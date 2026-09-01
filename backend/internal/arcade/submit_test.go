package arcade_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/samouraiworld/memba/backend/internal/arcade"
	"github.com/samouraiworld/memba/backend/internal/db"
)

// --- fakes -------------------------------------------------------------------

type fakeAuth struct {
	addr string
	err  error
}

func (f fakeAuth) ValidateRESTTokenAddress(_ string) (string, error) { return f.addr, f.err }

type fakeVerifier struct {
	res    arcade.Result
	err    error
	called int
}

func (f *fakeVerifier) Verify(_ context.Context, _ arcade.Job) (arcade.Result, error) {
	f.called++
	return f.res, f.err
}

type denyLimiter struct{}

func (denyLimiter) AllowArcadeSubmit(string) bool { return false }

func fixedNow() time.Time { return time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC) }

func newStore(t *testing.T) *arcade.Store {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return arcade.NewStore(database)
}

// okResult is a plausible verified daily run for 2026-07-13. LogHash is the
// worker's CANONICAL commitment — the handler stores/dedups on this, never on a
// hash of the raw request bytes.
func okResult() arcade.Result {
	return arcade.Result{
		OK: true, Score: 27150, Waves: 5, Won: false, OvertimeRound: 0,
		StateHash: "e8532dc207e3cb24", SimVersion: 2, LogHash: "canonicaldigestabc",
	}
}

func submitReq(t *testing.T, h http.Handler, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/arcade/submit", strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func dailyBody(t *testing.T, score int64, hash string) string {
	t.Helper()
	b, _ := json.Marshal(map[string]any{
		"seed": "barricade-2026-07-13", "simVersion": 2, "events": []any{},
		"claimedScore": score, "claimedHash": hash,
	})
	return string(b)
}

func baseCfg(t *testing.T, v arcade.Verifier) arcade.SubmitConfig {
	return arcade.SubmitConfig{
		Enabled: true, Store: newStore(t), Auth: fakeAuth{addr: "g1alice"},
		Verifier: v, Now: fixedNow,
	}
}

// --- tests -------------------------------------------------------------------

func TestSubmit_DisabledIs404(t *testing.T) {
	cfg := baseCfg(t, &fakeVerifier{res: okResult()})
	cfg.Enabled = false
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", dailyBody(t, 27150, "e8532dc207e3cb24"))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("disabled must 404, got %d", rr.Code)
	}
}

func TestSubmit_NonPostIs405(t *testing.T) {
	h := arcade.HandleSubmit(baseCfg(t, &fakeVerifier{res: okResult()}))
	req := httptest.NewRequest(http.MethodGet, "/api/arcade/submit", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET must 405, got %d", rr.Code)
	}
}

func TestSubmit_MissingAuthIs401(t *testing.T) {
	h := arcade.HandleSubmit(baseCfg(t, &fakeVerifier{res: okResult()}))
	rr := submitReq(t, h, "", dailyBody(t, 27150, "e8532dc207e3cb24"))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("no bearer must 401, got %d", rr.Code)
	}
}

func TestSubmit_BadTokenIs401(t *testing.T) {
	cfg := baseCfg(t, &fakeVerifier{res: okResult()})
	cfg.Auth = fakeAuth{err: errors.New("expired")}
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", dailyBody(t, 27150, "e8532dc207e3cb24"))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("bad token must 401, got %d", rr.Code)
	}
}

func TestSubmit_HappyPathStoresAndReturnsVerified(t *testing.T) {
	v := &fakeVerifier{res: okResult()}
	cfg := baseCfg(t, v)
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", dailyBody(t, 27150, "e8532dc207e3cb24"))
	if rr.Code != http.StatusOK {
		t.Fatalf("happy path must 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Verified bool   `json:"verified"`
		LogHash  string `json:"logHash"`
		Day      string `json:"day"`
		Mode     string `json:"mode"`
		Result   struct {
			Score int64 `json:"score"`
		} `json:"result"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Verified || resp.Result.Score != 27150 || resp.Mode != "daily" || resp.Day != "2026-07-13" || resp.LogHash == "" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	// It must be persisted.
	if _, ok, _ := cfg.Store.GetRunByLogHash(resp.LogHash); !ok {
		t.Fatal("verified run was not stored")
	}
}

func TestSubmit_ClaimMismatchIsRejectedAndNotStored(t *testing.T) {
	// The re-simulation computed 27150; the client claims 99999. A mismatch is a
	// rejection (client bug or cheat), and MUST NOT be stored.
	v := &fakeVerifier{res: okResult()}
	cfg := baseCfg(t, v)
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", dailyBody(t, 99999, "e8532dc207e3cb24"))
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("claim mismatch must 422, got %d", rr.Code)
	}
	var resp struct {
		Verified bool `json:"verified"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Verified {
		t.Fatal("mismatch must report verified=false")
	}
	var n int
	_ = cfg.Store.DB().QueryRow(`SELECT COUNT(*) FROM arcade_runs`).Scan(&n)
	if n != 0 {
		t.Fatalf("a mismatched claim must not be stored, found %d rows", n)
	}
}

func TestSubmit_HashMismatchIsRejected(t *testing.T) {
	v := &fakeVerifier{res: okResult()}
	cfg := baseCfg(t, v)
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", dailyBody(t, 27150, "0000000000000000"))
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("hash mismatch must 422, got %d", rr.Code)
	}
}

func TestSubmit_WorkerRejectionIs422(t *testing.T) {
	v := &fakeVerifier{res: arcade.Result{OK: false, Error: "unsupported simVersion"}}
	cfg := baseCfg(t, v)
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", dailyBody(t, 27150, "e8532dc207e3cb24"))
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("worker rejection must 422, got %d", rr.Code)
	}
}

func TestSubmit_InfraErrorIs503(t *testing.T) {
	v := &fakeVerifier{err: errors.New("node crashed")}
	cfg := baseCfg(t, v)
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", dailyBody(t, 27150, "e8532dc207e3cb24"))
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("infra error must 503, got %d", rr.Code)
	}
}

func TestSubmit_FutureDailySeedIsRejectedWithoutVerifying(t *testing.T) {
	// A future daily seed would pre-fill a board that isn't live yet. Reject it
	// before spending a verify.
	v := &fakeVerifier{res: okResult()}
	cfg := baseCfg(t, v)
	body, _ := json.Marshal(map[string]any{
		"seed": "barricade-2030-01-01", "simVersion": 2, "events": []any{},
		"claimedScore": 27150, "claimedHash": "e8532dc207e3cb24",
	})
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", string(body))
	if rr.Code != http.StatusUnprocessableEntity && rr.Code != http.StatusBadRequest {
		t.Fatalf("future daily seed must be rejected, got %d", rr.Code)
	}
	if v.called != 0 {
		t.Fatal("a future seed must be rejected BEFORE verifying")
	}
}

func TestSubmit_StaleDailySeedIsRejected(t *testing.T) {
	v := &fakeVerifier{res: okResult()}
	cfg := baseCfg(t, v)
	body, _ := json.Marshal(map[string]any{
		"seed": "barricade-2026-07-01", "simVersion": 2, "events": []any{},
		"claimedScore": 27150, "claimedHash": "e8532dc207e3cb24",
	})
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", string(body))
	if rr.Code != http.StatusUnprocessableEntity && rr.Code != http.StatusBadRequest {
		t.Fatalf("stale daily seed must be rejected, got %d", rr.Code)
	}
}

func TestSubmit_PracticeSeedStoredAsPracticeForToday(t *testing.T) {
	v := &fakeVerifier{res: okResult()}
	cfg := baseCfg(t, v)
	body, _ := json.Marshal(map[string]any{
		"seed": "practice-1720000000000-3", "simVersion": 2, "events": []any{},
		"claimedScore": 27150, "claimedHash": "e8532dc207e3cb24",
	})
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", string(body))
	if rr.Code != http.StatusOK {
		t.Fatalf("practice submit must 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Mode string `json:"mode"`
		Day  string `json:"day"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Mode != "practice" || resp.Day != "2026-07-13" {
		t.Fatalf("practice run mode/day wrong: %+v", resp)
	}
}

func TestSubmit_UnknownSeedPrefixIsRejected(t *testing.T) {
	v := &fakeVerifier{res: okResult()}
	cfg := baseCfg(t, v)
	body, _ := json.Marshal(map[string]any{
		"seed": "evil-seed", "simVersion": 2, "events": []any{},
		"claimedScore": 27150, "claimedHash": "e8532dc207e3cb24",
	})
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", string(body))
	if rr.Code == http.StatusOK {
		t.Fatal("an unrecognized seed prefix must be rejected")
	}
	if v.called != 0 {
		t.Fatal("unknown seed must be rejected before verifying")
	}
}

func TestSubmit_DuplicateSameAddrIsIdempotent(t *testing.T) {
	v := &fakeVerifier{res: okResult()}
	cfg := baseCfg(t, v)
	h := arcade.HandleSubmit(cfg)
	body := dailyBody(t, 27150, "e8532dc207e3cb24")
	first := submitReq(t, h, "tok", body)
	if first.Code != http.StatusOK {
		t.Fatalf("first submit must 200, got %d", first.Code)
	}
	second := submitReq(t, h, "tok", body)
	if second.Code != http.StatusOK {
		t.Fatalf("re-submitting one's own log must be idempotent 200, got %d", second.Code)
	}
}

func TestSubmit_DuplicateDifferentAddrIsRejected(t *testing.T) {
	// Alice submits a log; Mallory replays it under her address — and crucially,
	// with a BYTE-MUTATED body (reordered fields / different whitespace). Because
	// the commitment is the worker's CANONICAL log hash (the same fake result
	// here, as the real worker would produce for a semantically-identical log),
	// the theft still collides and is rejected. The realm binds a log to its
	// first submitter; a re-encoding must not dodge that.
	store := newStore(t)
	v := &fakeVerifier{res: okResult()}
	aliceBody := dailyBody(t, 27150, "e8532dc207e3cb24")
	malloryBody := `{"claimedHash":"e8532dc207e3cb24","claimedScore":27150,"simVersion":2,"events":[],"seed":"barricade-2026-07-13"}` // same run, keys reordered

	alice := arcade.HandleSubmit(arcade.SubmitConfig{Enabled: true, Store: store, Auth: fakeAuth{addr: "g1alice"}, Verifier: v, Now: fixedNow})
	if rr := submitReq(t, alice, "tok", aliceBody); rr.Code != http.StatusOK {
		t.Fatalf("alice submit must 200, got %d", rr.Code)
	}
	mallory := arcade.HandleSubmit(arcade.SubmitConfig{Enabled: true, Store: store, Auth: fakeAuth{addr: "g1mallory"}, Verifier: v, Now: fixedNow})
	rr := submitReq(t, mallory, "tok", malloryBody)
	if rr.Code != http.StatusConflict {
		t.Fatalf("a re-encoded stolen log must still 409, got %d", rr.Code)
	}
}

// okInvadersResult mirrors what the SI worker branch emits: wave in Waves,
// stats authored by the worker, sim v1, no won/overtime.
func okInvadersResult() arcade.Result {
	return arcade.Result{
		OK: true, Score: 4321, Waves: 3, StateHash: "0badc0de", SimVersion: 1,
		Stats: `{"wave":3,"shots":51,"hits":22}`, LogHash: "invaderscanonicaldigest",
	}
}

func invadersBody(t *testing.T, finalTick int64) string {
	t.Helper()
	b, _ := json.Marshal(map[string]any{
		"seed": "invaders-2026-07-13", "simVersion": 1, "events": []any{},
		"finalTick": finalTick, "claimedScore": 4321, "claimedHash": "0badc0de",
	})
	return string(b)
}

func TestSubmit_GameNotEnabledIsRejected(t *testing.T) {
	// THE dark-by-default pin: with the DEFAULT enablement (nil EnabledGames,
	// exactly what an unset MEMBA_ARCADE_GAMES yields), a Space Invaders seed
	// is rejected BEFORE any verify is spent — merging multi-game support
	// changes nothing in prod until the operator names the game.
	v := &fakeVerifier{res: okInvadersResult()}
	cfg := baseCfg(t, v) // EnabledGames deliberately unset
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", invadersBody(t, 600))
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a not-enabled game must 422, got %d: %s", rr.Code, rr.Body.String())
	}
	if v.called != 0 {
		t.Fatal("a not-enabled game must be rejected BEFORE verifying")
	}
	var n int
	_ = cfg.Store.DB().QueryRow(`SELECT COUNT(*) FROM arcade_runs`).Scan(&n)
	if n != 0 {
		t.Fatalf("a not-enabled game must not be stored, found %d rows", n)
	}
	// BARRICADE stays live under the same default enablement — the status quo.
	cfgBar := baseCfg(t, &fakeVerifier{res: okResult()}) // EnabledGames still unset
	if rr := submitReq(t, arcade.HandleSubmit(cfgBar), "tok", dailyBody(t, 27150, "e8532dc207e3cb24")); rr.Code != http.StatusOK {
		t.Fatalf("barricade must stay enabled by default, got %d", rr.Code)
	}
}

func TestSubmit_EnabledInvadersStoresGameAndStats(t *testing.T) {
	v := &fakeVerifier{res: okInvadersResult()}
	cfg := baseCfg(t, v)
	cfg.EnabledGames = arcade.ParseEnabledGames("barricade,invaders")
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", invadersBody(t, 600))
	if rr.Code != http.StatusOK {
		t.Fatalf("enabled invaders submit must 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Verified bool   `json:"verified"`
		LogHash  string `json:"logHash"`
		Game     string `json:"game"`
		Day      string `json:"day"`
		Mode     string `json:"mode"`
		Stats    string `json:"stats"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Verified || resp.Game != "invaders" || resp.Day != "2026-07-13" || resp.Mode != "daily" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if resp.Stats != `{"wave":3,"shots":51,"hits":22}` {
		t.Fatalf("response must echo the worker-authored stats verbatim, got %q", resp.Stats)
	}
	got, ok, _ := cfg.Store.GetRunByLogHash(resp.LogHash)
	if !ok || got.Game != "invaders" || got.Stats != resp.Stats || got.Waves != 3 {
		t.Fatalf("stored run wrong: %+v (ok=%v)", got, ok)
	}
}

func TestSubmit_FinalTickRules(t *testing.T) {
	// invaders: finalTick is REQUIRED (>0) — its sim runs to a tick count.
	v := &fakeVerifier{res: okInvadersResult()}
	cfg := baseCfg(t, v)
	cfg.EnabledGames = arcade.ParseEnabledGames("barricade,invaders")
	h := arcade.HandleSubmit(cfg)
	if rr := submitReq(t, h, "tok", invadersBody(t, 0)); rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invaders without finalTick must 422, got %d", rr.Code)
	}
	if v.called != 0 {
		t.Fatal("a missing finalTick must be rejected before verifying")
	}

	// barricade: finalTick is FORBIDDEN — a stray field must not smuggle
	// meaning into a game that ignores it.
	vb := &fakeVerifier{res: okResult()}
	cfgB := baseCfg(t, vb)
	body, _ := json.Marshal(map[string]any{
		"seed": "barricade-2026-07-13", "simVersion": 2, "events": []any{},
		"finalTick": 600, "claimedScore": 27150, "claimedHash": "e8532dc207e3cb24",
	})
	if rr := submitReq(t, arcade.HandleSubmit(cfgB), "tok", string(body)); rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("barricade with finalTick must 422, got %d", rr.Code)
	}
	if vb.called != 0 {
		t.Fatal("a stray finalTick must be rejected before verifying")
	}
}

func TestSubmit_BarricadeStatsSynthesized(t *testing.T) {
	// The BARRICADE worker output predates stats (byte-identical bundle branch)
	// — the handler synthesizes the legacy display trio so the realm keeps the
	// per-run context AttestScore v1 carried as positional args.
	v := &fakeVerifier{res: okResult()}
	cfg := baseCfg(t, v)
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", dailyBody(t, 27150, "e8532dc207e3cb24"))
	if rr.Code != http.StatusOK {
		t.Fatalf("submit must 200, got %d", rr.Code)
	}
	var resp struct {
		LogHash string `json:"logHash"`
		Game    string `json:"game"`
		Stats   string `json:"stats"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	want := `{"waves":5,"won":false,"overtimeRound":0}`
	if resp.Game != "barricade" || resp.Stats != want {
		t.Fatalf("barricade response game/stats wrong: %+v", resp)
	}
	got, _, _ := cfg.Store.GetRunByLogHash(resp.LogHash)
	if got.Game != "barricade" || got.Stats != want {
		t.Fatalf("stored barricade run game/stats wrong: %+v", got)
	}
}

func TestSubmit_PerAddressRateLimitIs429(t *testing.T) {
	cfg := baseCfg(t, &fakeVerifier{res: okResult()})
	cfg.Limiter = denyLimiter{}
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", dailyBody(t, 27150, "e8532dc207e3cb24"))
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("rate-limited wallet must 429, got %d", rr.Code)
	}
}

func TestSubmit_OversizeBodyIsRejected(t *testing.T) {
	cfg := baseCfg(t, &fakeVerifier{res: okResult()})
	cfg.MaxBodyBytes = 512
	big := `{"seed":"barricade-2026-07-13","simVersion":2,"claimedScore":1,"claimedHash":"x","events":[` +
		strings.Repeat(`{"tick":0,"type":"rally"},`, 200) + `{"tick":0,"type":"rally"}]}`
	rr := submitReq(t, arcade.HandleSubmit(cfg), "tok", big)
	if rr.Code != http.StatusRequestEntityTooLarge && rr.Code != http.StatusBadRequest {
		t.Fatalf("oversize body must be rejected, got %d", rr.Code)
	}
}
