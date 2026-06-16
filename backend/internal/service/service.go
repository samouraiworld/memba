package service

import (
	"crypto/ed25519"
	srand "crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/auth"
)

// MultisigService implements the ConnectRPC MultisigService.
type MultisigService struct {
	db         *sql.DB
	publicKey  ed25519.PublicKey
	privateKey ed25519.PrivateKey
	// chainID is the Gno chain this server is configured for (env GNO_CHAIN_ID).
	// Used to bind newly-minted auth tokens to a specific chain (AUTH-CHAINID-01).
	chainID string
	// acceptedChainIDs is the set of chain IDs whose tokens this server will
	// VALIDATE. Defaults to {chainID}; set MEMBA_ACCEPTED_CHAIN_IDS (comma-
	// separated) to serve multiple chains during a transition (e.g. test12->test13)
	// so flipping the frontend default doesn't 401 the other chain's sessions.
	acceptedChainIDs []string
}

// parseAcceptedChainIDs splits a comma-separated env value into a trimmed,
// non-empty set. When the env is unset, it falls back to the single configured
// chain (or nil/legacy-any when that is also empty).
func parseAcceptedChainIDs(env, defaultChainID string) []string {
	if strings.TrimSpace(env) == "" {
		if defaultChainID == "" {
			return nil
		}
		return []string{defaultChainID}
	}
	var out []string
	for p := range strings.SplitSeq(env, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// NewMultisigService creates a MultisigService.
// If ED25519_SEED is set (64 hex chars = 32 bytes), the keypair is deterministic
// and survives restarts. Otherwise a new keypair is generated and the seed is
// logged so the operator can persist it.
func NewMultisigService(db *sql.DB) (*MultisigService, error) {
	var privateKey ed25519.PrivateKey
	var publicKey ed25519.PublicKey

	if seedHex := os.Getenv("ED25519_SEED"); seedHex != "" {
		seed, err := hex.DecodeString(seedHex)
		if err != nil || len(seed) != ed25519.SeedSize {
			return nil, fmt.Errorf("ED25519_SEED must be %d hex chars", ed25519.SeedSize*2)
		}
		privateKey = ed25519.NewKeyFromSeed(seed)
		publicKey = privateKey.Public().(ed25519.PublicKey)
		slog.Info("loaded server keypair from ED25519_SEED")
	} else {
		var err error
		publicKey, privateKey, err = ed25519.GenerateKey(srand.Reader)
		if err != nil {
			return nil, err
		}
		slog.Warn("generated ephemeral keypair — set ED25519_SEED to persist",
			"seed", hex.EncodeToString(privateKey.Seed()))
	}

	chainID := os.Getenv("GNO_CHAIN_ID")
	if chainID == "" {
		slog.Warn("GNO_CHAIN_ID not set — auth tokens will be issued in legacy chainless mode (24h grace, then required)")
	}

	acceptedChainIDs := parseAcceptedChainIDs(os.Getenv("MEMBA_ACCEPTED_CHAIN_IDS"), chainID)
	slog.Info("auth: accepted token chain IDs", "chain_id", chainID, "accepted_chain_ids", acceptedChainIDs)

	return &MultisigService{
		db:               db,
		publicKey:        publicKey,
		privateKey:       privateKey,
		chainID:          chainID,
		acceptedChainIDs: acceptedChainIDs,
	}, nil
}

// authenticate validates a token and returns the user address.
func (s *MultisigService) authenticate(token *membav1.Token) (string, error) {
	if err := auth.ValidateToken(s.publicKey, token, s.acceptedChainIDs...); err != nil {
		return "", connect.NewError(connect.CodeUnauthenticated, err)
	}
	return token.UserAddress, nil
}

// ValidateRESTToken validates a JSON-encoded auth token from an Authorization header.
// Used by REST endpoints (IPFS upload, analyst) that can't use ConnectRPC's token field.
func (s *MultisigService) ValidateRESTToken(tokenJSON string) error {
	var token membav1.Token
	if err := json.Unmarshal([]byte(tokenJSON), &token); err != nil {
		return fmt.Errorf("invalid token format: %w", err)
	}
	return auth.ValidateToken(s.publicKey, &token, s.acceptedChainIDs...)
}

// internalError logs the real error and returns a sanitized connect error.
func internalError(ctx string, err error) error {
	slog.Error(ctx, "error", err)
	return connect.NewError(connect.CodeInternal, nil)
}
