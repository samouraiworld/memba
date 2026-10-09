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

// setTopic changes only a Memba topic. Global unsubscribe belongs to the shared
// Resend account and must never be reset by a Memba confirmation.
func (r *resend) setTopic(ctx context.Context, email, topicID string, in bool) error {
	sub := topicSubscription{ID: topicID, Subscription: "opt_out"}
	if in {
		sub.Subscription = "opt_in"
		blocked, err := r.unsubscribed(ctx, email)
		if errors.Is(err, errNoContact) {
			// Do not send global status, properties, segments or topics on creation:
			// another project may have created this email since our read.
			if err = r.do(ctx, "create contact", http.MethodPost, "/contacts", map[string]any{"email": email}, nil); err != nil {
				return err
			}
			blocked, err = r.unsubscribed(ctx, email)
		}
		if err != nil {
			return err
		}
		if blocked {
			return errGloballyUnsubscribed
		}
	}
	err := r.do(ctx, "set topic", http.MethodPatch, "/contacts/"+url.PathEscape(email)+"/topics", []topicSubscription{sub}, nil)
	if !in && errors.Is(err, errNoContact) {
		return nil
	}
	if err != nil || !in {
		return err
	}
	// A global unsubscribe may have arrived while our topic PATCH was in flight.
	blocked, err := r.unsubscribed(ctx, email)
	if err != nil {
		return err
	}
	if blocked {
		return errGloballyUnsubscribed
	}
	return nil
}

var errGloballyUnsubscribed = errors.New("resend contact is globally unsubscribed")

// unsubscribed reads the current global state, not the historical webhook's
// flag (the contact may have been deleted and recreated since that event).
func (r *resend) unsubscribed(ctx context.Context, email string) (bool, error) {
	var out struct {
		Unsubscribed *bool `json:"unsubscribed"`
	}
	if err := r.do(ctx, "read contact", http.MethodGet, "/contacts/"+url.PathEscape(email), nil, &out); err != nil {
		return false, err
	}
	if out.Unsubscribed == nil {
		return false, errors.New("resend read contact: missing subscription state")
	}
	return *out.Unsubscribed, nil
}

// topics follows every page before letting a webhook mark a delivery applied.
// Repeated or empty cursors fail closed, so a partial response can be retried.
func (r *resend) topics(ctx context.Context, email string) (map[string]string, error) {
	subs := map[string]string{}
	seen := map[string]bool{}
	path := "/contacts/" + url.PathEscape(email) + "/topics"
	after := ""
	for page := 0; page < 100; page++ {
		var out struct {
			Data    []topicSubscription `json:"data"`
			HasMore bool                `json:"has_more"`
		}
		next := path
		if after != "" {
			next += "?after=" + url.QueryEscape(after)
		}
		if err := r.do(ctx, "read topics", http.MethodGet, next, nil, &out); err != nil {
			return nil, err
		}
		for _, t := range out.Data {
			subs[t.ID] = t.Subscription
		}
		if !out.HasMore {
			return subs, nil
		}
		if len(out.Data) == 0 {
			break
		}
		after = out.Data[len(out.Data)-1].ID
		if after == "" || seen[after] {
			break
		}
		seen[after] = true
	}
	return nil, errors.New("resend read topics: incomplete pagination")
}

// withdrawMemba removes only Memba's permission to email this address. Neither
// topic state nor absence of segments proves exclusive ownership of a contact.
// Even a contact currently used only by Memba is retained by the shared provider.
func (h *handler) withdrawMemba(ctx context.Context, email string) error {
	subs := make([]topicSubscription, 0, len(topics))
	for _, topic := range topics {
		subs = append(subs, topicSubscription{ID: h.topicIDs[topic], Subscription: "opt_out"})
	}
	err := h.resend.do(ctx, "withdraw Memba topics", http.MethodPatch, "/contacts/"+url.PathEscape(email)+"/topics", subs, nil)
	if errors.Is(err, errNoContact) {
		return nil
	}
	return err
}
