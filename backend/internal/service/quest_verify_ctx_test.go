package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestQuestAbciQuery_HonorsContextCancellation proves the inbound request ctx is
// threaded into the outbound RPC fan-out: when the caller's ctx is cancelled, an
// in-flight quest-verify query must abort promptly with a ctx error instead of
// blocking up to rpcAttemptTimeout (8s) per node on a hung RPC node. Without ctx
// threading this hangs until the per-attempt timeout fires and the test trips its
// own deadline.
func TestQuestAbciQuery_HonorsContextCancellation(t *testing.T) {
	// A node that accepts the connection then blocks forever (simulates a hung,
	// not fast-failing, RPC node — the costly case rpcAttemptTimeout guards).
	released := make(chan struct{})
	blocking := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		<-released // never written; unblocked only on server Close
	}))
	defer blocking.Close()
	defer close(released)

	// No fallbacks: the single primary is the blocking node.
	t.Setenv("RPC_FALLBACK_URLS", " ")

	ctx, cancel := context.WithCancel(context.Background())
	// Cancel shortly after the request is in flight.
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	_, err := questAbciQuery(ctx, blocking.URL, "vm/qrender", "gno.land/r/x:")
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected a context-cancellation error from a hung node, got nil")
	}
	// Must abort on cancellation, well under the 8s per-attempt timeout.
	if elapsed >= rpcAttemptTimeout {
		t.Fatalf("query took %v (>= rpcAttemptTimeout %v): ctx cancellation was not honored", elapsed, rpcAttemptTimeout)
	}
}
