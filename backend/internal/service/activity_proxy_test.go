package service

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func indexerQuery(r *http.Request) string {
	var body struct {
		Query string `json:"query"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	return body.Query
}

func answerIndexerProof(w http.ResponseWriter, query, chainID string) bool {
	if strings.Contains(query, "latestBlockHeight") {
		_, _ = io.WriteString(w, `{"data":{"latestBlockHeight":4242}}`)
		return true
	}
	if strings.Contains(query, "getBlocks") {
		_, _ = io.WriteString(w, `{"data":{"getBlocks":[{"height":4242,"chain_id":"`+chainID+`"}]}}`)
		return true
	}
	return false
}

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
	var gotQuery string
	var gotContentType string
	var proofCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := indexerQuery(r)
		if strings.Contains(query, "getBlocks") || strings.Contains(query, "latestBlockHeight") {
			proofCalls.Add(1)
			answerIndexerProof(w, query, indexerChainID)
			return
		}
		gotQuery = query
		gotContentType = r.Header.Get("Content-Type")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, want)
	}))
	defer upstream.Close()
	t.Setenv("INDEXER_GRAPHQL_URL", upstream.URL)

	handler := HandleIndexerProxy()
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/indexer",
		strings.NewReader(`{"query":"{ transactions { hash } }"}`)))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if got := strings.TrimSpace(rec.Body.String()); got != want {
		t.Fatalf("relayed body mismatch:\n got  %q\n want %q", got, want)
	}
	if gotQuery != `{ transactions { hash } }` {
		t.Fatalf("upstream did not receive the forwarded query, got %q", gotQuery)
	}
	if gotContentType != "application/json" {
		t.Fatalf("upstream content-type = %q, want application/json", gotContentType)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("relayed content-type = %q, want application/json", ct)
	}
	// The next read reuses the short proof instead of doubling every page's
	// upstream requests. It still forwards the caller's own GraphQL document.
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/indexer",
		strings.NewReader(`{"query":"{ transactions { hash } }"}`)))
	if got := proofCalls.Load(); got != 2 {
		t.Fatalf("proof calls = %d, want 2 across two relay reads", got)
	}
}

func TestHandleIndexerProxy_UpstreamErrorIsBadGateway(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if answerIndexerProof(w, indexerQuery(r), indexerChainID) {
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer upstream.Close()
	t.Setenv("INDEXER_GRAPHQL_URL", upstream.URL)

	rec := httptest.NewRecorder()
	HandleIndexerProxy().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/indexer",
		strings.NewReader(`{"query":"{ transactions { hash } }"}`)))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 on upstream error, got %d", rec.Code)
	}
}

func TestHandleIndexerProxy_RejectsUnprovenChain(t *testing.T) {
	for _, tc := range []struct {
		name, tip, blocks string
	}{
		{"wrong chain", `{"data":{"latestBlockHeight":4242}}`, `{"data":{"getBlocks":[{"height":4242,"chain_id":"test-13"}]}}`},
		{"missing chain", `{"data":{"latestBlockHeight":4242}}`, `{"data":{"getBlocks":[{"height":4242}]}}`},
		{"missing block", `{"data":{"latestBlockHeight":4242}}`, `{"data":{"getBlocks":[]}}`},
		{"wrong height", `{"data":{"latestBlockHeight":4242}}`, `{"data":{"getBlocks":[{"height":4241,"chain_id":"gnoland-1"}]}}`},
		{"GraphQL error", `{"errors":[{"message":"unavailable"}]}`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var forwarded atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				query := indexerQuery(r)
				switch {
				case strings.Contains(query, "latestBlockHeight"):
					_, _ = io.WriteString(w, tc.tip)
				case strings.Contains(query, "getBlocks"):
					_, _ = io.WriteString(w, tc.blocks)
				default:
					forwarded.Add(1)
				}
			}))
			defer upstream.Close()
			t.Setenv("INDEXER_GRAPHQL_URL", upstream.URL)
			rec := httptest.NewRecorder()
			HandleIndexerProxy().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/indexer",
				strings.NewReader(`{"query":"{ transactions { hash } }"}`)))
			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected 503, got %d (%s)", rec.Code, rec.Body.String())
			}
			if got := forwarded.Load(); got != 0 {
				t.Fatalf("forwarded %d unproven requests", got)
			}
			if got := rec.Header().Get("Cache-Control"); got != "no-store" {
				t.Fatalf("cache control = %q, want no-store", got)
			}
		})
	}
}

func TestHandleIndexerProxy_DoesNotReuseProofForChangedUpstream(t *testing.T) {
	var oldForwarded, newForwarded atomic.Int32
	oldUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if answerIndexerProof(w, indexerQuery(r), indexerChainID) {
			return
		}
		oldForwarded.Add(1)
		_, _ = io.WriteString(w, `{"data":{"transactions":[]}}`)
	}))
	defer oldUpstream.Close()
	newUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if answerIndexerProof(w, indexerQuery(r), "test-13") {
			return
		}
		newForwarded.Add(1)
	}))
	defer newUpstream.Close()
	handler := HandleIndexerProxy()
	t.Setenv("INDEXER_GRAPHQL_URL", oldUpstream.URL)
	request := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/indexer",
			strings.NewReader(`{"query":"{ transactions { hash } }"}`)))
		return rec
	}
	if got := request().Code; got != http.StatusOK {
		t.Fatalf("initial relay status = %d, want 200", got)
	}
	t.Setenv("INDEXER_GRAPHQL_URL", newUpstream.URL)
	if got := request().Code; got != http.StatusServiceUnavailable {
		t.Fatalf("changed upstream status = %d, want 503", got)
	}
	if oldForwarded.Load() != 1 || newForwarded.Load() != 0 {
		t.Fatalf("forwarded to old=%d new=%d, want 1 and 0", oldForwarded.Load(), newForwarded.Load())
	}
}

func TestHandleIndexerProxy_SharesProofAcrossConcurrentReads(t *testing.T) {
	var proofCalls, forwarded atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := indexerQuery(r)
		if strings.Contains(query, "latestBlockHeight") {
			proofCalls.Add(1)
			time.Sleep(25 * time.Millisecond) // give parallel callers time to join the proof
			answerIndexerProof(w, query, indexerChainID)
			return
		}
		if strings.Contains(query, "getBlocks") {
			proofCalls.Add(1)
			answerIndexerProof(w, query, indexerChainID)
			return
		}
		forwarded.Add(1)
		_, _ = io.WriteString(w, `{"data":{"transactions":[]}}`)
	}))
	defer upstream.Close()
	t.Setenv("INDEXER_GRAPHQL_URL", upstream.URL)
	handler := HandleIndexerProxy()
	const readers = 10
	start := make(chan struct{})
	var wg sync.WaitGroup
	statuses := make(chan int, readers)
	for i := 0; i < readers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/indexer",
				strings.NewReader(`{"query":"{ transactions { hash } }"}`)))
			statuses <- rec.Code
		}()
	}
	close(start)
	wg.Wait()
	close(statuses)
	for status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("relay status = %d, want 200", status)
		}
	}
	if proofCalls.Load() != 2 || forwarded.Load() != readers {
		t.Fatalf("proof calls=%d forwarded=%d, want 2 and %d", proofCalls.Load(), forwarded.Load(), readers)
	}
}
