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

// BE-4: verified_xp counts only proof-backed completions — on_chain quests
// (server re-verified at grant time) and self_report quests with an
// admin-approved claim. off_chain XP and unapproved self_report rows must NOT
// count: verified_xp feeds the 350-XP candidature gate.
func TestGetUserQuests_VerifiedXP(t *testing.T) {
	h := setup(t)
	t.Setenv("QUEST_ADMIN_ADDRESSES", "g1admin")
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	getState := func(t *testing.T) *membav1.UserQuestState {
		t.Helper()
		resp, err := h.svc.GetUserQuests(ctx, connect.NewRequest(&membav1.GetUserQuestsRequest{Address: "g1alice"}))
		if err != nil {
			t.Fatal("GetUserQuests:", err)
		}
		return resp.Msg.State
	}

	// off_chain (connect-wallet, 10 XP): counts to total only.
	if _, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "connect-wallet",
	})); err != nil {
		t.Fatal("CompleteQuest off_chain:", err)
	}
	if s := getState(t); s.TotalXp != 10 || s.VerifiedXp != 0 {
		t.Fatalf("after off_chain: want total=10 verified=0, got total=%d verified=%d", s.TotalXp, s.VerifiedXp)
	}

	// on_chain (first-transaction, 15 XP), verifier passes: counts to both.
	h.svc.verifyOnChainQuest = func(_ context.Context, _, _, _ string) (bool, error) { return true, nil }
	if _, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "first-transaction",
	})); err != nil {
		t.Fatal("CompleteQuest on_chain:", err)
	}
	if s := getState(t); s.TotalXp != 25 || s.VerifiedXp != 15 {
		t.Fatalf("after on_chain: want total=25 verified=15, got total=%d verified=%d", s.TotalXp, s.VerifiedXp)
	}

	// self_report (write-10-tests, 30 XP) with an admin-APPROVED claim: counts to both.
	if _, err := h.svc.SubmitQuestClaim(ctx, connect.NewRequest(&membav1.SubmitQuestClaimRequest{
		AuthToken: token, QuestId: "write-10-tests", ProofText: "repo link with 10 tests",
	})); err != nil {
		t.Fatal("SubmitQuestClaim:", err)
	}
	var claimID int64
	if err := h.db.QueryRow(`SELECT id FROM quest_claims WHERE address='g1alice' AND quest_id='write-10-tests'`).Scan(&claimID); err != nil {
		t.Fatal("read claim id:", err)
	}
	adminToken := h.makeToken(t, "g1admin")
	if _, err := h.svc.ReviewQuestClaim(ctx, connect.NewRequest(&membav1.ReviewQuestClaimRequest{
		AuthToken: adminToken, ClaimId: claimID, Approved: true,
	})); err != nil {
		t.Fatal("ReviewQuestClaim:", err)
	}
	if s := getState(t); s.TotalXp != 55 || s.VerifiedXp != 45 {
		t.Fatalf("after approved self_report: want total=55 verified=45, got total=%d verified=%d", s.TotalXp, s.VerifiedXp)
	}

	// Legacy/dirty self_report completion row WITHOUT an approved claim
	// (predates the SyncQuests gate): counts to total, NOT to verified.
	if _, err := h.db.Exec(
		`INSERT INTO quest_completions (address, quest_id, completed_at, proof) VALUES ('g1alice', 'audit-realm', '2026-01-01T00:00:00Z', '')`,
	); err != nil {
		t.Fatal("seed legacy row:", err)
	}
	if s := getState(t); s.TotalXp != 95 || s.VerifiedXp != 45 {
		t.Fatalf("after unapproved self_report row: want total=95 verified=45, got total=%d verified=%d", s.TotalXp, s.VerifiedXp)
	}

	// Server-derived meta-quests (grantDerivedMetaQuests inserts rows directly,
	// bypassing verifyQuestCompletable) are off_chain-classed: their XP must
	// never count toward verified_xp.
	if _, err := h.db.Exec(
		`INSERT INTO quest_completions (address, quest_id, completed_at, proof) VALUES ('g1alice', 'earn-500-xp', '2026-01-01T00:00:00Z', '')`,
	); err != nil {
		t.Fatal("seed derived meta-quest row:", err)
	}
	if s := getState(t); s.TotalXp != 120 || s.VerifiedXp != 45 {
		t.Fatalf("after derived meta-quest row: want total=120 verified=45, got total=%d verified=%d", s.TotalXp, s.VerifiedXp)
	}
}

func TestCompleteQuest_Idempotent(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	// Complete twice — should not double XP.
	_, _ = h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
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
	_, _ = h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "connect-wallet",
	}))
	_, _ = h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
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
	_, _ = h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
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
	_, _ = h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
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
