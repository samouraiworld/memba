package indexer

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// W2-2 Hole 1: the tailers were the last RPC callers pinned to a single node —
// the topaz decommission stalled the feed for hours on exactly that. These
// tests pin the transport-level failover contract of httpGetFirst as consumed
// through the real fetch helpers.

func TestFetchLatestHeight_FailsOverPastDeadPrimary(t *testing.T) {
	alive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"result":{"sync_info":{"latest_block_height":"424242"}}}`))
	}))
	defer alive.Close()

	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	dead.Close() // connection refused from here on

	h, err := fetchLatestHeight(context.Background(), http.DefaultClient,
		[]string{dead.URL, alive.URL})
	if err != nil {
		t.Fatalf("failover past a dead primary should succeed, got: %v", err)
	}
	if h != 424242 {
		t.Fatalf("height = %d, want 424242 (the fallback's answer)", h)
	}
}

// The MEASURED production failure mode (2026-08-10): the canonical public node
// 403-throttles the Fly egress IP under tailer poll rates. A non-200 must
// advance to the next node, not surface as the final answer.
func TestFetchLatestHeight_FailsOverPast403Throttle(t *testing.T) {
	throttled := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer throttled.Close()

	alive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"result":{"sync_info":{"latest_block_height":"7"}}}`))
	}))
	defer alive.Close()

	h, err := fetchLatestHeight(context.Background(), http.DefaultClient,
		[]string{throttled.URL, alive.URL})
	if err != nil {
		t.Fatalf("failover past a 403-throttling primary should succeed, got: %v", err)
	}
	if h != 7 {
		t.Fatalf("height = %d, want 7", h)
	}
}

// Failover is TRANSPORT-level only: a 200 whose body fails to parse is the
// caller's problem (per-call retry policy), never a reason to silently prefer
// a different node's answer.
func TestFetchLatestHeight_ParseErrorDoesNotFailOver(t *testing.T) {
	garbage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"result":{"sync_info":{"latest_block_height":"not-a-number"}}}`))
	}))
	defer garbage.Close()

	var fallbackHits atomic.Int64
	alive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fallbackHits.Add(1)
		_, _ = w.Write([]byte(`{"result":{"sync_info":{"latest_block_height":"9"}}}`))
	}))
	defer alive.Close()

	_, err := fetchLatestHeight(context.Background(), http.DefaultClient,
		[]string{garbage.URL, alive.URL})
	if err == nil {
		t.Fatal("a parse failure on a 200 body must surface, not fail over")
	}
	if !strings.Contains(err.Error(), "parse latest height") {
		t.Fatalf("unexpected error: %v", err)
	}
	if fallbackHits.Load() != 0 {
		t.Fatal("fallback node was consulted on a parse error — failover must stay transport-level")
	}
}

// All nodes down → the last transport error surfaces (the tailer logs it and
// retries next cycle; nothing here may panic or spin).
func TestFetchLatestHeight_AllNodesDownReturnsLastError(t *testing.T) {
	dead1 := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	dead1.Close()
	dead2 := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	dead2.Close()

	if _, err := fetchLatestHeight(context.Background(), http.DefaultClient,
		[]string{dead1.URL, dead2.URL}); err == nil {
		t.Fatal("want an error when every node is unreachable")
	}
}

// BlockEvents rides the same failover path — one spot-check at a different
// endpoint so a future per-endpoint regression cannot hide behind /status.
func TestFetchBlockEvents_FailsOverPastDeadPrimary(t *testing.T) {
	alive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.String(), "/block_results") {
			t.Errorf("unexpected path %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"result":{"txs_results":null}}`))
	}))
	defer alive.Close()

	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	dead.Close()

	events, err := fetchBlockEvents(context.Background(), http.DefaultClient,
		[]string{dead.URL, alive.URL}, 42)
	if err != nil {
		t.Fatalf("failover past a dead primary should succeed, got: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("want empty events from an empty block, got %d", len(events))
	}
}
