package service

import (
	"context"
	"crypto/ed25519"
	srand "crypto/rand"
	"database/sql"
	"log/slog"

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

// NewMultisigService creates a new MultisigService with a fresh ed25519 keypair.
func NewMultisigService(db *sql.DB) (*MultisigService, error) {
	publicKey, privateKey, err := ed25519.GenerateKey(srand.Reader)
	if err != nil {
		return nil, err
	}
	slog.Info("generated server auth keypair", "pubkey_len", len(publicKey))
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

// ─── Auth RPCs ────────────────────────────────────────────────────

// GetChallenge returns a new authentication challenge.
func (s *MultisigService) GetChallenge(
	_ context.Context,
	_ *connect.Request[membav1.GetChallengeRequest],
) (*connect.Response[membav1.GetChallengeResponse], error) {
	slog.Info("GetChallenge called")

	challenge, err := auth.MakeChallenge(s.privateKey, auth.DefaultChallengeDuration)
	if err != nil {
		slog.Error("failed to make challenge", "error", err)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&membav1.GetChallengeResponse{
		Challenge: challenge,
	}), nil
}

// GetToken validates a signed challenge and returns an auth token.
func (s *MultisigService) GetToken(
	_ context.Context,
	req *connect.Request[membav1.GetTokenRequest],
) (*connect.Response[membav1.GetTokenResponse], error) {
	slog.Info("GetToken called")

	token, err := auth.MakeToken(
		s.privateKey,
		s.publicKey,
		auth.DefaultTokenDuration,
		req.Msg.GetInfoJson(),
		req.Msg.GetUserSignature(),
	)
	if err != nil {
		slog.Error("failed to make token", "error", err)
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}

	return connect.NewResponse(&membav1.GetTokenResponse{
		AuthToken: token,
	}), nil
}

// ─── Multisig RPCs ────────────────────────────────────────────────

// CreateOrJoinMultisig creates a new multisig or joins an existing one.
func (s *MultisigService) CreateOrJoinMultisig(
	_ context.Context,
	req *connect.Request[membav1.CreateOrJoinMultisigRequest],
) (*connect.Response[membav1.CreateOrJoinMultisigResponse], error) {
	if _, err := s.authenticate(req.Msg.GetAuthToken()); err != nil {
		return nil, err
	}
	slog.Info("CreateOrJoinMultisig called")
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// MultisigInfo returns info about a specific multisig.
func (s *MultisigService) MultisigInfo(
	_ context.Context,
	req *connect.Request[membav1.MultisigInfoRequest],
) (*connect.Response[membav1.MultisigInfoResponse], error) {
	if _, err := s.authenticate(req.Msg.GetAuthToken()); err != nil {
		return nil, err
	}
	slog.Info("MultisigInfo called")
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// Multisigs returns all multisigs for the authenticated user.
func (s *MultisigService) Multisigs(
	_ context.Context,
	req *connect.Request[membav1.MultisigsRequest],
) (*connect.Response[membav1.MultisigsResponse], error) {
	if _, err := s.authenticate(req.Msg.GetAuthToken()); err != nil {
		return nil, err
	}
	slog.Info("Multisigs called")
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// ─── Transaction RPCs ─────────────────────────────────────────────

// CreateTransaction creates a new transaction proposal.
func (s *MultisigService) CreateTransaction(
	_ context.Context,
	req *connect.Request[membav1.CreateTransactionRequest],
) (*connect.Response[membav1.CreateTransactionResponse], error) {
	if _, err := s.authenticate(req.Msg.GetAuthToken()); err != nil {
		return nil, err
	}
	slog.Info("CreateTransaction called")
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// Transactions returns transactions for a multisig.
func (s *MultisigService) Transactions(
	_ context.Context,
	req *connect.Request[membav1.TransactionsRequest],
) (*connect.Response[membav1.TransactionsResponse], error) {
	if _, err := s.authenticate(req.Msg.GetAuthToken()); err != nil {
		return nil, err
	}
	slog.Info("Transactions called")
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// SignTransaction adds a signature to a transaction.
func (s *MultisigService) SignTransaction(
	_ context.Context,
	req *connect.Request[membav1.SignTransactionRequest],
) (*connect.Response[membav1.SignTransactionResponse], error) {
	if _, err := s.authenticate(req.Msg.GetAuthToken()); err != nil {
		return nil, err
	}
	slog.Info("SignTransaction called")
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// CompleteTransaction marks a transaction as broadcast with its final hash.
func (s *MultisigService) CompleteTransaction(
	_ context.Context,
	req *connect.Request[membav1.CompleteTransactionRequest],
) (*connect.Response[membav1.CompleteTransactionResponse], error) {
	if _, err := s.authenticate(req.Msg.GetAuthToken()); err != nil {
		return nil, err
	}
	slog.Info("CompleteTransaction called")
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}
