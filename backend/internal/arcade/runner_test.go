package arcade

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testJob() Job {
	return Job{Seed: "barricade-2026-07-13", SimVersion: CurrentSimVersion, Events: json.RawMessage(`[]`)}
}

func okStdout(t *testing.T, score int64) []byte {
	t.Helper()
	b, err := json.Marshal(Result{OK: true, Score: score, Waves: 5, StateHash: "deadbeefdeadbeef", SimVersion: 2, LogHash: "cafebabecafebabe"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func TestRunner_ReturnsTheParsedResultOnSuccess(t *testing.T) {
	r := newRunnerWithExec(Config{}, func(_ context.Context, stdin []byte) ([]byte, error) {
		// The runner must forward the job verbatim as JSON on stdin.
		var got Job
		if err := json.Unmarshal(stdin, &got); err != nil {
			t.Fatalf("stdin not valid job json: %v", err)
		}
		if got.Seed != "barricade-2026-07-13" {
			t.Fatalf("seed not forwarded: %q", got.Seed)
		}
		return okStdout(t, 27150), nil
	})
	res, err := r.Verify(context.Background(), testJob())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.OK || res.Score != 27150 {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestRunner_TreatsWorkerRejectionAsAResultNotAnError(t *testing.T) {
	// {ok:false} is a clean verification rejection (bad input), not an
	// infrastructure failure — it comes back as a Result the caller inspects.
	r := newRunnerWithExec(Config{}, func(_ context.Context, _ []byte) ([]byte, error) {
		return []byte(`{"ok":false,"error":"unsupported simVersion"}`), nil
	})
	res, err := r.Verify(context.Background(), testJob())
	if err != nil {
		t.Fatalf("a worker rejection must not be an error, got %v", err)
	}
	if res.OK {
		t.Fatal("expected OK=false")
	}
	if res.Error == "" {
		t.Fatal("expected a rejection reason")
	}
}

func TestRunner_RejectsInvalidJobWithoutSpawningNode(t *testing.T) {
	// An invalid submission (here: an unsupported sim version) is a clean
	// rejection — Verify must return OK=false with nil error and, crucially,
	// must NOT spawn the worker (it cost-bounds before node, so a garbage
	// payload can't reach node's parser).
	var spawned bool
	r := newRunnerWithExec(Config{}, func(_ context.Context, _ []byte) ([]byte, error) {
		spawned = true
		return okStdout(t, 1), nil
	})
	res, err := r.Verify(context.Background(), Job{Seed: "x", SimVersion: 1, Events: json.RawMessage(`[]`)})
	if err != nil {
		t.Fatalf("invalid input must be a rejection, not an error: %v", err)
	}
	if res.OK {
		t.Fatal("expected OK=false for an invalid job")
	}
	if spawned {
		t.Fatal("node must not be spawned for an invalid job")
	}
}

func TestRunner_RejectsImplausibleOkResultAsError(t *testing.T) {
	// A worker that claims ok:true but omits the state hash (or the sim version)
	// must not be treated as a valid result — a zeroed, empty-hash "verified"
	// run is exactly what must never be attested.
	for name, stdout := range map[string]string{
		"empty state hash": `{"ok":true,"score":100,"simVersion":2,"logHash":"abc"}`,
		"empty log hash":   `{"ok":true,"score":100,"stateHash":"abc","simVersion":2}`,
		"wrong sim":        `{"ok":true,"score":100,"stateHash":"abc","logHash":"abc","simVersion":1}`,
		"bare ok":          `{"ok":true}`,
	} {
		t.Run(name, func(t *testing.T) {
			r := newRunnerWithExec(Config{}, func(_ context.Context, _ []byte) ([]byte, error) {
				return []byte(stdout), nil
			})
			if _, err := r.Verify(context.Background(), testJob()); err == nil {
				t.Fatalf("expected an error for an implausible ok result: %s", stdout)
			}
		})
	}
}

func TestRunner_SurfacesExecFailureAsError(t *testing.T) {
	// A non-zero exit / timeout / missing node is an infrastructure error the
	// caller must NOT confuse with a verification rejection.
	r := newRunnerWithExec(Config{}, func(_ context.Context, _ []byte) ([]byte, error) {
		return nil, errors.New("signal: killed")
	})
	if _, err := r.Verify(context.Background(), testJob()); err == nil {
		t.Fatal("expected an infrastructure error")
	}
}

func TestRunner_SurfacesUnparseableStdoutAsError(t *testing.T) {
	r := newRunnerWithExec(Config{}, func(_ context.Context, _ []byte) ([]byte, error) {
		return []byte("this is not json"), nil
	})
	if _, err := r.Verify(context.Background(), testJob()); err == nil {
		t.Fatal("expected an error for unparseable worker stdout")
	}
}

func TestRunner_NeverExceedsTheConcurrencyCap(t *testing.T) {
	const cap = 2
	var active, maxActive int32
	release := make(chan struct{})
	started := make(chan struct{}, 8)
	r := newRunnerWithExec(Config{Concurrency: cap}, func(_ context.Context, _ []byte) ([]byte, error) {
		n := atomic.AddInt32(&active, 1)
		for {
			m := atomic.LoadInt32(&maxActive)
			if n <= m || atomic.CompareAndSwapInt32(&maxActive, m, n) {
				break
			}
		}
		started <- struct{}{}
		<-release
		atomic.AddInt32(&active, -1)
		return okStdout(t, 1), nil
	})
	var wg sync.WaitGroup
	for range 5 {
		wg.Go(func() {
			_, _ = r.Verify(context.Background(), testJob())
		})
	}
	// Exactly `cap` may run at once: read that many starts, then confirm no more
	// arrive while they're all blocked.
	for range cap {
		<-started
	}
	select {
	case <-started:
		t.Fatal("more than the cap of workers ran concurrently")
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	wg.Wait()
	if maxActive > cap {
		t.Fatalf("max concurrent workers %d exceeded cap %d", maxActive, cap)
	}
}

func TestRunner_RespectsContextCancellationWhileQueued(t *testing.T) {
	// With the single slot held, a second call whose context is cancelled must
	// abandon the queue with the context error rather than block forever.
	release := make(chan struct{})
	defer close(release)
	r := newRunnerWithExec(Config{Concurrency: 1}, func(_ context.Context, _ []byte) ([]byte, error) {
		<-release
		return okStdout(t, 1), nil
	})
	go func() { _, _ = r.Verify(context.Background(), testJob()) }()
	time.Sleep(20 * time.Millisecond) // let the first call take the only slot

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := r.Verify(ctx, testJob()); err == nil {
		t.Fatal("expected a context error while queued behind a full semaphore")
	}
}

func TestReadAllCapped_TruncatesRunawayOutput(t *testing.T) {
	// A worker that floods stdout must not exhaust memory: reads stop at the cap.
	got, err := readAllCapped(strings.NewReader(strings.Repeat("x", 1000)), 100)
	if err == nil {
		t.Fatal("expected an over-cap error")
	}
	if len(got) > 100 {
		t.Fatalf("read %d bytes past the 100-byte cap", len(got))
	}
}

func TestReadAllCapped_PassesOutputUnderTheCap(t *testing.T) {
	got, err := readAllCapped(strings.NewReader("small"), 100)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(got) != "small" {
		t.Fatalf("got %q", got)
	}
}
