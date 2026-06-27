package attestation

import (
	"crypto/ed25519"
	"encoding/hex"
	"strings"
	"testing"
)

// Seed 0x01..0x20 is IDENTICAL to the gno realm's unit-test vectors
// (memba_quest_attestation_v1_test.gno). This pins byte-for-byte parity between
// this Go signer and the on-chain verifier: the same seed must produce the same
// pubkey and the same signature over the same canonical message. If either side
// changes the canonical format or signing, this fails.
const (
	testSeedHex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
	realmPubHex = "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664"
	realmSigHex = "5063c9dae045cb2d56312f5084dc9ef239bd782612354b9571ebae20a34d7d1fe3e7bb7bb3207a6b80272fee72a8ac3798d592c849b131f1038ad1073871270e"
)

func TestSigner_ParityWithRealmVectors(t *testing.T) {
	s, err := NewFromSeedHex(testSeedHex)
	if err != nil {
		t.Fatal(err)
	}
	if got := s.PublicKeyHex(); got != realmPubHex {
		t.Fatalf("pubkey parity drift:\n got  %s\n want %s", got, realmPubHex)
	}
	// Same (addr, questId, xp, nonce) the realm test verifies.
	if got := s.Sign("g1alice", "connect-wallet", 10, "nonce-001"); got != realmSigHex {
		t.Fatalf("signature parity drift:\n got  %s\n want %s", got, realmSigHex)
	}
}

func TestCanonical_MatchesRealmFormat(t *testing.T) {
	got := string(Canonical("g1alice", "connect-wallet", 10, "nonce-001"))
	if got != "g1alice|connect-wallet|10|nonce-001" {
		t.Fatalf("canonical format = %q, want %q", got, "g1alice|connect-wallet|10|nonce-001")
	}
}

// strconv.Itoa must agree with the realm's strconv.Itoa across edge values (no
// leading zeros, plain "-" for negatives) — otherwise a signed voucher wouldn't
// verify on-chain. The realm separately rejects xp<=0 / xp>MaxAttestXP at verify.
func TestCanonical_XPFormatting(t *testing.T) {
	cases := map[int]string{0: "a|q|0|n", 1000: "a|q|1000|n", 1: "a|q|1|n", -1: "a|q|-1|n"}
	for xp, want := range cases {
		if got := string(Canonical("a", "q", xp, "n")); got != want {
			t.Errorf("xp %d: canonical = %q, want %q", xp, got, want)
		}
	}
}

func TestIssueVoucher_VerifiesAndIsFresh(t *testing.T) {
	s, _ := NewFromSeedHex(testSeedHex)
	pub, _ := hex.DecodeString(s.PublicKeyHex())

	v1, err := s.IssueVoucher("g1alice", "use-cmdk", 10)
	if err != nil {
		t.Fatal(err)
	}
	sig, err := hex.DecodeString(v1.SigHex)
	if err != nil {
		t.Fatal("voucher sig must be hex:", err)
	}
	// The issued voucher must verify exactly as the realm would verify it.
	if !ed25519.Verify(pub, Canonical(v1.Address, v1.QuestID, v1.XP, v1.Nonce), sig) {
		t.Fatal("issued voucher must verify against the signer pubkey")
	}

	v2, _ := s.IssueVoucher("g1alice", "use-cmdk", 10)
	if v1.Nonce == v2.Nonce {
		t.Fatal("each voucher must get a unique nonce")
	}
	if strings.Contains(v1.Nonce, fieldSep) {
		t.Fatal("nonce must never contain the separator")
	}
}

func TestNewFromSeedHex_RejectsBadSeed(t *testing.T) {
	if _, err := NewFromSeedHex("abcd"); err == nil {
		t.Error("short seed should error")
	}
	if _, err := NewFromSeedHex("zzzz"); err == nil {
		t.Error("non-hex seed should error")
	}
}

func TestIssueVoucher_RejectsSeparatorInFields(t *testing.T) {
	s, _ := NewFromSeedHex(testSeedHex)
	if _, err := s.IssueVoucher("g1a|lice", "q", 10); err == nil {
		t.Error("separator in addr must error")
	}
	if _, err := s.IssueVoucher("g1alice", "qu|est", 10); err == nil {
		t.Error("separator in questId must error")
	}
}
