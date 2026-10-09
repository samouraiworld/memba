package arcade

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/samouraiworld/memba/backend/internal/address"
)

// FreePlayChain is a committed-state transport, not a client-provided receipt.
// Lookup must validate the RPC's chain ID and the realm's schema/config getters.
// Anchor must return only a canonical transaction hash, never arbitrary stdout.
// No production signer is provided by this preparation-only foundation.
type FreePlayChain interface {
	Lookup(context.Context, FreePlayTarget, string) (FreePlayReceipt, bool, error)
	Anchor(context.Context, FreePlayTarget, FreePlayEntry, FreePlayQuote) (string, error)
}

// FreePlaySpending must atomically reserve a durable per-day spend allowance
// before EACH possible broadcast, including retries, within the approved quote.
// A nil policy cannot broadcast. Budget implementations require separate review.
type FreePlaySpending interface {
	ReserveAttempt(context.Context, FreePlayRun, FreePlayQuote) error
}

type FreePlayPublisher struct {
	// Dedicated v2 signer: all writers for this account must use this DB lease.
	Signer   string
	Enabled  bool
	Store    *FreePlayStore
	Chain    FreePlayChain
	Spending FreePlaySpending
	Now      func() time.Time
}

func ValidateFreePlayReceipt(run FreePlayRun, r FreePlayReceipt) error {
	if r.SchemaVersion != 2 || r.Target != run.Target || r.Entry != run.Entry || r.Height <= 0 {
		return ErrFreePlayReceipt
	}
	a, err := address.Parse(r.Attester)
	if err != nil || a.Kind() != address.KindGno || a.String() != r.Attester {
		return ErrFreePlayReceipt
	}
	if r.TxHash != "" && !fpHex64.MatchString(r.TxHash) {
		return ErrFreePlayReceipt
	}
	return r.Entry.Validate()
}

// PublishOne does no background work unless explicitly called with every gate
// and dependency present. Every lease tries a readback before any broadcast.
func (p FreePlayPublisher) PublishOne(ctx context.Context) (bool, error) {
	if !p.Enabled || p.Store == nil || p.Chain == nil || p.Spending == nil || p.Signer == "" {
		return false, ErrFreePlayPaused
	}
	now := time.Now
	if p.Now != nil {
		now = p.Now
	}
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return false, err
	}
	// The bounded operation finishes before its lease can be acquired elsewhere.
	opCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	lease, ok, err := p.Store.Claim(opCtx, p.Signer, hex.EncodeToString(token[:]), now().Unix(), now().Add(time.Minute).Unix())
	if err != nil || !ok {
		return false, err
	}
	recordFailure := func(txHash string, e error) (bool, error) {
		// Preserve ambiguity even when the transport exhausted its context.
		saveCtx, stop := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer stop()
		if err := p.Store.saveAttempt(saveCtx, lease, txHash, e); err != nil {
			return true, err
		}
		return true, e
	}
	receipt, found, err := p.Chain.Lookup(opCtx, lease.Run.Target, lease.Run.Entry.RunID)
	if err != nil {
		return recordFailure("", err)
	}
	if found {
		return true, p.Store.confirm(opCtx, lease, receipt)
	}
	// An included tx may not yet be readable from this RPC. Do not spend again
	// while a persisted transaction's outcome is unknown; reconcile manually.
	if lease.TxHash != "" {
		return recordFailure("", errors.New("confirmation_pending"))
	}
	if lease.Quote.ExpiresAt <= now().Unix() {
		return recordFailure("", ErrFreePlayQuote)
	}
	if err := p.Spending.ReserveAttempt(opCtx, lease.Run, lease.Quote); err != nil {
		return recordFailure("", err)
	}
	if err := p.Store.reserveBroadcast(opCtx, lease); err != nil {
		return true, err
	}
	txHash, err := p.Chain.Anchor(opCtx, lease.Run.Target, lease.Run.Entry, lease.Quote)
	if err != nil {
		// An ambiguous send MUST be reconciled before another attempt. A sentinel
		// cannot masquerade as a receipt hash, but blocks automatic rebroadcast.
		return recordFailure("unknown", err)
	}
	if !fpHex64.MatchString(txHash) {
		return recordFailure("unknown", errors.New("invalid_transaction_hash"))
	}
	// Save the hash before readback; a failed save stops this invocation.
	if err := p.Store.saveAttempt(opCtx, lease, txHash, nil); err != nil {
		return true, err
	}
	receipt, found, err = p.Chain.Lookup(opCtx, lease.Run.Target, lease.Run.Entry.RunID)
	if err != nil {
		return true, err
	}
	if !found {
		return true, errors.New("confirmation_pending")
	}
	if receipt.TxHash != "" && receipt.TxHash != txHash {
		return true, ErrFreePlayReceipt
	}
	// The transport may only know the committed entry. Keep its evidence honest:
	// no guessed inclusion hash is added to a readback-only receipt.
	return true, p.Store.confirm(opCtx, lease, receipt)
}
