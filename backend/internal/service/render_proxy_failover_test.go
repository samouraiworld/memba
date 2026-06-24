package service

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
)

// writeAbciData writes a valid JSON-RPC abci_query response whose
// ResponseBase.Data base64-decodes to `payload`.
func writeAbciData(w http.ResponseWriter, payload string) {
	data := base64.StdEncoding.EncodeToString([]byte(payload))
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"result":{"response":{"ResponseBase":{"Data":"` + data + `","Error":null}}}}`))
}

func TestAbciQuery_FailsOverToHealthyNode(t *testing.T) {
	// Primary node is down (502); the backup answers.
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer down.Close()
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeAbciData(w, "RENDER_OK")
	}))
	defer good.Close()

	t.Setenv("RPC_FALLBACK_URLS", good.URL) // single backup = the good node

	got, err := abciQuery(down.URL, "vm/qrender", "gno.land/r/x:")
	if err != nil {
		t.Fatalf("expected failover success, got err: %v", err)
	}
	if got != "RENDER_OK" {
		t.Fatalf("got %q, want RENDER_OK from the backup node", got)
	}
}

func TestAbciQuery_ValidEmptyDoesNotFailOver(t *testing.T) {
	// The primary answers 200 with a present ABCI error (a legitimate "no
	// record"). Failover MUST NOT fire; the backup must never be hit.
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

	got, err := abciQuery(primary.URL, "bank/balances/g1invalid", "")
	if err != nil {
		t.Fatalf("a present ABCI error should be a clean empty result, got err: %v", err)
	}
	if got != "" {
		t.Fatalf("got %q, want empty string for no-record", got)
	}
	if backupHits != 0 {
		t.Fatalf("backup was hit %d times; a valid empty must not trigger failover", backupHits)
	}
}

func TestAbciQuery_AllNodesDownReturnsError(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer down.Close()
	t.Setenv("RPC_FALLBACK_URLS", down.URL)

	_, err := abciQuery(down.URL, "vm/qrender", "gno.land/r/x:")
	if err == nil {
		t.Fatal("expected an error when every node is down")
	}
}
