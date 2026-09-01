package arcade_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/samouraiworld/memba/backend/internal/arcade"
)

// The committed Space Invaders loop fixture. The expected values were derived
// by scripting the FRONTEND ENGINE directly (simulateReplay from
// frontend/src/games/space-invaders/lib/verify.ts with the shared FNV-1a seed
// derivation — engine seed 3389276757 for this seed string), independently of
// the verify worker — so this test proves the worker's own pipeline (seed
// derivation, tuple decoding, move10/10 quantization, hex hash formatting)
// reproduces the engine's ground truth end-to-end. The BARRICADE twin
// (loop_integration_test.go) is deliberately untouched.
const (
	siSeed      = "invaders-2026-07-13"
	siFinalTick = 600
	siEvents    = `[[5,10,0,0],[60,10,1,0],[240,-10,1,0],[420,0,1,0],[540,3,1,0]]`
	siScore     = 300
	siStateHash = "a7d393c2"
	siStats     = `{"wave":1,"shots":48,"hits":11}`
)

// siExpectedLogHash re-derives the commitment the worker must produce:
// sha256 over seed + "\n" + the canonical invaders log (finalTick, then each
// delta as tick|move10|fire|pause, ';'-joined) — pinned here in Go so a
// canonical-form drift in the worker fails loudly.
func siExpectedLogHash() string {
	canonical := siSeed + "\n" + "600;5|10|0|0;60|10|1|0;240|-10|1|0;420|0|1|0;540|3|1|0"
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:])
}

// TestArcadeLoop_SubmitVerifyStoreAttest_Invaders exercises the WHOLE backend
// certify loop for Space Invaders with the real node verify worker and a fake
// broadcaster (no chain): submit a run on day D (game explicitly enabled) →
// it's re-simulated + stored 'verified' with its game/stats → the day-close
// batcher at D+2 attests it with the multi-game fields.
func TestArcadeLoop_SubmitVerifyStoreAttest_Invaders(t *testing.T) {
	bin := os.Getenv("MEMBA_ARCADE_NODE_BIN")
	if bin == "" {
		bin = "node"
	}
	if _, err := exec.LookPath(bin); err != nil {
		t.Skipf("node (%q) not on PATH — skipping the end-to-end loop test", bin)
	}
	runner, err := arcade.NewRunner(arcade.Config{NodeBin: bin, Timeout: 30 * time.Second})
	if err != nil {
		t.Fatalf("NewRunner: %v", err)
	}
	t.Cleanup(func() { _ = runner.Close() })

	store := newStore(t)
	submitNow := func() time.Time { return time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC) }

	// ── 1. Submit a daily invaders run for 2026-07-13 (today at submit time),
	// with the game explicitly enabled (it is dark by default) ────────────────
	h := arcade.HandleSubmit(arcade.SubmitConfig{
		Enabled: true, Store: store, Auth: fakeAuth{addr: "g1alice"}, Verifier: runner, Now: submitNow,
		EnabledGames: arcade.ParseEnabledGames("barricade,invaders"),
	})
	body := `{"seed":"` + siSeed + `","simVersion":1,"finalTick":600,"events":` + siEvents +
		`,"claimedScore":300,"claimedHash":"` + siStateHash + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/arcade/submit", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer x")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("submit must 200, got %d: %s", rr.Code, rr.Body.String())
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
		t.Fatalf("unexpected submit response: %+v", resp)
	}
	if resp.LogHash != siExpectedLogHash() {
		t.Fatalf("logHash drifted from the pinned canonical form:\n got: %s\nwant: %s", resp.LogHash, siExpectedLogHash())
	}
	if resp.Stats != siStats {
		t.Fatalf("stats drifted: got %s want %s", resp.Stats, siStats)
	}

	// ── 2. Stored 'verified' with the re-simulated multi-game fields ─────────
	got, ok, _ := store.GetRunByLogHash(resp.LogHash)
	if !ok || got.Status != "verified" || got.Game != "invaders" || got.Score != siScore ||
		got.StateHash != siStateHash || got.Stats != siStats || got.Addr != "g1alice" || got.Waves != 1 {
		t.Fatalf("stored run wrong: %+v (ok=%v)", got, ok)
	}

	// ── 3. Day-close batch at 2026-07-15 (day 07-13 is now fully closed) ────
	batchNow := func() time.Time { return time.Date(2026, 7, 15, 1, 0, 0, 0, time.UTC) }
	b := &recordBroadcaster{}
	n, err := arcade.RunBatchOnce(context.Background(), store, b, 10, batchNow)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if n != 1 {
		t.Fatalf("the closed day's run must attest, got %d", n)
	}

	// ── 4. The attester got exactly the re-simulated multi-game fields ──────
	if len(b.calls) != 1 {
		t.Fatalf("expected 1 attestation, got %d", len(b.calls))
	}
	c := b.calls[0]
	if c.Game != "invaders" || c.Addr != "g1alice" || c.Day != "2026-07-13" || c.Score != siScore ||
		c.StateHash != siStateHash || c.Stats != siStats || c.SimVersion != 1 || c.LogHash != resp.LogHash {
		t.Fatalf("attested the wrong fields: %+v", c)
	}

	// ── 5. The run is now 'attested' with the broadcast tx recorded ─────────
	after, _, _ := store.GetRunByLogHash(resp.LogHash)
	if after.Status != "attested" || after.AttestedTxHash == "" {
		t.Fatalf("run must be attested after batch: %+v", after)
	}

	// A second batch cycle attests nothing (the board is drained).
	if n2, _ := arcade.RunBatchOnce(context.Background(), store, b, 10, batchNow); n2 != 0 {
		t.Fatalf("second batch must attest nothing, got %d", n2)
	}
}
