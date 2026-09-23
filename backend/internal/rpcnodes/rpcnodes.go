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

// defaultMainnetFallbacks are the backup gno.land mainnet (gnoland-1) RPC
// nodes tried, in order, when the primary endpoint is unreachable: the public
// canonical (the frontend's mainnet rpcUrl in frontend/src/lib/config.ts) plus
// the Samourai-operated mainnet node (verified serving gnoland-1 2026-09-23).
// Used ONLY on a transport error from the primary — a valid "no record" answer
// never triggers failover.
//
// This list is LIVE in prod: RPC_FALLBACK_URLS is not set there, so whatever
// is written here is what the backend fails over to. Failover is transport-only
// (no chain-identity check), so every host here must serve gnoland-1 — a host
// from a retired chain is dead at best and answers from the wrong chain at
// worst. The sapphire list was exactly that from 2026-09-02, when both
// sapphire hosts stopped answering ahead of the 09-09 sunset; the pearl list
// this replaced (mainnet cutover, 2026-09-23) retired with pearl-1.
// rpcnodes_test.go pins the "mainnet only, no retired chain" invariant.
var defaultMainnetFallbacks = []string{
	"https://rpc.gno.land:443",          // public canonical
	"https://rpc.mainnet.samourai.live", // Samourai-operated mainnet node
	// ⚠️ MEASURED 2026-08-10 on topaz, and the lesson carries: the public
	// canonical node returned **HTTP 403** to the Fly egress IP under the feed
	// tailer's poll rate (/status every 3s plus 2+ calls per block during
	// catch-up) — the #457/#462/#466 behaviour, presenting as 403, not 429.
	// Low-volume reads through this list are unaffected — only sustained
	// polling trips it. That is why FEED_RPC_URL must point at a DIFFERENT
	// node than GNO_RPC_URL (our node vs the canonical), and why the indexer
	// having no failover of its own is a real gap rather than a theoretical
	// one. Set RPC_FALLBACK_URLS to add nodes without a code change.
}

// FallbackURLs returns the ordered backup node list. RPC_FALLBACK_URLS
// (comma-separated) overrides the built-in list; blank entries are dropped and
// surrounding whitespace trimmed. An unset/empty env yields the mainnet default.
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
	return defaultMainnetFallbacks
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
