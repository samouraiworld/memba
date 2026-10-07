package account

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Export is everything Memba stores for an account ("Download my data").
type Export struct {
	Account Account `json:"account"`
}

type handler struct {
	db       *sql.DB
	verifier *Verifier
	now      func() time.Time
}

// NewHandler serves /api/account*. Off (404) unless enabled; unavailable (503)
// when enabled without a usable CLERK_JWT_KEYS, so a misconfiguration never
// accepts a session it cannot check.
func NewHandler(db *sql.DB, enabled bool, rawKeys string) http.Handler {
	if !enabled {
		return http.NotFoundHandler()
	}
	keys, err := ParseKeys(rawKeys)
	if err != nil {
		slog.Error("account routes unavailable: CLERK_JWT_KEYS", "error", err)
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusServiceUnavailable, "accounts are unavailable")
		})
	}
	return (&handler{db: db, verifier: NewVerifier(keys), now: time.Now}).routes()
}

// routes are POST and GET only: the server's CORS allows no other method.
func (h *handler) routes() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /api/account", h.authed(h.get))
	mux.Handle("GET /api/account/export", h.authed(h.export))
	mux.Handle("POST /api/account/delete", h.authed(h.delete))
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
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		a, err := Ensure(ctx, h.db, claims, h.now())
		if err != nil {
			slog.Error("account: ensure", "error", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		next(w, r.WithContext(ctx), a)
	})
}

func (h *handler) get(w http.ResponseWriter, _ *http.Request, a Account) {
	writeJSON(w, a)
}

func (h *handler) export(w http.ResponseWriter, _ *http.Request, a Account) {
	w.Header().Set("Content-Disposition", `attachment; filename="memba-account.json"`)
	writeJSON(w, Export{Account: a})
}

func (h *handler) delete(w http.ResponseWriter, r *http.Request, a Account) {
	if err := Delete(r.Context(), h.db, a.ID); err != nil {
		slog.Error("account: delete", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
