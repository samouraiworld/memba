package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func submissionTx(path, hash string, height, index int64) map[string]any {
	return map[string]any{
		"hash": hash, "block_height": height, "index": index, "success": true,
		"messages": []any{map[string]any{
			"typeUrl": "add_package", "route": "vm",
			"value": map[string]any{"__typename": "MsgAddPackage", "creator": "g1creator", "package": map[string]any{"path": path}},
		}},
	}
}

func submissionPage(chain any, txs any) any {
	return map[string]any{"data": map[string]any{
		"getBlocks":       []any{map[string]any{"height": 20000, "chain_id": chain}},
		"getTransactions": txs,
	}}
}

func mockSubmissions(t *testing.T, second any, secondStatus int, delay time.Duration) (*recentSubmissionsReader, *atomic.Int32, func()) {
	t.Helper()
	calls := &atomic.Int32{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost || r.URL.RawQuery != "" {
			t.Errorf("unexpected upstream request: %s %s", r.Method, r.URL)
		}
		var body struct {
			Query string `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode upstream query: %v", err)
		}
		if strings.Contains(body.Query, "latestBlockHeight") {
			_, _ = io.WriteString(w, `{"data":{"latestBlockHeight":20000}}`)
			return
		}
		for _, fragment := range []string{"getBlocks", "eq:20000", "gt:9800", "lt:20001", "success:{eq:true}", `typeUrl:{eq:"add_package"}`, `route:{eq:"vm"}`, "heightAndIndex:DESC"} {
			if !strings.Contains(body.Query, fragment) {
				t.Errorf("second query lacks %q: %s", fragment, body.Query)
			}
		}
		if delay != 0 {
			select {
			case <-time.After(delay):
			case <-r.Context().Done():
				return
			}
		}
		if secondStatus != 0 {
			w.WriteHeader(secondStatus)
			return
		}
		if raw, ok := second.(string); ok {
			_, _ = io.WriteString(w, raw)
			return
		}
		if err := json.NewEncoder(w).Encode(second); err != nil {
			t.Errorf("encode page: %v", err)
		}
	}))
	return newRecentSubmissionsReader(server.URL, server.Client()), calls, server.Close
}

func serveSubmissions(h http.Handler, method, path string, ctx context.Context) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRecentSubmissionsValidSortDedupAndCache(t *testing.T) {
	paths := []string{
		"gno.land/r/demo/one", "gno.land/p/demo/two", "gno.land/r/demo/three",
		"gno.land/p/demo/four", "gno.land/r/demo/five", "gno.land/p/demo/six",
	}
	txs := []any{
		submissionTx(paths[1], "b", 19998, 0),
		submissionTx(paths[0], "old", 19996, 0),
		submissionTx(paths[0], "new", 20000, 1),
		submissionTx(paths[2], "c", 19999, 0),
		submissionTx(paths[3], "d", 19997, 0),
		submissionTx(paths[4], "e", 19995, 0),
		submissionTx(paths[5], "f", 19994, 0),
	}
	// An unrelated first message must not hide a later MsgAddPackage.
	multi := txs[3].(map[string]any)
	multi["messages"] = append([]any{map[string]any{"typeUrl": "call", "route": "vm", "value": map[string]any{"__typename": "MsgCall"}}}, multi["messages"].([]any)...)
	reader, calls, closeServer := mockSubmissions(t, submissionPage("gnoland-1", txs), 0, 0)
	defer closeServer()
	h := reader.handler()
	rec := serveSubmissions(h, http.MethodGet, "/api/directory/recent-submissions", context.Background())
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var doc recentSubmissionsDocument
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.ChainID != "gnoland-1" || doc.Source != "official-mainnet-tx-indexer" || doc.Coverage != "window-only" || doc.IndexedHeight != 20000 || doc.WindowStart != 9801 || doc.WindowEnd != 20000 || doc.CheckedAt.IsZero() {
		t.Fatalf("invalid provenance: %+v", doc)
	}
	if len(doc.Rows) != 6 || doc.Rows[0].Path != paths[0] || doc.Rows[0].TxHash != "new" || doc.Rows[0].Kind != "realm" || doc.Rows[2].Path != paths[1] || doc.Rows[2].Kind != "package" {
		t.Fatalf("invalid sorted/deduped rows: %+v", doc.Rows)
	}
	if rec.Header().Get("Cache-Control") != "public, max-age=60" {
		t.Fatalf("cache header: %q", rec.Header().Get("Cache-Control"))
	}
	second := serveSubmissions(h, http.MethodGet, "/api/directory/recent-submissions", context.Background())
	if second.Body.String() != rec.Body.String() || calls.Load() != 2 {
		t.Fatalf("cache miss: calls=%d", calls.Load())
	}
	for _, req := range []struct {
		method, path string
		want         int
	}{
		{http.MethodPost, "/api/directory/recent-submissions", 405},
		{http.MethodGet, "/api/directory/recent-submissions?query=evil", 400},
	} {
		got := serveSubmissions(h, req.method, req.path, context.Background())
		if got.Code != req.want || calls.Load() != 2 {
			t.Fatalf("client input reached source: status=%d calls=%d", got.Code, calls.Load())
		}
	}
}

func TestRecentSubmissionsEmptyWindow(t *testing.T) {
	reader, _, closeServer := mockSubmissions(t, submissionPage("gnoland-1", nil), 0, 0)
	defer closeServer()
	rec := serveSubmissions(reader.handler(), http.MethodGet, "/api/directory/recent-submissions", context.Background())
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"rows":[]`) {
		t.Fatalf("empty window: %d %s", rec.Code, rec.Body.String())
	}
}

func TestRecentSubmissionsDisplayCapAfterValidation(t *testing.T) {
	txs := make([]any, 0, 14)
	for i := range 13 {
		txs = append(txs, submissionTx(fmt.Sprintf("gno.land/p/demo/p%d", i), fmt.Sprintf("hash%d", i), int64(20000-i), 0))
	}
	reader, _, closeServer := mockSubmissions(t, submissionPage("gnoland-1", txs), 0, 0)
	defer closeServer()
	rec := serveSubmissions(reader.handler(), http.MethodGet, "/api/directory/recent-submissions", context.Background())
	var doc recentSubmissionsDocument
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &doc) != nil || len(doc.Rows) != 12 {
		t.Fatalf("display cap: %d %s", rec.Code, rec.Body.String())
	}
	// The invisible fourteenth row must still be validated, not silently sliced.
	txs = append(txs, submissionTx("gno.land/p/demo/../bad", "bad", 19987, 0))
	reader, _, closeServer2 := mockSubmissions(t, submissionPage("gnoland-1", txs), 0, 0)
	defer closeServer2()
	rec = serveSubmissions(reader.handler(), http.MethodGet, "/api/directory/recent-submissions", context.Background())
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("malformed hidden row passed: %d %s", rec.Code, rec.Body.String())
	}
}

func TestRecentSubmissionsFailClosed(t *testing.T) {
	withoutAddPackage := submissionTx("gno.land/r/demo/valid", "x", 20000, 0)
	withoutAddPackage["messages"] = []any{map[string]any{"typeUrl": "call", "route": "vm", "value": map[string]any{"__typename": "MsgCall"}}}
	tests := []struct {
		name   string
		second any
		status int
	}{
		{"wrong chain", submissionPage("gnoland-2", []any{}), 0},
		{"missing chain", submissionPage(nil, []any{}), 0},
		{"malformed path", submissionPage("gnoland-1", []any{submissionTx("gno.land/r/demo/../bad", "x", 20000, 0)}), 0},
		{"missing add package", submissionPage("gnoland-1", []any{withoutAddPackage}), 0},
		{"out of window", submissionPage("gnoland-1", []any{submissionTx("gno.land/r/demo/valid", "x", 9800, 0)}), 0},
		{"graphql error", map[string]any{"data": submissionPage("gnoland-1", []any{}), "errors": []any{map[string]any{"message": "bad"}}}, 0},
		{"http error", nil, 502},
		{"oversized body", strings.Repeat("x", recentSubmissionsMaxBytes+1), 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reader, _, closeServer := mockSubmissions(t, tt.second, tt.status, 0)
			defer closeServer()
			rec := serveSubmissions(reader.handler(), http.MethodGet, "/api/directory/recent-submissions", context.Background())
			if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Cache-Control") != "no-store" || strings.Contains(rec.Body.String(), `"rows"`) {
				t.Fatalf("failed open: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestRecentSubmissionsConcurrentRequestsCoalesce(t *testing.T) {
	reader, calls, closeServer := mockSubmissions(t, submissionPage("gnoland-1", []any{submissionTx("gno.land/r/demo/one", "hash", 20000, 0)}), 0, 50*time.Millisecond)
	defer closeServer()
	h := reader.handler()
	const workers = 20
	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make(chan error, workers)
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			rec := serveSubmissions(h, http.MethodGet, "/api/directory/recent-submissions", context.Background())
			if rec.Code != 200 {
				results <- fmt.Errorf("status %d: %s", rec.Code, rec.Body.String())
			}
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	for err := range results {
		t.Fatal(err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("upstream calls = %d, want 2", got)
	}
}

func TestRecentSubmissionsCancellation(t *testing.T) {
	reader, _, closeServer := mockSubmissions(t, submissionPage("gnoland-1", []any{}), 0, time.Second)
	defer closeServer()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	rec := serveSubmissions(reader.handler(), http.MethodGet, "/api/directory/recent-submissions", ctx)
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("cancellation: %d %s", rec.Code, rec.Body.String())
	}
}

func TestRecentSubmissionsUpstreamDeadline(t *testing.T) {
	reader, _, closeServer := mockSubmissions(t, submissionPage("gnoland-1", []any{}), 0, time.Second)
	defer closeServer()
	reader.timeout = 20 * time.Millisecond
	rec := serveSubmissions(reader.handler(), http.MethodGet, "/api/directory/recent-submissions", context.Background())
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("upstream deadline: %d %s", rec.Code, rec.Body.String())
	}
}
