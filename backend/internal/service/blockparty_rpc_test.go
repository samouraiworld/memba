package service

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/blockparty"
	"github.com/samouraiworld/memba/backend/internal/blockparty/engine"
	"github.com/samouraiworld/memba/backend/internal/ratelimit"
)

func TestGetDailyChallenge_ServesCached(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(true, "", "")
	// pre-seed an immutable challenge
	c := blockparty.Challenge{Date: "2026-07-06", Height: 10, Hash: "abc", Seed: 42, Modifier: "standard", Par: 1500}
	if err := blockparty.PutChallenge(h.db, c); err != nil {
		t.Fatal(err)
	}
	resp, err := h.svc.GetDailyChallenge(context.Background(),
		connect.NewRequest(&membav1.GetDailyChallengeRequest{Date: "2026-07-06"}))
	if err != nil {
		t.Fatalf("GetDailyChallenge: %v", err)
	}
	m := resp.Msg
	if !m.Ready || m.Seed != 42 || m.Modifier != "standard" || m.BlockHeight != 10 || m.Par != 1500 {
		t.Fatalf("bad response: %+v", m)
	}
}

func TestSubmitScore_VerifiesAndStores(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(true, "", "")
	// seed a known challenge so we control seed+modifier
	c := blockparty.Challenge{Date: todayUTC(), Height: 5, Hash: "hh", Seed: 12345, Modifier: "standard", Par: 1500}
	if err := blockparty.PutChallenge(h.db, c); err != nil {
		t.Fatal(err)
	}
	// build a legal move log by playing the engine ourselves
	log := legalLog(t, 12345, "standard", 12)
	token := h.makeToken(t, "g1alice")
	resp, err := h.svc.SubmitScore(context.Background(), connect.NewRequest(&membav1.SubmitScoreRequest{
		AuthToken: token, Date: todayUTC(), MoveLog: log,
	}))
	if err != nil {
		t.Fatalf("SubmitScore: %v", err)
	}
	if resp.Msg.Score <= 0 {
		t.Fatalf("score=%d want >0", resp.Msg.Score)
	}
	if resp.Msg.Streak.Current != 1 {
		t.Fatalf("streak=%d want 1", resp.Msg.Streak.Current)
	}
	// Exact retry succeeds idempotently (for example after the first response
	// was lost); it must return the same authoritative score and streak.
	retry, err := h.svc.SubmitScore(context.Background(), connect.NewRequest(&membav1.SubmitScoreRequest{
		AuthToken: token, Date: todayUTC(), MoveLog: log,
	}))
	if err != nil {
		t.Fatalf("exact retry: %v", err)
	}
	if retry.Msg.Score != resp.Msg.Score || retry.Msg.Streak.Current != 1 {
		t.Fatalf("retry changed result: first=%+v retry=%+v", resp.Msg, retry.Msg)
	}

	// A different replay still conflicts with the immutable first write.
	different := legalLog(t, 12345, "standard", 11)
	_, err = h.svc.SubmitScore(context.Background(), connect.NewRequest(&membav1.SubmitScoreRequest{
		AuthToken: token, Date: todayUTC(), MoveLog: different,
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("different second submit: got code %v, want AlreadyExists", connect.CodeOf(err))
	}
}

func TestSubmitScore_RejectsWrongDate(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(true, "", "")
	token := h.makeToken(t, "g1bob")
	_, err := h.svc.SubmitScore(context.Background(), connect.NewRequest(&membav1.SubmitScoreRequest{
		AuthToken: token, Date: "2000-01-01", MoveLog: "URDL",
	}))
	if err == nil {
		t.Fatal("expected wrong-date rejection")
	}
}

func TestBlockPartyReads_RejectMalformedDates(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(true, "", "")
	if _, err := h.svc.GetDailyChallenge(context.Background(),
		connect.NewRequest(&membav1.GetDailyChallengeRequest{Date: "2026-99-99"})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("challenge malformed date: got %v, want InvalidArgument", err)
	}
	if _, err := h.svc.GetDailyLeaderboard(context.Background(),
		connect.NewRequest(&membav1.GetDailyLeaderboardRequest{Date: "not-a-date"})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("leaderboard malformed date: got %v, want InvalidArgument", err)
	}
}

func TestSubmitScore_DisabledFlag(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(false, "", "")
	token := h.makeToken(t, "g1bob")
	_, err := h.svc.SubmitScore(context.Background(), connect.NewRequest(&membav1.SubmitScoreRequest{
		AuthToken: token, Date: todayUTC(), MoveLog: "URDL",
	}))
	if err == nil {
		t.Fatal("expected unimplemented when flag off")
	}
}

func TestGetDailyLeaderboard(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(true, "", "")
	d := todayUTC()
	if _, err := blockparty.InsertScore(h.db, d, "g1a", 300, "UU", "b1"); err != nil {
		t.Fatal(err)
	}
	if _, err := blockparty.InsertScore(h.db, d, "g1b", 900, "RR", "b2"); err != nil {
		t.Fatal(err)
	}
	if _, err := blockparty.InsertScore(h.db, d, "g1c", 600, "DD", "b3"); err != nil {
		t.Fatal(err)
	}
	resp, err := h.svc.GetDailyLeaderboard(context.Background(),
		connect.NewRequest(&membav1.GetDailyLeaderboardRequest{Date: d, Limit: 10}))
	if err != nil {
		t.Fatal(err)
	}
	e := resp.Msg.Entries
	if len(e) != 3 || e[0].Address != "g1b" || e[0].Rank != 1 || e[2].Address != "g1a" {
		t.Fatalf("bad leaderboard: %+v", e)
	}
}

func TestGetDailyLeaderboard_TiesShareRankDeterministically(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(true, "", "")
	d := todayUTC()
	for _, row := range []struct {
		address string
		score   int64
	}{{"g1z", 900}, {"g1a", 900}, {"g1m", 600}} {
		if _, err := blockparty.InsertScore(h.db, d, row.address, row.score, "U", "hash"); err != nil {
			t.Fatal(err)
		}
	}
	resp, err := h.svc.GetDailyLeaderboard(context.Background(),
		connect.NewRequest(&membav1.GetDailyLeaderboardRequest{Date: d, Limit: 10}))
	if err != nil {
		t.Fatal(err)
	}
	entries := resp.Msg.Entries
	if len(entries) != 3 || entries[0].Address != "g1a" || entries[1].Address != "g1z" {
		t.Fatalf("tie ordering is not deterministic: %+v", entries)
	}
	if entries[0].Rank != 1 || entries[1].Rank != 1 || entries[2].Rank != 3 {
		t.Fatalf("competition ranks for tie = %+v; want 1,1,3", entries)
	}
}

func TestGetStreak_Default(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(true, "", "")
	resp, err := h.svc.GetStreak(context.Background(),
		connect.NewRequest(&membav1.GetStreakRequest{Address: "g1nobody"}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Msg.Streak.Current != 0 {
		t.Fatalf("current=%d want 0", resp.Msg.Streak.Current)
	}
}

// TestSubmitScore_PerAddressRateLimit verifies the per-address limiter (Q-03
// style) added to SubmitScore: a valid-token caller that keeps getting
// rejected can't grind unbounded replay CPU — the SECOND call within the
// window is rejected before any replay work, regardless of why the first
// call failed.
func TestSubmitScore_PerAddressRateLimit(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(true, "", "")
	h.svc.SetUserLimiter(ratelimit.New(context.Background(), map[string]ratelimit.Config{
		ratelimit.BlockPartySubmitEndpoint: {MaxRequests: 1, Window: time.Minute},
	}))
	token := h.makeToken(t, "g1carol")

	// First call: uses the wrong date on purpose (cheap to trigger, fails for
	// its own reason) but must NOT be rate-limited.
	_, err := h.svc.SubmitScore(context.Background(), connect.NewRequest(&membav1.SubmitScoreRequest{
		AuthToken: token, Date: "2000-01-01", MoveLog: "URDL",
	}))
	if err == nil {
		t.Fatal("expected wrong-date rejection on first call")
	}
	if connect.CodeOf(err) == connect.CodeResourceExhausted {
		t.Fatalf("first call should not be rate-limited, got %v", err)
	}

	// Second call with the same token: quota is exhausted, so this must be
	// rejected as ResourceExhausted before reaching the date check.
	_, err = h.svc.SubmitScore(context.Background(), connect.NewRequest(&membav1.SubmitScoreRequest{
		AuthToken: token, Date: "2000-01-01", MoveLog: "URDL",
	}))
	if err == nil {
		t.Fatal("expected second call to be rate-limited")
	}
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("second call: got code %v, want ResourceExhausted", connect.CodeOf(err))
	}
}

func TestSubmitScore_RejectsOverBudget(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(true, "", "")
	c := blockparty.Challenge{Date: todayUTC(), Height: 5, Hash: "hh", Seed: 12345, Modifier: "standard", Par: 1500}
	if err := blockparty.PutChallenge(h.db, c); err != nil {
		t.Fatal(err)
	}
	log := legalLog(t, 12345, "standard", 31) // 31 > standard budget 30
	token := h.makeToken(t, "g1alice")
	_, err := h.svc.SubmitScore(context.Background(), connect.NewRequest(&membav1.SubmitScoreRequest{
		AuthToken: token, Date: todayUTC(), MoveLog: log,
	}))
	if err == nil || connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("over-budget submit: got %v, want InvalidArgument", err)
	}
}

// legalLog plays the engine to produce a move string of `n` real (non-no-op) moves.
func legalLog(t *testing.T, seed uint32, mod string, n int) string {
	t.Helper()
	dirs := []engine.Move{"U", "R", "D", "L"}
	s := engine.InitGame(seed, mod)
	var out []byte
	for len(out) < n {
		for _, d := range dirs {
			ns := engine.Step(s, d)
			if ns.RngCallCount != s.RngCallCount { // real move
				s = ns
				out = append(out, d[0])
				break
			}
		}
	}
	return string(out)
}

// The flag must be a TOTAL kill switch: while parked, every Block Party RPC —
// reads included — answers Unimplemented. Before this gate GetDailyChallenge
// was reachable while "disabled" and could drive chain RPC traffic and mint a
// permanent challenge row from a misconfigured node.
func TestBlockPartyReads_DisabledFlag(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(false, "", "")

	if _, err := h.svc.GetDailyChallenge(context.Background(),
		connect.NewRequest(&membav1.GetDailyChallengeRequest{})); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("GetDailyChallenge while parked: got %v, want CodeUnimplemented", err)
	}
	if _, err := h.svc.GetDailyLeaderboard(context.Background(),
		connect.NewRequest(&membav1.GetDailyLeaderboardRequest{})); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("GetDailyLeaderboard while parked: got %v, want CodeUnimplemented", err)
	}
	if _, err := h.svc.GetStreak(context.Background(),
		connect.NewRequest(&membav1.GetStreakRequest{Address: "g1nobody"})); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("GetStreak while parked: got %v, want CodeUnimplemented", err)
	}
}
