package auth

// AAA-0 A2.phase1 — stop minting auth tokens from empty signatures (two-phase,
// lockout-safe). These also give MakeToken's signature path its first end-to-end
// coverage (the existing MakeToken tests all fail early on bogus pubkeys).

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestAllowUnsignedAuth_EnvLogic(t *testing.T) {
	cases := []struct {
		env  string
		want bool
	}{
		{"1", true}, {"true", true}, {"TRUE", true},                  // Explicit dev opt-in
		{"", false}, {"0", false}, {"false", false}, {"whatever", false}, // Secure default (fail-closed)
	}
	for _, c := range cases {
		t.Setenv(AllowUnsignedAuthEnv, c.env)
		if got := allowUnsignedAuth(); got != c.want {
			t.Errorf("allowUnsignedAuth() env=%q = %v, want %v", c.env, got, c.want)
		}
	}
}

// buildEmptySigAuthInfo builds a valid TokenRequestInfo (real secp256k1 pubkey +
// a server-bound challenge) so MakeToken reaches the signature step — with an
// EMPTY user signature.
func buildEmptySigAuthInfo(t *testing.T, serverPriv ed25519.PrivateKey, chainID string) string {
	t.Helper()
	userPub := secp256k1.GenPrivKey().PubKey().(*secp256k1.PubKey)
	pubkeyJSON := fmt.Sprintf(`{"type":"tendermint/PubKeySecp256k1","value":"%s"}`,
		base64.StdEncoding.EncodeToString(userPub.Key))

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
		t.Fatalf("protojson.Marshal: %v", err)
	}
	return string(b)
}

// Explicit opt-in: an empty signature is accepted when the env flag is "1".
func TestMakeToken_EmptySig_AllowedWhenOptedIn(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "1") // explicit dev opt-in
	serverPub, serverPriv := generateTestKeypair(t)
	infoJSON := buildEmptySigAuthInfo(t, serverPriv, "test12")

	tok, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, "", "test12")
	if err != nil {
		t.Fatalf("explicit opt-in must mint a token for an empty sig, got: %v", err)
	}
	if tok == nil {
		t.Fatal("expected a token")
	}
}

// Default (fail-closed): the same empty-signature request must be rejected.
func TestMakeToken_EmptySig_RejectedByDefault(t *testing.T) {
	t.Setenv(AllowUnsignedAuthEnv, "") // unset → fail-closed default
	serverPub, serverPriv := generateTestKeypair(t)
	infoJSON := buildEmptySigAuthInfo(t, serverPriv, "test12")

	_, err := MakeToken(serverPriv, serverPub, time.Hour, infoJSON, "", "test12")
	if err == nil {
		t.Fatal("fail-closed default: empty signature must be rejected (impersonation guard)")
	}
	if !strings.Contains(err.Error(), "user signature is required") {
		t.Fatalf("expected 'user signature is required', got: %v", err)
	}
}
