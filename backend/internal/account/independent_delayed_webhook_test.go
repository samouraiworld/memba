package account

import (
	"github.com/golang-jwt/jwt/v5"
	"net/http"
	"testing"
	"time"
)

// Returning to an earlier address must not recreate it to bypass a global opt-out.
func TestIndependentDelayedGlobalUnsubscribeAfterEmailRoundTrip(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	f.fake.mu.Lock()
	f.fake.unsubscribed["ada@example.org"] = true
	f.fake.mu.Unlock()
	body := []byte(`{"type":"contact.updated","data":{"email":"ada@example.org","unsubscribed":true}}`)
	headers := signedWebhook(t, f, "delayed-global-unsubscribe", body, now)
	at := now.Add(time.Second)
	f.h.now = func() time.Time { return at }
	tokenB := sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example"; c["iat"] = at.Unix() }))
	if rec := call(t, f.mux, "GET", "/api/account", tokenB, nil); rec.Code != 200 {
		t.Fatal(rec.Code)
	}
	at = now.Add(2 * time.Second)
	tokenA := sign(t, f.k, claims(func(c jwt.MapClaims) { c["iat"] = at.Unix() }))
	if rec := call(t, f.mux, "GET", "/api/account", tokenA, nil); rec.Code != 200 {
		t.Fatal(rec.Code)
	}
	if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)}); rec.Code != http.StatusConflict {
		t.Fatal("global opt-out bypassed", rec.Code)
	}
	if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, headers...); rec.Code != 204 {
		t.Fatal(rec.Code)
	}
	if got := states(t, call(t, f.mux, "GET", "/api/account/topics", tokenA, nil)); got["newsletter"] != "off" {
		t.Fatal(got)
	}
	f.fake.mu.Lock()
	defer f.fake.mu.Unlock()
	if !f.fake.unsubscribed["ada@example.org"] {
		t.Fatal("global unsubscribe reset")
	}
}
