package service

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"testing"

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
