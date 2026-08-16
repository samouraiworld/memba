package service

import (
	"context"
	"time"

	"github.com/samouraiworld/memba/backend/internal/rpcnodes"
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

// rpcFallbackURLs / rpcURLsInOrder are thin delegates to internal/rpcnodes —
// the node list moved there so the indexer tailers (which service imports, so
// they cannot import service back) share the exact same list, order, and
// RPC_FALLBACK_URLS override. Kept as package-local names so the existing
// callers (quest_verify.go, render_proxy.go, this file) read unchanged.
func rpcFallbackURLs() []string { return rpcnodes.FallbackURLs() }

func rpcURLsInOrder(primary string) []string { return rpcnodes.URLsInOrder(primary) }

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
