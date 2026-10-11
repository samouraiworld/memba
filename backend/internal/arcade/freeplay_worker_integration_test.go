package arcade

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func realFreePlayWorker(t *testing.T, cfg Config) (*Runner, *FreePlayRunner) {
	t.Helper()
	cfg = withDefaults(cfg)
	if _, err := exec.LookPath(cfg.NodeBin); err != nil {
		t.Skipf("node unavailable: %v", err)
	}
	parent, err := NewRunner(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = parent.Close() })
	worker, err := NewFreePlayRunner(parent)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = worker.Close() })
	return parent, worker
}

func TestFreePlayWorkerRealFixtures(t *testing.T) {
	_, worker := realFreePlayWorker(t, Config{Concurrency: 1})
	for _, v := range freeWorkerFixtures(t) {
		t.Run(v.Name, func(t *testing.T) {
			run, err := VerifyFreePlayRunWithWorker(context.Background(), v.Target, v.Player, v.Input, worker)
			if err != nil {
				t.Fatal(err)
			}
			if run.Entry.RunID != v.RunID || run.Entry.Score != v.Score || run.Entry.StateHash != v.StateHash || run.Entry.ReplayHash != v.ReplayHash || run.PayloadHash != v.PayloadHash {
				t.Fatalf("real engine commitment mismatch: %+v", run)
			}
		})
	}
}

func TestFreePlayWorkerRealRejections(t *testing.T) {
	_, worker := realFreePlayWorker(t, Config{Concurrency: 1})
	raw, err := os.ReadFile("testdata/freeplay/space-invaders-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Invalid []struct {
			Name          string
			Input         FreePlayInput
			ExpectedError string
		}
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	v := freeWorkerFixtures(t)[0]
	for _, f := range fixtures.Invalid {
		t.Run("invaders/"+f.Name, func(t *testing.T) {
			_, err := VerifyFreePlayRunWithWorker(context.Background(), v.Target, v.Player, f.Input, worker)
			if err == nil || err.Error() != f.ExpectedError || errors.Is(err, ErrFreePlayWorkerUnavailable) {
				t.Fatalf("want %s, got %v", f.ExpectedError, err)
			}
		})
	}
	all := freeWorkerFixtures(t)
	fps := all[len(all)-1]
	for name, test := range map[string]struct {
		change func(*FreePlayInput)
		want   string
	}{
		"unfinished":      {func(in *FreePlayInput) { in.Replay = "[1,[]]" }, "fps_not_terminal"},
		"direction":       {func(in *FreePlayInput) { in.Replay = "[1,[[0,\"F\",0,0,0]]]" }, "invalid_fps_direction"},
		"rejected reload": {func(in *FreePlayInput) { in.Replay = "[1,[[0,\"R\"]]]" }, "rejected_fps_action"},
		"noncanonical":    {func(in *FreePlayInput) { in.Replay = " " + in.Replay }, "noncanonical_replay"},
		"padded terminal": {func(in *FreePlayInput) {
			var replay []json.RawMessage
			_ = json.Unmarshal([]byte(in.Replay), &replay)
			var tick int
			_ = json.Unmarshal(replay[0], &tick)
			in.Replay = fmt.Sprintf("[%d,%s]", tick+1, replay[1])
		}, "trailing_fps_input"},
		"wrong score": {func(in *FreePlayInput) { score := *in.ClaimedScore + 1; in.ClaimedScore = &score }, "claimed_result_mismatch"},
		"wrong finish": {func(in *FreePlayInput) {
			if in.FinishReason == "lost" {
				in.FinishReason = "won"
			} else {
				in.FinishReason = "lost"
			}
		}, "not_terminal"},
		"classic version": {func(in *FreePlayInput) { in.SimVersion = 2 }, "unsupported_version"},
		"classic rules":   {func(in *FreePlayInput) { in.Rules = "barricade-classic" }, "unsupported_rules"},
	} {
		t.Run("fps/"+name, func(t *testing.T) {
			in := fps.Input
			test.change(&in)
			_, err := VerifyFreePlayRunWithWorker(context.Background(), fps.Target, fps.Player, in, worker)
			if err == nil || err.Error() != test.want || errors.Is(err, ErrFreePlayWorkerUnavailable) {
				t.Fatalf("want %s, got %v", test.want, err)
			}
		})
	}
}

func legacyWorkerJob() Job {
	return Job{Seed: "barricade-2026-07-13", SimVersion: 2, Events: json.RawMessage(`[]`)}
}

func TestFreePlayWorkerRealSharedCapacity(t *testing.T) {
	parent, worker := realFreePlayWorker(t, Config{Concurrency: 2})
	if parent.sem != worker.runtime.sem {
		t.Fatal("separate capacity")
	}
	var live, peak atomic.Int32
	entered, release := make(chan struct{}, 6), make(chan struct{})
	wrap := func(original execFn) execFn {
		return func(ctx context.Context, data []byte) ([]byte, error) {
			n := live.Add(1)
			defer live.Add(-1)
			for old := peak.Load(); n > old; old = peak.Load() {
				if peak.CompareAndSwap(old, n) {
					break
				}
			}
			entered <- struct{}{}
			select {
			case <-release:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			return original(ctx, data)
		}
	}
	parent.exec = wrap(parent.exec)
	worker.runtime.exec = wrap(worker.runtime.exec)
	v := freeWorkerFixtures(t)[0]
	var wait sync.WaitGroup
	failures := make(chan error, 6)
	for i := 0; i < 6; i++ {
		wait.Add(1)
		go func(i int) {
			defer wait.Done()
			if i%2 == 0 {
				result, err := parent.Verify(context.Background(), legacyWorkerJob())
				if err == nil && (!result.OK || result.Score != 27150 || result.StateHash != "e8532dc207e3cb24") {
					err = errors.New("legacy drift")
				}
				failures <- err
			} else {
				_, err := worker.VerifyFreePlay(context.Background(), v.Input)
				failures <- err
			}
		}(i)
	}
	for i := 0; i < 2; i++ {
		select {
		case <-entered:
		case <-time.After(3 * time.Second):
			close(release)
			wait.Wait()
			t.Fatal("shared capacity failed to start")
		}
	}
	close(release)
	wait.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Error(err)
		}
	}
	if peak.Load() != 2 || live.Load() != 0 || len(parent.sem) != 0 {
		t.Fatalf("peak=%d live=%d queued=%d", peak.Load(), live.Load(), len(parent.sem))
	}
}

func TestFreePlayWorkerRealProcessBoundaries(t *testing.T) {
	parent, real := realFreePlayWorker(t, Config{Concurrency: 1, MaxOutputBytes: 1024})
	v := freeWorkerFixtures(t)[0]
	for name, source := range map[string]string{
		"stdout cap":           `process.stdout.write('x'.repeat(200000)); setInterval(()=>{},1000)`,
		"stderr cap and crash": `process.stderr.write('s'.repeat(100000)); process.exitCode=1`,
		"malformed":            `process.stdout.write('{broken')`,
		"trailing JSON":        `process.stdout.write('{}\n{}')`,
	} {
		t.Run(name, func(t *testing.T) {
			worker, err := newFreePlayRunner(parent, []byte(source))
			if err != nil {
				t.Fatal(err)
			}
			path := worker.runtime.workerPath
			stat, err := os.Stat(path)
			if err != nil || stat.Mode().Perm() != 0600 {
				t.Fatalf("private bundle permissions: %v %v", stat, err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if _, err = worker.VerifyFreePlay(ctx, v.Input); !errors.Is(err, ErrFreePlayWorkerUnavailable) {
				t.Fatalf("failure must be unavailable: %v", err)
			}
			if ctx.Err() != nil {
				t.Fatal("output cap/crash did not return promptly")
			}
			if err = worker.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err = os.Stat(filepath.Dir(path)); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("extracted directory not cleaned")
			}
			if len(parent.sem) != 0 {
				t.Fatal("capacity leak")
			}
		})
	}
	// A failed child must not poison capacity for the real worker.
	if _, err := real.VerifyFreePlay(context.Background(), v.Input); err != nil {
		t.Fatal(err)
	}
}

func TestFreePlayWorkerRealCancelKillsAndReaps(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix PID liveness proof")
	}
	parent, _ := realFreePlayWorker(t, Config{Concurrency: 1})
	pidFile := filepath.Join(t.TempDir(), "pid")
	source := fmt.Sprintf(`require('node:fs').writeFileSync(%q,String(process.pid)); setInterval(()=>{},1000)`, pidFile)
	worker, err := newFreePlayRunner(parent, []byte(source))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = worker.Close() }()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := worker.VerifyFreePlay(ctx, freeWorkerFixturesInput()); done <- err }()
	var pid int
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		raw, err := os.ReadFile(pidFile)
		if err == nil {
			pid, _ = strconv.Atoi(strings.TrimSpace(string(raw)))
			if pid > 0 {
				break
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	if pid == 0 {
		cancel()
		<-done
		t.Fatal("child did not start")
	}
	// Real child occupies the one shared slot; a queued job cancels without spawning.
	queued, queuedCancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer queuedCancel()
	if _, err = parent.Verify(queued, legacyWorkerJob()); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("legacy queued cancellation: %v", err)
	}
	cancel()
	select {
	case err = <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("child cancellation did not return")
	}
	if !errors.Is(err, ErrFreePlayWorkerUnavailable) {
		t.Fatalf("cancel: %v", err)
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = process.Release() }()
	if err = process.Signal(syscall.Signal(0)); !errors.Is(err, syscall.ESRCH) && !errors.Is(err, os.ErrProcessDone) {
		t.Fatalf("child still live/not reaped: %v", err)
	}
	if len(parent.sem) != 0 {
		t.Fatal("capacity not released")
	}
}

func freeWorkerFixturesInput() FreePlayInput {
	score := int64(510)
	return FreePlayInput{ClientRunID: "00000000-0000-4000-8000-000000000001", Game: "space-invaders", Rules: "si-free-standard-v1", SimVersion: 1, Seed: "si1:00000000", ReplayCodec: "si-deltas-v1", Replay: "2315;0|0|1|0;1|0|0|0", FinishReason: "game-over", ClaimedScore: &score}
}

func TestFreePlayWorkerHTTPDistinguishesUnavailableAndRejected(t *testing.T) {
	_, real := realFreePlayWorker(t, Config{Concurrency: 1})
	v := freeWorkerFixtures(t)[0]
	raw, err := json.Marshal(v.Input)
	if err != nil {
		t.Fatal(err)
	}
	unavailable := freeWorkerWithExec(func(context.Context, []byte) ([]byte, error) { return nil, errors.New("private process detail") })
	rejected := freeWorkerWithExec(func(context.Context, []byte) ([]byte, error) {
		return []byte(`{"ok":false,"error":"not_terminal"}`), nil
	})
	for name, test := range map[string]struct {
		verifier FreePlayReplayVerifier
		status   int
		body     string
	}{
		"dormant": {nil, 422, "unsupported_rules"},
		"infra":   {unavailable, 503, "verification_unavailable"},
		"replay":  {rejected, 422, "not_terminal"},
		"real":    {real, 200, "verified"},
	} {
		t.Run(name, func(t *testing.T) {
			cfg := FreePlayHTTPConfig{Enabled: true, Target: v.Target, Store: freeStore(t), Auth: freeAuthFake{v.Player, v.Target.ChainID}, Limiter: freeLimitFake(true), Verifier: test.verifier}
			response := callFree(NewFreePlayHandler(cfg), "POST", "verify", string(raw))
			if response.Code != test.status || !strings.Contains(response.Body.String(), test.body) || strings.Contains(response.Body.String(), "private process detail") {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}
