package account

import (
	"bytes"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestIndependentDelayedGlobalUnsubscribeAfterContactRecreation(t *testing.T) {
	f := newConsentFixture(t)
	// The existing fake stores only topics. Track the global flag from the
	// production module's actual create/delete payloads, preserving it on PATCH.
	globalUnsubscribed := map[string]bool{}
	f.h.resend.client.Transport = reviewTransport(func(req *http.Request) (*http.Response, error) {
		var create struct {
			Email        string `json:"email"`
			Unsubscribed bool   `json:"unsubscribed"`
		}
		if req.Method == http.MethodPost && req.URL.Path == "/contacts" {
			raw, err := io.ReadAll(req.Body)
			if err != nil {
				return nil, err
			}
			req.Body = io.NopCloser(bytes.NewReader(raw))
			if err := json.Unmarshal(raw, &create); err != nil {
				return nil, err
			}
		}
		res, err := http.DefaultTransport.RoundTrip(req)
		if err == nil && res.StatusCode < 300 {
			if create.Email != "" {
				globalUnsubscribed[create.Email] = create.Unsubscribed
				t.Logf("actual POST contacts %s unsubscribed=%v", create.Email, create.Unsubscribed)
			}
			if req.Method == http.MethodDelete {
				delete(globalUnsubscribed, strings.TrimPrefix(req.URL.Path, "/contacts/"))
			}
		}
		return res, err
	})
	requireOK := func(method, path, token string, body any) {
		t.Helper()
		rec := call(t, f.mux, method, path, token, body)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s %s=%d %s", method, path, rec.Code, rec.Body.String())
		}
	}
	requireOK("POST", "/api/account/topics", f.tok, on("newsletter"))
	requireOK("POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	// The provider globally unsubscribed the old contact and signed an event,
	// whose first delivery is delayed a few seconds (not a replay).
	globalUnsubscribed["ada@example.org"] = true
	oldBody := []byte(`{"type":"contact.updated","data":{"email":"ada@example.org","unsubscribed":true}}`)
	oldHeaders := signedWebhook(t, f, "old-contact-global-unsubscribe", oldBody, now)
	at := now.Add(time.Second)
	f.h.now = func() time.Time { return at }
	tokenB := sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "ada@new.example"; c["iat"] = at.Unix() }))
	requireOK("GET", "/api/account", tokenB, nil) // production flow deletes old contact A
	at = now.Add(2 * time.Second)
	tokenA := sign(t, f.k, claims(func(c jwt.MapClaims) { c["iat"] = at.Unix() }))
	requireOK("GET", "/api/account", tokenA, nil) // generates a new request for A
	at = now.Add(3 * time.Second)
	requireOK("POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	flag, present := globalUnsubscribed["ada@example.org"]
	if !present || flag {
		t.Fatalf("new contact global suppression still on or absent: %v %v", present, flag)
	}
	rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", oldBody, oldHeaders...)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("old delivery=%d", rec.Code)
	}
	got := states(t, call(t, f.mux, "GET", "/api/account/topics", tokenA, nil))
	t.Logf("old delivery=%d current_global_unsubscribed=%v current_topic=%s local_state=%s", rec.Code, globalUnsubscribed["ada@example.org"], f.fake.sub("ada@example.org", "top_news"), got["newsletter"])
	if !globalUnsubscribed["ada@example.org"] && f.fake.sub("ada@example.org", "top_news") == "opt_in" && got["newsletter"] == "off" {
		t.Fatal("BUG: historical global unsubscribe withdraws newer consent but leaves recreated provider contact enabled")
	}
}
