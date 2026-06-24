package service

import (
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

	got, err := questAbciQuery(down.URL, "vm/qrender", "gno.land/r/x:")
	if err != nil {
		t.Fatalf("expected failover success, got err: %v", err)
	}
	if got != "VERIFIED" {
		t.Fatalf("got %q, want VERIFIED from the backup node", got)
	}
}
