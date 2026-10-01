package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/samouraiworld/memba/backend/internal/db"
	"github.com/samouraiworld/memba/backend/internal/ratelimit"
	"github.com/samouraiworld/memba/backend/internal/service"
)

type fakeTokenIdentityValidator struct {
	addr, chainID string
	err           error
	calls         int
}

func (f *fakeTokenIdentityValidator) ValidateRESTTokenIdentity(string) (string, string, error) {
	f.calls++
	return f.addr, f.chainID, f.err
}

// fakeCurationInboxService is a session validator whose per-wallet limiter
// refuses every wallet and records what it was asked.
type fakeCurationInboxService struct {
	fakeTokenIdentityValidator
	capsAsked []string
}

func (f *fakeCurationInboxService) AllowUser(addr, endpoint string) bool {
	f.capsAsked = append(f.capsAsked, addr+" "+endpoint)
	return false
}

// The curation inbox route answers 503 to every request while no inbox is
// configured, before any token is looked at; once configured it requires a
// wallet session issued for the inbox's chain.
func TestCurationInboxHandler(t *testing.T) {
	const wallet, chain = "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "gnoland-1"
	t.Setenv("MEMBA_ALLOW_UNSIGNED_AUTH", "")
	t.Setenv("GNO_RPC_URL", "http://127.0.0.1:1") // never reach real nodes
	t.Setenv("RPC_FALLBACK_URLS", "http://127.0.0.1:1")
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	if err := db.Migrate(database); err != nil {
		t.Fatal(err)
	}
	call := func(h http.Handler, method, authHeader string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/curation/inbox?collection=C1", strings.NewReader(`{"clientId":"client-id-0001","body":"hello"}`))
		if authHeader != "" {
			r.Header.Set("Authorization", authHeader)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec
	}
	allow := func(string, string) bool { return true }

	t.Run("not configured: 503 before any auth work", func(t *testing.T) {
		// The production wiring with MEMBA_CURATION_INBOX_KEY unset.
		inbox, err := service.NewCurationInbox(database, chain, "", allow)
		if inbox != nil || err != nil {
			t.Fatalf("no key: got (%v, %v), want no inbox and no error", inbox, err)
		}
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			for _, header := range []string{"", "Bearer {}"} {
				v := &fakeTokenIdentityValidator{addr: wallet, chainID: chain}
				rec := call(curationInboxHandler(v, chain, inbox), method, header)
				if rec.Code != http.StatusServiceUnavailable || v.calls != 0 || rec.Header().Get("Content-Type") != "application/json" ||
					strings.TrimSpace(rec.Body.String()) != `{"error":"curation inbox not available"}` {
					t.Fatalf("%s header %q: got %d %q %s, validator calls=%d", method, header, rec.Code, rec.Header().Get("Content-Type"), rec.Body, v.calls)
				}
			}
		}
	})

	t.Run("configured: a session issued for the inbox's chain is required", func(t *testing.T) {
		inbox, err := service.NewCurationInbox(database, chain, strings.Repeat("0f", 32), allow)
		if inbox == nil || err != nil {
			t.Fatalf("NewCurationInbox: %v, %v", inbox, err)
		}
		if rec := call(curationInboxHandler(&fakeTokenIdentityValidator{addr: wallet, chainID: chain}, chain, inbox), http.MethodGet, ""); rec.Code != http.StatusUnauthorized {
			t.Fatalf("no token: got %d, want 401", rec.Code)
		}
		refused := map[string]*fakeTokenIdentityValidator{
			"invalid token":                {err: errors.New("token expired")},
			"token of another chain":       {addr: wallet, chainID: "pearl-1"},
			"legacy token naming no chain": {addr: wallet, chainID: ""},
		}
		for name, v := range refused {
			if rec := call(curationInboxHandler(v, chain, inbox), http.MethodPost, "Bearer {}"); rec.Code != http.StatusUnauthorized || v.calls != 1 {
				t.Fatalf("%s: got %d, validator calls=%d, want 401 after one validation", name, rec.Code, v.calls)
			}
		}
		// A session of the inbox's chain reaches the inbox, which then cannot
		// ask the (unreachable) chain: 503, not 401.
		v := &fakeTokenIdentityValidator{addr: wallet, chainID: chain}
		if rec := call(curationInboxHandler(v, chain, inbox), http.MethodGet, "Bearer {}"); rec.Code != http.StatusServiceUnavailable || v.calls != 1 {
			t.Fatalf("session of the chain: got %d, validator calls=%d, want 503 from the inbox", rec.Code, v.calls)
		}
	})

	t.Run("as mounted: the service's per-wallet limiter inside, the per-IP bucket in front", func(t *testing.T) {
		prev := limiter
		limiter = ratelimit.New(t.Context(), map[string]ratelimit.Config{"curation_inbox": {MaxRequests: 2, Window: time.Minute}})
		t.Cleanup(func() { limiter = prev })
		svc := &fakeCurationInboxService{fakeTokenIdentityValidator: fakeTokenIdentityValidator{addr: wallet, chainID: chain}}
		route := curationInboxRoute(t.Context(), svc, database, chain, strings.Repeat("0f", 32))

		// The wallet is over its cap on the service's limiter: refused by the inbox.
		rec := call(route, http.MethodGet, "Bearer {}")
		if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Content-Type") != "application/json" ||
			len(svc.capsAsked) != 1 || svc.capsAsked[0] != wallet+" "+ratelimit.CurationInboxEndpoint {
			t.Fatalf("wallet over its cap: got %d %q, limiter asked %q, want the inbox's 429", rec.Code, rec.Header().Get("Content-Type"), svc.capsAsked)
		}
		// The third request of one IP in a minute is stopped before any token is looked at.
		if rec := call(route, http.MethodGet, ""); rec.Code != http.StatusUnauthorized {
			t.Fatalf("second request of the IP: got %d, want 401", rec.Code)
		}
		if rec := call(route, http.MethodGet, "Bearer {}"); rec.Code != http.StatusTooManyRequests || svc.calls != 1 {
			t.Fatalf("third request of the IP: got %d, validator calls=%d, want 429 before any validation", rec.Code, svc.calls)
		}
	})

	t.Run("the route starts the retention sweep, with or without a key", func(t *testing.T) {
		old := time.Now().Add(-400 * 24 * time.Hour).Unix()
		if _, err := database.Exec(`INSERT INTO curation_inbox_messages (chain_id, collection, seq, sender, client_id, created_at, key_id, nonce, body)
			VALUES (?, 'C9', 1, ?, 'client-id-0009', ?, 'none', x'00', x'00'), (?, 'C9', 2, ?, 'client-id-0010', ?, 'none', x'00', x'00')`,
			chain, wallet, old, chain, wallet, time.Now().Unix()); err != nil {
			t.Fatal(err)
		}
		curationInboxRoute(t.Context(), &fakeCurationInboxService{}, database, chain, "")
		for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(10 * time.Millisecond) {
			var expired, kept int
			if err := database.QueryRow(`SELECT COUNT(*) FILTER (WHERE created_at = ?), COUNT(*) FROM curation_inbox_messages WHERE collection = 'C9'`, old).Scan(&expired, &kept); err != nil {
				t.Fatal(err)
			}
			if expired == 0 && kept == 1 {
				return
			}
			if time.Now().After(deadline) {
				t.Fatalf("the inbox is off and nothing swept: %d expired and %d messages left, want 0 and 1", expired, kept)
			}
		}
	})
}
