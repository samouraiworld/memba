// Package attestation produces backend-signed quest/XP attestation vouchers for
// the on-chain memba_quest_attestation_v1 realm (Quests audit Q-05, Track A —
// "Model B" offline-signed voucher).
//
// The signing key is OFFLINE and never broadcasts. For a server-verified quest
// completion the backend issues a Voucher; the USER broadcasts it to the realm,
// which verifies the ed25519 signature and records the attestation. The chain
// thus holds a verifiable record of quest XP, not just the backend DB.
//
// CONTRACT: the canonical message signed here MUST stay byte-identical to the
// realm's verifier (gno.land/r/samcrew/memba_quest_attestation_v1.canonicalMsg):
//
//	addr "|" questId "|" itoa(xp) "|" nonce      (UTF-8)
//
// signer_test.go pins this against the realm's own test vectors (same seed →
// identical pubkey + signature), so any drift on either side fails CI.
package attestation

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
)

// RealmPath is the deployed attestation realm (test13). The client broadcasts
// RecordCompletion here; echoed in GetAttestationVouchers so the frontend need
// not hardcode it.
const RealmPath = "gno.land/r/samcrew/memba_quest_attestation_v1"

// fieldSep separates voucher fields in the canonical message. No field may
// contain it (the realm rejects it too) — this keeps the message unambiguous.
const fieldSep = "|"

// nonceBytes is the random nonce length per voucher (hex-encoded → 2× chars).
const nonceBytes = 16

// Voucher is a backend-signed attestation that a user broadcasts to the realm.
type Voucher struct {
	Address string
	QuestID string
	XP      int
	Nonce   string
	SigHex  string
}

// Signer holds the offline ed25519 key used to sign vouchers.
type Signer struct {
	priv ed25519.PrivateKey
	pub  ed25519.PublicKey
}

// NewFromSeedHex builds a Signer from a 32-byte hex seed (64 hex chars) — same
// format as the auth ED25519_SEED. Deterministic: the same seed yields the same
// keypair (and thus the same pubkey to register on-chain via the realm's
// SetSigner). Returns an error (not a panic) so callers can disable attestation
// cleanly when the seed is unset/invalid.
func NewFromSeedHex(seedHex string) (*Signer, error) {
	seed, err := hex.DecodeString(strings.TrimSpace(seedHex))
	if err != nil {
		return nil, err
	}
	if len(seed) != ed25519.SeedSize {
		return nil, errors.New("attestation seed must be 32 bytes (64 hex chars)")
	}
	priv := ed25519.NewKeyFromSeed(seed)
	return &Signer{priv: priv, pub: priv.Public().(ed25519.PublicKey)}, nil
}

// PublicKeyHex returns the signer's public key as hex. Register it on the realm
// via SetSigner after deploy.
func (s *Signer) PublicKeyHex() string { return hex.EncodeToString(s.pub) }

// Canonical builds the exact bytes signed here and verified on-chain. strconv.Itoa
// yields a canonical decimal (no leading zeros) so both sides agree for any xp.
// MUST match the realm's canonicalMsg byte-for-byte.
func Canonical(addr, questID string, xp int, nonce string) []byte {
	return []byte(addr + fieldSep + questID + fieldSep + strconv.Itoa(xp) + fieldSep + nonce)
}

// Sign returns the hex ed25519 signature over the canonical voucher message.
func (s *Signer) Sign(addr, questID string, xp int, nonce string) string {
	return hex.EncodeToString(ed25519.Sign(s.priv, Canonical(addr, questID, xp, nonce)))
}

// IssueVoucher mints a fresh voucher (random nonce) for a verified completion.
// The caller MUST only issue vouchers for server-verified grants — this layer
// performs no quest verification, it only signs. Rejects a separator in addr or
// questID (the random hex nonce can never contain one).
//
// Each voucher's nonce makes it single-use on-chain: the realm rejects a reused
// nonce (replay) and is idempotent per (addr, questId), so rebroadcasting only
// ever credits the completion once.
func (s *Signer) IssueVoucher(addr, questID string, xp int) (Voucher, error) {
	if strings.Contains(addr, fieldSep) || strings.Contains(questID, fieldSep) {
		return Voucher{}, errors.New("voucher field must not contain the separator")
	}
	b := make([]byte, nonceBytes)
	if _, err := rand.Read(b); err != nil {
		return Voucher{}, err
	}
	nonce := hex.EncodeToString(b)
	return Voucher{
		Address: addr,
		QuestID: questID,
		XP:      xp,
		Nonce:   nonce,
		SigHex:  s.Sign(addr, questID, xp, nonce),
	}, nil
}
