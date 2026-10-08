package account

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// fakeResend stands in for Resend's API: contacts with their topic
// subscriptions, sent emails, and a switch that makes every call fail.
type fakeResend struct {
	srv          *httptest.Server
	mu           sync.Mutex
	contacts     map[string]map[string]string // email → topic id → opt_in | opt_out
	unsubscribed map[string]bool
	sent         []struct{ To, Subject, Text string }
	calls        []string
	down         bool
	// afterDelete runs once, right after a contact is deleted and before the
	// caller hears back: what another request does in that window.
	afterDelete func()
	// afterTopicPatch runs once after a topic update, before the response.
	afterTopicPatch func()
	// applyThenFail applies topic changes but answers 500 (a timeout after the fact).
	applyThenFail bool
}

func newFakeResend(t *testing.T) *fakeResend {
	f := &fakeResend{contacts: map[string]map[string]string{}, unsubscribed: map[string]bool{}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeResend) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	hook := f.afterDelete
	if r.Method == http.MethodDelete && hook != nil {
		f.afterDelete = nil
		defer hook() // after the unlock below
	}
	if r.Method == http.MethodPatch && f.afterTopicPatch != nil {
		afterPatch := f.afterTopicPatch
		f.afterTopicPatch = nil
		defer afterPatch()
	}
	defer f.mu.Unlock()
	f.calls = append(f.calls, r.Method+" "+r.URL.Path)
	if f.down || r.Header.Get("Authorization") != "Bearer re_test" {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/"), "/")
	email := ""
	if len(parts) > 1 {
		email, _ = url.PathUnescape(parts[1])
	}
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/emails":
		var m struct {
			To      []string `json:"to"`
			Subject string   `json:"subject"`
			Text    string   `json:"text"`
		}
		_ = json.NewDecoder(r.Body).Decode(&m)
		f.sent = append(f.sent, struct{ To, Subject, Text string }{strings.Join(m.To, ","), m.Subject, m.Text})
		_, _ = w.Write([]byte(`{"id":"em_1"}`))
	case r.Method == http.MethodPost && r.URL.Path == "/contacts":
		var m struct {
			Email        string              `json:"email"`
			Topics       []topicSubscription `json:"topics"`
			Unsubscribed bool                `json:"unsubscribed"`
		}
		_ = json.NewDecoder(r.Body).Decode(&m)
		f.contacts[m.Email] = map[string]string{}
		f.unsubscribed[m.Email] = m.Unsubscribed
		for _, t := range m.Topics {
			f.contacts[m.Email][t.ID] = t.Subscription
		}
		_, _ = w.Write([]byte(`{"id":"ct_1"}`))
	case len(parts) == 3 && parts[2] == "topics":
		subs, ok := f.contacts[email]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Method == http.MethodGet {
			var data []topicSubscription
			for id, s := range subs {
				data = append(data, topicSubscription{ID: id, Subscription: s})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
			return
		}
		var m []topicSubscription
		_ = json.NewDecoder(r.Body).Decode(&m)
		for _, t := range m {
			subs[t.ID] = t.Subscription
		}
		if f.applyThenFail {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	case r.Method == http.MethodGet && len(parts) == 2:
		if _, ok := f.contacts[email]; !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"email": email, "unsubscribed": f.unsubscribed[email]})
	case r.Method == http.MethodDelete && len(parts) == 2:
		if _, ok := f.contacts[email]; !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		delete(f.contacts, email)
		delete(f.unsubscribed, email)
		_, _ = w.Write([]byte(`{}`))
	default:
		w.WriteHeader(http.StatusBadRequest)
	}
}

func (f *fakeResend) sub(email, topicID string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.contacts[email][topicID]
}

func (f *fakeResend) emails() []struct{ To, Subject, Text string } {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]struct{ To, Subject, Text string }(nil), f.sent...)
}

func (f *fakeResend) setDown(down bool) {
	f.mu.Lock()
	f.down = down
	f.mu.Unlock()
}
