package account

import (
	"net/http"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

// These are the independent review's two failing interleavings, updated to
// assert that a conflicting lifecycle request is rejected before it changes
// email or confirms anything. The old head returned 200/204 while Resend kept
// a new address subscribed after its local consent had been closed/deleted.
func TestReviewOptOutRacingEmailChangeAndConfirmation(t *testing.T) {
	f := newConsentFixture(t)
	if rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter")); rec.Code != http.StatusOK {
		t.Fatal(rec.Code)
	}
	link := lastLink(t, f.fake)
	newToken := sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example" }))
	otherToken := sign(t, f.k, claims(func(c jwt.MapClaims) { c["sub"] = "another-account"; c["email"] = "other@example.org" }))
	f.fake.mu.Lock()
	f.fake.contacts["ada@example.org"] = map[string]string{"top_news": "opt_out"}
	f.fake.afterTopicPatch = func() {
		for range 3 {
			rec := call(t, f.h.routes(), "GET", "/api/account", newToken, nil)
			if rec.Code != http.StatusConflict || rec.Header().Get("Retry-After") != "1" {
				t.Errorf("concurrent email change: %d", rec.Code)
			}
			rec = call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link})
			if rec.Code != http.StatusConflict {
				t.Errorf("concurrent confirmation: %d", rec.Code)
			}
		}
		if rec := call(t, f.mux, "GET", "/api/account", otherToken, nil); rec.Code != http.StatusOK {
			t.Errorf("unrelated account blocked: %d", rec.Code)
		}
	}
	f.fake.mu.Unlock()
	rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, map[string]any{"topic": "newsletter", "on": false})
	if rec.Code != http.StatusOK {
		t.Fatalf("opt out: %d %s", rec.Code, rec.Body.String())
	}
	if got := states(t, rec); got["newsletter"] != "off" {
		t.Fatalf("local state: %v", got)
	}
	if f.fake.sub("ada@new.example", "top_news") == "opt_in" || f.fake.sub("ada@example.org", "top_news") == "opt_in" {
		t.Fatal("withdrawn topic remains subscribed")
	}
	if len(f.fake.emails()) != 1 {
		t.Fatal("blocked email change sent a new confirmation")
	}
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusGone {
		t.Fatalf("old confirmation after withdrawal: %d", rec.Code)
	}
	// A later explicit request starts from fresh state and may opt in normally.
	if rec := call(t, f.mux, "GET", "/api/account", newToken, nil); rec.Code != http.StatusOK {
		t.Fatalf("email change retry: %d", rec.Code)
	}
	if rec := call(t, f.mux, "POST", "/api/account/topics", newToken, on("newsletter")); rec.Code != http.StatusOK {
		t.Fatalf("new opt-in request: %d", rec.Code)
	}
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)}); rec.Code != http.StatusOK {
		t.Fatalf("new opt-in confirmation: %d", rec.Code)
	}
}

func TestReviewDeleteRacingEmailChangeAndConfirmation(t *testing.T) {
	f := newConsentFixture(t)
	if rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter")); rec.Code != http.StatusOK {
		t.Fatal(rec.Code)
	}
	link := lastLink(t, f.fake)
	newToken := sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example" }))
	f.fake.mu.Lock()
	f.fake.contacts["ada@example.org"] = map[string]string{"top_news": "opt_out"}
	f.fake.afterDelete = func() {
		for range 3 {
			if rec := call(t, f.mux, "GET", "/api/account", newToken, nil); rec.Code != http.StatusConflict {
				t.Errorf("concurrent email change: %d", rec.Code)
			}
			if rec := call(t, f.h.routes(), "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusConflict {
				t.Errorf("concurrent confirmation: %d", rec.Code)
			}
		}
	}
	f.fake.mu.Unlock()
	rec := call(t, f.mux, "POST", "/api/account/delete", f.tok, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	var accounts, consents int
	if err := f.h.db.QueryRow("SELECT COUNT(*) FROM accounts").Scan(&accounts); err != nil {
		t.Fatal(err)
	}
	if err := f.h.db.QueryRow("SELECT COUNT(*) FROM consents").Scan(&consents); err != nil {
		t.Fatal(err)
	}
	if accounts != 0 || consents != 0 {
		t.Fatalf("local rows remain: %d %d", accounts, consents)
	}
	if f.fake.sub("ada@new.example", "top_news") == "opt_in" || f.fake.sub("ada@example.org", "top_news") == "opt_in" {
		t.Fatal("deleted account remains subscribed")
	}
	if len(f.fake.emails()) != 1 {
		t.Fatal("blocked email change sent a new confirmation")
	}
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusBadRequest {
		t.Fatalf("deleted confirmation: %d", rec.Code)
	}
}

func TestDeletePreservesCleanupAddressesUntilEveryProviderDeletionSucceeds(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	if _, err := f.h.db.Exec("INSERT INTO consents (account_id, topic, email, wording_version, source, requested_at, confirmed_at) SELECT id, 'announcements', 'old@example.org', 'v', 's', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z' FROM accounts"); err != nil {
		t.Fatal(err)
	}
	f.fake.mu.Lock()
	f.fake.contacts["old@example.org"] = map[string]string{"top_ann": "opt_in"}
	f.fake.afterDelete = func() { f.fake.setDown(true) }
	f.fake.mu.Unlock()
	if rec := call(t, f.mux, "POST", "/api/account/delete", f.tok, nil); rec.Code != http.StatusBadGateway {
		t.Fatalf("partial provider cleanup: %d", rec.Code)
	}
	var accounts, consents int
	if err := f.h.db.QueryRow("SELECT COUNT(*) FROM accounts").Scan(&accounts); err != nil {
		t.Fatal(err)
	}
	if err := f.h.db.QueryRow("SELECT COUNT(*) FROM consents").Scan(&consents); err != nil {
		t.Fatal(err)
	}
	if accounts != 1 || consents != 2 {
		t.Fatalf("retry evidence lost: accounts=%d consents=%d", accounts, consents)
	}
	if got := f.fake.sub("old@example.org", "top_ann"); got != "opt_in" {
		t.Fatalf("expected cleanup still outstanding: %q", got)
	}
	f.fake.setDown(false)
	if rec := call(t, f.h.routes(), "POST", "/api/account/delete", f.tok, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("retry: %d", rec.Code)
	}
	if f.fake.sub("old@example.org", "top_ann") != "" || f.fake.sub("ada@example.org", "top_news") != "" {
		t.Fatal("retry left provider contacts")
	}
	if err := f.h.db.QueryRow("SELECT COUNT(*) FROM consents").Scan(&consents); err != nil || consents != 0 {
		t.Fatalf("retry did not remove local history: %d (%v)", consents, err)
	}
}
