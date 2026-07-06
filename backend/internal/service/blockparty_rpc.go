package service

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/blockparty"
)

// Block Party RPC handlers. Stubs for now (proto + codegen only, B5) — real
// implementations land in later tasks (daily challenge derivation, score
// replay/verification, leaderboard, streak tracking).

func todayUTC() string { return time.Now().UTC().Format("2006-01-02") }

// ensureChallenge returns the cached challenge for `date`, deriving and caching
// it immutably on first request. ready=false means the day's block isn't mined.
func (s *MultisigService) ensureChallenge(ctx context.Context, date string) (blockparty.Challenge, bool, error) {
	if c, ok, err := blockparty.GetChallenge(s.db, date); err != nil {
		return blockparty.Challenge{}, false, err
	} else if ok {
		return c, true, nil
	}
	blk, err := blockparty.SelectDailyBlock(ctx, s.blockPartyFetcher(), date)
	if errors.Is(err, blockparty.ErrNotReady) {
		return blockparty.Challenge{}, false, nil
	}
	if err != nil {
		return blockparty.Challenge{}, false, err
	}
	seed := blockparty.DeriveSeed(blk.Hash, date)
	c := blockparty.Challenge{
		Date: date, Height: blk.Height, Hash: blk.Hash, Seed: seed,
		Modifier: blockparty.DeriveModifier(seed), Par: blockparty.DerivePar(seed),
	}
	if err := blockparty.PutChallenge(s.db, c); err != nil {
		return blockparty.Challenge{}, false, err
	}
	// re-read to honor immutability if a concurrent request cached first
	got, _, err := blockparty.GetChallenge(s.db, date)
	if err != nil {
		return blockparty.Challenge{}, false, err
	}
	return got, true, nil
}

func (s *MultisigService) GetDailyChallenge(
	ctx context.Context,
	req *connect.Request[membav1.GetDailyChallengeRequest],
) (*connect.Response[membav1.GetDailyChallengeResponse], error) {
	date := req.Msg.Date
	if date == "" {
		date = todayUTC()
	}
	c, ready, err := s.ensureChallenge(ctx, date)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !ready {
		return connect.NewResponse(&membav1.GetDailyChallengeResponse{Date: date, Ready: false}), nil
	}
	return connect.NewResponse(&membav1.GetDailyChallengeResponse{
		Date: c.Date, Seed: c.Seed, BlockHeight: c.Height, BlockHash: c.Hash,
		Modifier: c.Modifier, Par: c.Par, Ready: true,
	}), nil
}

func (s *MultisigService) SubmitScore(ctx context.Context, req *connect.Request[membav1.SubmitScoreRequest]) (*connect.Response[membav1.SubmitScoreResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("memba.v1.MultisigService.SubmitScore is not implemented"))
}

func (s *MultisigService) GetDailyLeaderboard(ctx context.Context, req *connect.Request[membav1.GetDailyLeaderboardRequest]) (*connect.Response[membav1.GetDailyLeaderboardResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("memba.v1.MultisigService.GetDailyLeaderboard is not implemented"))
}

func (s *MultisigService) GetStreak(ctx context.Context, req *connect.Request[membav1.GetStreakRequest]) (*connect.Response[membav1.GetStreakResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("memba.v1.MultisigService.GetStreak is not implemented"))
}
