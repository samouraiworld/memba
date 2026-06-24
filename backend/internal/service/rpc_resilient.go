package service

import (
	"context"
	"os"
	"slices"
	"strings"
	"time"
)

// rpcAttemptTimeout bounds a single RPC node attempt. The failover wrapper
// provides redundancy, so each attempt is deliberately short (matches the
// frontend's rpcFallback.ts RPC_TIMEOUT) to cap the cost of a hanging node
// before advancing to the next.
//
// KNOWN LIMITATION (tracked follow-up): there is no last-known-good memoization,
// so during a primary outage every call re-probes the dead primary first; on the
// home snapshot's ~8 sequential sources a *hanging* (not fast-failing) primary
// compounds (up to rpcAttemptTimeout × sources). A bounded-TTL last-good memo +
// propagating the inbound ctx deadline into the *Once HTTP calls would cap this;
// deferred (the realistic fast-fail outage already fails over near-instantly).
const rpcAttemptTimeout = 8 * time.Second

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
