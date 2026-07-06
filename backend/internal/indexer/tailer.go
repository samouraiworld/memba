package indexer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/samouraiworld/memba/backend/internal/metrics"
)

const (
	defaultTailerInterval = 3 * time.Second
	// defaultStartBlock avoids scanning all of genesis on first run. The NFT
	// realms were deployed on test13 well after this height; operators can
	// override via NFT_START_BLOCK. Documented in .env.example.
	defaultStartBlock = int64(260000)
	// maxBlocksPerCycle caps how many blocks one catch-up cycle processes so a
	// far-behind cursor doesn't hold the loop (and the DB writer) indefinitely.
	maxBlocksPerCycle = 500
)

// blockSource is the RPC seam used by tailOnce. The production implementation
// delegates to the package-level HTTP helpers; tests substitute a fake.
type blockSource interface {
	LatestHeight(ctx context.Context) (int64, error)
	BlockHash(ctx context.Context, height int64) (string, error)
	BlockEvents(ctx context.Context, height int64) ([]GnoEvent, error)
	// BlockTime returns the block header time (unix seconds) at a height. Used
	// by the feed tailer to denormalize a deterministic per-post timestamp.
	BlockTime(ctx context.Context, height int64) (int64, error)
}

// httpBlockSource is the production blockSource: thin wrappers around the
// existing fetchLatestHeight / fetchBlockHash / fetchBlockEvents helpers. It
// deliberately does not inline their logic so those helpers remain testable
// independently and their signatures stay stable.
type httpBlockSource struct {
	client *http.Client
	rpcURL string
}

func (s *httpBlockSource) LatestHeight(ctx context.Context) (int64, error) {
	return fetchLatestHeight(ctx, s.client, s.rpcURL)
}

func (s *httpBlockSource) BlockHash(ctx context.Context, height int64) (string, error) {
	return fetchBlockHash(ctx, s.client, s.rpcURL, height)
}

func (s *httpBlockSource) BlockEvents(ctx context.Context, height int64) ([]GnoEvent, error) {
	return fetchBlockEvents(ctx, s.client, s.rpcURL, height)
}

func (s *httpBlockSource) BlockTime(ctx context.Context, height int64) (int64, error) {
	return fetchBlockTime(ctx, s.client, s.rpcURL, height)
}

// TailerConfig holds the block-tailer's runtime configuration (env-driven).
type TailerConfig struct {
	RPCURL           string        // NFT_RPC_URL
	WatchedRealms    []string      // NFT_WATCHED_REALMS (market + collection pkg paths)
	SaleVolumeRealms []string      // NFT_SALE_VOLUME_REALMS (engines whose volume comes from Sale only)
	StartBlock       int64         // NFT_START_BLOCK (first-run cursor floor)
	Interval         time.Duration // NFT_POLL_INTERVAL (reused; tailer sleep when caught up)
	Confirmations    int64         // NFT_CONFIRMATIONS (blocks behind tip before processing; default 5)
	Logger           *slog.Logger
}

// StartNFTTailer launches a background goroutine that tails gno.land
// /block_results, parses chain.Emit GnoEvents from the watched realms, and
// writes normalized rows. It stops on context cancellation. Errors are logged,
// never fatal: one bad block is retried on the next cycle.
func StartNFTTailer(ctx context.Context, database *sql.DB, cfg TailerConfig) {
	if cfg.Interval <= 0 {
		cfg.Interval = defaultTailerInterval
	}
	if cfg.StartBlock <= 0 {
		cfg.StartBlock = defaultStartBlock
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Confirmations <= 0 {
		cfg.Confirmations = 5
	}
	if len(cfg.WatchedRealms) == 0 {
		cfg.Logger.Warn("nft tailer: no watched realms configured — not starting")
		return
	}

	watched := make(map[string]struct{}, len(cfg.WatchedRealms))
	for _, r := range cfg.WatchedRealms {
		if r = strings.TrimSpace(r); r != "" {
			watched[r] = struct{}{}
		}
	}

	saleVolumeSet := make(map[string]struct{}, len(cfg.SaleVolumeRealms))
	for _, r := range cfg.SaleVolumeRealms {
		if r = strings.TrimSpace(r); r != "" {
			saleVolumeSet[r] = struct{}{}
		}
	}

	client := &http.Client{Timeout: 15 * time.Second}
	src := &httpBlockSource{client: client, rpcURL: cfg.RPCURL}

	go func() {
		cfg.Logger.Info("nft tailer: started",
			"rpc", cfg.RPCURL,
			"watched_realms", cfg.WatchedRealms,
			"sale_volume_realms", cfg.SaleVolumeRealms,
			"start_block", cfg.StartBlock,
		)

		ticker := time.NewTicker(cfg.Interval)
		defer ticker.Stop()

		for {
			tailOnce(ctx, database, cfg, watched, saleVolumeSet, src)
			select {
			case <-ctx.Done():
				cfg.Logger.Info("nft tailer: stopped")
				return
			case <-ticker.C:
			}
		}
	}()
}

// tailOnce advances the cursor toward the chain tip, processing up to
// maxBlocksPerCycle confirmed blocks. All errors are logged and swallowed so
// the loop keeps running.
func tailOnce(ctx context.Context, db *sql.DB, cfg TailerConfig, watched map[string]struct{}, saleVolumeSet map[string]struct{}, src blockSource) {
	log := cfg.Logger

	latest, err := src.LatestHeight(ctx)
	if err != nil {
		log.Warn("nft tailer: latest height fetch failed", "error", err)
		return
	}
	metrics.IndexerChainHead.Set(float64(latest))

	cursor, storedHash, err := loadCursor(ctx, db, cfg.WatchedRealms, cfg.StartBlock)
	if err != nil {
		log.Warn("nft tailer: load cursor failed", "error", err)
		return
	}

	// Compute and export indexer lag for alerting (Wave 1 hardening).
	lag := latest - cursor
	metrics.IndexerLag.Set(float64(lag))
	if lag > 30 {
		log.Warn("nft tailer: indexer lag exceeds threshold",
			"lag_blocks", lag, "cursor", cursor, "chain_head", latest)
	}

	// Reorg detection: if we have a stored hash for the cursor block, re-fetch
	// the chain's hash for that block and compare. A mismatch means the cursor
	// block was replaced — roll back and replay from cursor-1.
	//
	// Recovery depth: this is intentionally SINGLE-BLOCK-DEEP. Only the cursor
	// block's hash is stored and re-validated each cycle; a reorg whose divergence
	// is below the cursor (i.e. a non-tip block whose events changed) would leave
	// stale rows because we only check the most-recently-processed height. This is
	// acceptable: the Confirmations depth (default 5) means any already-confirmed
	// block would require a fork ≥ Confirmations deep to reorg, which is
	// implausibly deep on gno.land's consensus. Full multi-block recovery would
	// require storing per-height block hashes in nft_indexer_state.
	if storedHash != "" {
		chainHash, err := src.BlockHash(ctx, cursor)
		if err != nil {
			log.Warn("nft tailer: block hash fetch failed (reorg check)", "height", cursor, "error", err)
			return
		}
		if chainHash != storedHash {
			log.Warn("nft tailer: reorg detected — rolling back",
				"height", cursor, "stored_hash", storedHash, "chain_hash", chainHash)
			if err := rollbackFromHeight(ctx, db, cursor); err != nil {
				log.Warn("nft tailer: rollback failed", "height", cursor, "error", err)
				return
			}
			// Walk the cursor back exactly one block per cycle. The replay loop
			// below re-processes from cursor+1 on the next call to tailOnce.
			//
			// If confirmedEnd returns <= cursor this cycle (e.g. the reorg
			// landed inside the confirmation window), nft_indexer_state still
			// holds the old hash so the next cycle re-detects the mismatch and
			// re-runs rollbackFromHeight as a harmless no-op (rows are already
			// gone) before walking back again. This self-heals within a couple of
			// cycles and is data-safe: idempotent inserts on replay mean we never
			// double-count.
			//
			// We do NOT synthesise a hash for cursor-1 here to suppress the
			// re-check: cursor-1 may itself lie on the reorged fork. Only blocks
			// we actually re-fetch and re-process have their hash persisted,
			// which is what keeps deep (multi-block) reorgs correct.
			cursor--
		}
	}

	end := confirmedEnd(latest, cfg.Confirmations, cursor, maxBlocksPerCycle)
	if end <= cursor {
		return // no confirmed work this cycle
	}

	for h := cursor + 1; h <= end; h++ {
		if ctx.Err() != nil {
			return
		}
		hash, err := src.BlockHash(ctx, h)
		if err != nil {
			log.Warn("nft tailer: block hash fetch failed", "height", h, "error", err)
			return
		}
		events, err := src.BlockEvents(ctx, h)
		if err != nil {
			log.Warn("nft tailer: block_results fetch failed", "height", h, "error", err)
			return // retry from this height next cycle (don't advance cursor past a gap)
		}
		for _, ev := range events {
			if _, ok := watched[ev.PkgPath]; !ok {
				continue
			}
			if err := dispatchEventScoped(ctx, db, ev, hash, saleVolumeSet); err != nil {
				// Do NOT advance the cursor past a block we couldn't fully project.
				// The "recoverable by rebuild-from-raw" path the projections assume
				// does not exist, so a dropped event would be a permanent silent gap.
				// Stop here and reprocess this block next cycle; the idempotent
				// INSERT OR IGNORE writes make replaying the applied events safe.
				log.Warn("nft tailer: dispatch failed — will retry block",
					"height", h, "type", ev.Type, "error", err)
				return
			}
		}
		if err := saveCursor(ctx, db, cfg.WatchedRealms, h, hash); err != nil {
			log.Warn("nft tailer: save cursor failed", "height", h, "error", err)
			return
		}
		metrics.IndexerLastBlock.Set(float64(h))
	}
}

// loadCursor returns the minimum last_processed_block across the watched realms
// (so no realm's events are skipped), plus the block_hash stored for the row
// that produced the minimum. Defaults to (startBlock-1, "", nil) when unset.
func loadCursor(ctx context.Context, db *sql.DB, realms []string, startBlock int64) (int64, string, error) {
	min := int64(-1)
	minHash := ""
	for _, realm := range realms {
		realm = strings.TrimSpace(realm)
		if realm == "" {
			continue
		}
		var last sql.NullInt64
		var hash sql.NullString
		err := db.QueryRowContext(ctx,
			`SELECT last_processed_block, block_hash FROM nft_indexer_state WHERE realm_path = ?`, realm).
			Scan(&last, &hash)
		var v int64
		var h string
		switch {
		case err == sql.ErrNoRows || !last.Valid:
			v = startBlock - 1
			h = ""
		case err != nil:
			return 0, "", err
		default:
			v = last.Int64
			h = hash.String
		}
		if min < 0 || v < min {
			min = v
			minHash = h
		}
	}
	if min < 0 {
		min = startBlock - 1
		minHash = ""
	}
	return min, minHash, nil
}

// saveCursor records height and blockHash as the last processed block for every
// watched realm.
func saveCursor(ctx context.Context, db *sql.DB, realms []string, height int64, blockHash string) error {
	for _, realm := range realms {
		realm = strings.TrimSpace(realm)
		if realm == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO nft_indexer_state (realm_path, last_processed_block, block_hash, updated_at)
			VALUES (?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(realm_path) DO UPDATE SET
				last_processed_block = excluded.last_processed_block,
				block_hash = excluded.block_hash,
				updated_at = CURRENT_TIMESTAMP`,
			realm, height, blockHash,
		); err != nil {
			return err
		}
	}
	return nil
}

// SeedRealmCursor records a realm's first-tail cursor at deployHeight-1 so a
// newly deployed engine is indexed from its deploy block (not genesis) without
// dragging the global min cursor backward. INSERT OR IGNORE: never rewinds a
// realm that has already advanced.
func SeedRealmCursor(ctx context.Context, db *sql.DB, realm string, deployHeight int64) error {
	_, err := db.ExecContext(ctx, `
		INSERT OR IGNORE INTO nft_indexer_state (realm_path, last_processed_block, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)`,
		realm, deployHeight-1,
	)
	return err
}

// ── RPC helpers ──────────────────────────────────────────────────────────────

type statusResponse struct {
	Result struct {
		SyncInfo struct {
			LatestBlockHeight string `json:"latest_block_height"`
		} `json:"sync_info"`
	} `json:"result"`
}

// fetchLatestHeight reads the chain tip from /status.
func fetchLatestHeight(ctx context.Context, client *http.Client, rpcURL string) (int64, error) {
	body, err := httpGet(ctx, client, rpcURL+"/status")
	if err != nil {
		return 0, err
	}
	var s statusResponse
	if err := json.Unmarshal(body, &s); err != nil {
		return 0, fmt.Errorf("decode status: %w", err)
	}
	h, err := strconv.ParseInt(s.Result.SyncInfo.LatestBlockHeight, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse latest height %q: %w", s.Result.SyncInfo.LatestBlockHeight, err)
	}
	return h, nil
}

// blockResponse decodes a tm2/gno /block response. The canonical block hash is
// nested under result.block_meta.block_id.hash on test13/tm2; some forks hoist it
// directly to result.block_id. Decode both; parseBlockHash prefers block_meta.
type blockResponse struct {
	Result struct {
		BlockMeta struct {
			BlockID struct {
				Hash string `json:"hash"`
			} `json:"block_id"`
			Header struct {
				Time string `json:"time"`
			} `json:"header"`
		} `json:"block_meta"`
		BlockID struct {
			Hash string `json:"hash"`
		} `json:"block_id"`
		Block struct {
			Header struct {
				Time string `json:"time"`
			} `json:"header"`
		} `json:"block"`
	} `json:"result"`
}

// blockHashFetchAttempts / blockHashRetryDelay harden fetchBlockHash against the
// test13 RPC endpoint (a multi-node load balancer) intermittently returning an
// empty block_id for a block that exists — which otherwise stalls the tailer's
// reorg-check on a transient empty. blockHashRetryDelay is a var so tests shorten it.
const blockHashFetchAttempts = 3

var blockHashRetryDelay = 500 * time.Millisecond

// fetchBlockHash fetches the block hash for a given height from /block?height=h.
// Retries a few times on a transient HTTP error or empty hash: the test13 RPC
// endpoint (a multi-node load balancer) intermittently returns an empty block_id
// for a block that exists, and without a retry the tailer's reorg-check stalls.
func fetchBlockHash(ctx context.Context, client *http.Client, rpcURL string, height int64) (string, error) {
	url := fmt.Sprintf("%s/block?height=%d", rpcURL, height)
	var lastErr error
	for attempt := range blockHashFetchAttempts {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(blockHashRetryDelay):
			}
		}
		body, err := httpGet(ctx, client, url)
		if err != nil {
			lastErr = err
			continue
		}
		hash, err := parseBlockHash(body, height)
		if err != nil {
			lastErr = err
			continue
		}
		return hash, nil
	}
	return "", fmt.Errorf("block %d: hash unavailable after %d attempts: %w", height, blockHashFetchAttempts, lastErr)
}

// parseBlockHash extracts the canonical block hash from a /block response body.
func parseBlockHash(body []byte, height int64) (string, error) {
	var b blockResponse
	if err := json.Unmarshal(body, &b); err != nil {
		return "", fmt.Errorf("decode block: %w", err)
	}
	hash := b.Result.BlockMeta.BlockID.Hash
	if hash == "" {
		hash = b.Result.BlockID.Hash // fallback for forks that hoist block_id
	}
	if hash == "" {
		return "", fmt.Errorf("block %d: empty block hash", height)
	}
	return hash, nil
}

// parseBlockTime extracts the block header time (unix seconds) from a /block
// response body. Deterministic — the same block always yields the same value,
// so it survives a rebuild-from-raw (unlike the ingest wall-clock created_at).
func parseBlockTime(body []byte, height int64) (int64, error) {
	var b blockResponse
	if err := json.Unmarshal(body, &b); err != nil {
		return 0, fmt.Errorf("decode block: %w", err)
	}
	ts := b.Result.BlockMeta.Header.Time
	if ts == "" {
		ts = b.Result.Block.Header.Time // fallback for forks that hoist block
	}
	if ts == "" {
		return 0, fmt.Errorf("block %d: empty block time", height)
	}
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return 0, fmt.Errorf("block %d: bad time %q: %w", height, ts, err)
	}
	return t.Unix(), nil
}

// fetchBlockTime fetches the block header time (unix seconds) for a height from
// /block?height=h — the same endpoint fetchBlockHash uses.
func fetchBlockTime(ctx context.Context, client *http.Client, rpcURL string, height int64) (int64, error) {
	url := fmt.Sprintf("%s/block?height=%d", rpcURL, height)
	body, err := httpGet(ctx, client, url)
	if err != nil {
		return 0, err
	}
	return parseBlockTime(body, height)
}

// fetchBlockEvents fetches and parses the watched GnoEvents at a height.
func fetchBlockEvents(ctx context.Context, client *http.Client, rpcURL string, height int64) ([]GnoEvent, error) {
	url := fmt.Sprintf("%s/block_results?height=%d", rpcURL, height)
	body, err := httpGet(ctx, client, url)
	if err != nil {
		return nil, err
	}
	return parseBlockResults(body, height)
}

func httpGet(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("http %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}
