package service

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/attestation"
)

// testAttestationSeed = 0x01..0x20 (same vector the realm + signer parity tests use).
const testAttestationSeed = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"

// TestCompleteQuest_IssuesAttestationVoucher is the A.3b end-to-end backend check:
// with a signer configured, completing a quest issues a voucher that
// GetAttestationVouchers returns AND that verifies on-chain (ed25519 over the
// canonical message) — i.e. the realm would accept it.
func TestCompleteQuest_IssuesAttestationVoucher(t *testing.T) {
	h := setup(t)
	signer, err := attestation.NewFromSeedHex(testAttestationSeed)
	if err != nil {
		t.Fatal(err)
	}
	h.svc.SetAttestationSigner(signer)

	token := h.makeToken(t, "g1alice")
	if _, err := h.svc.CompleteQuest(context.Background(), connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "connect-wallet", // off_chain, 10 XP, no network
	})); err != nil {
		t.Fatal("CompleteQuest:", err)
	}

	resp, err := h.svc.GetAttestationVouchers(context.Background(), connect.NewRequest(&membav1.GetAttestationVouchersRequest{
		Address: "g1alice",
	}))
	if err != nil {
		t.Fatal("GetAttestationVouchers:", err)
	}
	if resp.Msg.RealmPath != attestation.RealmPath {
		t.Fatalf("realm path = %q, want %q", resp.Msg.RealmPath, attestation.RealmPath)
	}
	if resp.Msg.SignerPubkeyHex != signer.PublicKeyHex() {
		t.Fatalf("signer pubkey mismatch")
	}
	if len(resp.Msg.Vouchers) != 1 {
		t.Fatalf("expected 1 voucher, got %d", len(resp.Msg.Vouchers))
	}
	v := resp.Msg.Vouchers[0]
	if v.QuestId != "connect-wallet" || v.Xp != 10 {
		t.Fatalf("unexpected voucher: %+v", v)
	}

	// The crux: the issued voucher must verify exactly as the on-chain realm
	// verifies it — ed25519 over canonical "address|questId|xp|nonce".
	pub, _ := hex.DecodeString(resp.Msg.SignerPubkeyHex)
	sig, err := hex.DecodeString(v.SigHex)
	if err != nil {
		t.Fatal("sig not hex:", err)
	}
	msg := attestation.Canonical("g1alice", v.QuestId, int(v.Xp), v.Nonce)
	if !ed25519.Verify(pub, msg, sig) {
		t.Fatal("backend-issued voucher must verify on-chain (ed25519 over canonical)")
	}
}

// Idempotent: re-completing the same quest keeps the original voucher (stable
// nonce), never a duplicate or a re-sign.
func TestCompleteQuest_VoucherIsIdempotent(t *testing.T) {
	h := setup(t)
	signer, _ := attestation.NewFromSeedHex(testAttestationSeed)
	h.svc.SetAttestationSigner(signer)
	token := h.makeToken(t, "g1bob")

	complete := func() {
		_, _ = h.svc.CompleteQuest(context.Background(), connect.NewRequest(&membav1.CompleteQuestRequest{
			AuthToken: token, QuestId: "connect-wallet",
		}))
	}
	complete()
	first, _ := h.svc.GetAttestationVouchers(context.Background(), connect.NewRequest(&membav1.GetAttestationVouchersRequest{Address: "g1bob"}))
	complete()
	second, _ := h.svc.GetAttestationVouchers(context.Background(), connect.NewRequest(&membav1.GetAttestationVouchersRequest{Address: "g1bob"}))

	if len(first.Msg.Vouchers) != 1 || len(second.Msg.Vouchers) != 1 {
		t.Fatalf("expected exactly 1 voucher both times, got %d then %d", len(first.Msg.Vouchers), len(second.Msg.Vouchers))
	}
	if first.Msg.Vouchers[0].Nonce != second.Msg.Vouchers[0].Nonce {
		t.Fatal("voucher nonce must stay stable across re-completion (no re-issue)")
	}
}

// SyncQuests must also issue vouchers — many off-chain quest UI triggers reach
// the backend only via sync (not CompleteQuest), so without this they'd never
// attest. This also backfills completions recorded before attestation was on.
func TestSyncQuests_IssuesAttestationVouchers(t *testing.T) {
	h := setup(t)
	signer, _ := attestation.NewFromSeedHex(testAttestationSeed)
	h.svc.SetAttestationSigner(signer)
	token := h.makeToken(t, "g1dave")

	if _, err := h.svc.SyncQuests(context.Background(), connect.NewRequest(&membav1.SyncQuestsRequest{
		AuthToken: token,
		Completions: []*membav1.QuestCompletion{
			{QuestId: "use-cmdk", CompletedAt: "2026-06-27T00:00:00Z"}, // off_chain, low-trust accept
		},
	})); err != nil {
		t.Fatal("SyncQuests:", err)
	}

	resp, err := h.svc.GetAttestationVouchers(context.Background(), connect.NewRequest(&membav1.GetAttestationVouchersRequest{Address: "g1dave"}))
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Msg.Vouchers) != 1 || resp.Msg.Vouchers[0].QuestId != "use-cmdk" {
		t.Fatalf("sync should issue a voucher for the off-chain quest, got %+v", resp.Msg.Vouchers)
	}
}

// Disabled by default (no signer): no voucher issued, and the response carries no
// realm/signer — so the frontend cleanly shows nothing.
func TestAttestation_DisabledWhenNoSigner(t *testing.T) {
	h := setup(t) // no SetAttestationSigner
	token := h.makeToken(t, "g1carol")
	if _, err := h.svc.CompleteQuest(context.Background(), connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "connect-wallet",
	})); err != nil {
		t.Fatal(err)
	}
	resp, err := h.svc.GetAttestationVouchers(context.Background(), connect.NewRequest(&membav1.GetAttestationVouchersRequest{Address: "g1carol"}))
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Msg.Vouchers) != 0 || resp.Msg.RealmPath != "" || resp.Msg.SignerPubkeyHex != "" {
		t.Fatalf("attestation must be inert when disabled, got %+v", resp.Msg)
	}
}

// deployTestAddr is a well-formed address for the deploy-quest binding tests.
const deployTestAddr = "g1abcdefghijklmnopqrstuvwxyz0123456789ab"

// countRows returns COUNT(*) for a query, failing the test on error.
func countRows(t *testing.T, h *testHarness, query string, args ...any) int {
	t.Helper()
	var n int
	if err := h.db.QueryRowContext(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// Two concurrent CompleteQuest calls for DIFFERENT deploy quests with the SAME
// proof can both pass the (non-transactional) distinct-proof precheck; the DB
// unique index then keeps only one completion. The losing call must fail and
// must not leave a voucher or badge mint behind for a completion that was never
// stored. The stub runs the real precheck and then holds both calls at a
// barrier, so both pass the precheck before either inserts — deterministic.
func TestCompleteQuest_ConflictingDeployProofGetsNoVoucher(t *testing.T) {
	h := setup(t)
	signer, err := attestation.NewFromSeedHex(testAttestationSeed)
	if err != nil {
		t.Fatal(err)
	}
	h.svc.SetAttestationSigner(signer)
	token := h.makeToken(t, deployTestAddr)
	const proof = "gno.land/r/alice/foo"

	var entered sync.WaitGroup
	entered.Add(2)
	release := make(chan struct{})
	h.svc.verifyOnChainQuest = func(ctx context.Context, addr, questID, p string) (bool, error) {
		used, err := h.svc.proofUsedForOtherDeploy(ctx, addr, questID, p)
		entered.Done()
		<-release
		if err != nil {
			return false, err
		}
		return !used, nil
	}

	quests := []string{"deploy-hello-pkg", "deploy-counter-pkg"}
	errs := make([]error, len(quests))
	var done sync.WaitGroup
	for i, q := range quests {
		done.Add(1)
		go func() {
			defer done.Done()
			_, errs[i] = h.svc.CompleteQuest(context.Background(), connect.NewRequest(&membav1.CompleteQuestRequest{
				AuthToken: token, QuestId: q, Proof: proof,
			}))
		}()
	}

	allIn := make(chan struct{})
	go func() { entered.Wait(); close(allIn) }()
	select {
	case <-allIn:
	case <-time.After(10 * time.Second):
		close(release)
		t.Fatal("both calls must reach the verifier before either inserts")
	}
	close(release)
	done.Wait()

	okCount, rejected := 0, 0
	for _, e := range errs {
		switch {
		case e == nil:
			okCount++
		case connect.CodeOf(e) == connect.CodeFailedPrecondition:
			rejected++
		default:
			t.Fatalf("unexpected error: %v", e)
		}
	}
	if okCount != 1 || rejected != 1 {
		t.Fatalf("want exactly 1 success and 1 FailedPrecondition, got ok=%d rejected=%d (errs=%v)", okCount, rejected, errs)
	}

	var stored string
	if err := h.db.QueryRow(
		`SELECT quest_id FROM quest_completions WHERE address = ? AND quest_id LIKE 'deploy-%'`, deployTestAddr,
	).Scan(&stored); err != nil {
		t.Fatal("expected exactly one stored deploy completion:", err)
	}

	resp, err := h.svc.GetAttestationVouchers(context.Background(), connect.NewRequest(&membav1.GetAttestationVouchersRequest{Address: deployTestAddr}))
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Msg.Vouchers) != 1 {
		t.Fatalf("want exactly 1 voucher, got %d: %+v", len(resp.Msg.Vouchers), resp.Msg.Vouchers)
	}
	if resp.Msg.Vouchers[0].QuestId != stored {
		t.Fatalf("voucher quest %q must match the stored completion %q", resp.Msg.Vouchers[0].QuestId, stored)
	}

	if n := countRows(t, h, `SELECT COUNT(*) FROM badge_mints WHERE address = ? AND quest_id LIKE 'deploy-%'`, deployTestAddr); n != 1 {
		t.Fatalf("want exactly 1 deploy badge mint, got %d", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM badge_mints WHERE address = ? AND quest_id = ?`, deployTestAddr, stored); n != 1 {
		t.Fatalf("the badge mint must be for the stored completion %q", stored)
	}
}

// Re-submitting the SAME quest with the SAME proof is an idempotent retry: it
// succeeds both times and keeps the single original voucher.
func TestCompleteQuest_IdempotentRetryKeepsVoucher(t *testing.T) {
	h := setup(t)
	signer, err := attestation.NewFromSeedHex(testAttestationSeed)
	if err != nil {
		t.Fatal(err)
	}
	h.svc.SetAttestationSigner(signer)
	h.svc.verifyOnChainQuest = func(ctx context.Context, addr, questID, p string) (bool, error) {
		used, err := h.svc.proofUsedForOtherDeploy(ctx, addr, questID, p)
		return !used, err
	}
	token := h.makeToken(t, deployTestAddr)

	complete := func() {
		t.Helper()
		if _, err := h.svc.CompleteQuest(context.Background(), connect.NewRequest(&membav1.CompleteQuestRequest{
			AuthToken: token, QuestId: "deploy-hello-pkg", Proof: "gno.land/r/alice/foo",
		})); err != nil {
			t.Fatal("idempotent retry must succeed:", err)
		}
	}
	vouchers := func() []*membav1.AttestationVoucher {
		t.Helper()
		resp, err := h.svc.GetAttestationVouchers(context.Background(), connect.NewRequest(&membav1.GetAttestationVouchersRequest{Address: deployTestAddr}))
		if err != nil {
			t.Fatal(err)
		}
		return resp.Msg.Vouchers
	}

	complete()
	first := vouchers()
	complete()
	second := vouchers()

	if len(first) != 1 || len(second) != 1 {
		t.Fatalf("want exactly 1 voucher both times, got %d then %d", len(first), len(second))
	}
	if first[0].QuestId != "deploy-hello-pkg" || first[0].Nonce != second[0].Nonce {
		t.Fatalf("voucher must be for the quest and keep a stable nonce: %+v then %+v", first[0], second[0])
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM badge_mints WHERE address = ?`, deployTestAddr); n != 1 {
		t.Fatalf("want exactly 1 badge mint, got %d", n)
	}
}

// Without a signer, a proof conflict that reaches the insert (the precheck is
// bypassed here to model a lost race sequentially) must still be rejected, must
// not queue a badge mint for the unstored quest, and must not change XP.
func TestCompleteQuest_ConflictNoSignerNoBadge(t *testing.T) {
	h := setup(t) // no SetAttestationSigner
	h.stubChainVerify(true)
	token := h.makeToken(t, deployTestAddr)
	ctx := context.Background()
	const proof = "gno.land/r/alice/foo"

	if _, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "deploy-hello-pkg", Proof: proof,
	})); err != nil {
		t.Fatal("first deploy completion:", err)
	}

	_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "deploy-counter-pkg", Proof: proof,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("conflicting proof must be rejected with FailedPrecondition, got %v", err)
	}

	if n := countRows(t, h, `SELECT COUNT(*) FROM attestation_vouchers WHERE address = ?`, deployTestAddr); n != 0 {
		t.Fatalf("no voucher expected without a signer, got %d", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM badge_mints WHERE address = ?`, deployTestAddr); n != 1 {
		t.Fatalf("want exactly 1 badge mint (the stored quest), got %d", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM badge_mints WHERE address = ? AND quest_id = 'deploy-counter-pkg'`, deployTestAddr); n != 0 {
		t.Fatal("no badge mint may be queued for the rejected quest")
	}
	resp, err := h.svc.GetUserQuests(ctx, connect.NewRequest(&membav1.GetUserQuestsRequest{Address: deployTestAddr}))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Msg.State.TotalXp != 20 {
		t.Fatalf("XP must stay at 20 (deploy-hello-pkg only), got %d", resp.Msg.State.TotalXp)
	}
}

// The voucher and badge-mint helpers must themselves refuse a quest with no
// stored completion, independent of the caller.
func TestQuestRewards_RequireStoredCompletion(t *testing.T) {
	h := setup(t)
	signer, err := attestation.NewFromSeedHex(testAttestationSeed)
	if err != nil {
		t.Fatal(err)
	}
	h.svc.SetAttestationSigner(signer)
	ctx := context.Background()

	h.svc.issueAttestationVoucher(ctx, "g1erin", "connect-wallet")
	h.svc.queueBadgeMint(ctx, "g1erin", "connect-wallet")

	if n := countRows(t, h, `SELECT COUNT(*) FROM attestation_vouchers WHERE address = 'g1erin'`); n != 0 {
		t.Fatalf("voucher issued without a stored completion (%d rows)", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM badge_mints WHERE address = 'g1erin'`); n != 0 {
		t.Fatalf("badge mint queued without a stored completion (%d rows)", n)
	}
}
