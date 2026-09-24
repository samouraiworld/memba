package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// newVoucherHarness returns a harness with a bound attestation signer and a
// deterministic on-chain verifier that accepts every on_chain quest.
func newVoucherHarness(t *testing.T) *testHarness {
	t.Helper()
	h := setup(t)
	signer, err := newBoundTestSigner(testAttestationSeed)
	if err != nil {
		t.Fatal(err)
	}
	h.svc.SetAttestationSigner(signer)
	h.stubChainVerify(true)
	return h
}

// servedVoucherQuests returns the quest ids GetAttestationVouchers serves for addr.
func servedVoucherQuests(t *testing.T, h *testHarness, addr string) map[string]bool {
	t.Helper()
	resp, err := h.svc.GetAttestationVouchers(context.Background(), connect.NewRequest(&membav1.GetAttestationVouchersRequest{Address: addr}))
	if err != nil {
		t.Fatal("GetAttestationVouchers:", err)
	}
	out := map[string]bool{}
	for _, v := range resp.Msg.Vouchers {
		out[v.QuestId] = true
	}
	return out
}

func storedVoucherCount(t *testing.T, h *testHarness, addr, questID string) int {
	t.Helper()
	return countRows(t, h, `SELECT COUNT(*) FROM attestation_vouchers_bound WHERE address = ? AND quest_id = ?`, addr, questID)
}

// One rule decides which completions are verified, for both VerifiedXp and
// attestation vouchers.
func TestCompletionVerified_Classification(t *testing.T) {
	cases := []struct {
		quest    string
		approved bool
		want     bool
	}{
		{"register-username", false, true},  // on_chain
		{"connect-wallet", false, false},    // off_chain
		{"first-100-users", false, false},   // off_chain, 50 XP
		{"season-1-complete", false, false}, // off_chain, 100 XP
		{"earn-500-xp", false, false},       // server-derived meta, off_chain
		{"view-profile", false, false},      // legacy id, no verification class
		{"directory-tabs", false, false},    // legacy id, no verification class
		{"gnodaokit-extension", false, false},
		{"follow-twitter", false, false}, // social
		{"bug-hunter", false, false},     // self_report, not approved
		{"bug-hunter", true, true},       // self_report, admin-approved
		{"not-a-quest", true, false},
	}
	for _, tc := range cases {
		if got := completionVerified(tc.quest, tc.approved); got != tc.want {
			t.Errorf("completionVerified(%q, approved=%v) = %v, want %v", tc.quest, tc.approved, got, tc.want)
		}
	}
}

// Bug A: off_chain and legacy quests are self-claimed, so CompleteQuest must
// store them (they still count toward TotalXp) but never sign a voucher.
func TestCompleteQuest_UnverifiedQuestGetsNoVoucher(t *testing.T) {
	for _, quest := range []string{"connect-wallet", "first-100-users", "season-1-complete", "view-profile", "directory-tabs"} {
		t.Run(quest, func(t *testing.T) {
			h := newVoucherHarness(t)
			token := h.makeToken(t, "g1alice")
			if _, err := h.svc.CompleteQuest(context.Background(), connect.NewRequest(&membav1.CompleteQuestRequest{
				AuthToken: token, QuestId: quest,
			})); err != nil {
				t.Fatal("CompleteQuest:", err)
			}
			if n := countRows(t, h, `SELECT COUNT(*) FROM quest_completions WHERE address = 'g1alice' AND quest_id = ?`, quest); n != 1 {
				t.Fatalf("completion must still be stored, got %d", n)
			}
			if n := storedVoucherCount(t, h, "g1alice", quest); n != 0 {
				t.Fatalf("no voucher may be signed for unverified %q, got %d", quest, n)
			}
			if len(servedVoucherQuests(t, h, "g1alice")) != 0 {
				t.Fatal("no voucher may be served for an unverified quest")
			}
		})
	}
}

// Bug A via sync: the verified on_chain entry gets a voucher, the off_chain
// entry in the same batch does not.
func TestSyncQuests_OnlyVerifiedQuestsGetVouchers(t *testing.T) {
	h := newVoucherHarness(t)
	token := h.makeToken(t, "g1dave")
	if _, err := h.svc.SyncQuests(context.Background(), connect.NewRequest(&membav1.SyncQuestsRequest{
		AuthToken: token,
		Completions: []*membav1.QuestCompletion{
			{QuestId: "use-cmdk", CompletedAt: "2026-06-27T00:00:00Z"},          // off_chain
			{QuestId: "first-100-users", CompletedAt: "2026-06-27T00:00:00Z"},   // off_chain
			{QuestId: "register-username", CompletedAt: "2026-06-27T00:00:00Z"}, // on_chain
		},
	})); err != nil {
		t.Fatal("SyncQuests:", err)
	}
	got := servedVoucherQuests(t, h, "g1dave")
	if len(got) != 1 || !got["register-username"] {
		t.Fatalf("only the on_chain quest may get a voucher, got %v", got)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM attestation_vouchers_bound WHERE address = 'g1dave'`); n != 1 {
		t.Fatalf("want exactly 1 stored voucher, got %d", n)
	}
}

// Defence in depth: issueAttestationVoucher itself refuses a stored completion
// that is not verified, whoever the caller is.
func TestIssueAttestationVoucher_RefusesUnverifiedStoredCompletion(t *testing.T) {
	h := newVoucherHarness(t)
	ctx := context.Background()
	const addr = "g1erin"
	for _, quest := range []string{"connect-wallet", "view-profile", "follow-twitter", "bug-hunter"} {
		if _, err := h.db.ExecContext(ctx,
			`INSERT INTO quest_completions (address, quest_id, completed_at) VALUES (?, ?, '2026-09-01T00:00:00Z')`, addr, quest,
		); err != nil {
			t.Fatal(err)
		}
		h.svc.issueAttestationVoucher(ctx, addr, quest)
		if n := storedVoucherCount(t, h, addr, quest); n != 0 {
			t.Fatalf("voucher signed for unverified stored completion %q", quest)
		}
	}
	// A pending (not approved) self_report claim does not make it verified.
	if _, err := h.db.ExecContext(ctx,
		`INSERT INTO quest_claims (address, quest_id, proof_url, proof_text, status) VALUES (?, 'bug-hunter', 'https://x', '', 'pending')`, addr,
	); err != nil {
		t.Fatal(err)
	}
	h.svc.issueAttestationVoucher(ctx, addr, "bug-hunter")
	if n := storedVoucherCount(t, h, addr, "bug-hunter"); n != 0 {
		t.Fatal("a pending claim must not be attested")
	}
}

// Bug B: an admin-approved self_report claim is verified and must be attested.
func TestReviewQuestClaim_ApprovalIssuesVoucher(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", "g1admin")
	h := newVoucherHarness(t)
	user := h.makeToken(t, "g1alice")
	admin := h.makeToken(t, "g1admin")

	h.submitClaim(t, user, "bug-hunter", "https://example.com/issue/1", "found it")
	if n := storedVoucherCount(t, h, "g1alice", "bug-hunter"); n != 0 {
		t.Fatal("a submitted claim must not be attested before review")
	}
	h.reviewClaim(t, admin, h.getClaim(t, "g1alice", "bug-hunter").id, true)

	if n := storedVoucherCount(t, h, "g1alice", "bug-hunter"); n != 1 {
		t.Fatalf("approval must sign exactly one voucher, got %d", n)
	}
	if got := servedVoucherQuests(t, h, "g1alice"); !got["bug-hunter"] {
		t.Fatalf("approved quest voucher must be served, got %v", got)
	}
}

// A rejected claim stores no completion and gets no voucher.
func TestReviewQuestClaim_RejectionIssuesNoVoucher(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", "g1admin")
	h := newVoucherHarness(t)
	user := h.makeToken(t, "g1bob")
	admin := h.makeToken(t, "g1admin")

	h.submitClaim(t, user, "bug-hunter", "https://example.com/issue/2", "")
	h.reviewClaim(t, admin, h.getClaim(t, "g1bob", "bug-hunter").id, false)

	if n := countRows(t, h, `SELECT COUNT(*) FROM attestation_vouchers_bound WHERE address = 'g1bob'`); n != 0 {
		t.Fatalf("rejection must not sign a voucher, got %d", n)
	}
}

// Vouchers signed for unverified quests before this rule existed stay in the
// table but are no longer served; verified ones still are.
func TestGetAttestationVouchers_FiltersStoredUnverifiedVouchers(t *testing.T) {
	h := newVoucherHarness(t)
	ctx := context.Background()
	const addr = "g1grace"
	signer := h.svc.attSigner

	// Pre-existing vouchers signed by the CURRENT key on the CURRENT chain, as
	// the pre-fix code would have stored them.
	stale := []string{"connect-wallet", "first-100-users", "season-1-complete", "view-profile", "bug-hunter"}
	for _, quest := range stale {
		v, err := signer.IssueVoucher(addr, quest, int(validQuests[quest]))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := h.db.ExecContext(ctx,
			`INSERT INTO attestation_vouchers_bound (chain_id, signer_pubkey, address, quest_id, xp, nonce, sig_hex) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			signer.ChainID(), signer.PublicKeyHex(), addr, quest, v.XP, v.Nonce, v.SigHex,
		); err != nil {
			t.Fatal(err)
		}
	}

	// A verified on_chain completion issues a fresh voucher through the normal path.
	token := h.makeToken(t, addr)
	if _, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "register-username",
	})); err != nil {
		t.Fatal(err)
	}

	got := servedVoucherQuests(t, h, addr)
	if len(got) != 1 || !got["register-username"] {
		t.Fatalf("only the verified voucher may be served, got %v", got)
	}
	// Rows are filtered, not deleted.
	if n := countRows(t, h, `SELECT COUNT(*) FROM attestation_vouchers_bound WHERE address = ?`, addr); n != len(stale)+1 {
		t.Fatalf("stored vouchers must be kept, got %d rows", n)
	}

	// Once the self_report claim is approved, its stored voucher is served again.
	if _, err := h.db.ExecContext(ctx,
		`INSERT INTO quest_claims (address, quest_id, proof_url, proof_text, status) VALUES (?, 'bug-hunter', 'https://x', '', 'approved')`, addr,
	); err != nil {
		t.Fatal(err)
	}
	got = servedVoucherQuests(t, h, addr)
	if len(got) != 2 || !got["register-username"] || !got["bug-hunter"] {
		t.Fatalf("approved self_report voucher must be served, got %v", got)
	}
}
