package account

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"
)

// afterEmailChange asks the new verified address to confirm again what was
// live for the old one (a new double opt-in, never a silent transfer).
func (h *handler) afterEmailChange(ctx context.Context, a Account, previous string, live []Consent) {
	if a.Email == "" || previous == "" {
		return
	}
	for _, c := range live {
		if err := h.request(ctx, a, c.Topic, c.Scope, c.WordingVersion, "email_changed"); err != nil {
			slog.Error("account: email change: new request", "error", err)
		}
	}
}

type resendEvent struct {
	Type string `json:"type"`
	Data struct {
		From         string   `json:"from"`
		Email        string   `json:"email"`
		Unsubscribed bool     `json:"unsubscribed"`
		To           []string `json:"to"`
		Bounce       struct {
			Type string `json:"type"`
		} `json:"bounce"`
	} `json:"data"`
}

// webhook applies Resend's word on an address: an unsubscribe withdraws, a
// permanent bounce or a complaint marks the address undeliverable and
// withdraws. It can never turn anything on. Each delivery applies once.
func (h *handler) webhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10+1))
	if err != nil || len(body) > 64<<10 {
		writeError(w, http.StatusRequestEntityTooLarge, "too large")
		return
	}
	id := r.Header.Get("svix-id")
	if verifySvix(h.webhookKey, id, r.Header.Get("svix-timestamp"), r.Header.Get("svix-signature"), body, h.now()) != nil {
		writeError(w, http.StatusUnauthorized, "invalid signature")
		return
	}
	var ev resendEvent
	if json.Unmarshal(body, &ev) != nil {
		writeError(w, http.StatusBadRequest, "invalid event")
		return
	}
	ctx, now := r.Context(), h.now()
	// Validate before reserving the lifecycle or contacting the provider.
	switch ev.Type {
	case "contact.updated":
		if ev.Data.Email == "" {
			writeError(w, http.StatusBadRequest, "missing contact address")
			return
		}
	case "email.bounced", "email.complained":
		// Signed webhooks are team-wide. A Zenao complaint is not a Memba
		// withdrawal; only our exact sender can change this local state.
		sender, parseErr := mail.ParseAddress(ev.Data.From)
		if parseErr != nil || !strings.EqualFold(sender.Address, "news@mail.memba.club") {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if ev.Type == "email.bounced" && ev.Data.Bounce.Type != "Permanent" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if len(ev.Data.To) == 0 {
			writeError(w, http.StatusBadRequest, "missing recipient")
			return
		}
		for _, addr := range ev.Data.To {
			if addr == "" {
				writeError(w, http.StatusBadRequest, "missing recipient")
				return
			}
		}
	default:
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var applied int
	if err := h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM webhook_events WHERE id = ?", id).Scan(&applied); err != nil {
		h.fail(w, "webhook replay check", err)
		return
	}
	if applied != 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	release, ok := beginWebhookOperation(w)
	if !ok {
		return
	}
	defer release()
	optedOut := map[string]bool{}
	globalUnsubscribed := false
	if ev.Type == "contact.updated" {
		var err error
		globalUnsubscribed, err = h.resend.unsubscribed(ctx, ev.Data.Email)
		if err != nil && !errors.Is(err, errNoContact) {
			slog.Error("account: webhook contact", "error", err)
			writeError(w, http.StatusBadGateway, "retry")
			return
		}
		if err == nil && !globalUnsubscribed {
			subs, err := h.resend.topics(ctx, ev.Data.Email)
			if err != nil && !errors.Is(err, errNoContact) {
				slog.Error("account: webhook topics", "error", err)
				writeError(w, http.StatusBadGateway, "retry")
				return
			}
			for _, t := range topics {
				optedOut[t] = subs[h.topicIDs[t]] == "opt_out"
			}
		}
	}
	err = h.inTx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)", id, now.UTC().Format(time.RFC3339))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return nil // already applied
		}
		switch ev.Type {
		case "contact.updated":
			if globalUnsubscribed {
				return withdraw(ctx, tx, now, "unsubscribe", "email = ?", ev.Data.Email)
			}
			for t, out := range optedOut {
				if out {
					if err := withdraw(ctx, tx, now, "unsubscribe", "email = ? AND topic = ?", ev.Data.Email, t); err != nil {
						return err
					}
				}
			}
		case "email.bounced", "email.complained":
			if ev.Type == "email.bounced" && ev.Data.Bounce.Type != "Permanent" {
				return nil
			}
			for _, addr := range ev.Data.To {
				if _, err := tx.ExecContext(ctx, "UPDATE accounts SET email_undeliverable_at = ? WHERE email = ?", now.UTC().Format(time.RFC3339), addr); err != nil {
					return err
				}
				if err := withdraw(ctx, tx, now, "undeliverable", "email = ?", addr); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		h.fail(w, "webhook", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// StartSweep deletes, daily, the requests nobody confirmed in time and old webhook replay entries.
func StartSweep(ctx context.Context, db *sql.DB) {
	go func() {
		tick := time.NewTicker(24 * time.Hour)
		defer tick.Stop()
		for {
			if err := sweep(ctx, db, time.Now()); err != nil && ctx.Err() == nil {
				slog.Warn("account: sweep failed", "error", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
			}
		}
	}()
}
