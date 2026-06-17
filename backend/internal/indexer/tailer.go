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

// TailerConfig holds the block-tailer's runtime configuration (env-driven).
type TailerConfig struct {
	RPCURL        string        // NFT_RPC_URL
	WatchedRealms []string      // NFT_WATCHED_REALMS (market + collection pkg paths)
	StartBlock    int64         // NFT_START_BLOCK (first-run cursor floor)
	Interval      time.Duration // NFT_POLL_INTERVAL (reused; tailer sleep when caught up)
	Logger        *slog.Logger
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

	client := &http.Client{Timeout: 15 * time.Second}

	go func() {
		cfg.Logger.Info("nft tailer: started",
			"rpc", cfg.RPCURL,
			"watched_realms", cfg.WatchedRealms,
			"start_block", cfg.StartBlock,
		)

		ticker := time.NewTicker(cfg.Interval)
		defer ticker.Stop()

		for {
			tailOnce(ctx, database, cfg, watched, client)
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
// maxBlocksPerCycle blocks. All errors are logged and swallowed so the loop
// keeps running.
func tailOnce(ctx context.Context, db *sql.DB, cfg TailerConfig, watched map[string]struct{}, client *http.Client) {
	log := cfg.Logger

	latest, err := fetchLatestHeight(ctx, client, cfg.RPCURL)
	if err != nil {
		log.Warn("nft tailer: latest height fetch failed", "error", err)
		return
	}

	cursor, err := loadCursor(ctx, db, cfg.WatchedRealms, cfg.StartBlock)
	if err != nil {
		log.Warn("nft tailer: load cursor failed", "error", err)
		return
	}

	if cursor >= latest {
		return // caught up
	}

	end := latest
	if end > cursor+maxBlocksPerCycle {
		end = cursor + maxBlocksPerCycle
	}

	for h := cursor + 1; h <= end; h++ {
		if ctx.Err() != nil {
			return
		}
		events, err := fetchBlockEvents(ctx, client, cfg.RPCURL, h)
		if err != nil {
			log.Warn("nft tailer: block_results fetch failed", "height", h, "error", err)
			return // retry from this height next cycle (don't advance cursor past a gap)
		}
		for _, ev := range events {
			if _, ok := watched[ev.PkgPath]; !ok {
				continue
			}
			if err := dispatchEvent(ctx, db, ev); err != nil {
				log.Warn("nft tailer: dispatch failed",
					"height", h, "type", ev.Type, "error", err)
				// Continue: idempotent writes mean a later replay is safe.
			}
		}
		if err := saveCursor(ctx, db, cfg.WatchedRealms, h); err != nil {
			log.Warn("nft tailer: save cursor failed", "height", h, "error", err)
			return
		}
	}
}

// loadCursor returns the minimum last_processed_block across the watched realms
// (so no realm's events are skipped), defaulting to startBlock-1 when unset.
func loadCursor(ctx context.Context, db *sql.DB, realms []string, startBlock int64) (int64, error) {
	min := int64(-1)
	for _, realm := range realms {
		realm = strings.TrimSpace(realm)
		if realm == "" {
			continue
		}
		var last sql.NullInt64
		err := db.QueryRowContext(ctx,
			`SELECT last_processed_block FROM nft_indexer_state WHERE realm_path = ?`, realm).
			Scan(&last)
		var v int64
		switch {
		case err == sql.ErrNoRows || !last.Valid:
			v = startBlock - 1
		case err != nil:
			return 0, err
		default:
			v = last.Int64
		}
		if min < 0 || v < min {
			min = v
		}
	}
	if min < 0 {
		min = startBlock - 1
	}
	return min, nil
}

// saveCursor records height as the last processed block for every watched realm.
func saveCursor(ctx context.Context, db *sql.DB, realms []string, height int64) error {
	for _, realm := range realms {
		realm = strings.TrimSpace(realm)
		if realm == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO nft_indexer_state (realm_path, last_processed_block, updated_at)
			VALUES (?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(realm_path) DO UPDATE SET
				last_processed_block = excluded.last_processed_block,
				updated_at = CURRENT_TIMESTAMP`,
			realm, height,
		); err != nil {
			return err
		}
	}
	return nil
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
