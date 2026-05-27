package auth

import (
	"crypto/ed25519"
	srand "crypto/rand"
	"strings"
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

	challenge, err := MakeChallenge(priv, 5*time.Minute, "", "")
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

	challenge, err := MakeChallenge(priv, -1*time.Second, "", "")
	if err != nil {
		t.Fatal("MakeChallenge:", err)
	}

	if err := ValidateChallenge(pub, challenge); err == nil {
		t.Fatal("expected error for expired challenge")
	}
}

func TestTamperedChallengeRejected(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	challenge, err := MakeChallenge(priv, 5*time.Minute, "", "")
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

	challenge, err := MakeChallenge(priv, 5*time.Minute, "", "")
	if err != nil {
		t.Fatal("MakeChallenge:", err)
	}

	if err := ValidateChallenge(otherPub, challenge); err == nil {
		t.Fatal("expected error for wrong key")
	}
}

func TestMakeAndValidateToken(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	token, err := makeTestToken(priv, 24*time.Hour, "test12")
	if err != nil {
		t.Fatal("makeTestToken:", err)
	}

	if err := ValidateToken(pub, token, "test12"); err != nil {
		t.Fatal("ValidateToken:", err)
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	token, err := makeTestToken(priv, -1*time.Second, "test12")
	if err != nil {
		t.Fatal("makeTestToken:", err)
	}

	if err := ValidateToken(pub, token, "test12"); err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestNilTokenRejected(t *testing.T) {
	pub, _ := generateTestKeypair(t)
	if err := ValidateToken(pub, nil, ""); err == nil {
		t.Fatal("expected error for nil token")
	}
}

func TestPubkeyBoundChallenge(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	testPubkey := `{"type":"tendermint/PubKeySecp256k1","value":"A1B2C3=="}`

	challenge, err := MakeChallenge(priv, 5*time.Minute, testPubkey, "")
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
	challenge, err := MakeChallenge(priv, 5*time.Minute, "", "")
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
	doc := MakeADR36SignDoc([]byte("hello"), "g1abc123", "test12")
	if len(doc) == 0 {
		t.Fatal("empty sign doc")
	}
	if doc[0] != '{' {
		t.Fatal("sign doc should be JSON object")
	}
}

// ─── v7.1 AUTH-CHAINID-01 regression tests (MEMBA-2026-001) ─────────

// TestADR36SignDocEmbedsChainID is the canary for AUTH-CHAINID-01: the same
// payload signed under two different chains must produce two different
// signDocs. Prior to v7.1 the chain_id field was hardcoded to "" making
// signatures bit-identical across chains.
func TestADR36SignDocEmbedsChainID(t *testing.T) {
	payload := []byte(`{"kind":"Login to Memba Multisig Service"}`)
	signer := "g1abc123"

	test12Doc := MakeADR36SignDoc(payload, signer, "test12")
	gnoland1Doc := MakeADR36SignDoc(payload, signer, "gnoland1")
	legacyDoc := MakeADR36SignDoc(payload, signer, "")

	if string(test12Doc) == string(gnoland1Doc) {
		t.Fatal("AUTH-CHAINID-01 regression: signDoc for test12 == signDoc for gnoland1")
	}
	if string(test12Doc) == string(legacyDoc) {
		t.Fatal("AUTH-CHAINID-01 regression: signDoc for test12 == signDoc for empty chain_id")
	}
	if !strings.Contains(string(test12Doc), `"chain_id":"test12"`) {
		t.Fatalf("test12 signDoc missing chain_id: %s", test12Doc)
	}
	if !strings.Contains(string(gnoland1Doc), `"chain_id":"gnoland1"`) {
		t.Fatalf("gnoland1 signDoc missing chain_id: %s", gnoland1Doc)
	}
}

// TestADR36SignDocChainIDJSONEscape verifies that chain_id values containing
// JSON-special characters cannot break the signDoc structure.
func TestADR36SignDocChainIDJSONEscape(t *testing.T) {
	// A chain_id with a quote would break a naive template; json.Marshal escapes it.
	doc := MakeADR36SignDoc([]byte("x"), "g1x", `"injected","msgs":[{"escape`)
	// The doc must still be a valid JSON-ish blob starting with { and ending with }.
	if len(doc) == 0 || doc[0] != '{' || doc[len(doc)-1] != '}' {
		t.Fatalf("signDoc malformed under hostile chain_id: %s", doc)
	}
}

// TestTokenChainBinding asserts that a token carries the chain_id it was
// issued for, and that ValidateToken rejects mismatched expected/token chains.
func TestTokenChainBinding(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	tokTest12, err := makeTestToken(priv, time.Hour, "test12")
	if err != nil {
		t.Fatal(err)
	}
	if tokTest12.ChainId != "test12" {
		t.Fatalf("token chain_id = %q, want test12", tokTest12.ChainId)
	}

	// Same chain ⇒ accept.
	if err := ValidateToken(pub, tokTest12, "test12"); err != nil {
		t.Fatalf("same-chain token rejected: %v", err)
	}

	// Cross-chain (token=test12, expected=gnoland1) ⇒ reject.
	if err := ValidateToken(pub, tokTest12, "gnoland1"); err == nil {
		t.Fatal("AUTH-CHAINID-01 regression: cross-chain token accepted")
	}
}

// TestTokenChainBindingLegacyGrace covers the 24h transition window where
// older clients haven't started sending chain_id yet. A token with empty
// ChainId must still be accepted when the server has a configured chain
// (logged for monitoring, but not rejected).
func TestTokenChainBindingLegacyGrace(t *testing.T) {
	pub, priv := generateTestKeypair(t)

	tokLegacy, err := makeTestToken(priv, time.Hour, "")
	if err != nil {
		t.Fatal(err)
	}

	// Server expects test12; token is legacy (empty). Grace accept.
	if err := ValidateToken(pub, tokLegacy, "test12"); err != nil {
		t.Fatalf("legacy-grace token rejected: %v", err)
	}

	// Server also legacy (no GNO_CHAIN_ID set): accept.
	if err := ValidateToken(pub, tokLegacy, ""); err != nil {
		t.Fatalf("legacy/legacy token rejected: %v", err)
	}
}

// FuzzMakeADR36SignDoc seeds the AUTH-CHAINID-01 fix: arbitrary chainID
// values must never break signDoc structure (the JSON template would
// otherwise be vulnerable to template-injection on hostile chain_ids).
func FuzzMakeADR36SignDoc(f *testing.F) {
	f.Add("test12", "g1abc", []byte("payload"))
	f.Add("gnoland1", "g1xyz", []byte(""))
	f.Add("", "g1leg", []byte("legacy"))
	f.Add(`"injected","msgs":[]`, "g1evil", []byte("attack"))
	f.Add("chain\x00with\x00nuls", "g1nul", []byte{0, 1, 2, 3})

	f.Fuzz(func(t *testing.T, chainID, signer string, data []byte) {
		doc := MakeADR36SignDoc(data, signer, chainID)
		if len(doc) == 0 {
			t.Fatal("empty doc")
		}
		if doc[0] != '{' || doc[len(doc)-1] != '}' {
			t.Fatalf("doc not a JSON object: %q", doc)
		}
	})
}

// ─── v7.1 Phase 1.9b — AUTH-SESSION-REJECT-01 regression tests ─────

// TestSessionRejectStrictByDefault is the canary for AUTH-SESSION-REJECT-01:
// a TokenRequestInfo JSON carrying an unknown field (the kind of payload
// Adena 1.20+ multichain session signatures are expected to produce) must
// be rejected by default. Without the strict unmarshal, the unknown field
// would be silently dropped and Memba would auth a session subaccount as
// if it were the user's main on-chain identity.
func TestSessionRejectStrictByDefault(t *testing.T) {
	_, priv := generateTestKeypair(t)
	t.Setenv(SessionPubkeyOptInEnv, "")
	if sessionPubkeysAccepted() {
		t.Fatal("kill switch should be off when env var is empty")
	}

	// Minimal TokenRequestInfo + an unexpected session_pubkey field that the
	// proto schema does not declare. Adena 1.20+ could add anything here;
	// the contract is "we don't know about it, so we don't trust it."
	infoJSON := `{
		"kind": "Login to Memba Multisig Service",
		"user_bech32_prefix": "g",
		"user_pubkey_json": "{\"type\":\"tendermint/PubKeySecp256k1\",\"value\":\"A1B2C3==\"}",
		"session_pubkey": "future-adena-session-blob"
	}`

	_, err := MakeToken(priv, nil, time.Hour, infoJSON, "", "test12")
	if err == nil {
		t.Fatal("AUTH-SESSION-REJECT-01 regression: TokenRequestInfo with unknown field was accepted")
	}
	if !strings.Contains(err.Error(), "AUTH-SESSION-REJECT-01") {
		t.Fatalf("expected error tagged with AUTH-SESSION-REJECT-01, got: %v", err)
	}
}

// TestSessionRejectOptInRelaxes covers the operator escape hatch: setting
// MEMBA_ACCEPT_SESSION_PUBKEYS=1 should switch back to lenient unmarshal so
// the same payload that was rejected above gets through (the request then
// fails for normal downstream reasons — invalid pubkey, missing challenge —
// not for the strict-unmarshal reason).
func TestSessionRejectOptInRelaxes(t *testing.T) {
	_, priv := generateTestKeypair(t)
	t.Setenv(SessionPubkeyOptInEnv, "1")
	if !sessionPubkeysAccepted() {
		t.Fatal("kill switch should be on when env var is '1'")
	}

	infoJSON := `{
		"kind": "Login to Memba Multisig Service",
		"user_bech32_prefix": "g",
		"user_pubkey_json": "{\"type\":\"tendermint/PubKeySecp256k1\",\"value\":\"A1B2C3==\"}",
		"session_pubkey": "future-adena-session-blob"
	}`

	_, err := MakeToken(priv, nil, time.Hour, infoJSON, "", "test12")
	if err == nil {
		// Shouldn't happen — the pubkey value is bogus base64, downstream will fail.
		t.Fatal("expected downstream error (invalid pubkey or missing challenge), got nil")
	}
	if strings.Contains(err.Error(), "AUTH-SESSION-REJECT-01") {
		t.Fatalf("opt-in should bypass strict unmarshal, but request still rejected by AUTH-SESSION-REJECT-01: %v", err)
	}
}

// TestSessionRejectLegacyClientUnaffected guards against the most likely
// false positive: a real, current Adena 1.19 client sending a vanilla
// TokenRequestInfo with no extra fields must still get past the unmarshal
// step. (The request then fails for an unrelated reason — bogus test
// pubkey — but not at the AUTH-SESSION-REJECT-01 path.)
func TestSessionRejectLegacyClientUnaffected(t *testing.T) {
	_, priv := generateTestKeypair(t)
	t.Setenv(SessionPubkeyOptInEnv, "")

	infoJSON := `{
		"kind": "Login to Memba Multisig Service",
		"user_bech32_prefix": "g",
		"user_pubkey_json": "{\"type\":\"tendermint/PubKeySecp256k1\",\"value\":\"A1B2C3==\"}",
		"chain_id": "test12"
	}`

	_, err := MakeToken(priv, nil, time.Hour, infoJSON, "", "test12")
	if err == nil {
		// Same as above: the bogus pubkey will trip a downstream check.
		t.Fatal("expected downstream error on bogus pubkey, got nil")
	}
	if strings.Contains(err.Error(), "AUTH-SESSION-REJECT-01") {
		t.Fatalf("legacy-shaped TokenRequestInfo must not trip AUTH-SESSION-REJECT-01: %v", err)
	}
}

// makeTestToken creates a server-signed token for testing.
func makeTestToken(priv ed25519.PrivateKey, duration time.Duration, chainID string) (*membav1.Token, error) {
	nonce, err := makeNonce()
	if err != nil {
		return nil, err
	}
	token := &membav1.Token{
		Nonce:       encodeBytes(nonce),
		UserAddress: "g1testuser123",
		Expiration:  encodeTime(time.Now().Add(duration)),
		ChainId:     chainID,
	}
	tokenBytes, err := proto.Marshal(token)
	if err != nil {
		return nil, err
	}
	token.ServerSignature = encodeBytes(ed25519.Sign(priv, tokenBytes))
	return token, nil
}
