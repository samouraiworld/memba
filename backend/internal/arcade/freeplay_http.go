package arcade

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type FreePlayAuthenticator interface {
	ValidateRESTTokenIdentity(string) (string, string, error)
}
type FreePlayQuotePolicy interface {
	Quote(context.Context, FreePlayRun) (FreePlayQuote, error)
}

// An explicit limiter is mandatory before verification, even in a preview.
type FreePlayLimiter interface {
	AllowFreePlay(context.Context, string, string) bool
}

// FreePlayBoardReader reads the v2 realm, not the local verified-runs table.
type FreePlayBoardReader interface {
	ReadBoard(context.Context, FreePlayTarget, string, string, int64, int, int) ([]FreePlayReceipt, error)
}
type FreePlayHTTPConfig struct {
	Boards  FreePlayBoardReader
	Enabled bool
	Target  FreePlayTarget
	Store   *FreePlayStore
	Auth    FreePlayAuthenticator
	Limiter FreePlayLimiter
	Quotes  FreePlayQuotePolicy
	Now     func() time.Time
}

// NewFreePlayHandler returns a standalone dormant router. The caller mounts the
// unchanged prefix; no daily route, shared auth code or realm v1 is modified.
func NewFreePlayHandler(cfg FreePlayHTTPConfig) http.Handler {
	now := time.Now
	if cfg.Now != nil {
		now = cfg.Now
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !cfg.Enabled || cfg.Store == nil || cfg.Auth == nil || cfg.Limiter == nil || cfg.Target.Validate() != nil || cfg.Store.target != cfg.Target {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, FreePlayPrefix+"boards/") {
			if !cfg.Limiter.AllowFreePlay(r.Context(), "", r.RemoteAddr) {
				writeErr(w, 429, "quota_exceeded")
				return
			}
			serveFreePlayBoard(w, r, cfg)
			return
		}

		token := bearer(r)
		if token == "" {
			writeErr(w, 401, "unauthenticated")
			return
		}
		player, chain, err := cfg.Auth.ValidateRESTTokenIdentity(token)
		if err != nil || player == "" {
			writeErr(w, 401, "unauthenticated")
			return
		}
		if chain != cfg.Target.ChainID {
			writeErr(w, 403, "wrong_network")
			return
		}
		if !cfg.Limiter.AllowFreePlay(r.Context(), player, r.RemoteAddr) {
			writeErr(w, 429, "quota_exceeded")
			return
		}
		if !strings.HasPrefix(r.URL.Path, FreePlayPrefix) {
			http.NotFound(w, r)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, FreePlayPrefix)
		decode := func(dst any) bool {
			r.Body = http.MaxBytesReader(w, r.Body, FreePlayMaxBody)
			d := json.NewDecoder(r.Body)
			d.DisallowUnknownFields()
			if err := d.Decode(dst); err != nil {
				writeErr(w, 400, "invalid_request")
				return false
			}
			var extra any
			if err := d.Decode(&extra); !errors.Is(err, io.EOF) {
				writeErr(w, 400, "invalid_request")
				return false
			}
			return true
		}
		if path == "verify" && r.Method == http.MethodPost {
			var input FreePlayInput
			if !decode(&input) {
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()
			run, err := VerifyFreePlayRun(ctx, cfg.Target, player, input)
			if err != nil {
				writeErr(w, 422, err.Error())
				return
			}
			run, err = cfg.Store.PutVerified(ctx, run, now().Unix())
			if err != nil {
				freePlayHTTPError(w, err)
				return
			}
			writeJSON(w, 200, run)
			return
		}
		parts := strings.Split(path, "/")
		if len(parts) < 2 || len(parts) > 3 || parts[0] != "runs" || !fpHex64.MatchString(parts[1]) {
			http.NotFound(w, r)
			return
		}
		run, err := cfg.Store.Get(r.Context(), parts[1])
		if err != nil {
			freePlayHTTPError(w, err)
			return
		}
		if run.Entry.Player != player {
			http.NotFound(w, r)
			return
		}
		if len(parts) == 2 && r.Method == http.MethodGet {
			writeJSON(w, 200, run)
			return
		}
		if r.Method != http.MethodPost {
			writeErr(w, 405, "method_not_allowed")
			return
		}
		if len(parts) != 3 {
			http.NotFound(w, r)
			return
		}
		switch parts[2] {
		case "quote":
			var empty struct{}
			if !decode(&empty) {
				return
			}
			if cfg.Quotes == nil {
				freePlayHTTPError(w, ErrFreePlayPaused)
				return
			}
			q, err := cfg.Quotes.Quote(r.Context(), run)
			if err != nil {
				freePlayHTTPError(w, err)
				return
			}
			if q.RunID != run.Entry.RunID || q.PayloadHash != run.PayloadHash {
				freePlayHTTPError(w, ErrFreePlayConflict)
				return
			}
			if err := cfg.Store.PutQuote(r.Context(), q, now().Unix()); err != nil {
				freePlayHTTPError(w, err)
				return
			}
			writeJSON(w, 200, q)
		case "publish":
			if cfg.Quotes == nil {
				freePlayHTTPError(w, ErrFreePlayPaused)
				return
			}
			var body struct {
				PayloadHash string `json:"payloadHash"`
				QuoteID     string `json:"quoteId"`
				Nonce       string `json:"nonce"`
			}
			if !decode(&body) {
				return
			}
			if err := cfg.Store.Queue(r.Context(), run.Entry.RunID, player, body.PayloadHash, body.QuoteID, body.Nonce, now().Unix()); err != nil {
				freePlayHTTPError(w, err)
				return
			}
			run, err = cfg.Store.Get(r.Context(), run.Entry.RunID)
			if err != nil {
				freePlayHTTPError(w, err)
				return
			}
			writeJSON(w, 202, run)
		default:
			http.NotFound(w, r)
		}
	})
}
func freePlayHTTPError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrFreePlayMissing):
		writeErr(w, 404, "run_not_found")
	case errors.Is(err, ErrFreePlayConflict):
		writeErr(w, 409, "run_conflict")
	case errors.Is(err, ErrFreePlayQuote):
		writeErr(w, 409, "quote_expired")
	case errors.Is(err, ErrFreePlayPaused):
		writeErr(w, 503, "publication_paused")
	default:
		writeErr(w, 503, "service_unavailable")
	}
}

func serveFreePlayBoard(w http.ResponseWriter, r *http.Request, cfg FreePlayHTTPConfig) {
	game := strings.TrimPrefix(r.URL.Path, FreePlayPrefix+"boards/")
	rules := r.URL.Query().Get("rules")
	version, err := strconv.ParseInt(r.URL.Query().Get("simVersion"), 10, 64)
	if !validFreePlayGame(game) || !fpRules.MatchString(rules) || err != nil || version < 1 || version > 2147483647 {
		writeErr(w, 400, "invalid_board")
		return
	}
	offset, limit := 0, 50
	if raw := r.URL.Query().Get("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > 100000 {
			writeErr(w, 400, "invalid_page")
			return
		}
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			writeErr(w, 400, "invalid_page")
			return
		}
	}
	if cfg.Boards == nil {
		writeErr(w, 503, "leaderboard_unavailable")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	entries, err := cfg.Boards.ReadBoard(ctx, cfg.Target, game, rules, version, offset, limit)
	if err != nil || len(entries) > limit {
		writeErr(w, 503, "leaderboard_unavailable")
		return
	}
	seen := make(map[string]bool)
	for _, entry := range entries {
		e := entry.Entry
		if entry.Target != cfg.Target || entry.SchemaVersion != 2 || entry.Height <= 0 || e.Game != game || e.Rules != rules || e.SimVersion != version || e.Validate() != nil || seen[e.Player] {
			writeErr(w, 503, "leaderboard_unavailable")
			return
		}
		if ValidateFreePlayReceipt(FreePlayRun{Target: cfg.Target, Entry: e}, entry) != nil {
			writeErr(w, 503, "leaderboard_unavailable")
			return
		}
		seen[e.Player] = true
	}
	if entries == nil {
		entries = []FreePlayReceipt{}
	}
	writeJSON(w, 200, map[string]any{"target": cfg.Target, "game": game, "rules": rules, "simVersion": version, "entries": entries})
}
