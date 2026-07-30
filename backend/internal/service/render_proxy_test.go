package service

import (
	"database/sql"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	_ "modernc.org/sqlite"
)

// blocklistTestDB builds an in-memory DB with just feed_blocklist, optionally
// pre-seeded with a takedown for postID.
func blocklistTestDB(t *testing.T, blockedPostID uint64) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`CREATE TABLE feed_blocklist (post_id INTEGER PRIMARY KEY, reason TEXT)`); err != nil {
		t.Fatal(err)
	}
	if blockedPostID != 0 {
		if _, err := db.Exec(`INSERT INTO feed_blocklist (post_id, reason) VALUES (?, 'test')`, blockedPostID); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func TestGnoRPCURL_DefaultsToTopaz(t *testing.T) {
	t.Setenv("GNO_RPC_URL", "") // force the built-in default
	const want = "https://rpc.topaz.samourai.live:443"
	if got := gnoRPCURL(); got != want {
		t.Fatalf("gnoRPCURL() default = %q, want pinned topaz node %q (retired-chain drift?)", got, want)
	}
}

func TestHandleRenderProxy_MissingRealm(t *testing.T) {
	handler := HandleRenderProxy(nil)
	req := httptest.NewRequest(http.MethodGet, "/api/render", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleRenderProxy_InvalidRealm(t *testing.T) {
	handler := HandleRenderProxy(nil)
	req := httptest.NewRequest(http.MethodGet, "/api/render?realm=evil.com/hack", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleRenderProxy_MethodNotAllowed(t *testing.T) {
	handler := HandleRenderProxy(nil)
	req := httptest.NewRequest(http.MethodPost, "/api/render?realm=gno.land/r/gov/dao", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rec.Code)
	}
}

// HandleEvalProxy tests removed — endpoint removed in v6 (SEC-01).

func TestHandleRenderProxy_InvalidPathChars(t *testing.T) {
	handler := HandleRenderProxy(nil)
	// Path with quotes should be rejected
	req := httptest.NewRequest(http.MethodGet, `/api/render?realm=gno.land/r/test&path=foo"bar`, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for path with quotes, got %d", rec.Code)
	}
}

func TestHandleRenderProxy_ValidPath(t *testing.T) {
	handler := HandleRenderProxy(nil)
	// Path with colons (for pagination: page:1) should be accepted
	req := httptest.NewRequest(http.MethodGet, "/api/render?realm=gno.land/r/test&path=page:1", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	// Will fail with 502 (no RPC) but should NOT be 400
	if rec.Code == http.StatusBadRequest {
		t.Errorf("path with colons should be accepted, got 400")
	}
}

func TestHandleBalanceProxy_MissingAddress(t *testing.T) {
	handler := HandleBalanceProxy()
	req := httptest.NewRequest(http.MethodGet, "/api/balance", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleBalanceProxy_InvalidAddress(t *testing.T) {
	handler := HandleBalanceProxy()

	// Too short
	req := httptest.NewRequest(http.MethodGet, "/api/balance?address=g1short", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for short address, got %d", rec.Code)
	}

	// Wrong prefix
	req = httptest.NewRequest(http.MethodGet, "/api/balance?address=cosmos1abcdefghijklmnopqrstuvwxyz12345678", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for wrong prefix, got %d", rec.Code)
	}
}

// F-20: a blocklisted feed post must never reach the chain relay, even though
// the realm's own Hidden/Deleted state knows nothing about an operator
// takedown (feed_blocklist is deliberately off-chain — 021_feed_blocklist.sql).
const testFeedRealm = "gno.land/r/samcrew/memba_feed_v2"

// fakeRenderRPC starts a local ABCI-shaped RPC server that always answers with
// body, and returns the number of requests it received — asserting on that
// count (rather than a real network's reachability) is what proves whether
// the proxy short-circuited before the chain relay.
func fakeRenderRPC(t *testing.T, body string) (url string, hits *int32) {
	t.Helper()
	var n int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&n, 1)
		data := base64.StdEncoding.EncodeToString([]byte(body))
		_, _ = w.Write([]byte(`{"result":{"response":{"ResponseBase":{"Data":"` + data + `","Error":null}}}}`))
	}))
	t.Cleanup(srv.Close)
	return srv.URL, &n
}

func TestHandleRenderProxy_BlocklistedFeedPost_Suppressed(t *testing.T) {
	rpcURL, hits := fakeRenderRPC(t, "SHOULD NOT BE SERVED")
	t.Setenv("GNO_RPC_URL", rpcURL)
	t.Setenv("FEED_WATCHED_REALMS", testFeedRealm)
	db := blocklistTestDB(t, 42)
	handler := HandleRenderProxy(db)

	req := httptest.NewRequest(http.MethodGet, "/api/render?realm="+testFeedRealm+"&path=post/42", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != feedPostUnavailableBody {
		t.Errorf("expected the suppressed-post body, got %q", rec.Body.String())
	}
	if got := atomic.LoadInt32(hits); got != 0 {
		t.Errorf("expected the chain relay never to be called, got %d requests", got)
	}
}

func TestHandleRenderProxy_NonBlocklistedFeedPost_StillProxies(t *testing.T) {
	rpcURL, hits := fakeRenderRPC(t, "POST 7 CONTENT")
	t.Setenv("GNO_RPC_URL", rpcURL)
	t.Setenv("FEED_WATCHED_REALMS", testFeedRealm)
	db := blocklistTestDB(t, 42) // post 42 is blocked; this request is for post 7
	handler := HandleRenderProxy(db)

	req := httptest.NewRequest(http.MethodGet, "/api/render?realm="+testFeedRealm+"&path=post/7", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Body.String() != "POST 7 CONTENT" {
		t.Fatalf("expected the clean post to proxy through, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if got := atomic.LoadInt32(hits); got != 1 {
		t.Errorf("expected exactly one chain relay call, got %d", got)
	}
}

func TestHandleRenderProxy_BlocklistCheckError_FailsClosed(t *testing.T) {
	rpcURL, hits := fakeRenderRPC(t, "SHOULD NOT BE SERVED")
	t.Setenv("GNO_RPC_URL", rpcURL)
	t.Setenv("FEED_WATCHED_REALMS", testFeedRealm)

	// A DB with no feed_blocklist table: the lookup errors rather than
	// answering. We must not serve a post we cannot prove is unblocked.
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	handler := HandleRenderProxy(db)

	req := httptest.NewRequest(http.MethodGet, "/api/render?realm="+testFeedRealm+"&path=post/42", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Body.String() != feedPostUnavailableBody {
		t.Errorf("expected the suppressed body when the blocklist is unreadable, got %q", rec.Body.String())
	}
	if got := atomic.LoadInt32(hits); got != 0 {
		t.Errorf("expected the chain relay never to be called, got %d requests", got)
	}
}

func TestHandleRenderProxy_UnwatchedRealm_SkipsBlocklistCheck(t *testing.T) {
	rpcURL, hits := fakeRenderRPC(t, "DAO CONTENT")
	t.Setenv("GNO_RPC_URL", rpcURL)
	t.Setenv("FEED_WATCHED_REALMS", testFeedRealm)
	db := blocklistTestDB(t, 42)
	handler := HandleRenderProxy(db)

	// Same post id, blocklisted — but a DIFFERENT realm. The post/<id> render
	// convention belongs to the feed realm; it must not suppress elsewhere.
	req := httptest.NewRequest(http.MethodGet, "/api/render?realm=gno.land/r/gov/dao&path=post/42", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Body.String() != "DAO CONTENT" {
		t.Fatalf("expected the unwatched realm to proxy through, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if got := atomic.LoadInt32(hits); got != 1 {
		t.Errorf("expected exactly one chain relay call, got %d", got)
	}
}
