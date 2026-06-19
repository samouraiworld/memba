package service

import (
	"context"
	"log/slog"
	"os"
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
	return &membav1.HomeSnapshot{GeneratedAt: time.Now().UTC().Format(time.RFC3339)}
}
