package account

import (
	"encoding/hex"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	accountdb "github.com/samouraiworld/memba/backend/internal/db"
)

func TestDeletedAccountCannotBeRecreatedByStillValidSession(t *testing.T) {
	f := newConsentFixture(t)
	if rec := call(t, f.mux, "GET", "/api/account", f.tok, nil); rec.Code != http.StatusOK {
		t.Fatal(rec.Code)
	}
	if rec := call(t, f.mux, "POST", "/api/account/delete", f.tok, nil); rec.Code != http.StatusNoContent {
		t.Fatal(rec.Code)
	}
	// Another handler represents an old tab/device with the same valid JWT.
	other, _ := testHandler(t, f.h.db, f.k)
	rec := call(t, other.routes(), "GET", "/api/account", f.tok, nil)
	if rec.Code != http.StatusGone {
		t.Fatalf("deleted account was recreated by its still-valid JWT: %d %s", rec.Code, rec.Body)
	}
	var n int
	if err := f.h.db.QueryRow("SELECT COUNT(*) FROM accounts").Scan(&n); err != nil || n != 0 {
		t.Fatalf("account recreated: %d (%v)", n, err)
	}
}

func TestDeletionMarkerSurvivesRestartAndDeleteRemainsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "accounts.db")
	database, err := accountdb.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := accountdb.Migrate(database); err != nil {
		t.Fatal(err)
	}
	key := newKey(t, "restart-key")
	h, fake := testHandler(t, database, key)
	token := sign(t, key, claims(nil))
	call(t, h.routes(), "POST", "/api/account/topics", token, on("newsletter"))
	if rec := call(t, h.routes(), "POST", "/api/account/delete", token, nil); rec.Code != http.StatusNoContent {
		t.Fatal(rec.Code)
	}
	var digest, deletedAt string
	if err := database.QueryRow("SELECT subject_digest, deleted_at FROM account_deletions").Scan(&digest, &deletedAt); err != nil {
		t.Fatal(err)
	}
	decoded, err := hex.DecodeString(digest)
	if err != nil || len(decoded) != 32 || strings.Contains(digest, "user_1") || strings.Contains(digest, "ada@example.org") {
		t.Fatalf("invalid pseudonymous marker: %q", digest)
	}
	if deletedAt != now.UTC().Format(time.RFC3339) {
		t.Fatalf("deletion time: %q", deletedAt)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	database, err = accountdb.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := accountdb.Migrate(database); err != nil {
		t.Fatalf("restart migration: %v", err)
	}
	other, otherFake := testHandler(t, database, key)
	for _, endpoint := range []struct{ method, path string }{
		{"GET", "/api/account"}, {"GET", "/api/account/topics"}, {"GET", "/api/account/export"}, {"POST", "/api/account/topics"},
	} {
		rec := call(t, other.routes(), endpoint.method, endpoint.path, token, on("newsletter"))
		if rec.Code != http.StatusGone {
			t.Fatalf("%s after restart: %d", endpoint.path, rec.Code)
		}
		payload := decode[map[string]string](t, rec)
		if payload["code"] != "account_deleted" || payload["error"] != "This Memba account was deleted. Sign out to finish deletion." || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("410 contract: %v", payload)
		}
	}
	// A later sweep has no authority to expire a marker: no JWT lifetime or
	// provider revocation bound has been established for automatic removal.
	if err := sweep(t.Context(), database, now.AddDate(10, 0, 0)); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if rec := call(t, other.routes(), "POST", "/api/account/delete", token, nil); rec.Code != http.StatusNoContent {
			t.Fatalf("delete retry: %d", rec.Code)
		}
	}
	var accounts, consents, markers int
	if err := database.QueryRow("SELECT COUNT(*) FROM accounts").Scan(&accounts); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRow("SELECT COUNT(*) FROM consents").Scan(&consents); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRow("SELECT COUNT(*) FROM account_deletions").Scan(&markers); err != nil {
		t.Fatal(err)
	}
	if accounts != 0 || consents != 0 || markers != 1 {
		t.Fatalf("after repeat: accounts=%d consents=%d markers=%d", accounts, consents, markers)
	}
	otherFake.mu.Lock()
	calls := len(otherFake.calls)
	otherFake.mu.Unlock()
	if calls != 0 {
		t.Fatalf("tombstoned routes reached provider %d times", calls)
	}
	fake.mu.Lock()
	sent := len(fake.sent)
	fake.mu.Unlock()
	if sent != 1 {
		t.Fatalf("fixture never exercised a consent: %d", sent)
	}
	// A different newly created provider identity can still create an account.
	newToken := sign(t, key, claims(func(c jwt.MapClaims) { c["sub"] = "new_identity" }))
	if rec := call(t, other.routes(), "GET", "/api/account", newToken, nil); rec.Code != http.StatusOK {
		t.Fatalf("new identity blocked: %d", rec.Code)
	}
}

func TestDeletionAndMarkerCommitAtomicallyAndRetry(t *testing.T) {
	for name, trigger := range map[string]string{
		"marker fails":           "CREATE TRIGGER fail_delete BEFORE INSERT ON account_deletions BEGIN SELECT RAISE(ABORT, 'test'); END",
		"account delete fails":   "CREATE TRIGGER fail_delete BEFORE DELETE ON accounts BEGIN SELECT RAISE(ABORT, 'test'); END",
		"account delete ignored": "CREATE TRIGGER fail_delete BEFORE DELETE ON accounts BEGIN SELECT RAISE(IGNORE); END",
	} {
		t.Run(name, func(t *testing.T) {
			f := newConsentFixture(t)
			call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
			if _, err := f.h.db.Exec(trigger); err != nil {
				t.Fatal(err)
			}
			if rec := call(t, f.mux, "POST", "/api/account/delete", f.tok, nil); rec.Code != http.StatusInternalServerError {
				t.Fatalf("failed transaction: %d", rec.Code)
			}
			var accounts, consents, markers int
			if err := f.h.db.QueryRow("SELECT COUNT(*) FROM accounts").Scan(&accounts); err != nil {
				t.Fatal(err)
			}
			if err := f.h.db.QueryRow("SELECT COUNT(*) FROM consents").Scan(&consents); err != nil {
				t.Fatal(err)
			}
			if err := f.h.db.QueryRow("SELECT COUNT(*) FROM account_deletions").Scan(&markers); err != nil {
				t.Fatal(err)
			}
			if accounts != 1 || consents != 1 || markers != 0 {
				t.Fatalf("partial commit: accounts=%d consents=%d markers=%d", accounts, consents, markers)
			}
			assertOperationReleased(t)
			if _, err := f.h.db.Exec("DROP TRIGGER fail_delete"); err != nil {
				t.Fatal(err)
			}
			if rec := call(t, f.mux, "POST", "/api/account/delete", f.tok, nil); rec.Code != http.StatusNoContent {
				t.Fatalf("retry: %d", rec.Code)
			}
			if rec := call(t, f.mux, "GET", "/api/account", f.tok, nil); rec.Code != http.StatusGone {
				t.Fatalf("denial after retry: %d", rec.Code)
			}
		})
	}
}
