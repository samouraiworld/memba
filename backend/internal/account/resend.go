package account

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// newsSender sends consent confirmations (Q3: news@ on the verified mail subdomain).
const newsSender = "Memba <news@mail.memba.club>"

var errNoContact = errors.New("no such contact")

// resend is the part of Resend's HTTP API Memba uses. Consent lives in Memba's
// database; Resend only mirrors which topics a contact receives.
type resend struct {
	baseURL string
	key     string
	client  *http.Client
}

func newResend(key string) *resend {
	return &resend{baseURL: "https://api.resend.com", key: key, client: &http.Client{Timeout: 10 * time.Second}}
}

// do calls Resend. Its errors name the operation and the HTTP status only:
// never the path or the transport's message, which carry the address.
func (r *resend) do(ctx context.Context, op, method, path string, body, out any) error {
	var buf io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		buf = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, r.baseURL+path, buf)
	if err != nil {
		return fmt.Errorf("resend %s: bad request", op)
	}
	req.Header.Set("Authorization", "Bearer "+r.key)
	req.Header.Set("Content-Type", "application/json")
	res, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("resend %s: no answer", op)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode == http.StatusNotFound {
		return errNoContact
	}
	if res.StatusCode >= 300 {
		return fmt.Errorf("resend %s: status %d", op, res.StatusCode)
	}
	if out != nil {
		if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(out); err != nil {
			return fmt.Errorf("resend %s: unreadable answer", op)
		}
	}
	return nil
}

func (r *resend) send(ctx context.Context, to, subject, text string) error {
	return r.do(ctx, "send", http.MethodPost, "/emails", map[string]any{"from": newsSender, "to": []string{to}, "subject": subject, "text": text}, nil)
}

type topicSubscription struct {
	ID           string `json:"id"`
	Subscription string `json:"subscription"` // opt_in | opt_out
}

// setTopic opts the address in or out of one topic, creating the contact on
// the first opt-in.
func (r *resend) setTopic(ctx context.Context, email, topicID string, in bool) error {
	sub := topicSubscription{ID: topicID, Subscription: "opt_out"}
	if in {
		sub.Subscription = "opt_in"
	}
	err := r.do(ctx, "set topic", http.MethodPatch, "/contacts/"+url.PathEscape(email)+"/topics", []topicSubscription{sub}, nil)
	if errors.Is(err, errNoContact) {
		if !in {
			return nil
		}
		return r.do(ctx, "create contact", http.MethodPost, "/contacts", map[string]any{"email": email, "unsubscribed": false, "topics": []topicSubscription{sub}}, nil)
	}
	return err
}

// topics returns the contact's subscription per Resend topic id.
func (r *resend) topics(ctx context.Context, email string) (map[string]string, error) {
	var out struct {
		Data []topicSubscription `json:"data"`
	}
	if err := r.do(ctx, "read topics", http.MethodGet, "/contacts/"+url.PathEscape(email)+"/topics", nil, &out); err != nil {
		return nil, err
	}
	subs := make(map[string]string, len(out.Data))
	for _, t := range out.Data {
		subs[t.ID] = t.Subscription
	}
	return subs, nil
}

// deleteContact removes the address from Resend; an unknown address is fine.
func (r *resend) deleteContact(ctx context.Context, email string) error {
	if err := r.do(ctx, "delete contact", http.MethodDelete, "/contacts/"+url.PathEscape(email), nil, nil); err != nil && !errors.Is(err, errNoContact) {
		return err
	}
	return nil
}
