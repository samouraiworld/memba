package arcade

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"testing"
	"time"
)

// This is the cross-boundary determinism guarantee: the REAL node worker (the
// committed esbuild bundle) must reproduce the pinned fixtures exactly. Paired
// with the frontend freshness test (verify-fixtures.test.ts, which asserts the
// frontend sim reproduces the same fixtures), it proves the attester's worker
// and the client's sim agree byte-for-byte. If node is unavailable the test is
// skipped — but GitHub's ubuntu runners ship node, so it runs in CI.

type fixtureFile struct {
	SimVersion int64 `json:"simVersion"`
	Cases      []struct {
		Name string `json:"name"`
		Job  struct {
			Seed       string          `json:"seed"`
			SimVersion int64           `json:"simVersion"`
			Events     json.RawMessage `json:"events"`
		} `json:"job"`
		Expected Result `json:"expected"`
	} `json:"cases"`
}

func newRealRunnerOrSkip(t *testing.T) *Runner {
	t.Helper()
	bin := os.Getenv("MEMBA_ARCADE_NODE_BIN")
	if bin == "" {
		bin = "node"
	}
	if _, err := exec.LookPath(bin); err != nil {
		t.Skipf("node (%q) not on PATH — skipping the real-worker boundary test", bin)
	}
	r, err := NewRunner(Config{NodeBin: bin, Timeout: 30 * time.Second})
	if err != nil {
		t.Fatalf("NewRunner: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r
}

func loadFixtures(t *testing.T) fixtureFile {
	t.Helper()
	raw, err := os.ReadFile("worker/testdata/fixtures.json")
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}
	var f fixtureFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("parse fixtures: %v", err)
	}
	if len(f.Cases) == 0 {
		t.Fatal("no fixtures to run")
	}
	return f
}

func TestVerifyWorker_ReproducesFixturesThroughRealNode(t *testing.T) {
	r := newRealRunnerOrSkip(t)
	f := loadFixtures(t)
	if f.SimVersion != simVersionBarricade {
		t.Fatalf("fixtures target sim v%d but the runner is v%d", f.SimVersion, simVersionBarricade)
	}
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			got, err := r.Verify(context.Background(), Job{
				Seed:       c.Job.Seed,
				SimVersion: c.Job.SimVersion,
				Events:     c.Job.Events,
			})
			if err != nil {
				t.Fatalf("verify: %v", err)
			}
			if got != c.Expected {
				t.Fatalf("bundle+node diverged from the pinned result\n got: %+v\nwant: %+v", got, c.Expected)
			}
		})
	}
}

func TestVerifyWorker_RejectsThroughRealNode(t *testing.T) {
	r := newRealRunnerOrSkip(t)

	t.Run("unsupported simVersion", func(t *testing.T) {
		res, err := r.Verify(context.Background(), Job{Seed: "x", SimVersion: 1, Events: json.RawMessage(`[]`)})
		if err != nil {
			t.Fatalf("unexpected infra error: %v", err)
		}
		if res.OK {
			t.Fatal("expected a rejection for sim v1")
		}
	})

	t.Run("non-array events", func(t *testing.T) {
		res, err := r.Verify(context.Background(), Job{Seed: "x", SimVersion: simVersionBarricade, Events: json.RawMessage(`5`)})
		if err != nil {
			t.Fatalf("unexpected infra error: %v", err)
		}
		if res.OK {
			t.Fatal("expected a rejection for non-array events")
		}
	})
}

// invadersBoundaryJob is a well-formed SI job the boundary tests mutate.
func invadersBoundaryJob(events string) Job {
	return Job{
		Game: gameInvaders, Seed: "invaders-2026-07-13", SimVersion: simVersionInvaders,
		FinalTick: 600, Events: json.RawMessage(events),
	}
}

func TestVerifyWorker_InvadersThroughRealNode(t *testing.T) {
	r := newRealRunnerOrSkip(t)

	// The good path: the committed loop fixture's job, straight through node.
	// Its expected values were derived from the FRONTEND ENGINE independently
	// of the worker (see loop_invaders_integration_test.go) — including the
	// shared FNV-1a seed derivation ("invaders-2026-07-13" → engine seed
	// 3389276757, pinned in TestInvadersEngineSeed_Vectors) and the 8-hex
	// zero-padded stateHash format the client's claimedHash must match.
	t.Run("reproduces the engine-anchored fixture", func(t *testing.T) {
		res, err := r.Verify(context.Background(), invadersBoundaryJob(`[[5,10,0,0],[60,10,1,0],[240,-10,1,0],[420,0,1,0],[540,3,1,0]]`))
		if err != nil {
			t.Fatalf("verify: %v", err)
		}
		want := Result{
			OK: true, Score: 300, Waves: 1, StateHash: "a7d393c2", SimVersion: 1,
			Stats:   `{"wave":1,"shots":48,"hits":11}`,
			LogHash: "c24b0301959240652d210721eb5357b9a033a875d43c153abb3c7a1f9c9af5f5",
		}
		if res != want {
			t.Fatalf("bundle+node diverged from the engine-anchored fixture\n got: %+v\nwant: %+v", res, want)
		}
	})

	// Every malformed-log shape is a CLEAN rejection (ok:false), never a crash
	// — the wire format is strict: reject, never repair.
	rejects := map[string]Job{
		"non-tuple element":     invadersBoundaryJob(`[{"tick":1}]`),
		"short tuple":           invadersBoundaryJob(`[[1,2,3]]`),
		"long tuple":            invadersBoundaryJob(`[[1,2,3,0,0]]`),
		"non-integer tick":      invadersBoundaryJob(`[[1.5,0,0,0]]`),
		"non-integer move":      invadersBoundaryJob(`[[1,0.5,0,0]]`),
		"move10 too big":        invadersBoundaryJob(`[[1,11,0,0]]`),
		"move10 too small":      invadersBoundaryJob(`[[1,-11,0,0]]`),
		"fire not 0/1":          invadersBoundaryJob(`[[1,0,2,0]]`),
		"pause not 0/1":         invadersBoundaryJob(`[[1,0,0,-1]]`),
		"negative tick":         invadersBoundaryJob(`[[-1,0,0,0]]`),
		"tick at finalTick":     invadersBoundaryJob(`[[600,0,0,0]]`),
		"non-increasing ticks":  invadersBoundaryJob(`[[5,0,0,0],[5,1,0,0]]`),
		"decreasing ticks":      invadersBoundaryJob(`[[9,0,0,0],[3,1,0,0]]`),
		"wrong sim version":     {Game: gameInvaders, Seed: "invaders-2026-07-13", SimVersion: simVersionBarricade, FinalTick: 600, Events: json.RawMessage(`[]`)},
		"missing finalTick":     {Game: gameInvaders, Seed: "invaders-2026-07-13", SimVersion: simVersionInvaders, Events: json.RawMessage(`[]`)},
		"barricade with a tick": {Game: gameBarricade, Seed: "barricade-2026-07-13", SimVersion: simVersionBarricade, FinalTick: 600, Events: json.RawMessage(`[]`)},
	}
	for name, job := range rejects {
		t.Run(name, func(t *testing.T) {
			res, err := r.Verify(context.Background(), job)
			if err != nil {
				t.Fatalf("must be a clean rejection, not an infra error: %v", err)
			}
			if res.OK {
				t.Fatalf("expected ok:false for %s", name)
			}
			if res.Error == "" {
				t.Fatal("expected a rejection reason")
			}
		})
	}

	// An unknown game never verifies — but note the Go-side ValidateJob
	// rejects it before node even spawns; the worker's own branch is exercised
	// in TestVerifyWorker_UnknownGameRejectedByWorkerItself.
	t.Run("unknown game", func(t *testing.T) {
		res, err := r.Verify(context.Background(), Job{Game: "pong", Seed: "x", SimVersion: 1, Events: json.RawMessage(`[]`)})
		if err != nil {
			t.Fatalf("unexpected infra error: %v", err)
		}
		if res.OK {
			t.Fatal("expected a rejection for an unknown game")
		}
	})
}

// TestVerifyWorker_UnknownGameRejectedByWorkerItself pipes a raw job straight
// into the node worker (bypassing ValidateJob) to prove the WORKER's own
// dispatch rejects an unknown game — defense in depth for any future caller
// that skips the Go gate.
func TestVerifyWorker_UnknownGameRejectedByWorkerItself(t *testing.T) {
	r := newRealRunnerOrSkip(t)
	out, err := r.exec(context.Background(), []byte(`{"game":"pong","seed":"x","simVersion":1,"events":[]}`))
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	var res Result
	if err := json.Unmarshal(out, &res); err != nil {
		t.Fatalf("unparseable worker output: %v (%s)", err, out)
	}
	if res.OK || res.Error == "" {
		t.Fatalf("the worker itself must reject an unknown game, got %+v", res)
	}
}

func TestVerifyWorker_OutputCapKillsPromptly(t *testing.T) {
	bin := os.Getenv("MEMBA_ARCADE_NODE_BIN")
	if bin == "" {
		bin = "node"
	}
	if _, err := exec.LookPath(bin); err != nil {
		t.Skipf("node (%q) not on PATH", bin)
	}
	// A tiny output cap (below the worker's ~90-byte result) forces the over-cap
	// path with the real worker. A generous timeout proves the kill returns
	// promptly — if it hung waiting for the child, this would take the full
	// timeout instead of milliseconds.
	r, err := NewRunner(Config{NodeBin: bin, Timeout: 30 * time.Second, MaxOutputBytes: 10})
	if err != nil {
		t.Fatalf("NewRunner: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	done := make(chan error, 1)
	go func() {
		_, verr := r.Verify(context.Background(), Job{Seed: "barricade-2026-07-13", SimVersion: simVersionBarricade, Events: json.RawMessage(`[]`)})
		done <- verr
	}()
	select {
	case verr := <-done:
		if verr == nil {
			t.Fatal("expected an over-cap error")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Verify hung on an over-cap child instead of killing it promptly")
	}
}

func TestVerifyWorker_TimeoutIsAnInfraErrorNotARejection(t *testing.T) {
	bin := os.Getenv("MEMBA_ARCADE_NODE_BIN")
	if bin == "" {
		bin = "node"
	}
	if _, err := exec.LookPath(bin); err != nil {
		t.Skipf("node (%q) not on PATH", bin)
	}
	// A wall-clock the real worker cannot beat (node startup alone is tens of ms)
	// forces the timeout path with a real process. It must surface as an ERROR —
	// a crashed/killed worker must never be mistaken for a clean OK=false
	// rejection or (worse) a valid result.
	r, err := NewRunner(Config{NodeBin: bin, Timeout: 1 * time.Millisecond})
	if err != nil {
		t.Fatalf("NewRunner: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	res, verr := r.Verify(context.Background(), Job{Seed: "barricade-2026-07-13", SimVersion: simVersionBarricade, Events: json.RawMessage(`[]`)})
	if verr == nil {
		t.Fatalf("a timed-out worker must be an infra error, got result %+v", res)
	}
}
