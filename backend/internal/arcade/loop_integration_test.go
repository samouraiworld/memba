package arcade_test

import (
	"context"
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

// recordBroadcaster stands in for the on-chain attester: it records the runs it
// would broadcast and always succeeds.
type recordBroadcaster struct{ calls []arcade.Run }

func (r *recordBroadcaster) AttestScore(_ context.Context, run arcade.Run) (string, error) {
	r.calls = append(r.calls, run)
	return "tx-" + run.LogHash, nil
}

// TestArcadeLoop_SubmitVerifyStoreAttest exercises the WHOLE backend certify loop
// end-to-end with the real node verify worker and a fake broadcaster (no chain):
// submit a run on day D → it's re-simulated + stored 'verified' → the day-close
// batcher at D+2 attests it → it's 'attested'. This is the stubbed e2e that
// stands in for a full gnodev loop (which the ceremony runbook covers manually).
func TestArcadeLoop_SubmitVerifyStoreAttest(t *testing.T) {
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

	// ── 1. Submit a daily run for 2026-07-13 (today at submit time) ──────────
	// Empty log on the served daily seed → the fixtures' known result.
	h := arcade.HandleSubmit(arcade.SubmitConfig{
		Enabled: true, Store: store, Auth: fakeAuth{addr: "g1alice"}, Verifier: runner, Now: submitNow,
	})
	body := `{"seed":"barricade-2026-07-13","simVersion":2,"events":[],"claimedScore":27150,"claimedHash":"e8532dc207e3cb24"}`
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
		Day      string `json:"day"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Verified || resp.LogHash == "" || resp.Day != "2026-07-13" {
		t.Fatalf("unexpected submit response: %+v", resp)
	}

	// ── 2. It's stored 'verified' with the re-simulated result ──────────────
	got, ok, _ := store.GetRunByLogHash(resp.LogHash)
	if !ok || got.Status != "verified" || got.Score != 27150 || got.StateHash != "e8532dc207e3cb24" || got.Addr != "g1alice" {
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

	// ── 4. The attester got exactly the re-simulated fields ─────────────────
	if len(b.calls) != 1 {
		t.Fatalf("expected 1 attestation, got %d", len(b.calls))
	}
	c := b.calls[0]
	if c.Addr != "g1alice" || c.Day != "2026-07-13" || c.Score != 27150 || c.StateHash != "e8532dc207e3cb24" || c.LogHash != resp.LogHash {
		t.Fatalf("attested the wrong fields: %+v", c)
	}

	// ── 5. The run is now 'attested' with the broadcast tx recorded ─────────
	after, _, _ := store.GetRunByLogHash(resp.LogHash)
	if after.Status != "attested" || after.AttestedTxHash == "" {
		t.Fatalf("run must be attested after batch: %+v", after)
	}

	// A second batch cycle attests nothing (the day is drained).
	if n2, _ := arcade.RunBatchOnce(context.Background(), store, b, 10, batchNow); n2 != 0 {
		t.Fatalf("second batch must attest nothing, got %d", n2)
	}
}
