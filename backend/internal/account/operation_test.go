package account

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func assertOperationReleased(t *testing.T) {
	t.Helper()
	accountOperations.Lock()
	active := len(accountOperations.active)
	accountOperations.Unlock()
	if active != 0 {
		t.Fatalf("operation map retained %d subjects after completion", active)
	}
	if !accountOperations.lifecycle.TryLock() {
		t.Fatal("lifecycle reservation leaked after completion")
	}
	accountOperations.lifecycle.Unlock()
}

func TestAccountOperationReleasesAfterErrorsAndRetries(t *testing.T) {
	f := newConsentFixture(t)
	// Ensure fails before reaching the endpoint.
	if _, err := f.h.db.Exec("CREATE TRIGGER fail_ensure BEFORE INSERT ON accounts BEGIN SELECT RAISE(ABORT, 'test'); END"); err != nil {
		t.Fatal(err)
	}
	if rec := call(t, f.mux, "GET", "/api/account", f.tok, nil); rec.Code != http.StatusInternalServerError {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
	if _, err := f.h.db.Exec("DROP TRIGGER fail_ensure"); err != nil {
		t.Fatal(err)
	}
	if rec := call(t, f.mux, "GET", "/api/account", f.tok, nil); rec.Code != http.StatusOK {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
	// Provider failure during email synchronization, followed by a fresh retry.
	newToken := sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "new@example.org" }))
	f.fake.setDown(true)
	if rec := call(t, f.mux, "GET", "/api/account", newToken, nil); rec.Code != http.StatusBadGateway {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
	f.fake.setDown(false)
	if rec := call(t, f.mux, "GET", "/api/account", newToken, nil); rec.Code != http.StatusOK {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
	// Endpoint validation and provider failures must also release the guard.
	if rec := call(t, f.mux, "POST", "/api/account/topics", newToken, map[string]any{"topic": "invalid"}); rec.Code != http.StatusBadRequest {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
	f.fake.setDown(true)
	if rec := call(t, f.mux, "POST", "/api/account/topics", newToken, on("newsletter")); rec.Code != http.StatusBadGateway {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
	f.fake.setDown(false)
	if rec := call(t, f.mux, "POST", "/api/account/topics", newToken, on("newsletter")); rec.Code != http.StatusOK {
		t.Fatal(rec.Code)
	}
	link := lastLink(t, f.fake)
	f.fake.setDown(true)
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusBadGateway {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
	f.fake.setDown(false)
	if _, err := f.h.db.Exec("CREATE TRIGGER fail_confirm BEFORE UPDATE OF confirmed_at ON consents BEGIN SELECT RAISE(ABORT, 'test'); END"); err != nil {
		t.Fatal(err)
	}
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusInternalServerError {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
	if _, err := f.h.db.Exec("DROP TRIGGER fail_confirm"); err != nil {
		t.Fatal(err)
	}
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusOK {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusGone {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
	f.fake.setDown(true)
	if rec := call(t, f.mux, "POST", "/api/account/delete", newToken, nil); rec.Code != http.StatusBadGateway {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
	f.fake.setDown(false)
	if rec := call(t, f.mux, "POST", "/api/account/delete", newToken, nil); rec.Code != http.StatusNoContent {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
}

func TestAccountOperationReleasesOnCancellationAndPanic(t *testing.T) {
	f := newConsentFixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	req := httptest.NewRequest("GET", "/api/account", nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+f.tok)
	f.mux.ServeHTTP(httptest.NewRecorder(), req)
	assertOperationReleased(t)
	func() {
		defer func() {
			if recover() == nil {
				t.Error("expected endpoint panic")
			}
		}()
		call(t, f.h.authed(func(http.ResponseWriter, *http.Request, Account) { panic("test") }), "GET", "/api/account", f.tok, nil)
	}()
	assertOperationReleased(t)
	if rec := call(t, f.mux, "GET", "/api/account", f.tok, nil); rec.Code != http.StatusOK {
		t.Fatal(rec.Code)
	}
}

func TestWebhookRetriesAfterProviderIOWithoutWaitingOnSQLite(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	link := lastLink(t, f.fake)
	body := []byte(`{"type":"contact.updated","data":{"email":"ada@example.org","unsubscribed":false}}`)
	headers := signedWebhook(t, f, "racing-unsubscribe", body, now)
	f.fake.mu.Lock()
	f.fake.contacts["ada@example.org"] = map[string]string{"top_news": "opt_out"}
	f.fake.afterTopicPatch = func() {
		f.fake.mu.Lock()
		f.fake.contacts["ada@example.org"]["top_news"] = "opt_out"
		f.fake.mu.Unlock()
		rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, headers...)
		if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Retry-After") != "1" {
			t.Errorf("busy webhook: %d", rec.Code)
		}
		var n int
		if err := f.h.db.QueryRow("SELECT COUNT(*) FROM webhook_events WHERE id = 'racing-unsubscribe'").Scan(&n); err != nil || n != 0 {
			t.Errorf("busy delivery consumed: %d (%v)", n, err)
		}
	}
	f.fake.mu.Unlock()
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusOK {
		t.Fatalf("confirmation: %d", rec.Code)
	}
	if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, headers...); rec.Code != http.StatusNoContent {
		t.Fatalf("webhook retry: %d", rec.Code)
	}
	if got := states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)); got["newsletter"] != "off" {
		t.Fatalf("retry left local state: %v", got)
	}
	if got := f.fake.sub("ada@example.org", "top_news"); got != "opt_out" {
		t.Fatalf("provider: %q", got)
	}
	assertOperationReleased(t)
}
