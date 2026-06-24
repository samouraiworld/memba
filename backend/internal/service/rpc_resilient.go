package service

import (
	"context"
	"os"
	"slices"
	"strings"
)

// defaultTest13Fallbacks are the backup test13 RPC nodes tried, in order, when
// the primary endpoint is unreachable. They mirror the trusted test13 nodes the
// frontend already fails over to (frontend/src/lib/config.ts test13 rpcUrl +
// fallbackRpcUrls + telemetry nodes). Used ONLY on a transport error from the
// primary — a valid "no record" answer never triggers failover.
var defaultTest13Fallbacks = []string{
	"https://rpc.test13.testnets.gno.land:443",        // public canonical
	"https://test13.rpc.onbloc.xyz:443",               // onbloc
	"https://rpc.test-13-aeddi-1.gnoland.network:443", // gno-core / aeddi
}

// rpcFallbackURLs returns the ordered backup node list. RPC_FALLBACK_URLS
// (comma-separated) overrides the built-in list; blank entries are dropped and
// surrounding whitespace trimmed. An unset/empty env yields the test13 default.
func rpcFallbackURLs() []string {
	if v := strings.TrimSpace(os.Getenv("RPC_FALLBACK_URLS")); v != "" {
		out := make([]string, 0, 4)
		for _, u := range strings.Split(v, ",") {
			if t := strings.TrimSpace(u); t != "" {
				out = append(out, t)
			}
		}
		return out
	}
	return defaultTest13Fallbacks
}

// rpcURLsInOrder returns [primary, ...fallbacks] with duplicates removed and
// order preserved. The primary (already env-resolved by the caller's *RPCURL()
// helper) is always tried first.
func rpcURLsInOrder(primary string) []string {
	urls := []string{primary}
	for _, u := range rpcFallbackURLs() {
		if !slices.Contains(urls, u) {
			urls = append(urls, u)
		}
	}
	return urls
}

// httpGetJSONResilient performs httpGetJSON against the primary base URL then
// each backup node until one succeeds. `base` is the RPC root (no trailing
// slash); `suffix` is the path+query (e.g. "/status", "/block?height=42").
// Returns the last error if every node fails.
func httpGetJSONResilient(ctx context.Context, base, suffix string, out any) error {
	var lastErr error
	for _, u := range rpcURLsInOrder(base) {
		if err := httpGetJSON(ctx, u+suffix, out); err != nil {
			lastErr = err
			continue
		}
		return nil
	}
	return lastErr
}
