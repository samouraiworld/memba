package service

import (
	"context"
	"database/sql"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// questClaim mirrors a quest_claims row for assertions.
type questClaim struct {
	id         int64
	proofURL   string
	proofText  string
	status     string
	reviewedBy sql.NullString
	reviewedAt sql.NullString
}

func (h *testHarness) getClaim(t *testing.T, address, questID string) questClaim {
	t.Helper()
	var c questClaim
	err := h.db.QueryRow(
		`SELECT id, proof_url, proof_text, status, reviewed_by, reviewed_at
		 FROM quest_claims WHERE address = ? AND quest_id = ?`,
		address, questID,
	).Scan(&c.id, &c.proofURL, &c.proofText, &c.status, &c.reviewedBy, &c.reviewedAt)
	if err != nil {
		t.Fatal("load claim:", err)
	}
	return c
}

func (h *testHarness) countClaims(t *testing.T, address, questID string) int {
	t.Helper()
	var n int
	if err := h.db.QueryRow(
		`SELECT COUNT(*) FROM quest_claims WHERE address = ? AND quest_id = ?`,
		address, questID,
	).Scan(&n); err != nil {
		t.Fatal("count claims:", err)
	}
	return n
}

func (h *testHarness) submitClaim(t *testing.T, token *membav1.Token, questID, proofURL, proofText string) *membav1.SubmitQuestClaimResponse {
	t.Helper()
	resp, err := h.svc.SubmitQuestClaim(context.Background(), connect.NewRequest(&membav1.SubmitQuestClaimRequest{
		AuthToken: token, QuestId: questID, ProofUrl: proofURL, ProofText: proofText,
	}))
	if err != nil {
		t.Fatal("SubmitQuestClaim:", err)
	}
	return resp.Msg
}

func (h *testHarness) reviewClaim(t *testing.T, adminToken *membav1.Token, claimID int64, approved bool) {
	t.Helper()
	if _, err := h.svc.ReviewQuestClaim(context.Background(), connect.NewRequest(&membav1.ReviewQuestClaimRequest{
		AuthToken: adminToken, ClaimId: claimID, Approved: approved,
	})); err != nil {
		t.Fatal("ReviewQuestClaim:", err)
	}
}

// A rejected claim must not be a dead end: resubmitting reopens it as a fresh
// pending claim carrying the new proof, with the previous review cleared.
// (Previously INSERT OR IGNORE + UNIQUE(address, quest_id) made a rejection
// permanent — the wrongly-rejected user could never re-reach the XP.)
func TestSubmitQuestClaim_ResubmitAfterReject_ReopensPending(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", "g1admin")
	h := setup(t)
	user := h.makeToken(t, "g1alice")
	admin := h.makeToken(t, "g1admin")

	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/1", "first attempt")
	first := h.getClaim(t, "g1alice", "fix-upstream-bug")
	h.reviewClaim(t, admin, first.id, false)

	resp := h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/2", "better proof")
	if resp.Status != "pending" {
		t.Fatalf("expected status pending after resubmit, got %q", resp.Status)
	}

	c := h.getClaim(t, "g1alice", "fix-upstream-bug")
	if c.status != "pending" {
		t.Fatalf("expected claim reopened as pending, got %q", c.status)
	}
	if c.proofURL != "https://example.com/pr/2" || c.proofText != "better proof" {
		t.Fatalf("expected new proof on reopened claim, got url=%q text=%q", c.proofURL, c.proofText)
	}
	if c.reviewedBy.Valid || c.reviewedAt.Valid {
		t.Fatalf("expected reviewed_by/reviewed_at cleared, got %v / %v", c.reviewedBy, c.reviewedAt)
	}
	if n := h.countClaims(t, "g1alice", "fix-upstream-bug"); n != 1 {
		t.Fatalf("expected exactly 1 claim row, got %d", n)
	}
}

// Resubmitting while a claim is still pending is an idempotent no-op: the
// original proof is kept for the reviewer, no duplicate row appears.
func TestSubmitQuestClaim_ResubmitWhilePending_NoOp(t *testing.T) {
	h := setup(t)
	user := h.makeToken(t, "g1alice")

	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/1", "original")
	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/2", "overwrite attempt")

	c := h.getClaim(t, "g1alice", "fix-upstream-bug")
	if c.status != "pending" {
		t.Fatalf("expected pending, got %q", c.status)
	}
	if c.proofURL != "https://example.com/pr/1" || c.proofText != "original" {
		t.Fatalf("pending claim must keep original proof, got url=%q text=%q", c.proofURL, c.proofText)
	}
	if n := h.countClaims(t, "g1alice", "fix-upstream-bug"); n != 1 {
		t.Fatalf("expected exactly 1 claim row, got %d", n)
	}
}

// Resubmitting after approval must not reopen the claim (no double review, no
// way to disturb an already-granted completion).
func TestSubmitQuestClaim_ResubmitAfterApprove_NoOp(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", "g1admin")
	h := setup(t)
	user := h.makeToken(t, "g1alice")
	admin := h.makeToken(t, "g1admin")

	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/1", "proof")
	first := h.getClaim(t, "g1alice", "fix-upstream-bug")
	h.reviewClaim(t, admin, first.id, true)

	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/2", "again")

	c := h.getClaim(t, "g1alice", "fix-upstream-bug")
	if c.status != "approved" {
		t.Fatalf("approved claim must stay approved, got %q", c.status)
	}
	if c.proofURL != "https://example.com/pr/1" {
		t.Fatalf("approved claim must keep original proof, got %q", c.proofURL)
	}
	if !c.reviewedBy.Valid || c.reviewedBy.String != "g1admin" {
		t.Fatalf("approved claim must keep reviewer, got %v", c.reviewedBy)
	}
}

// Reopening a rejected claim grants nothing by itself: XP stays 0 until an
// admin re-approves, and re-approval then completes the quest normally.
func TestSubmitQuestClaim_ResubmitAfterReject_NoXPUntilReapproval(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", "g1admin")
	h := setup(t)
	user := h.makeToken(t, "g1alice")
	admin := h.makeToken(t, "g1admin")
	ctx := context.Background()

	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/1", "first")
	first := h.getClaim(t, "g1alice", "fix-upstream-bug")
	h.reviewClaim(t, admin, first.id, false)
	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/2", "second")

	state, err := h.svc.loadUserQuestState(ctx, "g1alice")
	if err != nil {
		t.Fatal("loadUserQuestState:", err)
	}
	if state.TotalXp != 0 {
		t.Fatalf("resubmission alone must grant no XP, got %d", state.TotalXp)
	}

	reopened := h.getClaim(t, "g1alice", "fix-upstream-bug")
	h.reviewClaim(t, admin, reopened.id, true)

	state, err = h.svc.loadUserQuestState(ctx, "g1alice")
	if err != nil {
		t.Fatal("loadUserQuestState:", err)
	}
	if state.TotalXp == 0 {
		t.Fatal("expected XP granted after re-approval of reopened claim")
	}
}
