package service

import (
	"crypto/ed25519"
	srand "crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/auth"
)

// MultisigService implements the ConnectRPC MultisigService.
type MultisigService struct {
	db         *sql.DB
	publicKey  ed25519.PublicKey
	privateKey ed25519.PrivateKey
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

	return &MultisigService{
		db:         db,
		publicKey:  publicKey,
		privateKey: privateKey,
	}, nil
}

// authenticate validates a token and returns the user address.
func (s *MultisigService) authenticate(token *membav1.Token) (string, error) {
	if err := auth.ValidateToken(s.publicKey, token); err != nil {
		return "", connect.NewError(connect.CodeUnauthenticated, err)
	}
	return token.UserAddress, nil
}

// internalError logs the real error and returns a sanitized connect error.
func internalError(ctx string, err error) error {
	slog.Error(ctx, "error", err)
	return connect.NewError(connect.CodeInternal, nil)
}
