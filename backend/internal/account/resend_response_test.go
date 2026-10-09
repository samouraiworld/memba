package account

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

// A successful HTTP status is not proof that all provider preferences were read.
func TestSharedResendMalformedTopicsKeepWebhookRetryable(t *testing.T) {
	cases := map[string]string{
		"empty_object":            `{}`,
		"null_response":           `null`,
		"missing_has_more":        `{"data":[]}`,
		"null_has_more":           `{"has_more":null,"data":[]}`,
		"wrong_has_more_type":     `{"has_more":"false","data":[]}`,
		"missing_data":            `{"has_more":false}`,
		"null_data":               `{"has_more":false,"data":null}`,
		"wrong_data_type":         `{"has_more":false,"data":{}}`,
		"null_entry":              `{"has_more":false,"data":[null]}`,
		"missing_id":              `{"has_more":false,"data":[{"subscription":"opt_out"}]}`,
		"null_id":                 `{"has_more":false,"data":[{"id":null,"subscription":"opt_out"}]}`,
		"blank_id":                `{"has_more":false,"data":[{"id":"  ","subscription":"opt_out"}]}`,
		"wrong_id_type":           `{"has_more":false,"data":[{"id":42,"subscription":"opt_out"}]}`,
		"missing_subscription":    `{"has_more":false,"data":[{"id":"top_news"}]}`,
		"null_subscription":       `{"has_more":false,"data":[{"id":"top_news","subscription":null}]}`,
		"unknown_subscription":    `{"has_more":false,"data":[{"id":"top_news","subscription":"unknown"}]}`,
		"wrong_subscription_type": `{"has_more":false,"data":[{"id":"top_news","subscription":true}]}`,
		"duplicate_id":            `{"has_more":false,"data":[{"id":"top_news","subscription":"opt_out"},{"id":"top_news","subscription":"opt_in"}]}`,
	}
	for name, bad := range cases {
		t.Run(name, func(t *testing.T) {
			f := newConsentFixture(t)
			call(t, f.mux, "POST", "/api/account/topics", f.tok, on("newsletter"))
			if rec := call(t, f.mux, "POST", "/api/consent/confirm", "", map[string]string{"token": lastLink(t, f.fake)}); rec.Code != 200 {
				t.Fatal("setup", rec.Code)
			}
			f.h.resend.client.Transport = reviewTransport(func(r *http.Request) (*http.Response, error) {
				if r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/topics") {
					return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(bad)), Header: make(http.Header)}, nil
				}
				return http.DefaultTransport.RoundTrip(r)
			})
			body := []byte(`{"type":"contact.updated","data":{"email":"ada@example.org"}}`)
			headers := signedWebhook(t, f, "malformed-topics", body, now)
			if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, headers...); rec.Code != 502 {
				t.Errorf("malformed list acknowledged: %d", rec.Code)
			}
			var n int
			_ = f.h.db.QueryRow("SELECT COUNT(*) FROM webhook_events WHERE id='malformed-topics'").Scan(&n)
			if n != 0 {
				t.Error("malformed delivery consumed")
			}
			if got := states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)); got["newsletter"] != "on" {
				t.Error("partial response changed local consent")
			}
			f.h.resend.client.Transport = nil
			f.fake.mu.Lock()
			f.fake.contacts["ada@example.org"]["top_news"] = "opt_out"
			f.fake.mu.Unlock()
			if rec := call(t, f.mux, "POST", "/api/webhooks/resend", "", body, headers...); rec.Code != 204 {
				t.Fatal("retry", rec.Code)
			}
			if got := states(t, call(t, f.mux, "GET", "/api/account/topics", f.tok, nil)); got["newsletter"] != "off" {
				t.Error("retry did not apply real withdrawal")
			}
		})
	}
}

func TestSharedResendMinimalValidTopicResponses(t *testing.T) {
	for _, body := range []string{`{"has_more":false,"data":[]}`, `{"has_more":false,"data":[{"id":"top_news","subscription":"opt_out"}]}`} {
		r := newResend("test")
		r.client.Transport = reviewTransport(func(req *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
		})
		if _, err := r.topics(t.Context(), "owned@example.org"); err != nil {
			t.Fatal("optional presentation fields required", err)
		}
	}
}
