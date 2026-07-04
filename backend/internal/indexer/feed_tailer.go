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
		ticker := time.NewTicker(cfg.Interval)
		defer ticker.Stop()
		for {
			feedTailOnce(ctx, database, cfg, watched, src)
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
		for _, ev := range events {
			if _, ok := watched[ev.PkgPath]; !ok {
				continue
			}
			if err := dispatchFeedEvent(ctx, db, ev, hash); err != nil {
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
