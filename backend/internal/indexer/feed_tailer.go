package indexer

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// FeedTailerConfig holds the feed indexer's runtime configuration (env-driven).
// It is intentionally separate from TailerConfig: the feed indexer runs its own
// goroutine, cursor, and raw ledger so it is fully decoupled from the NFT
// money-path tailer.
type FeedTailerConfig struct {
	RPCURL        string        // FEED_RPC_URL (falls back to NFT_RPC_URL)
	WatchedRealms []string      // FEED_WATCHED_REALMS (memba_feed_v1 pkg path)
	StartBlock    int64         // FEED_START_BLOCK (first-run cursor floor)
	Interval      time.Duration // FEED_TAILER_INTERVAL
	Confirmations int64         // FEED_CONFIRMATIONS (blocks behind tip; default 5)
	Logger        *slog.Logger
}

// StartFeedTailer launches a background goroutine that tails /block_results,
// parses memba_feed_v1 chain.Emit events, and projects them into feed_posts.
// It stops on context cancellation. Errors are logged, never fatal.
//
// Reorg handling mirrors the NFT tailer (single-block-deep, self-healing) but
// the rollback is a plain delete of feed rows at/above the reorged height —
// the feed has no money aggregates to recompute, and every projection write is
// idempotent so a replay double-applies to the same state. KNOWN LIMITATION
// (acceptable for non-financial social content): an *edit/delete* whose block
// is reorged away leaves the projection showing the mutated body until the
// realm re-emits; a full rebuild-from-raw reconcile is a P1+ hardening.
func StartFeedTailer(ctx context.Context, database *sql.DB, cfg FeedTailerConfig) {
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
		cfg.Logger.Warn("feed tailer: no watched realms configured — not starting")
		return
	}

	watched := make(map[string]struct{}, len(cfg.WatchedRealms))
	for _, r := range cfg.WatchedRealms {
		if r = strings.TrimSpace(r); r != "" {
			watched[r] = struct{}{}
		}
	}

	client := &http.Client{Timeout: 15 * time.Second}
	src := &httpBlockSource{client: client, rpcURL: cfg.RPCURL}

	go func() {
		cfg.Logger.Info("feed tailer: started",
			"rpc", cfg.RPCURL,
			"watched_realms", cfg.WatchedRealms,
			"start_block", cfg.StartBlock,
		)
		// One-time opportunistic backfill of block_ts for posts created before
		// migration 019 (block_ts=0 → the UI rendered "block 12345" instead of a
		// relative time). Idempotent and bounded; retried on restart if the RPC
		// was unavailable. Panic-isolated so a bad block never stops the tailer.
		runRecovered(cfg.Logger, "feed_blockts_backfill", func() {
			backfillMissingBlockTimes(ctx, database, src, cfg.Logger)
		})
		ticker := time.NewTicker(cfg.Interval)
		defer ticker.Stop()
		for {
			runRecovered(cfg.Logger, "feed_tailer", func() {
				feedTailOnce(ctx, database, cfg, watched, src)
			})
			select {
			case <-ctx.Done():
				cfg.Logger.Info("feed tailer: stopped")
				return
			case <-ticker.C:
			}
		}
	}()
}

// feedTailOnce advances the feed cursor toward the confirmed tip, processing up
// to maxBlocksPerCycle blocks. All errors are logged and swallowed.
func feedTailOnce(ctx context.Context, db *sql.DB, cfg FeedTailerConfig, watched map[string]struct{}, src blockSource) {
	log := cfg.Logger

	latest, err := src.LatestHeight(ctx)
	if err != nil {
		log.Warn("feed tailer: latest height fetch failed", "error", err)
		return
	}

	cursor, storedHash, err := loadFeedCursor(ctx, db, cfg.WatchedRealms, cfg.StartBlock)
	if err != nil {
		log.Warn("feed tailer: load cursor failed", "error", err)
		return
	}

	// Single-block-deep reorg check (see StartFeedTailer doc).
	if storedHash != "" {
		chainHash, err := src.BlockHash(ctx, cursor)
		if err != nil {
			log.Warn("feed tailer: block hash fetch failed (reorg check)", "height", cursor, "error", err)
			return
		}
		if chainHash != storedHash {
			log.Warn("feed tailer: reorg detected — rolling back", "height", cursor,
				"stored_hash", storedHash, "chain_hash", chainHash)
			if err := rollbackFeedFromHeight(ctx, db, cursor); err != nil {
				log.Warn("feed tailer: rollback failed", "height", cursor, "error", err)
				return
			}
			cursor--
			// Floor the rewind: a persistently-mismatching hash (e.g. an RPC LB
			// returning an unstable hash for a height) must not walk the cursor
			// arbitrarily far back and trigger an ever-growing re-scan.
			if floor := cfg.StartBlock - 1; cursor < floor {
				cursor = floor
			}
		}
	}

	end := confirmedEnd(latest, cfg.Confirmations, cursor, maxBlocksPerCycle)
	if end <= cursor {
		return
	}

	for h := cursor + 1; h <= end; h++ {
		if ctx.Err() != nil {
			return
		}
		hash, err := src.BlockHash(ctx, h)
		if err != nil {
			log.Warn("feed tailer: block hash fetch failed", "height", h, "error", err)
			return
		}
		events, err := src.BlockEvents(ctx, h)
		if err != nil {
			log.Warn("feed tailer: block_results fetch failed", "height", h, "error", err)
			return
		}
		// Deterministic per-post timestamp: the block header time, denormalized
		// at ingest (survives rebuild-from-raw, unlike the ingest wall-clock).
		// Fetched only when the block carries a watched event.
		blockTime := int64(0)
		if hasWatched(events, watched) {
			blockTime, err = src.BlockTime(ctx, h)
			if err != nil {
				log.Warn("feed tailer: block time fetch failed", "height", h, "error", err)
				return
			}
		}
		for _, ev := range events {
			if _, ok := watched[ev.PkgPath]; !ok {
				continue
			}
			if err := dispatchFeedEvent(ctx, db, ev, hash, blockTime); err != nil {
				log.Warn("feed tailer: dispatch failed — will retry block",
					"height", h, "type", ev.Type, "error", err)
				return
			}
		}
		if err := saveFeedCursor(ctx, db, cfg.WatchedRealms, h, hash); err != nil {
			log.Warn("feed tailer: save cursor failed", "height", h, "error", err)
			return
		}
	}
}

// hasWatched reports whether any event in the block belongs to a watched realm
// — the guard that keeps block-time fetches to blocks that actually matter.
func hasWatched(events []GnoEvent, watched map[string]struct{}) bool {
	for _, ev := range events {
		if _, ok := watched[ev.PkgPath]; ok {
			return true
		}
	}
	return false
}

// loadFeedCursor returns the minimum last_processed_block across the watched
// realms (so no realm's events are skipped) plus the stored hash for that row.
// Defaults to (startBlock-1, "") when unset.
func loadFeedCursor(ctx context.Context, db *sql.DB, realms []string, startBlock int64) (int64, string, error) {
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
			`SELECT last_processed_block, block_hash FROM feed_indexer_state WHERE realm_path = ?`, realm).
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

// saveFeedCursor records height and blockHash as the last processed block for
// every watched realm.
func saveFeedCursor(ctx context.Context, db *sql.DB, realms []string, height int64, blockHash string) error {
	for _, realm := range realms {
		realm = strings.TrimSpace(realm)
		if realm == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO feed_indexer_state (realm_path, last_processed_block, block_hash, updated_at)
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

// rollbackFeedFromHeight deletes feed rows at or above `height`: the raw-ledger
// rows and any posts CREATED in those blocks. Mutations (edits/deletes/flags)
// applied in rolled-back blocks are re-applied idempotently on replay; see the
// KNOWN LIMITATION in StartFeedTailer for the residual edit-reorg case.
func rollbackFeedFromHeight(ctx context.Context, db *sql.DB, height int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	for _, stmt := range []string{
		`DELETE FROM feed_raw_events WHERE event_block >= ?`,
		`DELETE FROM feed_posts WHERE created_event_block >= ?`,
	} {
		if _, err := tx.ExecContext(ctx, stmt, height); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// maxBlockTimeBackfillPerRun bounds the opportunistic block_ts backfill so a
// large pre-migration backlog can't fire an unbounded burst of /block reads at
// startup. Remaining rows fill on the next restart (idempotent).
const maxBlockTimeBackfillPerRun = 500

// backfillMissingBlockTimes fills block_ts for feed_posts rows created before
// migration 019 (block_ts=0, block_h>0). It reads the block header time — the
// SAME deterministic source as ingest — so a backfilled value survives a later
// rebuild-from-raw. One /block read per distinct height; per-height failures are
// logged and skipped (not fatal); already-stamped rows are never touched.
func backfillMissingBlockTimes(ctx context.Context, db *sql.DB, src blockSource, log *slog.Logger) {
	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT block_h FROM feed_posts
		WHERE block_ts = 0 AND block_h > 0
		ORDER BY block_h
		LIMIT ?`, maxBlockTimeBackfillPerRun)
	if err != nil {
		log.Warn("feed tailer: block_ts backfill query failed", "error", err)
		return
	}
	var heights []int64
	for rows.Next() {
		var h int64
		if err := rows.Scan(&h); err != nil {
			log.Warn("feed tailer: block_ts backfill scan failed", "error", err)
			continue
		}
		heights = append(heights, h)
	}
	// Close before issuing writes: sqlite serializes an open read cursor against
	// a write on the same connection.
	_ = rows.Close()
	if len(heights) == 0 {
		return
	}

	filled := 0
	for _, h := range heights {
		ts, err := src.BlockTime(ctx, h)
		if err != nil {
			log.Warn("feed tailer: block_ts backfill time fetch failed", "height", h, "error", err)
			continue
		}
		if ts <= 0 {
			continue
		}
		if _, err := db.ExecContext(ctx,
			`UPDATE feed_posts SET block_ts = ? WHERE block_h = ? AND block_ts = 0`, ts, h); err != nil {
			log.Warn("feed tailer: block_ts backfill update failed", "height", h, "error", err)
			continue
		}
		filled++
	}
	if filled > 0 {
		log.Info("feed tailer: backfilled block_ts for pre-migration posts", "heights_filled", filled)
	}
}

// FeedIndexerLastBlock returns the max last_processed_block across the feed
// realms (staleness signal for the RPC), or 0 if unset.
func FeedIndexerLastBlock(ctx context.Context, db *sql.DB) int64 {
	var v sql.NullInt64
	_ = db.QueryRowContext(ctx,
		`SELECT MAX(last_processed_block) FROM feed_indexer_state`).Scan(&v)
	if v.Valid {
		return v.Int64
	}
	return 0
}
