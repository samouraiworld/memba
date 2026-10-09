package arcade

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

//go:embed worker/bundle/freeplay-worker.cjs
var freePlayWorkerBundle []byte

var ErrFreePlayWorkerUnavailable = errors.New("verification_unavailable")

type freePlayReplayRejected struct{ code string }

func (e freePlayReplayRejected) Error() string { return e.code }
func rejectFreePlayReplay(code string) error   { return freePlayReplayRejected{code} }

type FreePlayReplayResult struct {
	OK           bool   `json:"ok"`
	Error        string `json:"error,omitempty"`
	Game         string `json:"game,omitempty"`
	Rules        string `json:"rules,omitempty"`
	SimVersion   int64  `json:"simVersion,omitempty"`
	FinishReason string `json:"finishReason,omitempty"`
	Score        int64  `json:"score,omitempty"`
	StateHash    string `json:"stateHash,omitempty"`
	ReplayHash   string `json:"replayHash,omitempty"`
}
type FreePlayReplayVerifier interface {
	VerifyFreePlay(context.Context, FreePlayInput) (FreePlayReplayResult, error)
}

// FreePlayRunner reuses the existing subprocess implementation and SHARES its
// semaphore with legacy verification. It runs a distinct reviewed worker bundle.
// No constructor is wired into main; there is no implicit game activation.
type FreePlayRunner struct{ runtime *Runner }

// NewFreePlayRunner uses only the embedded reproducible Free play bundle.
// The existing parent supplies shared capacity/config; main does not call it.
func NewFreePlayRunner(parent *Runner) (*FreePlayRunner, error) {
	return newFreePlayRunner(parent, freePlayWorkerBundle)
}

// Only tests inject another local bundle to exercise subprocess failures.
func newFreePlayRunner(parent *Runner, reviewedBundle []byte) (*FreePlayRunner, error) {
	if parent == nil || parent.sem == nil || len(reviewedBundle) == 0 || len(reviewedBundle) > 4<<20 {
		return nil, ErrFreePlayWorkerUnavailable
	}
	dir, err := os.MkdirTemp("", "memba-freeplay-worker-")
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrFreePlayWorkerUnavailable, err)
	}
	path := filepath.Join(dir, "freeplay-worker.cjs")
	if err = os.WriteFile(path, reviewedBundle, 0600); err != nil {
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("%w: %v", ErrFreePlayWorkerUnavailable, err)
	}
	runtime := &Runner{cfg: parent.cfg, sem: parent.sem, workerPath: path, cleanup: func() { _ = os.RemoveAll(dir) }}
	runtime.exec = runtime.runNode
	return &FreePlayRunner{runtime: runtime}, nil
}
func (r *FreePlayRunner) Close() error { return r.runtime.Close() }

var freePlayWorkerSeed = regexp.MustCompile(`^[a-zA-Z0-9:_-]{1,128}$`)
var freePlayInvadersSeed = regexp.MustCompile(`^si1:[0-9a-f]{8}$`)

// Gate cost and scope before queueing/spawning. TypeScript remains authority for
// canonical event shape, accepted actions and exact terminal simulation.
func validateFreePlayWorkerInput(in FreePlayInput) error {
	if !fpUUID.MatchString(in.ClientRunID) || !freePlayWorkerSeed.MatchString(in.Seed) || len(in.Replay) < 1 || len(in.Replay) > 1000000 || in.ClaimedScore == nil || *in.ClaimedScore < 0 || *in.ClaimedScore > FreePlayMaxScore {
		return rejectFreePlayReplay("invalid_replay")
	}
	switch in.Game {
	case "space-invaders":
		if in.Rules != "si-free-standard-v1" || in.ReplayCodec != "si-deltas-v1" {
			return rejectFreePlayReplay("unsupported_rules")
		}
		if in.SimVersion != 1 {
			return rejectFreePlayReplay("unsupported_version")
		}
		if in.FinishReason != "game-over" {
			return rejectFreePlayReplay("not_terminal")
		}
		if !freePlayInvadersSeed.MatchString(in.Seed) {
			return rejectFreePlayReplay("invalid_replay")
		}
		tick, _, found := strings.Cut(in.Replay, ";")
		n, err := strconv.ParseInt(tick, 10, 64)
		if !found || err != nil || n < 1 {
			return rejectFreePlayReplay("invalid_replay")
		}
		if n > 216000 || strings.Count(in.Replay, ";") > 10000 {
			return rejectFreePlayReplay("certification_limit")
		}
	case "barricade":
		if in.Rules != "barricade-fps-c1" || in.ReplayCodec != "barricade-fps-inputs-v1" {
			return rejectFreePlayReplay("unsupported_rules")
		}
		if in.SimVersion != 3 {
			return rejectFreePlayReplay("unsupported_version")
		}
		if in.FinishReason != "won" && in.FinishReason != "lost" {
			return rejectFreePlayReplay("not_terminal")
		}
		var fields []json.RawMessage
		if err := json.Unmarshal([]byte(in.Replay), &fields); err != nil || len(fields) != 2 {
			return rejectFreePlayReplay("invalid_replay")
		}
		var tick int64
		var events []json.RawMessage
		if err := json.Unmarshal(fields[0], &tick); err != nil || tick < 1 || tick > 10800 {
			return rejectFreePlayReplay("certification_limit")
		}
		if err := json.Unmarshal(fields[1], &events); err != nil || events == nil || len(events) > 20000 {
			return rejectFreePlayReplay("certification_limit")
		}
	default:
		return rejectFreePlayReplay("unsupported_rules")
	}
	return nil
}

var freePlayWorkerRejections = map[string]bool{
	"invalid_replay": true, "not_terminal": true, "unsupported_version": true, "unsupported_rules": true,
	"claimed_result_mismatch": true, "certification_limit": true, "invalid_run_identity": true,
	"invalid_fps_replay": true, "invalid_fps_event_order": true, "invalid_fps_direction": true, "invalid_fps_event": true,
	"unsupported_fps_rules": true, "rejected_fps_action": true, "trailing_fps_input": true, "fps_not_terminal": true,
	"noncanonical_replay": true,
}

func (r *FreePlayRunner) VerifyFreePlay(ctx context.Context, in FreePlayInput) (FreePlayReplayResult, error) {
	var result FreePlayReplayResult
	if err := validateFreePlayWorkerInput(in); err != nil {
		return result, err
	}
	if r == nil || r.runtime == nil || r.runtime.exec == nil {
		return result, ErrFreePlayWorkerUnavailable
	}
	claimedScore := *in.ClaimedScore
	in.ClaimedScore = &claimedScore
	payload, err := json.Marshal(in)
	if err != nil || int64(len(payload)) > FreePlayMaxBody {
		return result, rejectFreePlayReplay("certification_limit")
	}
	if ctx.Err() != nil {
		return result, ErrFreePlayWorkerUnavailable
	}
	// The parent request deadline includes the wait for this shared capacity.
	select {
	case r.runtime.sem <- struct{}{}:
		defer func() { <-r.runtime.sem }()
	case <-ctx.Done():
		return result, fmt.Errorf("%w: %v", ErrFreePlayWorkerUnavailable, ctx.Err())
	}
	if ctx.Err() != nil {
		return result, ErrFreePlayWorkerUnavailable
	}
	jobCtx, cancel := context.WithTimeout(ctx, r.runtime.cfg.Timeout)
	defer cancel()
	stdout, err := r.runtime.exec(jobCtx, payload)
	if err != nil || jobCtx.Err() != nil {
		return result, fmt.Errorf("%w: worker execution failed", ErrFreePlayWorkerUnavailable)
	}
	if int64(len(stdout)) > r.runtime.cfg.MaxOutputBytes {
		return result, fmt.Errorf("%w: output cap", ErrFreePlayWorkerUnavailable)
	}
	decoder := json.NewDecoder(bytes.NewReader(stdout))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&result); err != nil {
		return result, fmt.Errorf("%w: invalid output", ErrFreePlayWorkerUnavailable)
	}
	var extra any
	if err = decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return result, fmt.Errorf("%w: trailing output", ErrFreePlayWorkerUnavailable)
	}
	if !result.OK {
		if !freePlayWorkerRejections[result.Error] {
			return result, fmt.Errorf("%w: invalid rejection", ErrFreePlayWorkerUnavailable)
		}
		return result, rejectFreePlayReplay(result.Error)
	}
	if err := validateFreePlayWorkerResult(in, result); err != nil {
		return result, err
	}
	return result, nil
}

func validateFreePlayWorkerResult(in FreePlayInput, result FreePlayReplayResult) error {
	if !result.OK || in.ClaimedScore == nil {
		return ErrFreePlayWorkerUnavailable
	}
	hashLength := 64
	if in.Game == "space-invaders" {
		hashLength = 8
	}
	replayHash := HashFreePlayFields("memba:free-replay:v1", in.Game, in.Rules, strconv.FormatInt(in.SimVersion, 10), in.Seed, in.ReplayCodec, in.Replay)
	if result.Error != "" || result.Game != in.Game || result.Rules != in.Rules || result.SimVersion != in.SimVersion || result.FinishReason != in.FinishReason || result.Score != *in.ClaimedScore || result.Score < 0 || result.Score > FreePlayMaxScore || len(result.StateHash) != hashLength || !fpStateHash.MatchString(result.StateHash) || result.ReplayHash != replayHash {
		return fmt.Errorf("%w: implausible result", ErrFreePlayWorkerUnavailable)
	}
	return nil
}
