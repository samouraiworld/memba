// Package rpcnodes owns the ordered gno RPC node list — the single source of
// truth for "which nodes, in which order" shared by every backend RPC caller
// (the service layer's resilient JSON fetches and the indexer tailers' block
// reads). It moved out of internal/service so internal/indexer could use it:
// service imports indexer, so the dependency can only point this way.
package rpcnodes

import (
	"os"
	"slices"
	"strings"
)

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

// FallbackURLs returns the ordered backup node list. RPC_FALLBACK_URLS
// (comma-separated) overrides the built-in list; blank entries are dropped and
// surrounding whitespace trimmed. An unset/empty env yields the sapphire default.
func FallbackURLs() []string {
	if v := strings.TrimSpace(os.Getenv("RPC_FALLBACK_URLS")); v != "" {
		out := make([]string, 0, 4)
		for u := range strings.SplitSeq(v, ",") {
			if t := strings.TrimSpace(u); t != "" {
				out = append(out, t)
			}
		}
		return out
	}
	return defaultSapphireFallbacks
}

// URLsInOrder returns [primary, ...fallbacks] with duplicates removed and
// order preserved. The primary (already env-resolved by the caller's *RPCURL()
// helper) is always tried first.
func URLsInOrder(primary string) []string {
	urls := []string{primary}
	for _, u := range FallbackURLs() {
		if !slices.Contains(urls, u) {
			urls = append(urls, u)
		}
	}
	return urls
}
