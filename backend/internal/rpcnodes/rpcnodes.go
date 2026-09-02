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

// defaultPearlFallbacks are the backup pearl RPC nodes tried, in order, when
// the primary endpoint is unreachable. They mirror the pearl nodes the
// frontend already fails over to (frontend/src/lib/config.ts pearl rpcUrl +
// fallbackRpcUrls): the public canonical plus our own sentry. Used ONLY on a
// transport error from the primary — a valid "no record" answer never
// triggers failover.
//
// This list is LIVE in prod: RPC_FALLBACK_URLS is not set there, so whatever
// is written here is what the backend fails over to. Failover is transport-only
// (no chain-identity check), so every host here must serve pearl-1 — a host
// from a retired chain is dead at best and answers from the wrong chain at
// worst. The sapphire list this replaced was exactly that from 2026-09-02,
// when both sapphire hosts stopped answering ahead of the 09-09 sunset.
// rpcnodes_test.go pins the "pearl only, no retired chain" invariant.
var defaultPearlFallbacks = []string{
	"https://rpc.pearl.testnets.gno.land:443", // public canonical
	"https://rpc.pearl.samourai.live:443",     // our sentry
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
// surrounding whitespace trimmed. An unset/empty env yields the pearl default.
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
	return defaultPearlFallbacks
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
