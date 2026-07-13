package arcade

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// workerBundle is the esbuild-bundled verify worker (see worker/build.mjs). It is
// committed and go:embed'd so the running binary carries the exact sim the client
// ran — no node_modules in the runtime image, no compile-time bundling step.
//
//go:embed worker/bundle/verify-worker.cjs
var workerBundle []byte

// Job is one submission to re-simulate: the seed, the sim version it was played
// on, and the raw input log. Marshaled verbatim onto the worker's stdin.
type Job struct {
	Seed       string          `json:"seed"`
	SimVersion int64           `json:"simVersion"`
	Events     json.RawMessage `json:"events"`
}

// Result is the worker's verdict. OK=true carries the re-simulated result the
// attester may write; OK=false is a clean rejection (bad input / unsupported
// version) that must never be attested. An infrastructure failure to RUN the
// worker (timeout, crash, missing node) surfaces as an error from Verify, not
// as a Result — the two must never be confused.
type Result struct {
	OK            bool   `json:"ok"`
	Error         string `json:"error,omitempty"`
	Score         int64  `json:"score"`
	Waves         int64  `json:"waves"`
	Won           bool   `json:"won"`
	OvertimeRound int64  `json:"overtimeRound"`
	StateHash     string `json:"stateHash"`
	SimVersion    int64  `json:"simVersion"`
}

// Config tunes the runner. Zero values fall back to safe defaults.
type Config struct {
	NodeBin        string        // node executable; default "node" (or $MEMBA_ARCADE_NODE_BIN)
	Timeout        time.Duration // per-job wall clock; default 20s
	Concurrency    int           // max node processes at once; default 4
	MaxOutputBytes int64         // stdout cap; default 64 KiB
}

const (
	defaultTimeout        = 20 * time.Second
	defaultConcurrency    = 4
	defaultMaxOutputBytes = 64 << 10
)

type execFn func(ctx context.Context, stdin []byte) ([]byte, error)

// Runner re-verifies submissions by piping each job to a fresh node subprocess.
// It is safe for concurrent use; a buffered semaphore bounds live processes.
type Runner struct {
	cfg        Config
	sem        chan struct{}
	exec       execFn
	workerPath string   // extracted bundle path (empty when exec is injected in tests)
	cleanup    func()   // removes the extracted bundle
}

// NewRunner extracts the embedded worker bundle to a private temp file and wires
// a real node exec. Call Close when done to remove the temp file.
func NewRunner(cfg Config) (*Runner, error) {
	cfg = withDefaults(cfg)
	dir, err := os.MkdirTemp("", "memba-arcade-worker-")
	if err != nil {
		return nil, fmt.Errorf("arcade worker tempdir: %w", err)
	}
	path := filepath.Join(dir, "verify-worker.cjs")
	if err := os.WriteFile(path, workerBundle, 0o600); err != nil {
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("arcade worker extract: %w", err)
	}
	r := &Runner{
		cfg:        cfg,
		sem:        make(chan struct{}, cfg.Concurrency),
		workerPath: path,
		cleanup:    func() { _ = os.RemoveAll(dir) },
	}
	r.exec = r.runNode
	return r, nil
}

// newRunnerWithExec builds a runner around an injected exec (tests). It does not
// touch the filesystem or spawn processes.
func newRunnerWithExec(cfg Config, ex execFn) *Runner {
	cfg = withDefaults(cfg)
	return &Runner{
		cfg:  cfg,
		sem:  make(chan struct{}, cfg.Concurrency),
		exec: ex,
	}
}

func withDefaults(cfg Config) Config {
	if cfg.NodeBin == "" {
		if env := os.Getenv("MEMBA_ARCADE_NODE_BIN"); env != "" {
			cfg.NodeBin = env
		} else {
			cfg.NodeBin = "node"
		}
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = defaultTimeout
	}
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = defaultConcurrency
	}
	if cfg.MaxOutputBytes <= 0 {
		cfg.MaxOutputBytes = defaultMaxOutputBytes
	}
	return cfg
}

// Close removes the extracted worker bundle. Safe to call on a test runner.
func (r *Runner) Close() error {
	if r.cleanup != nil {
		r.cleanup()
	}
	return nil
}

// Verify re-simulates one job and returns the worker's Result. It bounds live
// processes (semaphore) and each job's wall clock (timeout). A failure to RUN
// the worker returns an error; a worker that ran and rejected returns a Result
// with OK=false and nil error.
func (r *Runner) Verify(ctx context.Context, job Job) (Result, error) {
	// Queue behind the concurrency cap, but bail out if the caller's context is
	// cancelled while waiting (don't block a request goroutine forever).
	select {
	case r.sem <- struct{}{}:
		defer func() { <-r.sem }()
	case <-ctx.Done():
		return Result{}, ctx.Err()
	}

	payload, err := json.Marshal(job)
	if err != nil {
		return Result{}, fmt.Errorf("arcade: marshal job: %w", err)
	}

	jobCtx, cancel := context.WithTimeout(ctx, r.cfg.Timeout)
	defer cancel()

	stdout, err := r.exec(jobCtx, payload)
	if err != nil {
		return Result{}, fmt.Errorf("arcade: verify worker failed to run: %w", err)
	}

	var res Result
	if err := json.Unmarshal(bytes.TrimSpace(stdout), &res); err != nil {
		return Result{}, fmt.Errorf("arcade: unparseable worker output (%d bytes): %w", len(stdout), err)
	}
	return res, nil
}

// runNode is the production exec: pipe the job JSON to `node verify-worker.cjs`,
// read a capped stdout, and enforce the context deadline.
func (r *Runner) runNode(ctx context.Context, stdin []byte) ([]byte, error) {
	cmd := exec.CommandContext(ctx, r.cfg.NodeBin, r.workerPath) // #nosec G204 -- args are the fixed node binary + our own embedded bundle path, never user input
	cmd.Stdin = bytes.NewReader(stdin)
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	// stderr is captured but bounded — a broken worker must not flood memory.
	stderr := &cappedBuffer{max: 4 << 10}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	out, readErr := readAllCapped(stdoutPipe, r.cfg.MaxOutputBytes)
	if readErr != nil {
		// Don't wait for a flooding child to finish writing a full pipe — kill it
		// now so Wait returns immediately instead of blocking until the timeout.
		_ = cmd.Process.Kill()
	}
	waitErr := cmd.Wait()
	if ctx.Err() != nil {
		return nil, fmt.Errorf("timed out after %s: %w", r.cfg.Timeout, ctx.Err())
	}
	if readErr != nil {
		return nil, readErr
	}
	if waitErr != nil {
		return nil, fmt.Errorf("node exited: %w (stderr: %s)", waitErr, bytes.TrimSpace(stderr.Bytes()))
	}
	return out, nil
}

// cappedBuffer is an io.Writer that keeps at most max bytes and silently drops
// the rest — bounds subprocess stderr without ever blocking the writer.
type cappedBuffer struct {
	buf bytes.Buffer
	max int
}

func (c *cappedBuffer) Write(p []byte) (int, error) {
	if room := c.max - c.buf.Len(); room > 0 {
		if len(p) > room {
			c.buf.Write(p[:room])
		} else {
			c.buf.Write(p)
		}
	}
	return len(p), nil // report full consumption so the pipe never blocks
}

func (c *cappedBuffer) Bytes() []byte { return c.buf.Bytes() }

// readAllCapped reads up to max bytes; if the stream has more, it errors rather
// than buffering an unbounded flood.
func readAllCapped(rd io.Reader, max int64) ([]byte, error) {
	buf, err := io.ReadAll(io.LimitReader(rd, max+1))
	if err != nil {
		return buf, err
	}
	if int64(len(buf)) > max {
		return buf[:max], fmt.Errorf("worker output exceeded %d bytes", max)
	}
	return buf, nil
}
