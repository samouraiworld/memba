package arcade

import (
	"bytes"
	"context"
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
	Enabled  bool
	Store    *Store
	Auth     Authenticator
	Verifier Verifier
	// EnabledGames is the per-game rollout switch (from MEMBA_ARCADE_GAMES):
	// a submission whose seed derives a game not in this set is rejected
	// BEFORE any verify spend. nil/empty defaults to BARRICADE only — the
	// exact status quo, so every other game ships dark.
	EnabledGames map[string]bool
	Limiter      SubmitLimiter    // optional
	Now          func() time.Time // optional; defaults to time.Now
	MaxBodyBytes int64            // optional; defaults to MaxJobBytes + slack
}

// ParseEnabledGames parses the MEMBA_ARCADE_GAMES comma list (e.g.
// "barricade,invaders") into the submit handler's enablement set. Empty input
// yields the BARRICADE-only default. Entries are lowercased and trimmed; an
// unknown name is kept but harmless (no seed grammar ever derives it).
func ParseEnabledGames(env string) map[string]bool {
	out := map[string]bool{}
	for part := range strings.SplitSeq(env, ",") {
		if g := strings.ToLower(strings.TrimSpace(part)); g != "" {
			out[g] = true
		}
	}
	if len(out) == 0 {
		out[gameBarricade] = true
	}
	return out
}

type submitRequest struct {
	Seed       string          `json:"seed"`
	SimVersion int64           `json:"simVersion"`
	Events     json.RawMessage `json:"events"`
	// FinalTick is Space Invaders-only (its sim runs to a tick count, not a
	// terminal phase): required >0 for an invaders seed, and must be 0/absent
	// for BARRICADE — anything else is rejected before a verify is spent.
	FinalTick    int64  `json:"finalTick"`
	ClaimedScore int64  `json:"claimedScore"`
	ClaimedHash  string `json:"claimedHash"`
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

		// Derive game + mode + day from the seed (never trust a client-sent
		// game or mode), and reject a daily seed that isn't for the live window
		// — BEFORE spending a verify. A future seed would pre-fill a board that
		// isn't open yet; a stale one would farm a closed board.
		game, mode, day, err := deriveGameModeDay(req.Seed, now().UTC())
		if err != nil {
			writeReject(w, err.Error())
			return
		}
		// Per-game rollout gate (also before any verify spend): a game outside
		// MEMBA_ARCADE_GAMES is dark — its seeds are rejected outright.
		if !enabledGame(cfg.EnabledGames, game) {
			slog.Warn("arcade submit: game not enabled", "game", game, "addr", addr)
			writeReject(w, "game "+game+" is not enabled")
			return
		}
		// finalTick shape gate (cheap, deterministic): required for invaders,
		// forbidden for barricade. ValidateJob (inside Verify) re-checks and
		// bounds it; this just refuses to spend a verify on a malformed pair.
		if game == gameInvaders && req.FinalTick <= 0 {
			writeReject(w, "finalTick must be a positive tick count for "+game)
			return
		}
		if game != gameInvaders && req.FinalTick != 0 {
			writeReject(w, "finalTick is not a "+game+" field")
			return
		}

		res, err := cfg.Verifier.Verify(r.Context(), Job{Game: game, Seed: req.Seed, SimVersion: req.SimVersion, FinalTick: req.FinalTick, Events: req.Events})
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
		// A stale-client / cheat guard (NOT the integrity boundary — integrity is
		// that every stored field comes from `res`, never the claim): require the
		// client's claimed result to match the re-simulation, so a client on an old
		// sim build is told its number is wrong rather than silently attested.
		if res.Score != req.ClaimedScore || res.StateHash != req.ClaimedHash {
			slog.Warn("arcade submit: claim mismatch", "addr", addr, "claimedScore", req.ClaimedScore,
				"computedScore", res.Score, "claimedHash", req.ClaimedHash, "computedHash", res.StateHash)
			writeReject(w, "claimed result does not match the re-simulation")
			return
		}

		// The commitment is the worker's CANONICAL log hash (over the sanitized
		// event stream), never a hash of the raw request bytes — so a run binds to
		// one identity no matter how its JSON is re-encoded (the realm's
		// first-submitter guard would otherwise be dodgeable by a byte-mutation).
		logHash := res.LogHash
		stats := statsFor(game, res)

		run := Run{
			LogHash: logHash, Addr: addr, Game: game, Day: day, Mode: mode, Seed: req.Seed,
			SimVersion: res.SimVersion, Score: res.Score, Waves: res.Waves, Won: res.Won,
			OvertimeRound: res.OvertimeRound, StateHash: res.StateHash, Stats: stats,
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
					// Echo the STORED row's game/day/mode/stats (the same log
					// resubmitted on a later day must report its original
					// attribution, not today's).
					writeVerified(w, logHash, existing.Game, existing.Day, existing.Mode, existing.Stats, res)
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
		writeVerified(w, logHash, game, day, mode, stats, res)
	})
}

// statsFor picks the canonical on-chain stats blob for a verified result: the
// worker authors it for Space Invaders; for BARRICADE (whose worker output
// predates stats and stays byte-identical) the legacy display trio is
// synthesized here so the realm keeps the same per-run context AttestScore v1
// carried as positional args.
func statsFor(game string, res Result) string {
	if res.Stats != "" {
		return res.Stats
	}
	if game == gameBarricade {
		b, err := json.Marshal(struct {
			Waves         int64 `json:"waves"`
			Won           bool  `json:"won"`
			OvertimeRound int64 `json:"overtimeRound"`
		}{res.Waves, res.Won, res.OvertimeRound})
		if err != nil {
			return ""
		}
		return string(b)
	}
	return ""
}

// deriveGameModeDay maps a seed to its (game, mode, day) — the seed GRAMMAR is
// the sole authority on which game a run belongs to (a client-sent game field
// would let one game's log fill another game's board). Daily seeds
// ("<game>-YYYY-MM-DD") must be for today or yesterday (UTC) — the live board
// window; anything else is rejected. Practice seeds are attributed to the
// submission day. Grammar (prefix precedence is load-bearing:
// "invaders-practice-…" must match BEFORE the "invaders-" daily rule, or a
// practice run would parse as a malformed daily):
//
//	barricade-YYYY-MM-DD          → (barricade, daily)
//	practice-…                    → (barricade, practice)   [pre-multigame shape, grandfathered]
//	invaders-practice-…           → (invaders,  practice)
//	invaders-YYYY-MM-DD           → (invaders,  daily)
func deriveGameModeDay(seed string, now time.Time) (game, mode, day string, err error) {
	switch {
	case strings.HasPrefix(seed, "barricade-"):
		day, err = liveWindowDay(strings.TrimPrefix(seed, "barricade-"), now)
		if err != nil {
			return "", "", "", err
		}
		return gameBarricade, "daily", day, nil
	case strings.HasPrefix(seed, "practice-"):
		return gameBarricade, "practice", now.Format("2006-01-02"), nil
	case strings.HasPrefix(seed, "invaders-practice-"):
		return gameInvaders, "practice", now.Format("2006-01-02"), nil
	case strings.HasPrefix(seed, "invaders-"):
		day, err = liveWindowDay(strings.TrimPrefix(seed, "invaders-"), now)
		if err != nil {
			return "", "", "", err
		}
		return gameInvaders, "daily", day, nil
	default:
		return "", "", "", fmt.Errorf("unrecognized seed")
	}
}

// liveWindowDay validates a daily seed's date part and enforces the shared
// live-board window: today or yesterday (UTC). A future date would pre-fill a
// board that isn't open yet; a stale one would farm a closed board.
func liveWindowDay(datePart string, now time.Time) (string, error) {
	// time.Parse validates the exact YYYY-MM-DD shape (rejects trailing junk
	// and impossible dates); the value itself isn't needed.
	if _, perr := time.Parse("2006-01-02", datePart); perr != nil {
		return "", fmt.Errorf("malformed daily seed")
	}
	today := now.Format("2006-01-02")
	yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")
	if datePart != today && datePart != yesterday {
		return "", fmt.Errorf("daily seed is not for the live window (today or yesterday UTC)")
	}
	return datePart, nil
}

// enabledGame reports whether a derived game is rolled out. A nil/empty set
// means the BARRICADE-only default (the pre-multigame status quo).
func enabledGame(set map[string]bool, game string) bool {
	if len(set) == 0 {
		return game == gameBarricade
	}
	return set[game]
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(h, "Bearer ")
}

func compact(events json.RawMessage) string {
	var buf bytes.Buffer
	if err := json.Compact(&buf, events); err != nil {
		return string(events)
	}
	return buf.String()
}

func writeVerified(w http.ResponseWriter, logHash, game, day, mode, stats string, res Result) {
	writeJSON(w, http.StatusOK, map[string]any{
		"verified": true,
		"logHash":  logHash,
		"game":     game,
		"day":      day,
		"mode":     mode,
		// stats is the canonical per-game JSON blob as a STRING — exactly the
		// bytes the attester writes on-chain, so clients see the commitment
		// verbatim rather than a re-encoding.
		"stats": stats,
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
