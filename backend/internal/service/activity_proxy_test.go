package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleIndexerProxy_MethodNotAllowed(t *testing.T) {
	rec := httptest.NewRecorder()
	HandleIndexerProxy().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/indexer", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
}

func TestHandleIndexerProxy_EmptyBody(t *testing.T) {
	rec := httptest.NewRecorder()
	HandleIndexerProxy().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/indexer", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty body, got %d", rec.Code)
	}
}

func TestHandleIndexerProxy_RequestTooLarge(t *testing.T) {
	big := strings.NewReader(strings.Repeat("x", (8<<10)+10))
	rec := httptest.NewRecorder()
	HandleIndexerProxy().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/indexer", big))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", rec.Code)
	}
}

func TestHandleIndexerProxy_ForwardsAndRelays(t *testing.T) {
	const want = `{"data":{"latestBlockHeight":4242}}`
	var gotBody string
	var gotContentType string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		gotContentType = r.Header.Get("Content-Type")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, want)
	}))
	defer upstream.Close()
	t.Setenv("INDEXER_GRAPHQL_URL", upstream.URL)

	rec := httptest.NewRecorder()
	HandleIndexerProxy().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/indexer",
		strings.NewReader(`{"query":"{ latestBlockHeight }"}`)))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if got := strings.TrimSpace(rec.Body.String()); got != want {
		t.Fatalf("relayed body mismatch:\n got  %q\n want %q", got, want)
	}
	if gotBody != `{"query":"{ latestBlockHeight }"}` {
		t.Fatalf("upstream did not receive the forwarded query, got %q", gotBody)
	}
	if gotContentType != "application/json" {
		t.Fatalf("upstream content-type = %q, want application/json", gotContentType)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("relayed content-type = %q, want application/json", ct)
	}
}

func TestHandleIndexerProxy_UpstreamErrorIsBadGateway(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer upstream.Close()
	t.Setenv("INDEXER_GRAPHQL_URL", upstream.URL)

	rec := httptest.NewRecorder()
	HandleIndexerProxy().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/indexer",
		strings.NewReader(`{"query":"{ latestBlockHeight }"}`)))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 on upstream error, got %d", rec.Code)
	}
}
