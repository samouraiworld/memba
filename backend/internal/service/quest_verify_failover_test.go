package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestQuestAbciQuery_FailsOver(t *testing.T) {
	// Primary node is throttled (503); the backup verifies the quest.
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer down.Close()
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeAbciData(w, "VERIFIED") // helper from render_proxy_failover_test.go
	}))
	defer good.Close()

	t.Setenv("RPC_FALLBACK_URLS", good.URL)

	got, err := questAbciQuery(context.Background(), down.URL, "vm/qrender", "gno.land/r/x:")
	if err != nil {
		t.Fatalf("expected failover success, got err: %v", err)
	}
	if got != "VERIFIED" {
		t.Fatalf("got %q, want VERIFIED from the backup node", got)
	}
}

func TestQuestAbciQuery_ValidEmptyDoesNotFailOver(t *testing.T) {
	// Primary answers 200 with a present ABCI error (a legitimate "requirement
	// not met"). Failover MUST NOT fire — verification reads the primary's
	// authoritative empty, not a different node. The backup must never be hit.
	var backupHits int
	backup := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		backupHits++
		writeAbciData(w, "SHOULD_NOT_BE_USED")
	}))
	defer backup.Close()
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":{"response":{"ResponseBase":{"Data":"","Error":{"@type":"/std.InvalidAddressError"}}}}}`))
	}))
	defer primary.Close()

	t.Setenv("RPC_FALLBACK_URLS", backup.URL)

	got, err := questAbciQuery(context.Background(), primary.URL, "vm/qrender", "gno.land/r/x:")
	if err != nil {
		t.Fatalf("a present ABCI error must be a clean empty, got err: %v", err)
	}
	if got != "" {
		t.Fatalf("got %q, want empty for no-record", got)
	}
	if backupHits != 0 {
		t.Fatalf("backup hit %d times; a valid empty must not fail over", backupHits)
	}
}
