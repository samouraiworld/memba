package arcade

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Authenticator recovers the authenticated wallet address from a REST bearer
// token — the address-binding proof (the token proves the submitter owns the
// wallet, so no separate per-submission signature is needed). *service.MultisigService
// satisfies it via ValidateRESTTokenAddress.
type Authenticator interface {
	ValidateRESTTokenAddress(tokenJSON string) (string, error)
}

// Verifier re-simulates a submitted run. *Runner satisfies it.
type Verifier interface {
	Verify(ctx context.Context, job Job) (Result, error)
}

// SubmitLimiter is the optional per-wallet submit cap (the verify is CPU-heavy,
// so one wallet must not fan out unbounded). nil disables it.
type SubmitLimiter interface {
	AllowArcadeSubmit(addr string) bool
}

// SubmitConfig wires the submit handler's dependencies. Enabled=false (or a nil
// Store/Auth/Verifier) makes the endpoint 404 — the mint-ticket "unset = 404"
// pattern, so the route is dark until the operator turns it on.
type SubmitConfig struct {
	Enabled      bool
	Store        *Store
	Auth         Authenticator
	Verifier     Verifier
	Limiter      SubmitLimiter    // optional
	Now          func() time.Time // optional; defaults to time.Now
	MaxBodyBytes int64            // optional; defaults to MaxJobBytes + slack
}

type submitRequest struct {
	Seed         string          `json:"seed"`
	SimVersion   int64           `json:"simVersion"`
	Events       json.RawMessage `json:"events"`
	ClaimedScore int64           `json:"claimedScore"`
	ClaimedHash  string          `json:"claimedHash"`
}

// resultJSON is the re-simulated result echoed back to (and stored for) the client.
type resultJSON struct {
	Score         int64  `json:"score"`
	Waves         int64  `json:"waves"`
	Won           bool   `json:"won"`
	OvertimeRound int64  `json:"overtimeRound"`
	StateHash     string `json:"stateHash"`
	SimVersion    int64  `json:"simVersion"`
}

// HandleSubmit serves POST /api/arcade/submit: authenticate the wallet →
// re-simulate the submitted input log → require the client's claimed score/hash
// to match the re-simulation → store the verified run (queued for attestation).
// A client-claimed number is NEVER stored blind.
func HandleSubmit(cfg SubmitConfig) http.Handler {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	maxBody := cfg.MaxBodyBytes
	if maxBody <= 0 {
		maxBody = MaxJobBytes + (64 << 10)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !cfg.Enabled || cfg.Store == nil || cfg.Auth == nil || cfg.Verifier == nil {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		token := bearer(r)
		if token == "" {
			writeErr(w, http.StatusUnauthorized, "authorization required")
			return
		}
		addr, err := cfg.Auth.ValidateRESTTokenAddress(token)
		if err != nil {
			slog.Warn("arcade submit: auth failed", "error", err)
			writeErr(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}
		if cfg.Limiter != nil && !cfg.Limiter.AllowArcadeSubmit(addr) {
			slog.Warn("arcade submit: rate limited", "addr", addr)
			writeErr(w, http.StatusTooManyRequests, "submit rate limit exceeded — slow down and retry shortly")
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		var req submitRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			if strings.Contains(err.Error(), "request body too large") {
				writeErr(w, http.StatusRequestEntityTooLarge, "submission too large")
				return
			}
			writeErr(w, http.StatusBadRequest, "invalid request body")
			return
		}

		// Derive mode + day from the seed (never trust a client-sent mode), and
		// reject a daily seed that isn't for the live window — BEFORE spending a
		// verify. A future seed would pre-fill a board that isn't open yet; a
		// stale one would farm a closed board.
		mode, day, err := deriveModeDay(req.Seed, now().UTC())
		if err != nil {
			writeReject(w, err.Error())
			return
		}

		res, err := cfg.Verifier.Verify(r.Context(), Job{Seed: req.Seed, SimVersion: req.SimVersion, Events: req.Events})
		if err != nil {
			slog.Error("arcade submit: verify worker failed", "error", err, "addr", addr, "seed", req.Seed)
			writeErr(w, http.StatusServiceUnavailable, "verification temporarily unavailable")
			return
		}
		if !res.OK {
			slog.Warn("arcade submit: worker rejected", "reason", res.Error, "addr", addr, "seed", req.Seed)
			writeReject(w, "rejected: "+res.Error)
			return
		}
		// The whole point: the client's claimed result must match the re-simulation.
		// A mismatch is a stale client or a cheat — reject, do not store.
		if res.Score != req.ClaimedScore || res.StateHash != req.ClaimedHash {
			slog.Warn("arcade submit: claim mismatch", "addr", addr, "claimedScore", req.ClaimedScore,
				"computedScore", res.Score, "claimedHash", req.ClaimedHash, "computedHash", res.StateHash)
			writeReject(w, "claimed result does not match the re-simulation")
			return
		}

		logHash, err := hashLog(req.Events)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid events")
			return
		}

		run := Run{
			LogHash: logHash, Addr: addr, Day: day, Mode: mode, Seed: req.Seed,
			SimVersion: res.SimVersion, Score: res.Score, Waves: res.Waves, Won: res.Won,
			OvertimeRound: res.OvertimeRound, StateHash: res.StateHash,
			Events: compact(req.Events), Status: "verified", CreatedAt: now().Unix(),
		}
		if err := cfg.Store.InsertRun(run); err != nil {
			if errors.Is(err, ErrDuplicateLog) {
				// The log was already submitted. If by THIS wallet, it's an
				// idempotent re-submit (return the stored verdict). If by another,
				// this is a replay of someone else's log — reject it (the realm
				// binds a log to its first submitter).
				existing, ok, gerr := cfg.Store.GetRunByLogHash(logHash)
				if gerr == nil && ok && existing.Addr == addr {
					writeVerified(w, logHash, day, mode, res)
					return
				}
				slog.Warn("arcade submit: duplicate log from a different address", "addr", addr, "logHash", logHash)
				writeErr(w, http.StatusConflict, "this run's input log was already submitted by another address")
				return
			}
			slog.Error("arcade submit: store failed", "error", err, "addr", addr)
			writeErr(w, http.StatusServiceUnavailable, "storage temporarily unavailable")
			return
		}
		writeVerified(w, logHash, day, mode, res)
	})
}

// deriveModeDay maps a seed to its (mode, day). Daily seeds ("barricade-YYYY-MM-DD")
// must be for today or yesterday (UTC) — the live board window; anything else is
// rejected. Practice seeds ("practice-…") are attributed to the submission day.
func deriveModeDay(seed string, now time.Time) (mode, day string, err error) {
	switch {
	case strings.HasPrefix(seed, "barricade-"):
		datePart := strings.TrimPrefix(seed, "barricade-")
		// time.Parse validates the exact YYYY-MM-DD shape (rejects trailing junk
		// and impossible dates); the value itself isn't needed.
		if _, perr := time.Parse("2006-01-02", datePart); perr != nil {
			return "", "", fmt.Errorf("malformed daily seed")
		}
		today := now.Format("2006-01-02")
		yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")
		if datePart != today && datePart != yesterday {
			return "", "", fmt.Errorf("daily seed is not for the live window (today or yesterday UTC)")
		}
		return "daily", datePart, nil
	case strings.HasPrefix(seed, "practice-"):
		return "practice", now.Format("2006-01-02"), nil
	default:
		return "", "", fmt.Errorf("unrecognized seed")
	}
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(h, "Bearer ")
}

// hashLog is the input-log commitment: sha256 of the compact-JSON events. It is
// what the attester writes on-chain and the replay-theft dedupe key.
func hashLog(events json.RawMessage) (string, error) {
	var buf bytes.Buffer
	if err := json.Compact(&buf, events); err != nil {
		return "", err
	}
	sum := sha256.Sum256(buf.Bytes())
	return hex.EncodeToString(sum[:]), nil
}

func compact(events json.RawMessage) string {
	var buf bytes.Buffer
	if err := json.Compact(&buf, events); err != nil {
		return string(events)
	}
	return buf.String()
}

func writeVerified(w http.ResponseWriter, logHash, day, mode string, res Result) {
	writeJSON(w, http.StatusOK, map[string]any{
		"verified": true,
		"logHash":  logHash,
		"day":      day,
		"mode":     mode,
		"result": resultJSON{
			Score: res.Score, Waves: res.Waves, Won: res.Won,
			OvertimeRound: res.OvertimeRound, StateHash: res.StateHash, SimVersion: res.SimVersion,
		},
	})
}

func writeReject(w http.ResponseWriter, reason string) {
	writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"verified": false, "reason": reason})
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]any{"error": msg})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
