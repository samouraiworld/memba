package service

import (
	"context"
	"database/sql"
	"sync"
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

// ── GetUserQuests claim-status visibility ───────────────────
//
// The user must be able to SEE the state of their self-report claims (there is
// no user-facing read otherwise — ListPendingClaims is admin-only). GetUserQuests
// exposes status-only rows: quest_id + lifecycle, never the proof contents.

func (h *testHarness) getUserQuests(t *testing.T, address string) *membav1.GetUserQuestsResponse {
	t.Helper()
	resp, err := h.svc.GetUserQuests(context.Background(), connect.NewRequest(&membav1.GetUserQuestsRequest{
		Address: address,
	}))
	if err != nil {
		t.Fatal("GetUserQuests:", err)
	}
	return resp.Msg
}

func findClaimStatus(resp *membav1.GetUserQuestsResponse, questID string) *membav1.QuestClaimStatus {
	for _, cs := range resp.ClaimStatuses {
		if cs.QuestId == questID {
			return cs
		}
	}
	return nil
}

func TestGetUserQuests_NoClaims_EmptyStatuses(t *testing.T) {
	h := setup(t)

	resp := h.getUserQuests(t, "g1alice")
	if len(resp.ClaimStatuses) != 0 {
		t.Fatalf("expected no claim statuses, got %d", len(resp.ClaimStatuses))
	}
}

func TestGetUserQuests_PendingClaim_Visible(t *testing.T) {
	h := setup(t)
	user := h.makeToken(t, "g1alice")

	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/1", "secret proof text")

	resp := h.getUserQuests(t, "g1alice")
	cs := findClaimStatus(resp, "fix-upstream-bug")
	if cs == nil {
		t.Fatal("expected a claim status for fix-upstream-bug")
	}
	if cs.Status != "pending" {
		t.Fatalf("expected pending, got %q", cs.Status)
	}
	if cs.CreatedAt == "" {
		t.Fatal("expected created_at to be set")
	}
	if cs.ReviewedAt != "" {
		t.Fatalf("expected empty reviewed_at while pending, got %q", cs.ReviewedAt)
	}
}

func TestGetUserQuests_RejectedClaim_Visible(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", "g1admin")
	h := setup(t)
	user := h.makeToken(t, "g1alice")
	admin := h.makeToken(t, "g1admin")

	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/1", "proof")
	claim := h.getClaim(t, "g1alice", "fix-upstream-bug")
	h.reviewClaim(t, admin, claim.id, false)

	resp := h.getUserQuests(t, "g1alice")
	cs := findClaimStatus(resp, "fix-upstream-bug")
	if cs == nil {
		t.Fatal("expected a claim status for fix-upstream-bug")
	}
	if cs.Status != "rejected" {
		t.Fatalf("expected rejected, got %q", cs.Status)
	}
	if cs.ReviewedAt == "" {
		t.Fatal("expected reviewed_at to be set after review")
	}
}

func TestGetUserQuests_ApprovedClaim_Visible(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", "g1admin")
	h := setup(t)
	user := h.makeToken(t, "g1alice")
	admin := h.makeToken(t, "g1admin")

	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/1", "proof")
	claim := h.getClaim(t, "g1alice", "fix-upstream-bug")
	h.reviewClaim(t, admin, claim.id, true)

	resp := h.getUserQuests(t, "g1alice")
	cs := findClaimStatus(resp, "fix-upstream-bug")
	if cs == nil {
		t.Fatal("expected a claim status for fix-upstream-bug")
	}
	if cs.Status != "approved" {
		t.Fatalf("expected approved, got %q", cs.Status)
	}
}

// ── ReviewQuestClaim race safety ────────────────────────────
//
// The review flow used to be SELECT-check-then-unconditional-UPDATE: two
// concurrent reviews could both pass the pending check and the last write
// won — an approve/reject pair could leave granted XP behind a "rejected"
// claim. The UPDATE is guarded (`WHERE status = 'pending'`) and checks
// RowsAffected, so exactly one review can ever win a claim.

func TestReviewQuestClaim_AlreadyReviewed_FailedPrecondition(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", "g1admin")
	h := setup(t)
	user := h.makeToken(t, "g1alice")
	admin := h.makeToken(t, "g1admin")

	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/1", "proof")
	claim := h.getClaim(t, "g1alice", "fix-upstream-bug")
	h.reviewClaim(t, admin, claim.id, true)

	_, err := h.svc.ReviewQuestClaim(context.Background(), connect.NewRequest(&membav1.ReviewQuestClaimRequest{
		AuthToken: admin, ClaimId: claim.id, Approved: false,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("expected FailedPrecondition on second review, got %v", err)
	}

	c := h.getClaim(t, "g1alice", "fix-upstream-bug")
	if c.status != "approved" {
		t.Fatalf("approved claim must stay approved, got %q", c.status)
	}
}

func TestReviewQuestClaim_ConcurrentApproveReject_ExactlyOneWins(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", "g1admin")
	h := setup(t)
	user := h.makeToken(t, "g1alice")
	admin := h.makeToken(t, "g1admin")
	ctx := context.Background()

	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/1", "proof")
	claim := h.getClaim(t, "g1alice", "fix-upstream-bug")

	// Fire an approve and a reject concurrently from a shared start line. The
	// interleaving isn't guaranteed to hit the race window on any single run,
	// but the invariants below must hold on EVERY run.
	start := make(chan struct{})
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i, approved := range []bool{true, false} {
		wg.Go(func() {
			<-start
			_, errs[i] = h.svc.ReviewQuestClaim(ctx, connect.NewRequest(&membav1.ReviewQuestClaimRequest{
				AuthToken: admin, ClaimId: claim.id, Approved: approved,
			}))
		})
	}
	close(start)
	wg.Wait()

	// Exactly one review may win; the loser must see FailedPrecondition.
	winners := 0
	for _, err := range errs {
		if err == nil {
			winners++
		} else if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("loser must fail with FailedPrecondition, got %v", err)
		}
	}
	if winners != 1 {
		t.Fatalf("expected exactly 1 winning review, got %d (errs=%v)", winners, errs)
	}

	// The final row must be consistent with the winner: a completion exists
	// if and only if the surviving status is "approved".
	c := h.getClaim(t, "g1alice", "fix-upstream-bug")
	var completions int
	if err := h.db.QueryRow(
		`SELECT COUNT(*) FROM quest_completions WHERE address = ? AND quest_id = ?`,
		"g1alice", "fix-upstream-bug",
	).Scan(&completions); err != nil {
		t.Fatal("count completions:", err)
	}
	if c.status != "approved" && c.status != "rejected" {
		t.Fatalf("expected approved or rejected, got %q", c.status)
	}
	if (c.status == "approved") != (completions == 1) {
		t.Fatalf("inconsistent state: status=%q completions=%d", c.status, completions)
	}
}

// The submit response must report the claim's REAL status: resubmitting on an
// already-approved claim is a no-op and must not answer "pending" (the UI
// would show a pending banner over an already-granted completion).
func TestSubmitQuestClaim_Response_ReportsActualStatus(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", "g1admin")
	h := setup(t)
	user := h.makeToken(t, "g1alice")
	admin := h.makeToken(t, "g1admin")

	if resp := h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/1", "proof"); resp.Status != "pending" {
		t.Fatalf("fresh claim must report pending, got %q", resp.Status)
	}
	claim := h.getClaim(t, "g1alice", "fix-upstream-bug")
	h.reviewClaim(t, admin, claim.id, true)

	if resp := h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/2", "again"); resp.Status != "approved" {
		t.Fatalf("no-op resubmit on approved claim must report approved, got %q", resp.Status)
	}
}

// Claims belong to their submitter: another address's GetUserQuests must not
// include them, and the proof contents must never appear in the response.
func TestGetUserQuests_ClaimStatuses_ScopedToAddress(t *testing.T) {
	h := setup(t)
	user := h.makeToken(t, "g1alice")

	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/1", "proof")

	resp := h.getUserQuests(t, "g1bob")
	if len(resp.ClaimStatuses) != 0 {
		t.Fatalf("expected no claim statuses for another address, got %d", len(resp.ClaimStatuses))
	}
}
