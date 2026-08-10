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

// blocklistTestDB builds an in-memory DB with the two tables the render gate
// reads, optionally pre-seeded with a takedown for blockedPostID. Callers that
// exercise the reply path add rows to feed_posts themselves.
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
	// Mirrors the columns feedRenderSuppressed's sub-select needs (018_feed.sql).
	if _, err := db.Exec(`CREATE TABLE feed_posts (post_id INTEGER PRIMARY KEY, reply_to INTEGER NOT NULL DEFAULT 0)`); err != nil {
		t.Fatal(err)
	}
	if blockedPostID != 0 {
		if _, err := db.Exec(`INSERT INTO feed_blocklist (post_id, reason) VALUES (?, 'test')`, blockedPostID); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

// renderProxyCase drives one request against a fake RPC and reports whether the
// handler suppressed (short-circuited, 0 relay hits) or relayed to the chain.
func renderProxyCase(t *testing.T, db *sql.DB, realm, path string) (body string, relayHits int32) {
	t.Helper()
	rpcURL, hits := fakeRenderRPC(t, "CHAIN BODY")
	t.Setenv("GNO_RPC_URL", rpcURL)
	rec := httptest.NewRecorder()
	HandleRenderProxy(db).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/api/render?realm="+realm+"&path="+path, nil))
	return rec.Body.String(), atomic.LoadInt32(hits)
}

func TestGnoRPCURL_DefaultsToTopaz(t *testing.T) {
	t.Setenv("GNO_RPC_URL", "") // force the built-in default
	const want = "https://rpc.topaz.testnets.gno.land:443"
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

// A blocklisted REPLY is inlined in full by the realm's renderPost, which knows
// nothing about an off-chain blocklist — so suppressing only the requested id
// would leave the reply readable through its parent.
func TestHandleRenderProxy_BlocklistedReply_SuppressesParentRender(t *testing.T) {
	t.Setenv("FEED_WATCHED_REALMS", testFeedRealm)
	db := blocklistTestDB(t, 99) // reply 99 is blocked...
	if _, err := db.Exec(`INSERT INTO feed_posts (post_id, reply_to) VALUES (99, 7), (7, 0)`); err != nil {
		t.Fatal(err)
	}

	// ...so requesting its PARENT (7, itself unblocked) must also suppress.
	body, hits := renderProxyCase(t, db, testFeedRealm, "post/7")
	if body != feedPostUnavailableBody {
		t.Errorf("parent of a blocklisted reply must be suppressed, got %q", body)
	}
	if hits != 0 {
		t.Errorf("expected no chain relay, got %d", hits)
	}
}

func TestHandleRenderProxy_UnrelatedParent_StillProxies(t *testing.T) {
	t.Setenv("FEED_WATCHED_REALMS", testFeedRealm)
	db := blocklistTestDB(t, 99)
	// 99 replies to 7; post 8 is a different thread and must be unaffected.
	if _, err := db.Exec(`INSERT INTO feed_posts (post_id, reply_to) VALUES (99, 7), (7, 0), (8, 0)`); err != nil {
		t.Fatal(err)
	}

	body, hits := renderProxyCase(t, db, testFeedRealm, "post/8")
	if body != "CHAIN BODY" || hits != 1 {
		t.Errorf("an unrelated thread must relay, got body=%q hits=%d", body, hits)
	}
}

// Leading zeros normalise to the same id on BOTH sides (our ParseUint and the
// realm's), so post/0042 must suppress exactly as post/42 does. Anchoring cases
// must NOT suppress — the realm 404s them, and over-matching would let an
// unrelated path be silently replaced by a moderation message.
func TestHandleRenderProxy_PostPathMatching(t *testing.T) {
	cases := []struct {
		path            string
		wantSuppression bool
	}{
		{"post/42", true},
		{"post/0042", true},
		{"post/000000000000000000042", true},
		{"post/42x", false},
		{"x/post/42", false},
		{"post/42/", false},
		{"post/42:", false},
		{"POST/42", false},
		{"page/1", false},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			t.Setenv("FEED_WATCHED_REALMS", testFeedRealm)
			body, hits := renderProxyCase(t, blocklistTestDB(t, 42), testFeedRealm, tc.path)
			if tc.wantSuppression {
				if body != feedPostUnavailableBody || hits != 0 {
					t.Errorf("%q must be suppressed, got body=%q hits=%d", tc.path, body, hits)
				}
			} else if body != "CHAIN BODY" || hits != 1 {
				t.Errorf("%q must relay to the chain, got body=%q hits=%d", tc.path, body, hits)
			}
		})
	}
}

// The gate is keyed on FEED_WATCHED_REALMS. Unset, it is inert — pinned here so
// that is a deliberate, visible property rather than an accident (main.go logs a
// warning at startup for the same reason).
func TestHandleRenderProxy_WatchedRealmsUnset_NoSuppression(t *testing.T) {
	t.Setenv("FEED_WATCHED_REALMS", "")
	body, hits := renderProxyCase(t, blocklistTestDB(t, 42), testFeedRealm, "post/42")
	if body != "CHAIN BODY" || hits != 1 {
		t.Errorf("unset FEED_WATCHED_REALMS must leave the gate inert, got body=%q hits=%d", body, hits)
	}
}

func TestHandleRenderProxy_SuppressedResponseIsNotCacheable(t *testing.T) {
	rpcURL, _ := fakeRenderRPC(t, "SHOULD NOT BE SERVED")
	t.Setenv("GNO_RPC_URL", rpcURL)
	t.Setenv("FEED_WATCHED_REALMS", testFeedRealm)
	rec := httptest.NewRecorder()
	HandleRenderProxy(blocklistTestDB(t, 42)).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/api/render?realm="+testFeedRealm+"&path=post/42", nil))

	// The normal relay sets `public, max-age=5`; a takedown must never inherit it.
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("suppressed response must be no-store, got %q", got)
	}
}

// The suppression text must stay byte-identical to the realm's own, so a caller
// cannot tell an operator takedown from an on-chain hide. Realm source of truth:
// memba_feed_v1.gno:1118 (deployed on topaz) and memba_feed_v2.gno:1134.
func TestFeedPostUnavailableBody_MatchesRealmLiteral(t *testing.T) {
	const realmLiteral = "# Post unavailable\n\n*This post has been hidden or removed.*\n"
	if feedPostUnavailableBody != realmLiteral {
		t.Errorf("suppression text drifted from the realm's:\n got %q\nwant %q", feedPostUnavailableBody, realmLiteral)
	}
}

func TestHandleRenderProxy_RealmMatchIsExact_NotPrefix(t *testing.T) {
	rpcURL, hits := fakeRenderRPC(t, "ARCHIVE REALM CONTENT")
	t.Setenv("GNO_RPC_URL", rpcURL)
	t.Setenv("FEED_WATCHED_REALMS", testFeedRealm)
	db := blocklistTestDB(t, 42)
	handler := HandleRenderProxy(db)

	// A DIFFERENT realm that merely starts with the watched one. gno does not
	// normalise pkgpaths (verified against topaz-1: a trailing slash, dot
	// segment or case change all yield InvalidPkgPathError), so exact equality
	// is the correct match — a prefix match would suppress posts belonging to
	// an unrelated realm that happens to share the name stem.
	req := httptest.NewRequest(http.MethodGet, "/api/render?realm="+testFeedRealm+"_archive&path=post/42", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Body.String() != "ARCHIVE REALM CONTENT" {
		t.Fatalf("a prefix-sharing realm must not be suppressed, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if got := atomic.LoadInt32(hits); got != 1 {
		t.Errorf("expected exactly one chain relay call, got %d", got)
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
