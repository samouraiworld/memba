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

// defaultSapphireFallbacks are the backup sapphire RPC nodes tried, in order,
// when the primary endpoint is unreachable. They mirror the trusted sapphire
// nodes the frontend already fails over to (frontend/src/lib/config.ts
// sapphire rpcUrl + fallbackRpcUrls) plus our own sentry. Used ONLY on a
// transport error from the primary — a valid "no record" answer never
// triggers failover.
var defaultSapphireFallbacks = []string{
	"https://rpc.sapphire.testnets.gno.land:443", // public canonical
	"https://sapphire.rpc.onbloc.xyz:443",        // onbloc's node (what Adena ships)
	"https://rpc.sapphire.samourai.live:443",     // our sentry (51.159.105.229)
	// ⚠️ MEASURED 2026-08-10 on topaz, and the lesson carries: the public
	// canonical node returned **HTTP 403** to the Fly egress IP under the feed
	// tailer's poll rate (/status every 3s plus 2+ calls per block during
	// catch-up) — the #457/#462/#466 behaviour, presenting as 403, not 429.
	// Low-volume reads through this list are unaffected — only sustained
	// polling trips it. That is why FEED_RPC_URL must point at a DIFFERENT
	// node than GNO_RPC_URL (our sentry vs the canonical), and why the indexer
	// having no failover of its own is a real gap rather than a theoretical
	// one. Set RPC_FALLBACK_URLS to add nodes without a code change.
}

// rpcFallbackURLs returns the ordered backup node list. RPC_FALLBACK_URLS
// (comma-separated) overrides the built-in list; blank entries are dropped and
// surrounding whitespace trimmed. An unset/empty env yields the sapphire default.
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
	return defaultSapphireFallbacks
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
