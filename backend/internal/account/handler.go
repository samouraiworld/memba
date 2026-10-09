package account

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Export is everything Memba stores for an account ("Download my data").
type Export struct {
	Account  Account   `json:"account"`
	Consents []Consent `json:"consents"`
}

// Config is the account feature's environment.
type Config struct {
	Enabled             bool   // MEMBA_ACCOUNT_ENABLED=1
	JWTKeys             string // CLERK_JWT_KEYS
	ResendAPIKey        string // RESEND_API_KEY
	ResendWebhookSecret string // RESEND_WEBHOOK_SECRET (whsec_…)
	LinkSecret          string // MEMBA_EMAIL_LINK_SECRET, at least 32 bytes
	TopicIDs            string // RESEND_TOPIC_IDS: {"announcements": "<Resend topic id>", …}
}

type handler struct {
	db         *sql.DB
	verifier   *Verifier
	resend     *resend
	webhookKey []byte
	linkSecret []byte
	topicIDs   map[string]string
	now        func() time.Time
}

func (c Config) build(db *sql.DB) (*handler, error) {
	keys, err := ParseKeys(c.JWTKeys)
	if err != nil {
		return nil, err
	}
	if c.ResendAPIKey == "" {
		return nil, errors.New("RESEND_API_KEY is required")
	}
	webhookKey, err := base64.StdEncoding.Strict().DecodeString(strings.TrimPrefix(c.ResendWebhookSecret, "whsec_"))
	if err != nil || len(webhookKey) == 0 || !strings.HasPrefix(c.ResendWebhookSecret, "whsec_") {
		return nil, errors.New("RESEND_WEBHOOK_SECRET is not whsec_<base64>")
	}
	if len(c.LinkSecret) < 32 {
		return nil, errors.New("MEMBA_EMAIL_LINK_SECRET must be at least 32 bytes")
	}
	var ids map[string]string
	if json.Unmarshal([]byte(c.TopicIDs), &ids) != nil {
		return nil, errors.New("RESEND_TOPIC_IDS is not a JSON object")
	}
	seenIDs := map[string]bool{}
	for _, t := range topics {
		if ids[t] == "" || seenIDs[ids[t]] {
			return nil, fmt.Errorf("RESEND_TOPIC_IDS needs a distinct id for %q", t)
		}
		seenIDs[ids[t]] = true
	}
	return &handler{db: db, verifier: NewVerifier(keys), resend: newResend(c.ResendAPIKey), webhookKey: webhookKey,
		linkSecret: []byte(c.LinkSecret), topicIDs: ids, now: time.Now}, nil
}

// NewHandler serves /api/account*, /api/consent/confirm and /api/webhooks/resend.
// Off (404) unless enabled; unavailable (503) when enabled with any setting
// missing or unusable, so a misconfiguration never accepts what it cannot check.
func NewHandler(db *sql.DB, c Config) http.Handler {
	if !c.Enabled {
		return http.NotFoundHandler()
	}
	h, err := c.build(db)
	if err != nil {
		slog.Error("account routes unavailable", "error", err)
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusServiceUnavailable, "accounts are unavailable")
		})
	}
	return h.routes()
}

// routes are POST and GET only: the server's CORS allows no other method.
func (h *handler) routes() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /api/account", h.authed(h.get))
	mux.Handle("GET /api/account/export", h.authed(h.export))
	mux.Handle("POST /api/account/delete", h.authed(h.delete))
	mux.Handle("GET /api/account/topics", h.authed(h.getTopics))
	mux.Handle("POST /api/account/topics", h.authed(h.setTopic))
	mux.HandleFunc("POST /api/consent/confirm", h.confirm)
	mux.HandleFunc("POST /api/webhooks/resend", h.webhook)
	return mux
}

// authed verifies the Clerk session in "Authorization: Bearer <jwt>" and
// passes the caller's account, created on first use.
func (h *handler) authed(next func(http.ResponseWriter, *http.Request, Account)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok {
			writeError(w, http.StatusUnauthorized, "sign-in required")
			return
		}
		claims, err := h.verifier.Verify(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "sign-in required")
			return
		}
		// Reads also synchronize verified email, so they participate in the
		// same operation as topic writes, deletion and link confirmation.
		release, ok := beginOperation(w, claims.Subject)
		if !ok {
			return
		}
		defer release()
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		deleted, err := wasDeleted(ctx, h.db, claims.Subject)
		if err != nil {
			slog.Error("account: deletion marker", "error", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if deleted {
			if r.Method == http.MethodPost && r.URL.Path == "/api/account/delete" {
				w.WriteHeader(http.StatusNoContent)
			} else {
				deletedAccount(w)
			}
			return
		}
		a, err := Ensure(ctx, h.db, claims.Subject, h.now())
		if err != nil {
			slog.Error("account: ensure", "error", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if a, err = h.followEmail(ctx, a, claims); err != nil {
			slog.Error("account: address change", "error", err)
			writeError(w, http.StatusBadGateway, "your address changed and the email provider did not answer; try again")
			return
		}
		next(w, r.WithContext(ctx), a)
	})
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}
