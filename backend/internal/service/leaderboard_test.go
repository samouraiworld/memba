package service

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// complete is a helper: completes an off_chain quest (accepted by the gate
// without a network call) for a user, building XP via CompleteQuest so both
// quest_completions and the user_ranks cache are written.
func (h *testHarness) complete(t *testing.T, addr string, questIDs ...string) {
	t.Helper()
	ctx := context.Background()
	token := h.makeToken(t, addr)
	for _, q := range questIDs {
		if _, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
			AuthToken: token, QuestId: q,
		})); err != nil {
			t.Fatalf("CompleteQuest(%s,%s): %v", addr, q, err)
		}
	}
}

func TestGetLeaderboard_OrdersByXPDesc(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	// off_chain quests: connect-wallet=10, use-cmdk=10, switch-network=15, submit-feedback=20
	h.complete(t, "g1alice", "connect-wallet", "submit-feedback")             // 30
	h.complete(t, "g1bob", "connect-wallet")                                  // 10
	h.complete(t, "g1carol", "connect-wallet", "use-cmdk", "switch-network")  // 35

	resp, err := h.svc.GetLeaderboard(ctx, connect.NewRequest(&membav1.GetLeaderboardRequest{Limit: 50}))
	if err != nil {
		t.Fatal("GetLeaderboard:", err)
	}
	if resp.Msg.TotalCount != 3 {
		t.Fatalf("expected totalCount 3, got %d", resp.Msg.TotalCount)
	}
	got := resp.Msg.Entries
	if len(got) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(got))
	}
	// Carol(35) > Alice(30) > Bob(10)
	wantOrder := []struct {
		addr string
		xp   uint32
	}{{"g1carol", 35}, {"g1alice", 30}, {"g1bob", 10}}
	for i, w := range wantOrder {
		if got[i].Address != w.addr || got[i].TotalXp != w.xp {
			t.Errorf("rank %d: got (%s,%d), want (%s,%d)", i, got[i].Address, got[i].TotalXp, w.addr, w.xp)
		}
	}
}

// When quest_completions has users absent from the user_ranks cache (e.g. a
// completion written without updating the cache), GetLeaderboard must rebuild
// the cache rather than serve a stale/short page. Previously the recompute only
// fired when the cache was entirely empty.
func TestGetLeaderboard_RecomputesWhenCacheStale(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	// Alice goes through CompleteQuest (cache updated): 1 cached user.
	h.complete(t, "g1alice", "connect-wallet", "use-cmdk") // 20

	// Bob's completion is inserted directly — quest_completions now has 2 users
	// but user_ranks still has 1 (cache is stale).
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := h.db.ExecContext(ctx,
		`INSERT INTO quest_completions (address, quest_id, completed_at) VALUES (?, ?, ?)`,
		"g1bob", "submit-feedback", now, // 20 XP
	); err != nil {
		t.Fatal("seed bob completion:", err)
	}

	resp, err := h.svc.GetLeaderboard(ctx, connect.NewRequest(&membav1.GetLeaderboardRequest{Limit: 50}))
	if err != nil {
		t.Fatal("GetLeaderboard:", err)
	}
	if resp.Msg.TotalCount != 2 {
		t.Fatalf("expected totalCount 2, got %d", resp.Msg.TotalCount)
	}
	if len(resp.Msg.Entries) != 2 {
		t.Fatalf("expected 2 entries after stale-cache recompute, got %d", len(resp.Msg.Entries))
	}
	seen := map[string]bool{}
	for _, e := range resp.Msg.Entries {
		seen[e.Address] = true
	}
	if !seen["g1alice"] || !seen["g1bob"] {
		t.Fatalf("expected both alice and bob, got %v", seen)
	}
}
