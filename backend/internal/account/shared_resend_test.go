package account

import (
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSharedResendCleanupPreservesOtherProject(t *testing.T) {
	for _, action := range []string{"delete", "email_change"} {
		t.Run(action, func(t *testing.T) {
			f := newConsentFixture(t)
			call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
			call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
			f.fake.mu.Lock()
			f.fake.contacts["ada@example.org"]["zenao_events"] = "opt_in"
			f.fake.unsubscribed["ada@example.org"] = true
			f.fake.mu.Unlock()
			var code int
			if action == "delete" {
				code = call(t, f.mux, "POST", "/api/account/delete", f.tok, nil).Code
			} else {
				code = call(t, f.mux, "GET", "/api/account", sign(t, f.k, claims(func(c jwt.MapClaims) { c["email"] = "new@example.org" })), nil).Code
			}
			if code != http.StatusOK && code != http.StatusNoContent {
				t.Fatalf("cleanup: %d", code)
			}
			f.fake.mu.Lock()
			defer f.fake.mu.Unlock()
			if f.fake.contacts["ada@example.org"]["zenao_events"] != "opt_in" || !f.fake.unsubscribed["ada@example.org"] {
				t.Fatal("cleanup destroyed Zenao preference or global suppression")
			}
			for _, id := range f.h.topicIDs {
				if f.fake.contacts["ada@example.org"][id] != "opt_out" {
					t.Fatalf("Memba topic %s remains eligible", id)
				}
			}
			for _, c := range f.fake.calls {
				if strings.HasPrefix(c, "DELETE ") {
					t.Fatalf("global deletion: %s", c)
				}
			}
		})
	}
}

// The provider creates the same address for Zenao after Memba observed 404.
// Model an upsert: only fields explicitly supplied may modify the contact.
func TestSharedResendCreateRaceNeverResubscribesGlobally(t *testing.T) {
	global := true
	exists := false
	zenao := "opt_in"
	writesFalse := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost:
			var b map[string]any
			_ = json.NewDecoder(r.Body).Decode(&b)
			exists = true
			if v, ok := b["unsubscribed"].(bool); ok {
				global = v
				writesFalse = !v
			}
			if _, ok := b["topics"]; ok {
				zenao = "clobbered"
			}
			_, _ = io.WriteString(w, `{"id":"shared"}`)
		case r.Method == http.MethodGet && exists:
			_ = json.NewEncoder(w).Encode(map[string]any{"unsubscribed": global})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	r := newResend("test")
	r.baseURL = srv.URL
	if err := r.setTopic(t.Context(), "shared@example.org", "memba", true); err == nil {
		t.Error("globally unsubscribed shared contact was accepted")
	}
	if writesFalse || !global || zenao != "opt_in" {
		t.Fatal("create race modified global or unrelated preference")
	}
}
func TestSharedResendWebhookReadsEveryTopicPage(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	original := f.h.resend.client.Transport
	if original == nil {
		original = http.DefaultTransport
	}
	f.h.resend.client.Transport = reviewTransport(func(r *http.Request) (*http.Response, error) {
		if r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/topics") {
			body := `{"has_more":true,"data":[{"id":"zenao","subscription":"opt_out"}]}`
			if r.URL.Query().Get("after") == "zenao" {
				body = `{"has_more":false,"data":[{"id":"top_news","subscription":"opt_out"}]}`
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
		}
		return original.RoundTrip(r)
	})
	body := []byte(`{"type":"contact.updated","data":{"email":"ada@example.org","unsubscribed":false}}`)
	if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, signedWebhook(t, f, "shared-pages", body, now)...); rec.Code != 204 {
		t.Fatal(rec.Code)
	}
	if got := states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)); got["newsletter"] != "off" {
		t.Fatal("Memba opt-out on later page ignored")
	}
}
func TestSharedResendForeignComplaintCannotWithdrawMemba(t *testing.T) {
	f := newConsentFixture(t)
	call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
	call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
	for _, from := range []string{"Zenao <events@mail.zenao.io>", ""} {
		body, _ := json.Marshal(map[string]any{"type": "email.complained", "data": map[string]any{"from": from, "to": []string{"ada@example.org"}}})
		call(t, f.mux, "POST", "/api/webhooks/resend", "", body, signedWebhook(t, f, "other-project"+from, body, now)...)
	}
	if got := states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)); got["newsletter"] != "on" {
		t.Fatal("another project's complaint withdrew Memba consent")
	}
}

func TestSharedResendPaginationFailureKeepsWebhookRetryable(t *testing.T) {
	for _, broken := range []string{"second_page_error", "repeated_cursor", "empty_more"} {
		t.Run(broken, func(t *testing.T) {
			f := newConsentFixture(t)
			call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
			call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
			f.h.resend.client.Transport = reviewTransport(func(r *http.Request) (*http.Response, error) {
				if r.Method != http.MethodGet || !strings.HasSuffix(r.URL.Path, "/topics") {
					return http.DefaultTransport.RoundTrip(r)
				}
				status := 200
				body := `{"has_more":true,"data":[{"id":"zenao","subscription":"opt_out"}]}`
				if broken == "empty_more" {
					body = `{"has_more":true,"data":[]}`
				} else if r.URL.Query().Get("after") != "" && broken == "second_page_error" {
					status = 500
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})
			body := []byte(`{"type":"contact.updated","data":{"email":"ada@example.org"}}`)
			if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, signedWebhook(t, f, "incomplete", body, now)...); rec.Code != 502 {
				t.Fatalf("partial list acknowledged: %d", rec.Code)
			}
			var n int
			_ = f.h.db.QueryRow("SELECT COUNT(*) FROM webhook_events WHERE id='incomplete'").Scan(&n)
			if n != 0 {
				t.Fatal("failed delivery consumed")
			}
			f.h.resend.client.Transport = nil
			if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, signedWebhook(t, f, "incomplete", body, now)...); rec.Code != 204 {
				t.Fatal("retry", rec.Code)
			}
		})
	}
}

func TestSharedResendGlobalUnsubscribeBlocksConfirmation(t *testing.T) {
	for _, duringPatch := range []bool{false, true} {
		t.Run(map[bool]string{false: "before", true: "during_patch"}[duringPatch], func(t *testing.T) {
			f := newConsentFixture(t)
			call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
			f.fake.mu.Lock()
			f.fake.contacts["ada@example.org"] = map[string]string{"zenao": "opt_in"}
			f.fake.unsubscribed["ada@example.org"] = !duringPatch
			if duringPatch {
				f.fake.afterTopicPatch = func() { f.fake.mu.Lock(); f.fake.unsubscribed["ada@example.org"] = true; f.fake.mu.Unlock() }
			}
			f.fake.mu.Unlock()
			rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)})
			if rec.Code != 409 {
				t.Fatalf("suppressed confirmation: %d", rec.Code)
			}
			if f.fake.sub("ada@example.org", "top_news") != "opt_out" || f.fake.sub("ada@example.org", "zenao") != "opt_in" {
				t.Fatal("rollback changed unrelated topic or retained Memba opt-in")
			}
			if got := states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)); got["newsletter"] == "on" {
				t.Fatal("suppressed local consent confirmed")
			}
		})
	}
}
