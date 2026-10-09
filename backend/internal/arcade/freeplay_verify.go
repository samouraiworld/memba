package arcade

import (
	"context"
	"errors"
	"strconv"

	"github.com/samouraiworld/memba/backend/internal/blockparty"
)

// VerifyFreePlayRun currently accepts only the reviewed Block Party codec.
// New games require their own adapter; changing a client slug cannot select
// the old daily worker or mislabel a Classic/FPS result.
func VerifyFreePlayRun(ctx context.Context, target FreePlayTarget, player string, in FreePlayInput) (FreePlayRun, error) {
	id, err := FreePlayRunID(target, player, in.Game, in.ClientRunID)
	if err != nil {
		return FreePlayRun{}, err
	}
	if in.Game != "block-party" || in.Rules != blockparty.FreePlayRules || in.ReplayCodec != blockparty.FreePlayCodec {
		return FreePlayRun{}, errors.New("unsupported_rules")
	}
	if in.SimVersion != 1 {
		return FreePlayRun{}, errors.New("unsupported_version")
	}
	if in.FinishReason != "game-over" {
		return FreePlayRun{}, errors.New("not_terminal")
	}
	result, err := blockparty.VerifyFreePlay(ctx, in.Seed, in.Replay)
	if err != nil {
		return FreePlayRun{}, err
	}
	if in.ClaimedScore != nil && *in.ClaimedScore != result.Score {
		return FreePlayRun{}, errors.New("claimed_result_mismatch")
	}
	e := FreePlayEntry{Game: in.Game, Player: player, Rules: in.Rules, SimVersion: in.SimVersion, RunID: id, Seed: in.Seed, Score: result.Score, StateHash: result.StateHash,
		ReplayHash: HashFreePlayFields("memba:free-replay:v1", in.Game, in.Rules, strconv.FormatInt(in.SimVersion, 10), in.Seed, in.ReplayCodec, in.Replay)}
	if err := e.Validate(); err != nil {
		return FreePlayRun{}, err
	}
	return FreePlayRun{Target: target, Entry: e, ClientRunID: in.ClientRunID, PayloadHash: e.PayloadHash(target), ReplayCodec: in.ReplayCodec, Replay: in.Replay, Status: "verified"}, nil
}
