package auth

import (
	"context"
	"crypto/ed25519"
	srand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
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

// hashPubkey computes SHA256 of a pubkey JSON string for challenge binding.
func hashPubkey(pubkeyJSON string) string {
	h := sha256.Sum256([]byte(pubkeyJSON))
	return hex.EncodeToString(h[:])
}

// MakeChallenge creates a server-signed challenge with an expiry.
// If pubkeyJSON is non-empty, the challenge is cryptographically bound to that
// pubkey — only the holder of that key can use this challenge to obtain a token.
// This prevents AUTH-01: attackers cannot reuse a challenge with a different pubkey.
// If chainID is non-empty, the challenge is bound to that chain (AUTH-CHAINID-01):
// a challenge issued for test12 cannot be replayed against gnoland1.
func MakeChallenge(privateKey ed25519.PrivateKey, duration time.Duration, pubkeyJSON, chainID string) (*membav1.Challenge, error) {
	nonce, err := makeNonce()
	if err != nil {
		return nil, errors.Wrap(err, "failed to make nonce")
	}
	challenge := &membav1.Challenge{
		Nonce:      nonce,
		Expiration: encodeTime(time.Now().Add(duration)),
		ChainId:    chainID,
	}
	if pubkeyJSON != "" {
		challenge.BoundPubkeyHash = hashPubkey(pubkeyJSON)
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
// returns a server-signed auth token bound to a specific chain.
//
// AUTH-CHAINID-01 (advisory MEMBA-2026-001): tokens carry the chain they were
// issued for. ADR-036 signDoc embeds chainID, so a signature produced for
// test12 cannot be verified against a signDoc claiming gnoland1.
//
// defaultChainID is the server's configured chain (env GNO_CHAIN_ID). It is
// used when the client's TokenRequestInfo.ChainID is empty (24h legacy grace
// window during the v7.1 rollout — clients pre-PR0b don't send chain_id).
// The effective chainID is recorded in both the ADR-036 signDoc and the
// returned token.ChainId.
// SessionPubkeyOptInEnv toggles AUTH-SESSION-REJECT-01. Setting it to "1" or
// "true" relaxes TokenRequestInfo unmarshal from strict back to lenient so a
// future Adena release that adds session metadata fields can be accepted
// without a code change. Default (unset / any other value) is strict.
const SessionPubkeyOptInEnv = "MEMBA_ACCEPT_SESSION_PUBKEYS"

// sessionPubkeysAccepted reads the kill switch at call time so tests and
// operators can flip it without restarting the process. Conservative parse:
// only "1" / "true" / "TRUE" opt in; everything else stays strict.
func sessionPubkeysAccepted() bool {
	switch os.Getenv(SessionPubkeyOptInEnv) {
	case "1", "true", "TRUE":
		return true
	default:
		return false
	}
}

// AllowUnsignedAuthEnv gates the A2 empty-signature policy (two-phase, lockout-safe).
// A user signature is the ONLY proof of private-key ownership: pubkeys are public
// on-chain and the challenge binding only proves the challenge was *requested* for
// a pubkey, so an empty signature lets anyone mint a token for any address
// (impersonation). Rollout:
//   - Phase 1 (default / unset / "1" / "true"): empty sigs ACCEPTED but emitted on
//     the auth_login gate-signal metric, so the signed-login ratio can be observed
//     before enforcing. Lockout-safe — deploying this does not break current
//     unsigned clients.
//   - Phase 2 ("0" / "false"): empty sigs REJECTED. Flip once the observed
//     signed-login ratio ≈ 100% (24h token TTL means stragglers re-auth within a day).
const AllowUnsignedAuthEnv = "MEMBA_ALLOW_UNSIGNED_AUTH"

func allowUnsignedAuth() bool {
	switch os.Getenv(AllowUnsignedAuthEnv) {
	case "0", "false", "FALSE":
		return false // Phase 2: enforce
	default:
		return true // Phase 1: accept + log (default, lockout-safe)
	}
}

// logAuthLogin emits the auth_login gate signal — a structured, countable log line
// (the backend has no metrics backend yet). result ∈ {signed, signed_invalid,
// signed_invalid_rejected, empty_allowed, empty_rejected}; operators aggregate/alert
// on metric="auth_login" to watch the signed-login ratio before flipping
// AllowUnsignedAuthEnv to enforce. "signed_invalid" means a signature was present but
// did not verify (e.g. an Adena canonical-doc mismatch) and was accepted in phase 1.
func logAuthLogin(result, address, chainID string) {
	slog.Info("auth_login",
		"metric", "auth_login",
		"result", result,
		"address", address,
		"chain_id", chainID,
	)
}

func MakeToken(
	privateKey ed25519.PrivateKey,
	publicKey ed25519.PublicKey,
	tokenDuration time.Duration,
	infoJSON string,
	signatureBase64 string,
	defaultChainID string,
) (*membav1.Token, error) {
	infoBytes := []byte(infoJSON)

	// AUTH-SESSION-REJECT-01 (Phase 1.9b defensive measure):
	// Adena 1.20+ is expected to ship multichain session-pubkey signatures
	// using derived subaccount keys. The session pubkey would parse and
	// derive an address, but that address ≠ the user's main on-chain account
	// — silently misattributing identity.
	//
	// We cannot tell a session secp256k1 pubkey from a main one by inspection
	// alone, so the defensive contract is to refuse TokenRequestInfo payloads
	// that carry fields we don't recognise. Adena 1.20+ is expected to add a
	// session_* / parent_* signal; strict unmarshal trips on it and we log
	// the reject so operators know when the rollout hits production.
	//
	// Kill switch: SessionPubkeyOptInEnv ("MEMBA_ACCEPT_SESSION_PUBKEYS=1")
	// flips back to DiscardUnknown:true once we explicitly opt in.
	var info membav1.TokenRequestInfo
	unmarshaler := protojson.UnmarshalOptions{DiscardUnknown: sessionPubkeysAccepted()}
	if err := unmarshaler.Unmarshal(infoBytes, &info); err != nil {
		slog.Warn("AUTH-SESSION-REJECT-01: TokenRequestInfo unmarshal failed",
			"err", err.Error(),
			"opt_in_env", SessionPubkeyOptInEnv,
			"hint", "if this is an Adena 1.20+ session signature, set MEMBA_ACCEPT_SESSION_PUBKEYS=1 to opt in")
		return nil, errors.Wrap(err, "failed to unmarshal token request info (AUTH-SESSION-REJECT-01: strict — set "+SessionPubkeyOptInEnv+"=1 to opt in)")
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

	// AUTH-CHAINID-01: derive the chain this auth is for. Prefer the
	// client-provided value; fall back to the server's default during the
	// grace window. If both are empty we still proceed but log it — the
	// resulting ADR-036 signDoc will use "" (legacy behavior).
	effectiveChainID := info.ChainId
	if effectiveChainID == "" {
		effectiveChainID = defaultChainID
		if effectiveChainID == "" {
			slog.Warn("auth: chain_id missing and no server default — legacy mode (deprecated, will be required after grace window)")
		} else {
			slog.Info("auth: using server default chain_id", "chain_id", effectiveChainID)
		}
	}

	// If the challenge was bound to a chain (newer GetChallenge clients), it
	// must match the effective chain we're about to issue a token for.
	if info.Challenge != nil && info.Challenge.ChainId != "" && info.Challenge.ChainId != effectiveChainID {
		slog.Warn("auth: challenge chain_id mismatch",
			"challenge_chain_id", info.Challenge.ChainId,
			"effective_chain_id", effectiveChainID)
		return nil, errors.New("challenge was issued for a different chain — request a new challenge")
	}

	// Derive the user's address — pubkey is REQUIRED (v5: address-only rejected, v6: pubkey binding enforced).
	var chainUserAddress, universalAddress string

	if info.UserPubkeyJson != "" {
		// Standard path: parse pubkey → derive address.
		userPubKey, err := ParsePubKeyJSON(info.UserPubkeyJson)
		if err != nil {
			return nil, errors.Wrap(err, "failed to parse user pubkey")
		}
		addressBytes := userPubKey.Address()

		chainUserAddress, err = bech32.ConvertAndEncode(prefix, addressBytes)
		if err != nil {
			return nil, errors.Wrap(err, "failed to encode bech32 address")
		}

		// v6 AUTH-01: Verify the challenge was issued for THIS specific pubkey.
		// This prevents an attacker from requesting a challenge and using it
		// with a victim's pubkey (pubkeys are public on-chain data).
		if info.Challenge != nil && info.Challenge.BoundPubkeyHash != "" {
			expectedHash := hashPubkey(info.UserPubkeyJson)
			if info.Challenge.BoundPubkeyHash != expectedHash {
				slog.Warn("pubkey-bound challenge mismatch",
					"expected_hash", info.Challenge.BoundPubkeyHash,
					"provided_hash", expectedHash)
				return nil, errors.New("challenge was issued for a different pubkey — request a new challenge")
			}
		} else {
			// Challenge without pubkey binding — reject.
			// Old clients must update to send pubkey in GetChallenge.
			slog.Warn("challenge without pubkey binding rejected",
				"address", chainUserAddress)
			return nil, errors.New("challenge must be bound to a pubkey — please update your client")
		}

		// A2: a user signature is the only proof of private-key ownership. Verify
		// it when present; gate the empty case behind the two-phase enforcement
		// switch (AllowUnsignedAuthEnv) and record the auth_login gate signal.
		if signatureBase64 != "" {
			// Adena has no ADR-036 — it signs only tx-shaped docs. The login proof
			// is therefore a non-broadcast tx-shaped challenge embedding the server
			// nonce + chain_id, verified over gno-canonical sign-bytes
			// (LoginChallengeSignBytes). The challenge nonce (validated above for
			// server-signature/expiry/replay and bound to this pubkey) is the
			// anti-replay binding; chain binding comes from the signDoc chain_id.
			if verr := VerifyLoginChallengeSignature(
				userPubKey, effectiveChainID, chainUserAddress, info.Challenge.Nonce, signatureBase64,
			); verr != nil {
				// Present-but-invalid signature — most often Adena's canonical sign-doc
				// bytes diverging from LoginChallengeSignBytes. Gate it exactly like the
				// empty-sig case: enforce only in phase 2. Phase 1 must NOT hard-fail
				// (that caused a 403 login outage when the frontend began sending real
				// Adena signatures that did not yet match the reconstructed doc).
				if !allowUnsignedAuth() {
					logAuthLogin("signed_invalid_rejected", chainUserAddress, effectiveChainID)
					slog.Warn("auth: AUTH-UNSIGNED-01 — user signature did not verify (enforcement on)",
						"address", chainUserAddress, "err", verr.Error())
					return nil, errors.New("invalid user signature")
				}
				logAuthLogin("signed_invalid", chainUserAddress, effectiveChainID)
				// AUTH-A2-DEBUG (temporary): emit the reconstructed sign-bytes + received
				// signature so the login-doc template can be reconciled with Adena's
				// actual output. Remove once signed-login ratio is ~100%.
				if signBytes, sbErr := LoginChallengeSignBytes(effectiveChainID, chainUserAddress, info.Challenge.Nonce); sbErr == nil {
					slog.Warn("auth: AUTH-A2-DEBUG — tx-shaped login signature did not verify (accepted in phase 1)",
						"address", chainUserAddress,
						"chain_id", effectiveChainID,
						"nonce_b64", base64.StdEncoding.EncodeToString(info.Challenge.Nonce),
						"reconstructed_sign_bytes", string(signBytes),
						"signature_b64", signatureBase64,
						"user_pubkey_json", info.UserPubkeyJson,
						"err", verr.Error())
				}
			} else {
				logAuthLogin("signed", chainUserAddress, effectiveChainID)
			}
		} else {
			// A2.phase1: empty signature = NO cryptographic proof of key ownership.
			// Pubkeys are public and the challenge binding only proves the challenge
			// was requested for this pubkey, so an empty sig is impersonation-capable.
			if !allowUnsignedAuth() {
				logAuthLogin("empty_rejected", chainUserAddress, effectiveChainID)
				slog.Warn("auth: AUTH-UNSIGNED-01 — empty user signature rejected (enforcement on)",
					"address", chainUserAddress)
				return nil, errors.New("user signature is required")
			}
			logAuthLogin("empty_allowed", chainUserAddress, effectiveChainID)
			slog.Warn("auth: AUTH-UNSIGNED-01 — token minted WITHOUT a user signature "+
				"(impersonation-capable; set "+AllowUnsignedAuthEnv+"=0 to enforce)",
				"address", chainUserAddress,
				"chain_id", effectiveChainID)
		}

		universalAddress, err = bech32.ConvertAndEncode(UniversalBech32Prefix, addressBytes)
		if err != nil {
			return nil, errors.Wrap(err, "failed to encode universal address")
		}
	} else if info.UserAddress != "" {
		// Address-only path REJECTED (v5 security hardening).
		// Previously allowed wallets that hadn't transacted on-chain to authenticate
		// with just an address (no cryptographic proof of ownership). This is an
		// impersonation risk: any caller with a valid challenge could claim any address.
		//
		// Users must now have a pubkey (i.e., have made at least one on-chain TX or
		// used a wallet that exposes the pubkey). The faucet flow provides this for
		// new accounts.
		slog.Warn("address-only auth attempt rejected",
			"address", info.UserAddress,
			"reason", "pubkey required for authentication (v5 security policy)")
		return nil, errors.New("pubkey is required for authentication — please ensure your wallet has transacted on-chain at least once (e.g., use the faucet)")
	} else {
		return nil, errors.New("either user_pubkey_json or user_address must be provided")
	}

	nonce, err := makeNonce()
	if err != nil {
		return nil, errors.Wrap(err, "failed to make nonce")
	}

	token := &membav1.Token{
		Nonce:       encodeBytes(nonce),
		UserAddress: universalAddress,
		Expiration:  encodeTime(time.Now().Add(tokenDuration)),
		ChainId:     effectiveChainID,
	}
	tokenBytes, err := proto.Marshal(token)
	if err != nil {
		return nil, errors.Wrap(err, "failed to marshal token")
	}
	token.ServerSignature = encodeBytes(ed25519.Sign(privateKey, tokenBytes))
	return token, nil
}

// ValidateToken checks the server signature and expiry of a token.
//
// AUTH-CHAINID-01: if expectedChainID is non-empty and the token carries a
// non-empty ChainId, they must match — this rejects tokens issued for one
// chain when used against another. Empty values on either side fall through
// (24h legacy grace window).
func ValidateToken(publicKey ed25519.PublicKey, token *membav1.Token, expectedChainID string) error {
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

	// AUTH-CHAINID-01: enforce chain binding.
	if expectedChainID != "" && token.ChainId != "" && token.ChainId != expectedChainID {
		slog.Warn("auth: token chain mismatch",
			"token_chain_id", token.ChainId,
			"expected_chain_id", expectedChainID)
		return errors.New("token issued for a different chain")
	}
	if expectedChainID != "" && token.ChainId == "" {
		// Legacy token (issued pre-AUTH-CHAINID-01) — accept during 24h grace,
		// log so we can monitor the legacy footprint.
		slog.Info("auth: accepting legacy token without chain_id (grace window)",
			"expected_chain_id", expectedChainID)
	}

	return nil
}

// ------------------------------------------------------------------
// ADR-036 + Pubkey helpers
// ------------------------------------------------------------------

// MakeADR36SignDoc builds a Cosmos ADR-036 sign document.
//
// AUTH-CHAINID-01 (advisory MEMBA-2026-001): chainID is now embedded in the
// signDoc. Previously hardcoded to "", which made signatures bit-identical
// across chains and exposed Memba to cross-chain replay once it ran on
// multiple Gno networks (test12, gnoland1). chainID must be safely
// JSON-encoded since it lands inside the JSON template.
func MakeADR36SignDoc(data []byte, signerAddress, chainID string) []byte {
	const template = `{"account_number":"0","chain_id":%s,"fee":{"amount":[],"gas":"0"},"memo":"","msgs":[{"type":"sign/MsgSignData","value":{"data":%s,"signer":%s}}],"sequence":"0"}`
	chainJSON, _ := json.Marshal(chainID)
	dataJSON, _ := json.Marshal(base64.StdEncoding.EncodeToString(data))
	signerJSON, _ := json.Marshal(signerAddress)
	return fmt.Appendf(nil, template, string(chainJSON), string(dataJSON), string(signerJSON))
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
