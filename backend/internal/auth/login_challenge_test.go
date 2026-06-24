package auth

import (
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	"github.com/cosmos/cosmos-sdk/types/bech32"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestLoginChallengeSignBytes_Shape(t *testing.T) {
	nonce := []byte("0123456789abcdef0123456789abcdef")
	sb, err := LoginChallengeSignBytes("test12", "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", nonce)
	if err != nil {
		t.Fatalf("LoginChallengeSignBytes: %v", err)
	}
	got := string(sb)

	// Deterministic: same inputs → same bytes.
	sb2, _ := LoginChallengeSignBytes("test12", "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", nonce)
	if string(sb2) != got {
		t.Fatal("LoginChallengeSignBytes is not deterministic")
	}

	wantMemo := ClientMagic + " | nonce: " + base64.StdEncoding.EncodeToString(nonce)
	for _, want := range []string{
		`"account_number":"0"`,
		`"sequence":"0"`,
		`"chain_id":"test12"`,
		`{"@type":"/vm.m_call"`,
		`"pkg_path":"gno.land/r/memba/login"`,
		`"func":"ProveKeyOwnership"`,
		`"caller":"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("login sign-bytes missing %q\nfull: %s", want, got)
		}
	}
	// memo carries the binding nonce; assert via the same json-escaping the doc uses.
	if !strings.Contains(got, `"memo":`) || !strings.Contains(got, base64.StdEncoding.EncodeToString(nonce)) {
		t.Errorf("memo missing nonce binding (want memo %q)\nfull: %s", wantMemo, got)
	}
	// args must be OMITTED (no key) to match Adena's proto-roundtrip form: ts-proto's
	// MsgCall.toJSON drops an empty repeated `args` entirely. The empty scalar
	// send/max_deposit, by contrast, ARE emitted. Verified byte-exact against a real
	// Adena signature in login_challenge_realvector_test.go (corrects the prior
	// "args":null assumption that caused result=signed_invalid in production).
	if strings.Contains(got, `"args"`) {
		t.Errorf(`login msg must OMIT "args" (Adena drops empty repeated args), got: %s`, got)
	}
	if !strings.Contains(got, `"send":""`) {
		t.Errorf(`login msg must emit "send":"", got: %s`, got)
	}
	if !strings.Contains(got, `"max_deposit":""`) {
		t.Errorf(`login msg must emit "max_deposit":"", got: %s`, got)
	}
	// top-level keys sorted (sortJSON contract).
	if !strings.HasPrefix(got, `{"account_number":"0","chain_id":"test12"`) {
		t.Errorf("top-level keys not sorted: %s", got)
	}
}

// loginAuthInfo builds a TokenRequestInfo with a real pubkey + bound challenge, and
// returns it plus the user's private key and address so a test can sign the proof.
func loginAuthInfo(t *testing.T, serverPriv []byte, chainID string) (string, *secp256k1.PrivKey, string, *membav1.Challenge) {
	t.Helper()
	priv := secp256k1.GenPrivKey()
	pub := priv.PubKey().(*secp256k1.PubKey)
	pubkeyJSON := fmt.Sprintf(`{"type":"tendermint/PubKeySecp256k1","value":"%s"}`,
		base64.StdEncoding.EncodeToString(pub.Key))
	addr, err := bech32.ConvertAndEncode("g", pub.Address().Bytes())
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := MakeChallenge(serverPriv, time.Hour, pubkeyJSON, chainID)
	if err != nil {
		t.Fatalf("MakeChallenge: %v", err)
	}
	info := &membav1.TokenRequestInfo{
		Kind:             ClientMagic,
		UserBech32Prefix: "g",
		UserPubkeyJson:   pubkeyJSON,
		ChainId:          chainID,
		Challenge:        challenge,
	}
	b, err := protojson.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	return string(b), priv, addr, challenge
}

// unboundLoginAuthInfo is like loginAuthInfo but requests an UNBOUND challenge
// (boundPubkeyHash=""), as an untransacted wallet must (no pubkey at challenge time).
func unboundLoginAuthInfo(t *testing.T, serverPriv []byte, chainID string) (string, *secp256k1.PrivKey, string, *membav1.Challenge) {
	t.Helper()
	priv := secp256k1.GenPrivKey()
	pub := priv.PubKey().(*secp256k1.PubKey)
	pubkeyJSON := fmt.Sprintf(`{"type":"tendermint/PubKeySecp256k1","value":"%s"}`,
		base64.StdEncoding.EncodeToString(pub.Key))
	addr, err := bech32.ConvertAndEncode("g", pub.Address().Bytes())
	if err != nil {
		t.Fatal(err)
	}
	// Empty pubkeyJSON => unbound challenge (boundPubkeyHash == "").
	challenge, err := MakeChallenge(serverPriv, time.Hour, "", chainID)
	if err != nil {
		t.Fatalf("MakeChallenge: %v", err)
	}
	if challenge.BoundPubkeyHash != "" {
		t.Fatal("expected an unbound challenge")
	}
	info := &membav1.TokenRequestInfo{
		Kind: ClientMagic, UserBech32Prefix: "g", UserPubkeyJson: pubkeyJSON,
		ChainId: chainID, Challenge: challenge,
	}
	b, err := protojson.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	return string(b), priv, addr, challenge
}

// TestMakeToken_UnboundChallenge_SignedAccepted: an untransacted wallet uses an
// UNBOUND challenge; a valid signature is the ownership proof, so it mints.
func TestMakeToken_UnboundChallenge_SignedAccepted(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "0") // even with enforcement on, a VALID signature passes
	serverPub, serverPriv := generateTestKeypair(t)
	const chainID = "test12"
	infoJSON, priv, addr, challenge := unboundLoginAuthInfo(t, serverPriv, chainID)

	sb, err := LoginChallengeSignBytes(chainID, addr, challenge.Nonce)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := priv.Sign(sb)
	if err != nil {
		t.Fatal(err)
	}
	tok, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, base64.StdEncoding.EncodeToString(raw), chainID)
	if err != nil {
		t.Fatalf("unbound challenge + valid signature must mint, got: %v", err)
	}
	if tok == nil {
		t.Fatal("expected a token")
	}
}

// TestMakeToken_UnboundChallenge_EmptySigRejected: an unbound challenge with NO
// signature has no ownership proof and must be rejected (regardless of the gate).
func TestMakeToken_UnboundChallenge_EmptySigRejected(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "") // phase 1 (default allow) — still must reject unbound+unsigned
	serverPub, serverPriv := generateTestKeypair(t)
	infoJSON, _, _, _ := unboundLoginAuthInfo(t, serverPriv, "test12")

	_, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, "", "test12")
	if err == nil {
		t.Fatal("unbound challenge with empty signature must be rejected (no ownership proof)")
	}
}

// TestMakeToken_UnboundChallenge_InvalidSig_PhaseBoundary documents the security
// boundary the unbound-challenge relaxation relies on: an unbound challenge + a
// present-but-INVALID signature (e.g. an attacker submitting a victim's public
// pubkey + garbage sig) is MINTED in phase 1 (deliberately permissive, lockout-safe
// — identical to the pre-existing bound+empty phase-1 behavior, since boundPubkeyHash
// = sha256(public pubkey) is no barrier to someone holding the public pubkey) and is
// REJECTED in phase 2. Phase 2 is the impersonation boundary; do not flip it before
// the real-Adena golden vector confirms valid sigs verify. See design §9.
func TestMakeToken_UnboundChallenge_InvalidSig_PhaseBoundary(t *testing.T) {
	serverPub, serverPriv := generateTestKeypair(t)
	const chainID = "test12"

	t.Run("phase 1 mints (lockout-safe)", func(t *testing.T) {
		t.Setenv(AllowUnsignedAuthEnv, "") // default allow
		infoJSON, _, _, _ := unboundLoginAuthInfo(t, serverPriv, chainID)
		garbage := base64.StdEncoding.EncodeToString([]byte("not a valid secp256k1 signature!"))
		tok, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, garbage, chainID)
		if err != nil || tok == nil {
			t.Fatalf("phase 1: unbound + invalid sig must mint (lockout-safe), got err=%v", err)
		}
	})

	t.Run("phase 2 rejects (impersonation closed)", func(t *testing.T) {
		t.Setenv(AllowUnsignedAuthEnv, "0") // enforce
		infoJSON, _, _, _ := unboundLoginAuthInfo(t, serverPriv, chainID)
		garbage := base64.StdEncoding.EncodeToString([]byte("not a valid secp256k1 signature!"))
		if _, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, garbage, chainID); err == nil {
			t.Fatal("phase 2: unbound + invalid sig must be rejected (impersonation boundary)")
		}
	})
}

// TestMakeToken_TxShapedSignature_Accepted is the A2 happy path: a real secp256k1
// signature over the reconstructed login sign-bytes mints a token.
func TestMakeToken_TxShapedSignature_Accepted(t *testing.T) {
	serverPub, serverPriv := generateTestKeypair(t)
	const chainID = "test12"
	infoJSON, priv, addr, challenge := loginAuthInfo(t, serverPriv, chainID)

	sb, err := LoginChallengeSignBytes(chainID, addr, challenge.Nonce)
	if err != nil {
		t.Fatal(err)
	}
	rawSig, err := priv.Sign(sb)
	if err != nil {
		t.Fatal(err)
	}
	sig := base64.StdEncoding.EncodeToString(rawSig)

	tok, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, sig, chainID)
	if err != nil {
		t.Fatalf("expected tx-shaped signature to be accepted, got: %v", err)
	}
	if tok == nil {
		t.Fatal("expected a token")
	}
}

// signWrongNonce signs a doc bound to a different nonce than the challenge carries,
// so it will not verify against the reconstructed login sign-bytes.
func signWrongNonce(t *testing.T, priv *secp256k1.PrivKey, chainID, addr string, nonce []byte) string {
	t.Helper()
	wrong := append([]byte(nil), nonce...)
	wrong[0] ^= 0xff
	sb, _ := LoginChallengeSignBytes(chainID, addr, wrong)
	rawSig, _ := priv.Sign(sb)
	return base64.StdEncoding.EncodeToString(rawSig)
}

// TestMakeToken_TxShapedSignature_RejectedWhenEnforced: in phase 2 a present-but-
// invalid signature is rejected.
func TestMakeToken_TxShapedSignature_RejectedWhenEnforced(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "0") // enforce
	serverPub, serverPriv := generateTestKeypair(t)
	const chainID = "test12"
	infoJSON, priv, addr, challenge := loginAuthInfo(t, serverPriv, chainID)
	sig := signWrongNonce(t, priv, chainID, addr, challenge.Nonce)

	_, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, sig, chainID)
	if err == nil {
		t.Fatal("enforcement on: a signature over the wrong nonce must be rejected")
	}
	if !strings.Contains(err.Error(), "invalid user signature") {
		t.Fatalf("expected 'invalid user signature', got: %v", err)
	}
}

// TestMakeToken_TxShapedSignature_InvalidAllowedInPhase1 is the lockout-safety
// guarantee: in phase 1 a present-but-invalid signature (e.g. an Adena canonical-doc
// mismatch) must NOT block login — it is logged and a token is still minted, like the
// empty-sig case. This prevents the 403 outage where a real-but-non-matching Adena
// signature hard-failed every login.
func TestMakeToken_TxShapedSignature_InvalidAllowedInPhase1(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "") // default allow (phase 1)
	serverPub, serverPriv := generateTestKeypair(t)
	const chainID = "test12"
	infoJSON, priv, addr, challenge := loginAuthInfo(t, serverPriv, chainID)
	sig := signWrongNonce(t, priv, chainID, addr, challenge.Nonce)

	tok, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, sig, chainID)
	if err != nil {
		t.Fatalf("phase 1 must accept (log + mint) an invalid signature, got: %v", err)
	}
	if tok == nil {
		t.Fatal("expected a token in phase 1")
	}
}

// addressOnlyAuthInfo builds a TokenRequestInfo with ONLY an address (no pubkey,
// no signature) — an untransacted wallet whose pubkey Adena won't reveal or sign
// for (Adena #800). Unbound challenge.
func addressOnlyAuthInfo(t *testing.T, serverPriv []byte, chainID string) (string, string) {
	t.Helper()
	priv := secp256k1.GenPrivKey()
	pub := priv.PubKey().(*secp256k1.PubKey)
	addr, err := bech32.ConvertAndEncode("g", pub.Address().Bytes())
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := MakeChallenge(serverPriv, time.Hour, "", chainID)
	if err != nil {
		t.Fatalf("MakeChallenge: %v", err)
	}
	info := &membav1.TokenRequestInfo{
		Kind: ClientMagic, UserBech32Prefix: "g", UserAddress: addr,
		ChainId: chainID, Challenge: challenge,
	}
	b, err := protojson.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	return string(b), addr
}

// TestMakeToken_AddressOnly_AllowedWhenUnsigned: with unsigned auth allowed (the
// testnet posture), an untransacted wallet signs in with just its address — the
// only path possible since Adena won't sign/reveal a pubkey for it. The minted
// token validates.
func TestMakeToken_AddressOnly_AllowedWhenUnsigned(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "") // default-allow
	serverPub, serverPriv := generateTestKeypair(t)
	const chainID = "test-13"
	infoJSON, _ := addressOnlyAuthInfo(t, serverPriv, chainID)

	tok, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, "", chainID)
	if err != nil {
		t.Fatalf("address-only login must mint when unsigned auth is allowed, got: %v", err)
	}
	if tok == nil || tok.UserAddress == "" {
		t.Fatal("expected a token bound to the address")
	}
	if err := ValidateToken(serverPub, tok, chainID); err != nil {
		t.Fatalf("minted address-only token must validate: %v", err)
	}
}

// TestMakeToken_AddressOnly_RejectedWhenEnforced: with signed auth enforced
// (mainnet posture), address-only has no ownership proof and is rejected.
func TestMakeToken_AddressOnly_RejectedWhenEnforced(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "0")
	serverPub, serverPriv := generateTestKeypair(t)
	infoJSON, _ := addressOnlyAuthInfo(t, serverPriv, "test-13")

	if _, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, "", "test-13"); err == nil {
		t.Fatal("address-only login must be rejected when signed auth is enforced")
	}
}
