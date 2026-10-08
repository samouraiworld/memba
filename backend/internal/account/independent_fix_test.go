package account

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

type reviewTransport func(*http.Request) (*http.Response, error)

func (f reviewTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestIndependentWebhookSnapshotRacesConfirmation(t *testing.T) {
	f := newConsentFixture(t)
	if rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter")); rec.Code != http.StatusOK {
		t.Fatal(rec.Code)
	}
	link := lastLink(t, f.fake)
	changedToken := sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "new@example.org" }))
	f.fake.mu.Lock()
	f.fake.contacts["ada@example.org"] = map[string]string{"top_news": "opt_out"}
	f.fake.mu.Unlock()
	f.h.resend.client.Transport = reviewTransport(func(req *http.Request) (*http.Response, error) {
		res, err := http.DefaultTransport.RoundTrip(req)
		if err == nil && req.Method == http.MethodGet {
			// The webhook fetched the provider's opt_out snapshot; before that
			// response reaches its DB transaction, a user confirms the pending link.
			rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": link})
			if rec.Code != http.StatusConflict {
				t.Errorf("confirmation: %d %s", rec.Code, rec.Body.String())
			}
			if rec := call(t, f.mux, "GET", "/api/account", changedToken, nil); rec.Code != http.StatusConflict {
				t.Errorf("email change escaped webhook guard: %d", rec.Code)
			}
			if rec := call(t, f.mux, "POST", "/api/account/delete", f.tok, nil); rec.Code != http.StatusConflict {
				t.Errorf("deletion escaped webhook guard: %d", rec.Code)
			}
		}
		return res, err
	})
	body := []byte(`{"type":"contact.updated","data":{"email":"ada@example.org","unsubscribed":false}}`)
	rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, signedWebhook(t, f, "review-stale-snapshot", body, now)...)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("webhook: %d", rec.Code)
	}
	all, err := consents(t.Context(), f.h.db, accountID(t, f))
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 {
		t.Fatalf("consents=%v", all)
	}
	t.Logf("webhook=%d confirmed=%s withdrawn=%s provider=%s", rec.Code, all[0].ConfirmedAt, all[0].WithdrawnReason, f.fake.sub("ada@example.org", "top_news"))
	if all[0].WithdrawnAt != "" && f.fake.sub("ada@example.org", "top_news") == "opt_in" {
		t.Fatal("BUG: stale webhook snapshot withdraws confirmed consent while provider remains subscribed")
	}
}

func TestIndependentSeparateHandlersShareGuard(t *testing.T) {
	f := newConsentFixture(t)
	other, err := testConfig(t, f.k).build(f.h.db)
	if err != nil {
		t.Fatal(err)
	}
	other.now = f.h.now
	other.verifier.now = f.h.now
	other.resend.baseURL = f.fake.srv.URL
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	f.fake.mu.Lock()
	f.fake.contacts["ada@example.org"] = map[string]string{"top_news": "opt_out"}
	f.fake.afterTopicPatch = func() {
		rec := call(t, other.routes(), "GET", "/api/account", f.tok, nil)
		if rec.Code != http.StatusConflict || rec.Header().Get("Retry-After") != "1" {
			t.Errorf("separate handler: %d", rec.Code)
		}
	}
	f.fake.mu.Unlock()
	rec := call(t, f.mux, "POST", "/api/account/topics", f.tok, map[string]any{"topic": "newsletter", "on": false})
	if rec.Code != http.StatusOK {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
}

func TestWebhookRetryReadsCurrentTopicsWithoutReversingANewerOptIn(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	// A delayed contact.updated event has no authority to opt out a topic
	// whose current provider state is now opt_in. Only its fresh read counts.
	body := []byte(`{"type":"contact.updated","data":{"email":"ada@example.org","unsubscribed":false}}`)
	f.fake.mu.Lock()
	before := len(f.fake.calls)
	f.fake.mu.Unlock()
	if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, signedWebhook(t, f, "delayed-contact-update", body, now)...); rec.Code != http.StatusNoContent {
		t.Fatal(rec.Code)
	}
	if got := states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)); got["newsletter"] != "on" {
		t.Fatalf("delayed event removed new consent: %v", got)
	}
	if f.fake.sub("ada@example.org", "top_news") != "opt_in" {
		t.Fatal("delayed event opted out provider")
	}
	f.fake.mu.Lock()
	defer f.fake.mu.Unlock()
	for _, request := range f.fake.calls[before:] {
		if request != "GET /contacts/ada@example.org/topics" && request != "GET /contacts/ada@example.org" {
			t.Errorf("webhook mutated provider: %s", request)
		}
	}
}

func TestWebhookRejectsInvalidAndAcknowledgesReplayBeforeExclusiveGuard(t *testing.T) {
	f := newConsentFixture(t)
	body := []byte(`{"type":"contact.updated","data":{"email":"ada@example.org","unsubscribed":false}}`)
	if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, signedWebhook(t, f, "already-recorded", body, now)...); rec.Code != http.StatusNoContent {
		t.Fatal(rec.Code)
	}
	release, ok := beginWebhookOperation(httptest.NewRecorder())
	if !ok {
		t.Fatal("unexpected busy guard")
	}
	defer release()
	f.fake.mu.Lock()
	before := len(f.fake.calls)
	f.fake.mu.Unlock()
	if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body); rec.Code != http.StatusUnauthorized {
		t.Fatalf("signature must precede guard: %d", rec.Code)
	}
	malformed := []byte(`{"type":"contact.updated","data":{}}`)
	if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", malformed, signedWebhook(t, f, "malformed", malformed, now)...); rec.Code != http.StatusBadRequest {
		t.Fatalf("validation must precede guard: %d", rec.Code)
	}
	if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, signedWebhook(t, f, "already-recorded", body, now)...); rec.Code != http.StatusNoContent {
		t.Fatalf("replay must precede guard: %d", rec.Code)
	}
	if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, signedWebhook(t, f, "new-busy", body, now)...); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("new busy event: %d", rec.Code)
	}
	var n int
	if err := f.h.db.QueryRow("SELECT COUNT(*) FROM webhook_events WHERE id = 'new-busy'").Scan(&n); err != nil || n != 0 {
		t.Fatalf("contention consumed ledger: %d (%v)", n, err)
	}
	f.fake.mu.Lock()
	defer f.fake.mu.Unlock()
	if len(f.fake.calls) != before {
		t.Fatal("invalid, replayed or busy delivery reached provider")
	}
}

func TestWebhookUsesCurrentGlobalSuppressionAndRetriesProviderFailure(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	f.fake.mu.Lock()
	f.fake.unsubscribed["ada@example.org"] = true
	f.fake.mu.Unlock()
	// The historical payload says false; current provider global suppression wins.
	body := []byte(`{"type":"contact.updated","data":{"email":"ada@example.org","unsubscribed":false}}`)
	headers := signedWebhook(t, f, "current-global-stop", body, now)
	f.fake.setDown(true)
	if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, headers...); rec.Code != http.StatusBadGateway {
		t.Fatal(rec.Code)
	}
	assertOperationReleased(t)
	var n int
	if err := f.h.db.QueryRow("SELECT COUNT(*) FROM webhook_events WHERE id = 'current-global-stop'").Scan(&n); err != nil || n != 0 {
		t.Fatalf("failed read consumed event: %d (%v)", n, err)
	}
	f.fake.setDown(false)
	if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, headers...); rec.Code != http.StatusNoContent {
		t.Fatal(rec.Code)
	}
	if got := states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)); got["newsletter"] != "off" {
		t.Fatalf("global suppression ignored: %v", got)
	}
	assertOperationReleased(t)
}
