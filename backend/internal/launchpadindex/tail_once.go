package launchpadindex

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	ErrTailerConfig      = errors.New("invalid Launchpad tailer configuration")
	ErrSourceBehind      = errors.New("launchpad RPC source is behind stored cursor")
	ErrReorgBelowAnchor  = errors.New("launchpad reorg reached publication anchor")
	ErrInconsistentBlock = errors.New("inconsistent Launchpad block observations")
	ErrReorgScanLimit    = errors.New("launchpad reorg scan limit reached")
)

const (
	maxReorgScan = 64
	stepTimeout  = 30 * time.Second
)

// PublicationVerifier must check the successful submission and activation
// receipts, source bytes, transaction positions and their own block hashes.
// The RPC implementation remains unwired until a trusted release approval,
// coherent endpoint, single-writer deployment and release gates are in place.
type PublicationVerifier interface {
	VerifyPublication(context.Context, Scope, *PinnedRPCSource) error
}

// Tailer performs one verified journal action per Step. Its mutex prevents
// concurrent steps on this instance. Deployment must ensure one writer per
// scope across all processes before enabling it.
type Tailer struct {
	mu            sync.Mutex
	store         *Store
	source        *PinnedRPCSource
	verifier      PublicationVerifier
	confirmations int64
}

func NewTailer(store *Store, source *PinnedRPCSource, verifier PublicationVerifier, confirmations int64) (*Tailer, error) {
	if store == nil || store.db == nil || source == nil || source.client == nil ||
		verifier == nil || confirmations <= 0 {
		return nil, ErrTailerConfig
	}
	return &Tailer{store: store, source: source, verifier: verifier, confirmations: confirmations}, nil
}

// Step checks one pinned endpoint and either appends one confirmed block,
// rolls back to a common ancestor, or makes no change. Any read/parse failure
// before a journal action leaves durable rows and cursor unchanged.
func (t *Tailer) Step(ctx context.Context) (bool, error) {
	if t == nil {
		return false, ErrTailerConfig
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, stepTimeout)
	defer cancel()
	statusBody, err := t.source.status(ctx)
	if err != nil {
		return false, err
	}
	status, err := ParseReadyStatus(statusBody, t.store.scope.ChainID)
	if err != nil {
		return false, err
	}
	safeTip := status.LatestHeight - t.confirmations
	cursor, err := t.store.Cursor(ctx)
	if err != nil {
		return false, err
	}
	if safeTip < t.store.scope.PublicationHeight {
		if cursor.Height > t.store.scope.PublicationHeight-1 {
			return false, ErrSourceBehind
		}
		return false, nil
	}
	activation, err := t.readHeader(ctx, t.store.scope.PublicationHeight)
	if err != nil {
		return false, err
	}
	if activation.Hash != t.store.scope.PublicationHash ||
		activation.ParentHash != t.store.scope.PublicationParentHash {
		return false, ErrReorgBelowAnchor
	}
	if err := t.verifier.VerifyPublication(ctx, t.store.scope, t.source); err != nil {
		return false, fmt.Errorf("verify Launchpad publication: %w", err)
	}
	if safeTip < cursor.Height {
		return false, ErrSourceBehind
	}
	observed, err := t.readHeader(ctx, cursor.Height)
	if err != nil {
		return false, err
	}
	if observed.Hash != cursor.Hash {
		return t.rollbackToCommonAncestor(ctx, cursor.Height)
	}
	if cursor.Height == safeTip {
		return false, nil
	}
	next := cursor.Height + 1
	before, err := t.readHeader(ctx, next)
	if err != nil {
		return false, err
	}
	if before.ParentHash != cursor.Hash {
		return false, ErrInconsistentBlock
	}
	resultsBody, err := t.source.results(ctx, next)
	if err != nil {
		return false, err
	}
	minTx := 0
	if next == t.store.scope.PublicationHeight {
		minTx = t.store.scope.ActivationTxIndex
	}
	events, err := parseBlockResultsFromTx(resultsBody, next, minTx,
		next == t.store.scope.PublicationHeight, before.NumTxs)
	if err != nil {
		return false, err
	}
	after, err := t.readHeader(ctx, next)
	if err != nil {
		return false, err
	}
	if before != after {
		return false, ErrInconsistentBlock
	}
	activationAfter, err := t.readHeader(ctx, t.store.scope.PublicationHeight)
	if err != nil {
		return false, err
	}
	if activationAfter.Hash != activation.Hash || activationAfter.ParentHash != activation.ParentHash {
		return false, ErrReorgBelowAnchor
	}
	if err := t.store.AppendBlock(ctx, before, events); err != nil {
		return false, err
	}
	return true, nil
}

func (t *Tailer) readHeader(ctx context.Context, height int64) (BlockHeader, error) {
	body, err := t.source.block(ctx, height)
	if err != nil {
		return BlockHeader{}, err
	}
	return ParseBlockHeader(body, t.store.scope.ChainID, height)
}

func (t *Tailer) rollbackToCommonAncestor(ctx context.Context, current int64) (bool, error) {
	scanned := 0
	for height := current - 1; height >= t.store.scope.PublicationHeight; height-- {
		if scanned >= maxReorgScan {
			return false, ErrReorgScanLimit
		}
		scanned++
		stored, err := t.store.HashAt(ctx, height)
		if err != nil {
			return false, err
		}
		observed, err := t.readHeader(ctx, height)
		if err != nil {
			return false, err
		}
		if observed.Hash == stored {
			activation, err := t.readHeader(ctx, t.store.scope.PublicationHeight)
			if err != nil {
				return false, err
			}
			if activation.Hash != t.store.scope.PublicationHash ||
				activation.ParentHash != t.store.scope.PublicationParentHash {
				return false, ErrReorgBelowAnchor
			}
			if err := t.store.RollbackTo(ctx, Cursor{Height: height, Hash: stored}); err != nil {
				return false, err
			}
			return true, nil
		}
	}
	return false, ErrReorgBelowAnchor
}
