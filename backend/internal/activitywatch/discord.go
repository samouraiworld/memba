package activitywatch

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

func (w *Watcher) send(ctx context.Context, content string) error {
	u, err := url.Parse(w.cfg.WebhookURL)
	if err != nil {
		return errors.New("invalid webhook URL")
	}
	q := u.Query()
	q.Set("wait", "true")
	u.RawQuery = q.Encode()
	body, err := json.Marshal(map[string]any{"content": content, "allowed_mentions": map[string]any{"parse": []string{}}})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return errors.New("invalid Discord request")
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := w.client.Do(req)
	if err != nil {
		return errors.New("discord transport failed; delivery may be ambiguous, retry pending")
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusTooManyRequests {
		var rate struct {
			RetryAfter float64 `json:"retry_after"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&rate)
		// Pause for Discord's requested interval (minimum one normal cycle).
		delay := time.Duration(rate.RetryAfter * float64(time.Second))
		if delay < 15*time.Second {
			delay = 15 * time.Second
		}
		if delay > 24*time.Hour {
			delay = 24 * time.Hour
		}
		w.retryAt = w.now().Add(delay)
		return errors.New("discord rate limited; retry scheduled")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("discord HTTP %d; delivery remains queued", resp.StatusCode)
	}
	var message struct {
		ID string `json:"id"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&message) != nil || message.ID == "" {
		return errors.New("discord did not confirm a saved message")
	}
	return nil
}
