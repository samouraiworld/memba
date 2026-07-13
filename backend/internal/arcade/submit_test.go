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

// okResult is a plausible verified daily run for 2026-07-13.
func okResult() arcade.Result {
	return arcade.Result{OK: true, Score: 27150, Waves: 5, Won: false, OvertimeRound: 0, StateHash: "e8532dc207e3cb24", SimVersion: 2}
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
	// Alice submits a log; Mallory replays the identical log under her address.
	// The realm binds a log to its first submitter — the backend must reject the
	// theft rather than store or attest it.
	store := newStore(t)
	v := &fakeVerifier{res: okResult()}
	body := dailyBody(t, 27150, "e8532dc207e3cb24")

	alice := arcade.HandleSubmit(arcade.SubmitConfig{Enabled: true, Store: store, Auth: fakeAuth{addr: "g1alice"}, Verifier: v, Now: fixedNow})
	if rr := submitReq(t, alice, "tok", body); rr.Code != http.StatusOK {
		t.Fatalf("alice submit must 200, got %d", rr.Code)
	}
	mallory := arcade.HandleSubmit(arcade.SubmitConfig{Enabled: true, Store: store, Auth: fakeAuth{addr: "g1mallory"}, Verifier: v, Now: fixedNow})
	rr := submitReq(t, mallory, "tok", body)
	if rr.Code != http.StatusConflict {
		t.Fatalf("a stolen log must 409, got %d", rr.Code)
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
