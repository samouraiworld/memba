package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// stubChainVerify installs a deterministic on-chain verifier so these tests
// never hit the network. Returns whatever `ok` says for any on_chain quest.
func (h *testHarness) stubChainVerify(ok bool) {
	h.svc.verifyOnChainQuest = func(_ context.Context, _, _ string) (bool, error) {
		return ok, nil
	}
}

// P0-1: self_report quests must NOT be grantable via CompleteQuest — they
// require admin-reviewed proof (SubmitQuestClaim). Otherwise any authenticated
// user could fabricate the 100-XP "fix-upstream-bug" via a direct RPC.
func TestCompleteQuest_RejectsSelfReport(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "fix-upstream-bug",
	}))
	if err == nil {
		t.Fatal("expected self_report quest to be rejected by CompleteQuest")
	}

	// XP must remain 0 — nothing was granted.
	resp, _ := h.svc.GetUserQuests(ctx, connect.NewRequest(&membav1.GetUserQuestsRequest{Address: "g1alice"}))
	if resp.Msg.State.TotalXp != 0 {
		t.Fatalf("expected 0 XP after rejected self_report, got %d", resp.Msg.State.TotalXp)
	}
}

// social quests likewise require proof and are not self-completable.
func TestCompleteQuest_RejectsSocial(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "follow-twitter",
	}))
	if err == nil {
		t.Fatal("expected social quest to be rejected by CompleteQuest")
	}
}

// on_chain quests are granted only when the server-side verifier passes.
func TestCompleteQuest_OnChain_VerifiedViaStub(t *testing.T) {
	h := setup(t)
	h.stubChainVerify(true)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	resp, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "register-username",
	}))
	if err != nil {
		t.Fatal("CompleteQuest(register-username) with passing verifier:", err)
	}
	if resp.Msg.State.TotalXp != 20 {
		t.Fatalf("expected 20 XP, got %d", resp.Msg.State.TotalXp)
	}
}

// on_chain quests are rejected when the verifier says the condition isn't met.
func TestCompleteQuest_OnChain_RejectedWhenNotMet(t *testing.T) {
	h := setup(t)
	h.stubChainVerify(false)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "register-username",
	}))
	if err == nil {
		t.Fatal("expected on_chain quest to be rejected when verifier returns false")
	}
}

// on_chain quests with no registered server verifier are NOT grantable — they
// stay "coming soon" until a verifier lands. Uses the real default verifier
// (no stub) with an unregistered deploy quest, which returns false WITHOUT a
// network call (default switch falls through to false).
func TestCompleteQuest_OnChain_NoVerifier_Rejected(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "deploy-hello-pkg",
	}))
	if err == nil {
		t.Fatal("expected on_chain quest without a server verifier to be rejected")
	}
}

// off_chain quests remain low-trust accepts (documented trade-off, low XP).
func TestCompleteQuest_OffChainAccepted(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	resp, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "use-cmdk",
	}))
	if err != nil {
		t.Fatal("CompleteQuest(use-cmdk):", err)
	}
	if resp.Msg.State.TotalXp != 10 {
		t.Fatalf("expected 10 XP, got %d", resp.Msg.State.TotalXp)
	}
}

// SyncQuests applies the same gate: unverifiable/self_report entries are
// skipped, valid off_chain ones imported.
func TestSyncQuests_SkipsUnverifiable(t *testing.T) {
	h := setup(t)
	h.stubChainVerify(false) // on_chain entries will be skipped
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	resp, err := h.svc.SyncQuests(ctx, connect.NewRequest(&membav1.SyncQuestsRequest{
		AuthToken: token,
		Completions: []*membav1.QuestCompletion{
			{QuestId: "connect-wallet"},     // off_chain -> imported
			{QuestId: "fix-upstream-bug"},   // self_report -> skipped
			{QuestId: "register-username"},  // on_chain, verifier false -> skipped
		},
	}))
	if err != nil {
		t.Fatal("SyncQuests:", err)
	}
	if resp.Msg.State.TotalXp != 10 {
		t.Fatalf("expected 10 XP (only connect-wallet), got %d", resp.Msg.State.TotalXp)
	}
	if len(resp.Msg.State.Completed) != 1 {
		t.Fatalf("expected 1 completion, got %d", len(resp.Msg.State.Completed))
	}
}
