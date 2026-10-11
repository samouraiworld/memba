package blockparty

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"regexp"
	"strconv"

	"github.com/samouraiworld/memba/backend/internal/blockparty/engine"
)

const FreePlayRules = "bp-free-standard-undo-v1"
const FreePlayCodec = "bp-actions-v1"
const FreePlayMaxActions = 100000

var freePlaySeed = regexp.MustCompile(`^bp1:[0-9a-f]{8}$`)

// FreePlayResult always comes from replay, never a client score or checkpoint.
type FreePlayResult struct {
	Score     int64
	StateHash string
	State     engine.State
}

// VerifyFreePlay preserves Practice's unlimited successful moves and Undo rules.
// MaxActions is a certification resource bound, not a gameplay move budget.
func VerifyFreePlay(ctx context.Context, seed, actions string) (FreePlayResult, error) {
	if !freePlaySeed.MatchString(seed) {
		return FreePlayResult{}, errors.New("invalid_seed")
	}
	if len(actions) == 0 || len(actions) > FreePlayMaxActions {
		return FreePlayResult{}, errors.New("invalid_replay_size")
	}
	n, err := strconv.ParseUint(seed[4:], 16, 32)
	if err != nil {
		return FreePlayResult{}, err
	}
	state := engine.InitGame(uint32(n), "standard")
	// States are immutable engine snapshots. Undo pops the last accepted move.
	history := make([]engine.State, 0, min(len(actions), 1024))
	for _, action := range []byte(actions) {
		if err := ctx.Err(); err != nil {
			return FreePlayResult{}, err
		}
		if action == 'Z' {
			if len(history) == 0 {
				return FreePlayResult{}, errors.New("invalid_undo")
			}
			state = history[len(history)-1]
			history = history[:len(history)-1]
			continue
		}
		if action != 'U' && action != 'R' && action != 'D' && action != 'L' {
			return FreePlayResult{}, errors.New("invalid_action")
		}
		if state.Over {
			return FreePlayResult{}, errors.New("move_after_terminal")
		}
		next := engine.Step(state, string(action))
		if next.RngCallCount == state.RngCallCount {
			return FreePlayResult{}, errors.New("noop_move")
		}
		history = append(history, state)
		state = next
	}
	if !state.Over {
		return FreePlayResult{}, errors.New("not_terminal")
	}
	fields := []string{"memba:bp-state:v1"}
	for _, value := range state.Board {
		fields = append(fields, strconv.Itoa(value))
	}
	fields = append(fields, strconv.FormatInt(state.Score, 10), strconv.FormatUint(uint64(state.Rng), 10), strconv.Itoa(state.RngCallCount), strconv.Itoa(state.Moves), state.Modifier, "1")
	h := sha256.New()
	for _, field := range fields {
		var size [4]byte
		// State fields are decimal integers, a fixed domain or the standard
		// modifier. Bound the encoding explicitly before narrowing its length.
		length := len(field)
		if length > 128 {
			return FreePlayResult{}, errors.New("invalid_state_field")
		}
		binary.BigEndian.PutUint32(size[:], uint32(length))
		_, _ = h.Write(size[:])
		_, _ = h.Write([]byte(field))
	}
	return FreePlayResult{Score: state.Score, StateHash: hex.EncodeToString(h.Sum(nil)), State: state}, nil
}
