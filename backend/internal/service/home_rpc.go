package service

import (
	"os"
	"time"
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
