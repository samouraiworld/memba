package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// queryFunc is the injectable seam over abciQuery so assembleHomeSnapshot is
// unit-testable without a live chain. Defaults to the package-level abciQuery.
type queryFunc func(rpcURL, path, data string) (string, error)

// homeSnapshotRPCURL returns the RPC the home snapshot reads (test13 by default).
// IMPORTANT: do not use gnoRPCURL() here — it defaults to testnet12.
func homeSnapshotRPCURL() string {
	if v := os.Getenv("HOME_SNAPSHOT_RPC_URL"); v != "" {
		return v
	}
	if v := os.Getenv("NFT_RPC_URL"); v != "" {
		return v
	}
	return "https://rpc.test13.testnets.gno.land:443"
}

// homeSnapshotTTL is the cache window (default 30s, env HOME_SNAPSHOT_TTL as a Go duration).
func homeSnapshotTTL() time.Duration {
	if v := os.Getenv("HOME_SNAPSHOT_TTL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return 30 * time.Second
}

// cachedHomeSnapshot returns a fresh snapshot from cache, re-assembles on
// expiry, and serves the last-good value if re-assembly returns nil (stale).
func (s *MultisigService) cachedHomeSnapshot(
	ctx context.Context,
	chainID string,
	assemble func(context.Context, string) *membav1.HomeSnapshot,
) *membav1.HomeSnapshot {
	ttl := homeSnapshotTTL()

	s.homeCacheMu.RLock()
	cached, ok := s.homeCached[chainID]
	at := s.homeCachedAt[chainID]
	s.homeCacheMu.RUnlock()
	if ok && cached != nil && time.Since(at) < ttl {
		return cached // HIT
	}

	// The snapshot is single-network (test13) per spec §6, so the same RPC URL
	// serves every chain_id today. A future multi-chain deployment would resolve
	// the RPC URL from chainID here instead of calling homeSnapshotRPCURL().
	fresh := assemble(ctx, homeSnapshotRPCURL()) // MISS
	if fresh == nil {
		// Serve stale if we have any prior value.
		s.homeCacheMu.RLock()
		stale := s.homeCached[chainID]
		s.homeCacheMu.RUnlock()
		if stale != nil {
			slog.Warn("home snapshot assemble failed; serving stale", "chain_id", chainID)
			return stale
		}
		return nil
	}

	s.homeCacheMu.Lock()
	s.homeCached[chainID] = fresh
	s.homeCachedAt[chainID] = time.Now()
	s.homeCacheMu.Unlock()
	return fresh
}

// GetHomeSnapshot returns the cached, server-assembled global home payload.
// Public read (no auth). chain_id defaults to the server's configured chain.
func (s *MultisigService) GetHomeSnapshot(
	ctx context.Context,
	req *connect.Request[membav1.GetHomeSnapshotRequest],
) (*connect.Response[membav1.GetHomeSnapshotResponse], error) {
	chainID := req.Msg.GetChainId()
	if chainID == "" {
		chainID = s.chainID
	}

	snap := s.cachedHomeSnapshot(ctx, chainID, s.assembleHomeSnapshot)
	if snap == nil {
		// No cache and assembly produced nothing — return an empty snapshot
		// (non-breaking: the frontend treats this as "use Phase-1 fallback").
		snap = &membav1.HomeSnapshot{StaleSources: []string{"all"}}
	}
	return connect.NewResponse(&membav1.GetHomeSnapshotResponse{Snapshot: snap}), nil
}

// assembleHomeSnapshot builds the global snapshot from chain + DB sources.
// Each source is independently fault-tolerant (see Phase C). Returns a non-nil
// snapshot even when sources fail (their names go in stale_sources).
func (s *MultisigService) assembleHomeSnapshot(ctx context.Context, rpcURL string) *membav1.HomeSnapshot {
	snap := &membav1.HomeSnapshot{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Counts:      &membav1.EcosystemCounts{}, // initialise once; failed sources leave their field 0
	}

	// RPC source: network pulse (block height) from /status.
	if p, err := fetchNetworkPulse(ctx, rpcURL); err != nil {
		snap.StaleSources = append(snap.StaleSources, "network")
	} else {
		snap.Network = p
		snap.AsOfBlock = p.BlockHeight
	}

	// RPC source: validator-set health from /validators.
	if v, err := fetchValidatorsHealth(ctx, rpcURL); err != nil {
		snap.StaleSources = append(snap.StaleSources, "validators")
	} else {
		snap.ValidatorsHealth = v
		snap.Counts.Validators = v.Total
	}

	// DB source: collection count.
	if n, err := s.countCollections(ctx); err != nil {
		snap.StaleSources = append(snap.StaleSources, "collections")
	} else {
		snap.Counts.Collections = n
	}

	// DB source: highest block seen by the NFT indexer.
	if b, err := s.maxIndexerBlock(ctx); err != nil {
		snap.StaleSources = append(snap.StaleSources, "indexer_block")
	} else {
		snap.IndexerLastBlock = b
	}

	return snap
}

// countCollections returns the number of NFT collections tracked in the DB.
func (s *MultisigService) countCollections(ctx context.Context) (uint32, error) {
	var n uint32
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM nft_collections`).Scan(&n)
	return n, err
}

// maxIndexerBlock returns the highest last_processed_block across all indexed
// realms. Returns 0 when the table is empty (MAX returns NULL on an empty set).
func (s *MultisigService) maxIndexerBlock(ctx context.Context) (int64, error) {
	var b sql.NullInt64
	err := s.db.QueryRowContext(ctx, `SELECT MAX(last_processed_block) FROM nft_indexer_state`).Scan(&b)
	if err != nil {
		return 0, err
	}
	return b.Int64, nil
}

// httpGetJSON performs a GET to url, decodes the JSON body into out.
// Local replica of the indexer's unexported httpGet so we avoid a cross-package dep.
func httpGetJSON(ctx context.Context, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, out)
}

// fetchNetworkPulse calls rpcURL+"/status" and returns the current block height.
func fetchNetworkPulse(ctx context.Context, rpcURL string) (*membav1.NetworkPulse, error) {
	var s struct {
		Result struct {
			SyncInfo struct {
				LatestBlockHeight string `json:"latest_block_height"`
			} `json:"sync_info"`
		} `json:"result"`
	}
	if err := httpGetJSON(ctx, rpcURL+"/status", &s); err != nil {
		return nil, err
	}
	h, err := strconv.ParseInt(s.Result.SyncInfo.LatestBlockHeight, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("parse block height: %w", err)
	}
	return &membav1.NetworkPulse{BlockHeight: h}, nil
}

// fetchValidatorsHealth calls rpcURL+"/validators" and returns the validator-set
// health. Active and Total are set from the set size; Status is "healthy" unless
// the set is empty ("down"). AvgBlockTimeMs and per-validator uptime are not
// computed in v1 (left 0 per YAGNI).
func fetchValidatorsHealth(ctx context.Context, rpcURL string) (*membav1.ValidatorsHealth, error) {
	var v struct {
		Result struct {
			Validators []json.RawMessage `json:"validators"`
		} `json:"result"`
	}
	if err := httpGetJSON(ctx, rpcURL+"/validators", &v); err != nil {
		return nil, err
	}
	total := uint32(len(v.Result.Validators))
	status := "healthy"
	if total == 0 {
		status = "down"
	}
	return &membav1.ValidatorsHealth{Status: status, Active: total, Total: total}, nil
}
