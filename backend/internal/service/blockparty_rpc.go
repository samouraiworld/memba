package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/blockparty"
	"github.com/samouraiworld/memba/backend/internal/blockparty/engine"
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
		MoveBudget: int32(blockparty.MoveBudget(c.Modifier)),
	}), nil
}

const maxMoveLog = 4096

// parseMoves validates and decodes a compact move log ("URDL...") into engine
// moves. It rejects any non-UDLR character and logs longer than maxMoveLog —
// both are the padding/oversize DoS vector.
func parseMoves(log string) ([]engine.Move, bool) {
	if len(log) > maxMoveLog {
		return nil, false
	}
	out := make([]engine.Move, 0, len(log))
	for _, ch := range log {
		switch ch {
		case 'U', 'R', 'D', 'L':
			out = append(out, string(ch))
		default:
			return nil, false
		}
	}
	return out, true
}

// boardHash returns the sha256 hex digest of the row-major board, stored
// alongside the score for later audit/dispute resolution.
func boardHash(b engine.Board) string {
	h := sha256.New()
	for _, v := range b {
		_, _ = fmt.Fprintf(h, "%d,", v)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// SubmitScore is the security-critical handler: the client never sends a
// score, only its move log. The server replays the day's challenge from the
// seed and derives the authoritative score itself.
func (s *MultisigService) SubmitScore(
	ctx context.Context,
	req *connect.Request[membav1.SubmitScoreRequest],
) (*connect.Response[membav1.SubmitScoreResponse], error) {
	if !s.blockPartyEnabled {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("block party is disabled"))
	}
	// 1) auth BEFORE any replay work
	addr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}
	date := req.Msg.Date
	// 2) today-only
	if date != todayUTC() {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("date must be today (UTC)"))
	}
	// 3) parse + length cap
	moves, ok := parseMoves(req.Msg.MoveLog)
	if !ok {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid or oversized move log"))
	}
	// 4) challenge must be ready
	c, ready, err := s.ensureChallenge(ctx, date)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !ready {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("today's challenge is not ready"))
	}
	// 5) move log must fit the day's server-authoritative budget
	if len(moves) > blockparty.MoveBudget(c.Modifier) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("move log exceeds the daily move budget"))
	}
	// 6) replay stepwise, rejecting any no-op move (padding/DoS guard)
	st := engine.InitGame(c.Seed, c.Modifier)
	for _, m := range moves {
		ns := engine.Step(st, m)
		if ns.RngCallCount == st.RngCallCount { // no board change => no-op => illegal
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("move log contains a no-op move"))
		}
		st = ns
	}
	score := st.Score
	// 7) one-per-day insert (first-write-wins)
	inserted, err := blockparty.InsertScore(s.db, date, addr, score, req.Msg.MoveLog, boardHash(st.Board))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !inserted {
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("already submitted today"))
	}
	// 8) streak + percentile
	streak, err := blockparty.BumpStreak(s.db, addr, date)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	pct, err := blockparty.Percentile(s.db, date, score)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&membav1.SubmitScoreResponse{
		Score: score, Percentile: int32(pct), Par: c.Par,
		Streak: &membav1.BlockPartyStreak{
			Current: int32(streak.Current), Longest: int32(streak.Longest),
			FreezesRemaining: int32(streak.FreezesRemaining),
		},
	}), nil
}

func (s *MultisigService) GetDailyLeaderboard(
	ctx context.Context,
	req *connect.Request[membav1.GetDailyLeaderboardRequest],
) (*connect.Response[membav1.GetDailyLeaderboardResponse], error) {
	date := req.Msg.Date
	if date == "" {
		date = todayUTC()
	}
	limit := int(req.Msg.Limit)
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := blockparty.TopScores(s.db, date, limit)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	out := make([]*membav1.LeaderboardScore, len(rows))
	for i, r := range rows {
		out[i] = &membav1.LeaderboardScore{Address: r.Address, Score: r.Score, Rank: int32(i + 1)}
	}
	return connect.NewResponse(&membav1.GetDailyLeaderboardResponse{Entries: out}), nil
}

func (s *MultisigService) GetStreak(
	ctx context.Context,
	req *connect.Request[membav1.GetStreakRequest],
) (*connect.Response[membav1.GetStreakResponse], error) {
	st, err := blockparty.GetStreak(s.db, req.Msg.Address)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&membav1.GetStreakResponse{
		Streak: &membav1.BlockPartyStreak{
			Current: int32(st.Current), Longest: int32(st.Longest), FreezesRemaining: int32(st.FreezesRemaining),
		},
	}), nil
}
