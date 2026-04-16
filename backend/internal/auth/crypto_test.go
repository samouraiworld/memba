package auth

import (
	"crypto/ed25519"
	srand "crypto/rand"
	"testing"
	"time"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"google.golang.org/protobuf/proto"
)

func generateTestKeypair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(srand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv
}

func TestMakeAndValidateChallenge(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	challenge, err := MakeChallenge(priv, 5*time.Minute, "")
	if err != nil {
		t.Fatal("MakeChallenge:", err)
	}
	if challenge == nil {
		t.Fatal("challenge is nil")
	}
	if len(challenge.Nonce) == 0 {
		t.Fatal("nonce is empty")
	}
	if challenge.Expiration == "" {
		t.Fatal("expiration is empty")
	}
	if len(challenge.ServerSignature) == 0 {
		t.Fatal("server signature is empty")
	}

	if err := ValidateChallenge(pub, challenge); err != nil {
		t.Fatal("ValidateChallenge:", err)
	}
}

func TestExpiredChallengeRejected(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	challenge, err := MakeChallenge(priv, -1*time.Second, "")
	if err != nil {
		t.Fatal("MakeChallenge:", err)
	}

	if err := ValidateChallenge(pub, challenge); err == nil {
		t.Fatal("expected error for expired challenge")
	}
}

func TestTamperedChallengeRejected(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	challenge, err := MakeChallenge(priv, 5*time.Minute, "")
	if err != nil {
		t.Fatal("MakeChallenge:", err)
	}

	challenge.Nonce[0] ^= 0xFF

	if err := ValidateChallenge(pub, challenge); err == nil {
		t.Fatal("expected error for tampered challenge")
	}
}

func TestWrongKeyChallengeRejected(t *testing.T) {
	_, priv := generateTestKeypair(t)
	otherPub, _ := generateTestKeypair(t)

	challenge, err := MakeChallenge(priv, 5*time.Minute, "")
	if err != nil {
		t.Fatal("MakeChallenge:", err)
	}

	if err := ValidateChallenge(otherPub, challenge); err == nil {
		t.Fatal("expected error for wrong key")
	}
}

func TestMakeAndValidateToken(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	token, err := makeTestToken(priv, 24*time.Hour)
	if err != nil {
		t.Fatal("makeTestToken:", err)
	}

	if err := ValidateToken(pub, token); err != nil {
		t.Fatal("ValidateToken:", err)
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	token, err := makeTestToken(priv, -1*time.Second)
	if err != nil {
		t.Fatal("makeTestToken:", err)
	}

	if err := ValidateToken(pub, token); err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestNilTokenRejected(t *testing.T) {
	pub, _ := generateTestKeypair(t)
	if err := ValidateToken(pub, nil); err == nil {
		t.Fatal("expected error for nil token")
	}
}

func TestPubkeyBoundChallenge(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	testPubkey := `{"type":"tendermint/PubKeySecp256k1","value":"A1B2C3=="}`

	challenge, err := MakeChallenge(priv, 5*time.Minute, testPubkey)
	if err != nil {
		t.Fatal("MakeChallenge:", err)
	}
	if challenge.BoundPubkeyHash == "" {
		t.Fatal("expected bound_pubkey_hash to be set")
	}

	// Should validate normally
	if err := ValidateChallenge(pub, challenge); err != nil {
		t.Fatal("ValidateChallenge:", err)
	}

	// Verify hash matches expected
	expectedHash := hashPubkey(testPubkey)
	if challenge.BoundPubkeyHash != expectedHash {
		t.Fatalf("hash mismatch: got %s, want %s", challenge.BoundPubkeyHash, expectedHash)
	}

	// Different pubkey should produce different hash
	differentHash := hashPubkey(`{"type":"tendermint/PubKeySecp256k1","value":"X9Y8Z7=="}`)
	if challenge.BoundPubkeyHash == differentHash {
		t.Fatal("different pubkeys should produce different hashes")
	}
}

func TestUnboundChallengeStillWorks(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	// Empty pubkey = no binding (backward compat for challenge validation itself)
	challenge, err := MakeChallenge(priv, 5*time.Minute, "")
	if err != nil {
		t.Fatal("MakeChallenge:", err)
	}
	if challenge.BoundPubkeyHash != "" {
		t.Fatal("expected empty bound_pubkey_hash for unbound challenge")
	}
	if err := ValidateChallenge(pub, challenge); err != nil {
		t.Fatal("ValidateChallenge:", err)
	}
}

func TestADR36SignDoc(t *testing.T) {
	doc := MakeADR36SignDoc([]byte("hello"), "g1abc123")
	if len(doc) == 0 {
		t.Fatal("empty sign doc")
	}
	if doc[0] != '{' {
		t.Fatal("sign doc should be JSON object")
	}
}

// makeTestToken creates a server-signed token for testing.
func makeTestToken(priv ed25519.PrivateKey, duration time.Duration) (*membav1.Token, error) {
	nonce, err := makeNonce()
	if err != nil {
		return nil, err
	}
	token := &membav1.Token{
		Nonce:       encodeBytes(nonce),
		UserAddress: "g1testuser123",
		Expiration:  encodeTime(time.Now().Add(duration)),
	}
	tokenBytes, err := proto.Marshal(token)
	if err != nil {
		return nil, err
	}
	token.ServerSignature = encodeBytes(ed25519.Sign(priv, tokenBytes))
	return token, nil
}
