package arcade

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// These injected-exec tests prove the Go boundary, not the TS simulation.
// Exact Node replay of all six fixtures remains a separate integration gate.
func freeWorkerFixtures(t *testing.T) []freeVector {
	t.Helper()
	raw, err := os.ReadFile("testdata/freeplay/space-invaders-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var si struct {
		Valid []freeVector `json:"valid"`
	}
	if err = json.Unmarshal(raw, &si); err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile("testdata/freeplay/barricade-fps-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fps []freeVector
	if err = json.Unmarshal(raw, &fps); err != nil {
		t.Fatal(err)
	}
	return append(si.Valid, fps...)
}
func freeWorkerVerdict(v freeVector) FreePlayReplayResult {
	return FreePlayReplayResult{OK: true, Game: v.Input.Game, Rules: v.Input.Rules, SimVersion: v.Input.SimVersion, FinishReason: v.Input.FinishReason, Score: v.Score, StateHash: v.StateHash, ReplayHash: v.ReplayHash}
}
func freeWorkerWithExec(ex execFn) *FreePlayRunner {
	return &FreePlayRunner{runtime: newRunnerWithExec(Config{Concurrency: 1}, ex)}
}

func TestFreePlayWorkerEnvelopeFixtureCommitments(t *testing.T) {
	for _, v := range freeWorkerFixtures(t) {
		t.Run(v.Name, func(t *testing.T) {
			calls := 0
			worker := freeWorkerWithExec(func(_ context.Context, raw []byte) ([]byte, error) {
				calls++
				var input FreePlayInput
				if err := json.Unmarshal(raw, &input); err != nil {
					t.Fatal(err)
				}
				if input.Replay != v.Input.Replay || input.Seed != v.Input.Seed {
					t.Fatal("input transformed")
				}
				return json.Marshal(freeWorkerVerdict(v))
			})
			run, err := VerifyFreePlayRunWithWorker(context.Background(), v.Target, v.Player, v.Input, worker)
			if err != nil || calls != 1 || run.Entry.RunID != v.RunID || run.Entry.StateHash != v.StateHash || run.Entry.ReplayHash != v.ReplayHash || run.PayloadHash != v.PayloadHash {
				t.Fatalf("envelope %+v calls=%d err=%v", run, calls, err)
			}
			if _, err = VerifyFreePlayRun(context.Background(), v.Target, v.Player, v.Input); err == nil {
				t.Fatal("default verifier enabled new game")
			}
		})
	}
}

func TestFreePlayWorkerRejectsBeforeSpawning(t *testing.T) {
	v := freeWorkerFixtures(t)[0]
	calls := 0
	worker := freeWorkerWithExec(func(context.Context, []byte) ([]byte, error) { calls++; return nil, nil })
	for name, mutate := range map[string]func(*FreePlayInput){
		"daily slug":    func(in *FreePlayInput) { in.Game = "invaders" },
		"classic rules": func(in *FreePlayInput) { in.Rules = "barricade-classic" },
		"version":       func(in *FreePlayInput) { in.SimVersion++ },
		"daily seed":    func(in *FreePlayInput) { in.Seed = "invaders-2026-10-09" },
		"ticks":         func(in *FreePlayInput) { in.Replay = "216001;0|0|1|0" },
		"oversized":     func(in *FreePlayInput) { in.Replay = strings.Repeat("x", 1000001) },
		"score missing": func(in *FreePlayInput) { in.ClaimedScore = nil },
		"finish":        func(in *FreePlayInput) { in.FinishReason = "won" },
	} {
		t.Run(name, func(t *testing.T) {
			input := v.Input
			mutate(&input)
			if _, err := worker.VerifyFreePlay(context.Background(), input); err == nil {
				t.Fatal("accepted invalid input")
			}
		})
	}
	if calls != 0 {
		t.Fatalf("spawned %d times", calls)
	}
}

func TestFreePlayWorkerRejectsUntrustworthyOutput(t *testing.T) {
	v := freeWorkerFixtures(t)[0]
	for name, mutate := range map[string]func(*FreePlayReplayResult){
		"game":        func(r *FreePlayReplayResult) { r.Game = "barricade" },
		"rules":       func(r *FreePlayReplayResult) { r.Rules = "si-daily" },
		"version":     func(r *FreePlayReplayResult) { r.SimVersion++ },
		"reason":      func(r *FreePlayReplayResult) { r.FinishReason = "lost" },
		"score":       func(r *FreePlayReplayResult) { r.Score++ },
		"replay hash": func(r *FreePlayReplayResult) { r.ReplayHash = strings.Repeat("0", 64) },
		"hash width":  func(r *FreePlayReplayResult) { r.StateHash = strings.Repeat("a", 64) },
	} {
		t.Run(name, func(t *testing.T) {
			result := freeWorkerVerdict(v)
			mutate(&result)
			worker := freeWorkerWithExec(func(context.Context, []byte) ([]byte, error) { return json.Marshal(result) })
			if _, err := worker.VerifyFreePlay(context.Background(), v.Input); !errors.Is(err, ErrFreePlayWorkerUnavailable) {
				t.Fatal(err)
			}
		})
	}
	for _, output := range []string{`{"ok":true}`, `{"ok":false,"error":"private stderr"}`, `{"ok":false,"error":"invalid_replay","extra":true}`, `{"ok":false,"error":"invalid_replay"} {}`, strings.Repeat("x", 65537)} {
		worker := freeWorkerWithExec(func(context.Context, []byte) ([]byte, error) { return []byte(output), nil })
		if _, err := worker.VerifyFreePlay(context.Background(), v.Input); !errors.Is(err, ErrFreePlayWorkerUnavailable) {
			t.Fatal(err)
		}
	}
	worker := freeWorkerWithExec(func(context.Context, []byte) ([]byte, error) {
		return []byte(`{"ok":false,"error":"not_terminal"}`), nil
	})
	if _, err := worker.VerifyFreePlay(context.Background(), v.Input); err == nil || errors.Is(err, ErrFreePlayWorkerUnavailable) || err.Error() != "not_terminal" {
		t.Fatalf("rejection vs infra: %v", err)
	}
}

func TestFreePlayWorkerCancellationAndSharedCapacity(t *testing.T) {
	v := freeWorkerFixtures(t)[0]
	calls := 0
	parent := newRunnerWithExec(Config{Concurrency: 1}, func(context.Context, []byte) ([]byte, error) { return nil, nil })
	worker := &FreePlayRunner{runtime: &Runner{cfg: parent.cfg, sem: parent.sem, exec: func(context.Context, []byte) ([]byte, error) { calls++; return nil, nil }}}
	parent.sem <- struct{}{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := worker.VerifyFreePlay(ctx, v.Input); !errors.Is(err, ErrFreePlayWorkerUnavailable) || calls != 0 {
		t.Fatalf("cancellation %d %v", calls, err)
	}
	<-parent.sem
	worker.runtime.cfg.Timeout = time.Millisecond
	worker.runtime.exec = func(ctx context.Context, _ []byte) ([]byte, error) { calls++; <-ctx.Done(); return nil, ctx.Err() }
	if _, err := worker.VerifyFreePlay(context.Background(), v.Input); !errors.Is(err, ErrFreePlayWorkerUnavailable) || calls != 1 {
		t.Fatalf("timeout %d %v", calls, err)
	}
	if len(parent.sem) != 0 {
		t.Fatal("capacity leaked")
	}
}
