package account

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/samouraiworld/memba/backend/internal/db"
	_ "modernc.org/sqlite"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

// serve runs one request against the handler.
func serve(t *testing.T, h http.Handler, method, path, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// testConfig is a complete, valid configuration for key k.
func testConfig(t *testing.T, k testKey) Config {
	t.Helper()
	return Config{Enabled: true, JWTKeys: keysJSON(t, k), ResendAPIKey: "re_test", ResendWebhookSecret: "whsec_" + base64.StdEncoding.EncodeToString([]byte("webhook-secret")),
		LinkSecret: strings.Repeat("s", 32), TopicIDs: `{"announcements":"top_ann","newsletter":"top_news","early_access":"top_early"}`}
}

// testHandler is the account handler on a fake Resend, clocked at `now`.
func testHandler(t *testing.T, database *sql.DB, k testKey) (*handler, *fakeResend) {
	t.Helper()
	h, err := testConfig(t, k).build(database)
	if err != nil {
		t.Fatal(err)
	}
	fake := newFakeResend(t)
	h.resend.baseURL = fake.srv.URL
	h.now = func() time.Time { return now }
	h.verifier.now = h.now
	return h, fake
}

func enabledHandler(t *testing.T, database *sql.DB, k testKey) http.Handler {
	t.Helper()
	h, _ := testHandler(t, database, k)
	return h.routes()
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
	return v
}

func TestRoutesAreOffUnlessEnabledAndUnavailableWithoutKeys(t *testing.T) {
	database := testDB(t)
	k := newKey(t, "ins_1")
	if rec := serve(t, NewHandler(database, Config{}), "GET", "/api/account", ""); rec.Code != http.StatusNotFound {
		t.Errorf("disabled: %d, want 404", rec.Code)
	}
	broken := map[string]func(*Config){
		"no keys":            func(c *Config) { c.JWTKeys = "" },
		"empty keys":         func(c *Config) { c.JWTKeys = "{}" },
		"keys not JSON":      func(c *Config) { c.JWTKeys = "not json" },
		"no Resend key":      func(c *Config) { c.ResendAPIKey = "" },
		"no webhook secret":  func(c *Config) { c.ResendWebhookSecret = "" },
		"no link secret":     func(c *Config) { c.LinkSecret = "" },
		"short link secret":  func(c *Config) { c.LinkSecret = strings.Repeat("s", 31) },
		"no topic ids":       func(c *Config) { c.TopicIDs = "" },
		"a topic without id": func(c *Config) { c.TopicIDs = `{"announcements":"a","newsletter":"b"}` },
		"malformed whsec":    func(c *Config) { c.ResendWebhookSecret = "whsec_not base64!" },
		"no whsec_ prefix":   func(c *Config) { c.ResendWebhookSecret = base64.StdEncoding.EncodeToString([]byte("k")) },
	}
	for name, breakIt := range broken {
		c := testConfig(t, k)
		breakIt(&c)
		for _, path := range []string{"/api/account", "/api/consent/confirm", "/api/webhooks/resend"} {
			if rec := serve(t, NewHandler(database, c), "POST", path, ""); rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Content-Type") != "application/json" {
				t.Errorf("%s %s: %d %q, want 503 JSON", name, path, rec.Code, rec.Header().Get("Content-Type"))
			}
		}
	}
}

func TestAnUnauthenticatedOrForgedCallIsRefusedWith401(t *testing.T) {
	k, other := newKey(t, "ins_1"), newKey(t, "ins_2")
	h := enabledHandler(t, testDB(t), k)
	for name, tok := range map[string]string{"none": "", "garbage": "x", "unknown kid": sign(t, other, claims(nil))} {
		for _, r := range [][2]string{{"GET", "/api/account"}, {"GET", "/api/account/export"}, {"POST", "/api/account/delete"}} {
			rec := serve(t, h, r[0], r[1], tok)
			if rec.Code != http.StatusUnauthorized || rec.Header().Get("Content-Type") != "application/json" {
				t.Errorf("%s %s %s: %d %q, want 401 JSON", name, r[0], r[1], rec.Code, rec.Header().Get("Content-Type"))
			}
		}
	}
}

func TestTheFirstCallCreatesTheAccountAndTheEmailFollowsTheProvider(t *testing.T) {
	k := newKey(t, "ins_1")
	h := enabledHandler(t, testDB(t), k)
	first := decode[Account](t, serve(t, h, "GET", "/api/account", sign(t, k, claims(nil))))
	if len(first.ID) != 32 || first.Email != "ada@example.org" || first.EmailVerifiedAt == "" {
		t.Fatalf("first: %+v", first)
	}
	again := decode[Account](t, serve(t, h, "GET", "/api/account", sign(t, k, claims(nil))))
	if again != first {
		t.Fatalf("second call changed the account: %+v vs %+v", again, first)
	}
	changed := decode[Account](t, serve(t, h, "GET", "/api/account", sign(t, k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example" }))))
	if changed.ID != first.ID || changed.Email != "ada@new.example" {
		t.Fatalf("email change: %+v", changed)
	}
	unverified := decode[Account](t, serve(t, h, "GET", "/api/account", sign(t, k, claims(func(c jwt.MapClaims) { c["email_verified"] = false }))))
	if unverified.Email != "" || unverified.EmailVerifiedAt != "" {
		t.Fatalf("unverified email kept: %+v", unverified)
	}
	other := decode[Account](t, serve(t, h, "GET", "/api/account", sign(t, k, claims(func(c jwt.MapClaims) { c["sub"] = "user_2" }))))
	if other.ID == first.ID {
		t.Fatal("two subjects share one account")
	}
}

func TestExportHoldsTheCallersAccountAndDeleteRemovesIt(t *testing.T) {
	k := newKey(t, "ins_1")
	database := testDB(t)
	h := enabledHandler(t, database, k)
	tok := sign(t, k, claims(nil))
	created := decode[Account](t, serve(t, h, "GET", "/api/account", tok))
	_ = decode[Account](t, serve(t, h, "GET", "/api/account", sign(t, k, claims(func(c jwt.MapClaims) { c["sub"] = "user_2" }))))

	rec := serve(t, h, "GET", "/api/account/export", tok)
	if got := decode[Export](t, rec); got.Account != created || rec.Header().Get("Content-Disposition") == "" {
		t.Fatalf("export: %+v", got)
	}
	if rec := serve(t, h, "GET", "/api/account/delete", tok); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET delete: %d, want 405", rec.Code)
	}
	if rec := serve(t, h, "POST", "/api/account/delete", tok); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}
	var n int
	if err := database.QueryRow("SELECT COUNT(*) FROM accounts WHERE id = ?", created.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("deleted account still stored (%d, %v)", n, err)
	}
	if err := database.QueryRow("SELECT COUNT(*) FROM accounts").Scan(&n); err != nil || n != 1 {
		t.Fatalf("delete touched another account (%d left, %v)", n, err)
	}
}
