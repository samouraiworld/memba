package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/blockparty"
	"github.com/samouraiworld/memba/backend/internal/blockparty/engine"
)

func TestGetDailyChallenge_ServesCached(t *testing.T) {
	h := setup(t)
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
	h.svc.SetBlockParty(true, "")
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
	// second submit same day rejected
	_, err = h.svc.SubmitScore(context.Background(), connect.NewRequest(&membav1.SubmitScoreRequest{
		AuthToken: token, Date: todayUTC(), MoveLog: log,
	}))
	if err == nil {
		t.Fatal("expected second-submit rejection")
	}
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("second submit: got code %v, want AlreadyExists", connect.CodeOf(err))
	}
}

func TestSubmitScore_RejectsWrongDate(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(true, "")
	token := h.makeToken(t, "g1bob")
	_, err := h.svc.SubmitScore(context.Background(), connect.NewRequest(&membav1.SubmitScoreRequest{
		AuthToken: token, Date: "2000-01-01", MoveLog: "URDL",
	}))
	if err == nil {
		t.Fatal("expected wrong-date rejection")
	}
}

func TestSubmitScore_DisabledFlag(t *testing.T) {
	h := setup(t)
	h.svc.SetBlockParty(false, "")
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

func TestGetStreak_Default(t *testing.T) {
	h := setup(t)
	resp, err := h.svc.GetStreak(context.Background(),
		connect.NewRequest(&membav1.GetStreakRequest{Address: "g1nobody"}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Msg.Streak.Current != 0 {
		t.Fatalf("current=%d want 0", resp.Msg.Streak.Current)
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
