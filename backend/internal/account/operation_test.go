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

func TestWebhookCanWithdrawDuringProviderIOWithoutWaitingOnSQLite(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	link := lastLink(t, f.fake)
	f.fake.mu.Lock()
	f.fake.contacts["ada@example.org"] = map[string]string{"top_news": "opt_out"}
	f.fake.afterTopicPatch = func() {
		// Model a provider unsubscribe after it applied the confirmation's PATCH.
		f.fake.mu.Lock()
		f.fake.contacts["ada@example.org"]["top_news"] = "opt_out"
		f.fake.mu.Unlock()
		body := []byte(`{"type":"contact.updated","data":{"email":"ada@example.org","unsubscribed":true}}`)
		if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, signedWebhook(t, f, "racing-unsubscribe", body, now)...); rec.Code != http.StatusNoContent {
			t.Errorf("webhook: %d", rec.Code)
		}
	}
	f.fake.mu.Unlock()
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link}); rec.Code != http.StatusGone {
		t.Fatalf("withdrawn confirmation: %d", rec.Code)
	}
	if got := f.fake.sub("ada@example.org", "top_news"); got != "opt_out" {
		t.Fatalf("provider: %q", got)
	}
	assertOperationReleased(t)
}
