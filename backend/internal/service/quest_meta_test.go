package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// Meta-quests (earn-500-xp, earn-1000-xp, complete-all-everyone, top-10-leaderboard)
// are server-DERIVED. A client must not be able to claim them directly — that was the
// leaderboard-farming hole (audit MED-2).
func TestCompleteQuest_RejectsMetaQuestClaim(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	for _, id := range []string{"earn-500-xp", "earn-1000-xp", "complete-all-everyone", "top-10-leaderboard"} {
		_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
			AuthToken: token,
			QuestId:   id,
		}))
		if err == nil {
			t.Fatalf("%q: expected rejection (server-derived), but it was accepted", id)
		}
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%q: expected CodeInvalidArgument, got %v", id, connect.CodeOf(err))
		}
	}
}

// The earn-500-xp milestone is granted by the server from authoritative XP, never by
// a client claim. Reaching >= 500 XP via real completions must auto-grant it.
func TestCompleteQuest_AutoGrantsEarn500XP(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	// Seed real completions directly (bypassing the RPC) until ~490 XP, skipping
	// meta-quests and the trigger quest. validQuests/metaQuests are package vars.
	const ts = "2026-01-01T00:00:00Z"
	var xp uint32
	for id, q := range validQuests {
		if metaQuests[id] || id == "connect-wallet" || xp >= 490 {
			continue
		}
		if _, err := h.db.ExecContext(ctx,
			`INSERT OR IGNORE INTO quest_completions (address, quest_id, completed_at, proof) VALUES (?, ?, ?, '')`,
			"g1alice", id, ts); err != nil {
			t.Fatal("seed:", err)
		}
		xp += q
	}
	if xp < 490 {
		t.Fatalf("seed only reached %d XP, need >= 490", xp)
	}

	// One more off_chain completion crosses 500 → earn-500-xp must be auto-granted.
	resp, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token,
		QuestId:   "connect-wallet",
	}))
	if err != nil {
		t.Fatal("CompleteQuest:", err)
	}
	if resp.Msg.State.TotalXp < 500 {
		t.Fatalf("expected >= 500 XP, got %d", resp.Msg.State.TotalXp)
	}
	found := false
	for _, c := range resp.Msg.State.Completed {
		if c.QuestId == "earn-500-xp" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected earn-500-xp to be auto-granted at >= 500 XP")
	}
}
