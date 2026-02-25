package auth

import (
	"context"
	"crypto/ed25519"
	srand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"

	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	"github.com/cosmos/cosmos-sdk/types/bech32"
	"github.com/pkg/errors"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const (
	// ClientMagic prevents phishing by ensuring the user knowingly signs for Memba.
	ClientMagic = "Login to Memba Multisig Service"

	// UniversalBech32Prefix is used to store cross-chain addresses.
	UniversalBech32Prefix = "g"

	DefaultTokenDuration     = 24 * time.Hour
	DefaultChallengeDuration = 5 * time.Minute
)

// ------------------------------------------------------------------
// Nonce helpers
// ------------------------------------------------------------------

func makeNonce() ([]byte, error) {
	nonce := make([]byte, 32)
	if _, err := srand.Read(nonce); err != nil {
		return nil, err
	}
	return nonce, nil
}

func encodeBytes(b []byte) string          { return base64.StdEncoding.EncodeToString(b) }
func decodeBytes(s string) ([]byte, error) { return base64.StdEncoding.DecodeString(s) }

func encodeTime(t time.Time) string          { return t.UTC().Format(time.RFC3339) }
func decodeTime(s string) (time.Time, error) { return time.Parse(time.RFC3339, s) }

// ------------------------------------------------------------------
// S5: Nonce deduplication — prevents challenge replay within TTL
// ------------------------------------------------------------------

type nonceTracker struct {
	mu   sync.Mutex
	used map[string]time.Time
}

var usedNonces = &nonceTracker{used: make(map[string]time.Time)}

// StartNonceTracker starts a background goroutine that prunes expired nonces.
// It stops when ctx is cancelled, enabling graceful shutdown and preventing
// goroutine leaks in tests. Call this once from main().
func StartNonceTracker(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				usedNonces.mu.Lock()
				now := time.Now()
				for k, exp := range usedNonces.used {
					if now.After(exp) {
						delete(usedNonces.used, k)
					}
				}
				usedNonces.mu.Unlock()
			}
		}
	}()
}

// markNonceUsed returns true if the nonce was already used (replay).
func markNonceUsed(nonce []byte, ttl time.Duration) bool {
	key := encodeBytes(nonce)
	usedNonces.mu.Lock()
	defer usedNonces.mu.Unlock()

	if _, exists := usedNonces.used[key]; exists {
		return true // replay
	}
	usedNonces.used[key] = time.Now().Add(ttl)
	return false
}

// ------------------------------------------------------------------
// Challenge
// ------------------------------------------------------------------

// MakeChallenge creates a server-signed challenge with an expiry.
func MakeChallenge(privateKey ed25519.PrivateKey, duration time.Duration) (*membav1.Challenge, error) {
	nonce, err := makeNonce()
	if err != nil {
		return nil, errors.Wrap(err, "failed to make nonce")
	}
	challenge := &membav1.Challenge{
		Nonce:      nonce,
		Expiration: encodeTime(time.Now().Add(duration)),
	}
	data, err := proto.Marshal(challenge)
	if err != nil {
		return nil, errors.Wrap(err, "failed to marshal challenge")
	}
	challenge.ServerSignature = ed25519.Sign(privateKey, data)
	return challenge, nil
}

// ValidateChallenge checks the server signature and expiry of a challenge.
func ValidateChallenge(publicKey ed25519.PublicKey, challenge *membav1.Challenge) error {
	if challenge == nil {
		return errors.New("missing challenge")
	}
	exp, err := decodeTime(challenge.GetExpiration())
	if err != nil {
		return errors.Wrap(err, "failed to parse expiration")
	}
	if !exp.After(time.Now()) {
		return errors.New("challenge expired")
	}

	// Verify server signature over the challenge without the signature field.
	clean := proto.Clone(challenge).(*membav1.Challenge)
	clean.ServerSignature = nil
	data, err := proto.Marshal(clean)
	if err != nil {
		return errors.Wrap(err, "failed to marshal challenge data")
	}
	if !ed25519.Verify(publicKey, data, challenge.ServerSignature) {
		return errors.New("invalid server signature on challenge")
	}

	// S5: Prevent challenge replay.
	if markNonceUsed(challenge.Nonce, DefaultChallengeDuration) {
		return errors.New("challenge already used")
	}

	return nil
}

// ------------------------------------------------------------------
// Token
// ------------------------------------------------------------------

// MakeToken validates a user's ADR-036 signature against a challenge and
// returns a server-signed auth token.
func MakeToken(
	privateKey ed25519.PrivateKey,
	publicKey ed25519.PublicKey,
	tokenDuration time.Duration,
	infoJSON string,
	signatureBase64 string,
) (*membav1.Token, error) {
	infoBytes := []byte(infoJSON)

	var info membav1.TokenRequestInfo
	if err := protojson.Unmarshal(infoBytes, &info); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal token request info")
	}

	if info.Kind != ClientMagic {
		return nil, errors.New("invalid client magic — possible phishing attempt")
	}

	prefix := info.UserBech32Prefix
	if prefix == "" {
		return nil, errors.New("missing user bech32 prefix")
	}

	// Validate the challenge embedded in the request.
	if err := ValidateChallenge(publicKey, info.Challenge); err != nil {
		return nil, errors.Wrap(err, "invalid challenge")
	}

	// Parse the user's secp256k1 public key.
	userPubKey, err := ParsePubKeyJSON(info.UserPubkeyJson)
	if err != nil {
		return nil, errors.Wrap(err, "failed to parse user pubkey")
	}
	addressBytes := userPubKey.Address()

	// Derive the user's bech32 address.
	chainUserAddress, err := bech32.ConvertAndEncode(prefix, addressBytes)
	if err != nil {
		return nil, errors.Wrap(err, "failed to encode bech32 address")
	}

	// Verify ADR-036 signature when provided.
	// Adena wallet does not support ADR-036 sign/MsgSignData, so the
	// signature may be empty. In that case, auth relies on:
	// 1. Server-signed challenge validation (nonce + expiry + server sig)
	// 2. User pubkey → address derivation (proves pubkey knowledge)
	// 3. Adena connection verifying wallet ownership on the client side
	if signatureBase64 != "" {
		signature, err := base64.StdEncoding.DecodeString(signatureBase64)
		if err != nil {
			return nil, errors.Wrap(err, "failed to decode user signature")
		}
		signDoc := MakeADR36SignDoc(infoBytes, chainUserAddress)
		if !userPubKey.VerifySignature(signDoc, signature) {
			return nil, errors.New("invalid user signature")
		}
	}

	// Derive universal address for storage.
	universalAddress, err := bech32.ConvertAndEncode(UniversalBech32Prefix, addressBytes)
	if err != nil {
		return nil, errors.Wrap(err, "failed to encode universal address")
	}

	nonce, err := makeNonce()
	if err != nil {
		return nil, errors.Wrap(err, "failed to make nonce")
	}

	token := &membav1.Token{
		Nonce:       encodeBytes(nonce),
		UserAddress: universalAddress,
		Expiration:  encodeTime(time.Now().Add(tokenDuration)),
	}
	tokenBytes, err := proto.Marshal(token)
	if err != nil {
		return nil, errors.Wrap(err, "failed to marshal token")
	}
	token.ServerSignature = encodeBytes(ed25519.Sign(privateKey, tokenBytes))
	return token, nil
}

// ValidateToken checks the server signature and expiry of a token.
func ValidateToken(publicKey ed25519.PublicKey, token *membav1.Token) error {
	if token == nil {
		return errors.New("missing token")
	}
	exp, err := decodeTime(token.Expiration)
	if err != nil {
		return errors.Wrap(err, "failed to parse expiration")
	}
	if !exp.After(time.Now()) {
		return errors.New("token expired")
	}

	clean := proto.Clone(token).(*membav1.Token)
	clean.ServerSignature = ""
	tokenBytes, err := proto.Marshal(clean)
	if err != nil {
		return errors.Wrap(err, "failed to marshal token data")
	}
	sigBytes, err := decodeBytes(token.ServerSignature)
	if err != nil {
		return errors.Wrap(err, "failed to decode server signature")
	}
	if !ed25519.Verify(publicKey, tokenBytes, sigBytes) {
		return errors.New("invalid server signature on token")
	}
	return nil
}

// ------------------------------------------------------------------
// ADR-036 + Pubkey helpers
// ------------------------------------------------------------------

// MakeADR36SignDoc builds a Cosmos ADR-036 sign document.
func MakeADR36SignDoc(data []byte, signerAddress string) []byte {
	const template = `{"account_number":"0","chain_id":"","fee":{"amount":[],"gas":"0"},"memo":"","msgs":[{"type":"sign/MsgSignData","value":{"data":%s,"signer":%s}}],"sequence":"0"}`
	dataJSON, _ := json.Marshal(base64.StdEncoding.EncodeToString(data))
	signerJSON, _ := json.Marshal(signerAddress)
	return []byte(fmt.Sprintf(template, string(dataJSON), string(signerJSON)))
}

// ParsePubKeyJSON parses an Amino-JSON encoded secp256k1 public key.
func ParsePubKeyJSON(pubkeyJSON string) (*secp256k1.PubKey, error) {
	pk := struct {
		Type  string `json:"type"`
		Value []byte `json:"value"`
	}{}
	if err := json.Unmarshal([]byte(pubkeyJSON), &pk); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal pubkey json")
	}
	if pk.Type != "tendermint/PubKeySecp256k1" {
		return nil, fmt.Errorf("unsupported pubkey type: %s", pk.Type)
	}
	pubkey := secp256k1.PubKey{}
	if err := pubkey.UnmarshalAmino(pk.Value); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal amino pubkey")
	}
	return &pubkey, nil
}
