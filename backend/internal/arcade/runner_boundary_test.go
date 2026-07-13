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
	if f.SimVersion != CurrentSimVersion {
		t.Fatalf("fixtures target sim v%d but the runner is v%d", f.SimVersion, CurrentSimVersion)
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
		res, err := r.Verify(context.Background(), Job{Seed: "x", SimVersion: CurrentSimVersion, Events: json.RawMessage(`5`)})
		if err != nil {
			t.Fatalf("unexpected infra error: %v", err)
		}
		if res.OK {
			t.Fatal("expected a rejection for non-array events")
		}
	})
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
		_, verr := r.Verify(context.Background(), Job{Seed: "barricade-2026-07-13", SimVersion: CurrentSimVersion, Events: json.RawMessage(`[]`)})
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
