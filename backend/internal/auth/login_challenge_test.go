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
	// args must be ABSENT (gno omitempty canonical form), not "args":[].
	if strings.Contains(got, `"args"`) {
		t.Errorf("login msg must omit empty args (canonical), got: %s", got)
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

// TestMakeToken_TxShapedSignature_Rejected: a present-but-invalid signature is
// rejected regardless of the unsigned-auth gate (the gate only covers empty sigs).
func TestMakeToken_TxShapedSignature_Rejected(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "") // default allow — must NOT rescue a bad present sig
	serverPub, serverPriv := generateTestKeypair(t)
	const chainID = "test12"
	infoJSON, priv, addr, challenge := loginAuthInfo(t, serverPriv, chainID)

	// Sign a DIFFERENT nonce than the challenge carries → verification must fail.
	wrong := append([]byte(nil), challenge.Nonce...)
	wrong[0] ^= 0xff
	sb, _ := LoginChallengeSignBytes(chainID, addr, wrong)
	rawSig, _ := priv.Sign(sb)
	sig := base64.StdEncoding.EncodeToString(rawSig)

	_, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, sig, chainID)
	if err == nil {
		t.Fatal("expected a signature over the wrong nonce to be rejected")
	}
	if !strings.Contains(err.Error(), "invalid user signature") {
		t.Fatalf("expected 'invalid user signature', got: %v", err)
	}
}
