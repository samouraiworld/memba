package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRPCURLsInOrder_PrimaryFirstDeduped(t *testing.T) {
	t.Setenv("RPC_FALLBACK_URLS", "") // built-in default list
	primary := "https://rpc.testnet13.samourai.live:443"
	got := rpcURLsInOrder(primary)
	if len(got) < 2 {
		t.Fatalf("want primary + fallbacks, got %v", got)
	}
	if got[0] != primary {
		t.Fatalf("primary must be first, got %q", got[0])
	}
	seen := map[string]bool{}
	for _, u := range got {
		if seen[u] {
			t.Fatalf("duplicate url %q in %v", u, got)
		}
		seen[u] = true
	}
}

func TestRPCURLsInOrder_PrimaryAlsoInFallbacks_NoDup(t *testing.T) {
	primary := "https://node-a:443"
	t.Setenv("RPC_FALLBACK_URLS", "https://node-a:443,https://node-b:443")
	got := rpcURLsInOrder(primary)
	want := []string{"https://node-a:443", "https://node-b:443"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %v, want %v (primary deduped from fallbacks)", got, want)
	}
}

func TestRPCFallbackURLs_EnvOverride(t *testing.T) {
	t.Setenv("RPC_FALLBACK_URLS", " https://x:443 , ,https://y:443 ")
	got := rpcFallbackURLs()
	if len(got) != 2 || got[0] != "https://x:443" || got[1] != "https://y:443" {
		t.Fatalf("got %v, want trimmed [x, y] with blanks dropped", got)
	}
}

func TestHTTPGetJSONResilient_FailsOver(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer down.Close()
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer good.Close()
	t.Setenv("RPC_FALLBACK_URLS", good.URL)

	var out struct {
		OK bool `json:"ok"`
	}
	if err := httpGetJSONResilient(context.Background(), down.URL, "/status", &out); err != nil {
		t.Fatalf("expected failover success, got %v", err)
	}
	if !out.OK {
		t.Fatal("expected ok=true from the backup node")
	}
}
