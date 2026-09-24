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
//
// CHAIN BINDING (owner ruling O4): that message carries NO chain id, and the
// realm is immutable, so a key registered on two chains would make every voucher
// valid on both. The fix lives here, off-chain: a signer is only ever built
// bound to ONE chain id (QUEST_SIGNER_CHAIN_ID), and NewBoundSigner refuses it
// unless that binding equals the chain the backend runs on (GNO_CHAIN_ID). Each
// chain gets its own key; a key never signs for a chain it wasn't bound to.
package attestation

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// RealmPath is the deployed attestation realm (same path on every chain). The
// client broadcasts RecordCompletion here; echoed in GetAttestationVouchers so
// the frontend need not hardcode it.
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

// Signer holds the offline ed25519 key used to sign vouchers. chainID is the
// one chain the key is bound to; empty means unbound, and an unbound signer
// refuses to issue vouchers (see IssueVoucher).
type Signer struct {
	priv    ed25519.PrivateKey
	pub     ed25519.PublicKey
	chainID string
}

// State is the resolved attestation-signer configuration, exposed on /health
// and the memba_quest_attestation_signer_state gauge. Only StateEnabled issues
// vouchers. StateOff is the pre-existing "nothing configured" default (inert,
// not an error); every Disabled* state is a misconfiguration that fails closed.
type State string

const (
	// StateOff: no seed configured — attestation is dormant, as it always was.
	StateOff State = "off"
	// StateEnabled: seed valid and bound to the chain the backend runs on.
	StateEnabled State = "enabled"
	// StateDisabledUnbound: seed set but QUEST_SIGNER_CHAIN_ID is missing.
	StateDisabledUnbound State = "disabled_unbound"
	// StateDisabledNoRuntimeChain: seed + binding set but GNO_CHAIN_ID is empty,
	// so the binding cannot be checked against anything.
	StateDisabledNoRuntimeChain State = "disabled_no_runtime_chain"
	// StateDisabledChainMismatch: the binding names a different chain.
	StateDisabledChainMismatch State = "disabled_chain_mismatch"
	// StateDisabledInvalidSeed: the seed is not 32 bytes of hex.
	StateDisabledInvalidSeed State = "disabled_invalid_seed"
)

// AllStates lists every State, for zeroing the per-state gauge.
var AllStates = []State{
	StateOff, StateEnabled, StateDisabledUnbound, StateDisabledNoRuntimeChain,
	StateDisabledChainMismatch, StateDisabledInvalidSeed,
}

// Misconfigured reports whether st is a fail-closed misconfiguration (a seed is
// present but the signer was refused), as opposed to enabled or simply off. The
// zero value ("", a service never configured) is not misconfigured: it has no
// signer, so it issues nothing either way.
func (st State) Misconfigured() bool {
	switch st {
	case StateDisabledUnbound, StateDisabledNoRuntimeChain, StateDisabledChainMismatch, StateDisabledInvalidSeed:
		return true
	}
	return false
}

// chainIDPattern is the shape of a gno chain id ("gnoland-1", "test13"), at
// most 32 characters so a 64-hex seed or a mnemonic can never match. A
// value outside it is never echoed: an operator who swaps lines in
// `fly secrets import` could otherwise put the seed in an ERROR log.
var chainIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

// LoggableChainID returns the trimmed chain id quoted when it looks like a
// chain id, and a redacted length marker otherwise, so it is always safe to log.
func LoggableChainID(v string) string {
	v = strings.TrimSpace(v)
	if chainIDPattern.MatchString(v) {
		return strconv.Quote(v)
	}
	return fmt.Sprintf("<redacted: %d chars, not a chain id>", len(v))
}

// NewBoundSigner resolves the signer from its three inputs: the hex seed
// (MEMBA_ATTESTATION_SEED), the chain the key is bound to (QUEST_SIGNER_CHAIN_ID)
// and the chain the backend runs on (GNO_CHAIN_ID). It returns a Signer ONLY
// when the seed is valid and the binding equals the runtime chain exactly (no
// normalisation beyond trimming whitespace: "gnoland1" is not "gnoland-1").
// Otherwise it returns nil, the State, and an error explaining why. The error
// never contains the seed or any byte of it, so callers may log it.
//
// An empty seed is StateOff with a nil error, whatever the other two say.
func NewBoundSigner(seedHex, boundChainID, runtimeChainID string) (*Signer, State, error) {
	seedHex = strings.TrimSpace(seedHex)
	boundChainID = strings.TrimSpace(boundChainID)
	runtimeChainID = strings.TrimSpace(runtimeChainID)
	if seedHex == "" {
		return nil, StateOff, nil
	}
	if boundChainID == "" {
		return nil, StateDisabledUnbound, errors.New("attestation seed is set but QUEST_SIGNER_CHAIN_ID is empty — the signer must be bound to exactly one chain")
	}
	if runtimeChainID == "" {
		return nil, StateDisabledNoRuntimeChain, errors.New("GNO_CHAIN_ID is empty — cannot verify the attestation signer's chain binding")
	}
	if boundChainID != runtimeChainID {
		return nil, StateDisabledChainMismatch, fmt.Errorf("attestation signer is bound to chain %s but the backend runs on %s", LoggableChainID(boundChainID), LoggableChainID(runtimeChainID))
	}
	s, err := NewFromSeedHex(seedHex)
	if err != nil {
		// Deliberately drop err: hex.InvalidByteError quotes the offending seed byte.
		return nil, StateDisabledInvalidSeed, errors.New("attestation seed is not 32 bytes of hex (64 hex chars)")
	}
	s.chainID = boundChainID
	return s, StateEnabled, nil
}

// NewFromSeedHex builds an UNBOUND Signer from a 32-byte hex seed (64 hex
// chars) — same format as the auth ED25519_SEED. Deterministic: the same seed
// yields the same keypair (and thus the same pubkey to register on-chain via
// the realm's SetSigner). An unbound signer can Sign (parity tests, the keygen
// tool) but refuses IssueVoucher; production goes through NewBoundSigner.
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

// ChainID returns the chain this signer is bound to ("" when unbound).
func (s *Signer) ChainID() string { return s.chainID }

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
//
// Fails closed on an unbound signer: vouchers are only minted by a key bound to
// one chain (NewBoundSigner).
func (s *Signer) IssueVoucher(addr, questID string, xp int) (Voucher, error) {
	if s.chainID == "" {
		return Voucher{}, errors.New("attestation signer is not bound to a chain")
	}
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
