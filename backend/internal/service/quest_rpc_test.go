package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

func TestCompleteQuest_Success(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	resp, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token,
		QuestId:   "connect-wallet",
	}))
	if err != nil {
		t.Fatal("CompleteQuest:", err)
	}
	if resp.Msg.State.TotalXp != 10 {
		t.Fatalf("expected 10 XP, got %d", resp.Msg.State.TotalXp)
	}
	if len(resp.Msg.State.Completed) != 1 {
		t.Fatalf("expected 1 completion, got %d", len(resp.Msg.State.Completed))
	}
}

func TestCompleteQuest_Idempotent(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	// Complete twice — should not double XP.
	h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token,
		QuestId:   "connect-wallet",
	}))
	resp, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token,
		QuestId:   "connect-wallet",
	}))
	if err != nil {
		t.Fatal("CompleteQuest (2nd):", err)
	}
	if resp.Msg.State.TotalXp != 10 {
		t.Fatalf("expected 10 XP (no double), got %d", resp.Msg.State.TotalXp)
	}
	if len(resp.Msg.State.Completed) != 1 {
		t.Fatalf("expected 1 completion (no dup), got %d", len(resp.Msg.State.Completed))
	}
}

func TestCompleteQuest_InvalidQuestID(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token,
		QuestId:   "fake-quest",
	}))
	if err == nil {
		t.Fatal("expected error for invalid quest ID")
	}
}

func TestCompleteQuest_Unauthenticated(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: nil,
		QuestId:   "connect-wallet",
	}))
	if err == nil {
		t.Fatal("expected error for nil token")
	}
}

func TestGetUserQuests_Empty(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	resp, err := h.svc.GetUserQuests(ctx, connect.NewRequest(&membav1.GetUserQuestsRequest{
		Address: "g1nobody",
	}))
	if err != nil {
		t.Fatal("GetUserQuests:", err)
	}
	if resp.Msg.State.TotalXp != 0 {
		t.Fatalf("expected 0 XP, got %d", resp.Msg.State.TotalXp)
	}
}

func TestGetUserQuests_WithCompletions(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	// Complete two quests.
	h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "connect-wallet",
	}))
	h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "browse-proposals",
	}))

	resp, err := h.svc.GetUserQuests(ctx, connect.NewRequest(&membav1.GetUserQuestsRequest{
		Address: "g1alice",
	}))
	if err != nil {
		t.Fatal("GetUserQuests:", err)
	}
	if resp.Msg.State.TotalXp != 25 { // 10 + 15
		t.Fatalf("expected 25 XP, got %d", resp.Msg.State.TotalXp)
	}
	if len(resp.Msg.State.Completed) != 2 {
		t.Fatalf("expected 2 completions, got %d", len(resp.Msg.State.Completed))
	}
}

func TestGetUserQuests_InvalidAddress(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	_, err := h.svc.GetUserQuests(ctx, connect.NewRequest(&membav1.GetUserQuestsRequest{
		Address: "",
	}))
	if err == nil {
		t.Fatal("expected error for empty address")
	}
}

func TestSyncQuests_ImportLocalStorage(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	resp, err := h.svc.SyncQuests(ctx, connect.NewRequest(&membav1.SyncQuestsRequest{
		AuthToken: token,
		Completions: []*membav1.QuestCompletion{
			{QuestId: "connect-wallet", CompletedAt: "2026-03-15T10:00:00Z"},
			{QuestId: "view-profile", CompletedAt: "2026-03-15T10:05:00Z"},
			{QuestId: "fake-quest", CompletedAt: "2026-03-15T10:10:00Z"}, // should be skipped
		},
	}))
	if err != nil {
		t.Fatal("SyncQuests:", err)
	}
	if resp.Msg.State.TotalXp != 20 { // 10 + 10, fake-quest skipped
		t.Fatalf("expected 20 XP, got %d", resp.Msg.State.TotalXp)
	}
	if len(resp.Msg.State.Completed) != 2 {
		t.Fatalf("expected 2 completions, got %d", len(resp.Msg.State.Completed))
	}
}

func TestSyncQuests_IdempotentWithExisting(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	// Complete one quest first.
	h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "connect-wallet",
	}))

	// Sync including the same quest + a new one.
	resp, err := h.svc.SyncQuests(ctx, connect.NewRequest(&membav1.SyncQuestsRequest{
		AuthToken: token,
		Completions: []*membav1.QuestCompletion{
			{QuestId: "connect-wallet", CompletedAt: "2026-03-15T10:00:00Z"},
			{QuestId: "use-cmdk", CompletedAt: "2026-03-15T11:00:00Z"},
		},
	}))
	if err != nil {
		t.Fatal("SyncQuests:", err)
	}
	if resp.Msg.State.TotalXp != 20 { // 10 + 10
		t.Fatalf("expected 20 XP, got %d", resp.Msg.State.TotalXp)
	}
	if len(resp.Msg.State.Completed) != 2 {
		t.Fatalf("expected 2 completions, got %d", len(resp.Msg.State.Completed))
	}
}

func TestSyncQuests_Unauthenticated(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	_, err := h.svc.SyncQuests(ctx, connect.NewRequest(&membav1.SyncQuestsRequest{
		AuthToken: nil,
		Completions: []*membav1.QuestCompletion{
			{QuestId: "connect-wallet"},
		},
	}))
	if err == nil {
		t.Fatal("expected error for nil token")
	}
}

func TestCompleteQuest_MultipleQuests_XPAccumulation(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	quests := []struct {
		id       string
		totalXP  uint32
	}{
		{"connect-wallet", 10},
		{"visit-5-pages", 20},
		{"browse-proposals", 35},
		{"view-profile", 45},
		{"use-cmdk", 55},
		{"switch-network", 70},
		{"directory-tabs", 85},
		{"submit-feedback", 105},
		{"view-validator", 115},
		{"share-link", 125},
	}

	for _, q := range quests {
		resp, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
			AuthToken: token, QuestId: q.id,
		}))
		if err != nil {
			t.Fatalf("CompleteQuest(%s): %v", q.id, err)
		}
		if resp.Msg.State.TotalXp != q.totalXP {
			t.Fatalf("after %s: expected %d XP, got %d", q.id, q.totalXP, resp.Msg.State.TotalXp)
		}
	}
}

func TestGetUserQuests_IsolatedPerUser(t *testing.T) {
	h := setup(t)
	ctx := context.Background()

	// Alice completes a quest.
	aliceToken := h.makeToken(t, "g1alice")
	h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: aliceToken, QuestId: "connect-wallet",
	}))

	// Bob has no completions.
	resp, err := h.svc.GetUserQuests(ctx, connect.NewRequest(&membav1.GetUserQuestsRequest{
		Address: "g1bob",
	}))
	if err != nil {
		t.Fatal("GetUserQuests (bob):", err)
	}
	if resp.Msg.State.TotalXp != 0 {
		t.Fatalf("bob should have 0 XP, got %d", resp.Msg.State.TotalXp)
	}
}
