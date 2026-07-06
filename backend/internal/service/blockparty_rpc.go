package service

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// Block Party RPC handlers. Stubs for now (proto + codegen only, B5) — real
// implementations land in later tasks (daily challenge derivation, score
// replay/verification, leaderboard, streak tracking).

func (s *MultisigService) GetDailyChallenge(ctx context.Context, req *connect.Request[membav1.GetDailyChallengeRequest]) (*connect.Response[membav1.GetDailyChallengeResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("memba.v1.MultisigService.GetDailyChallenge is not implemented"))
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
