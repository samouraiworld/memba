package service

import (
	"context"
	"database/sql"
	"log/slog"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// MultisigService implements the ConnectRPC MultisigService.
type MultisigService struct {
	db *sql.DB
}

// NewMultisigService creates a new MultisigService.
func NewMultisigService(db *sql.DB) *MultisigService {
	return &MultisigService{db: db}
}

// GetChallenge returns a new authentication challenge.
func (s *MultisigService) GetChallenge(
	ctx context.Context,
	req *connect.Request[membav1.GetChallengeRequest],
) (*connect.Response[membav1.GetChallengeResponse], error) {
	slog.Info("GetChallenge called")
	// TODO: implement challenge generation (ed25519 nonce + server signature)
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// GetToken validates a signed challenge and returns an auth token.
func (s *MultisigService) GetToken(
	ctx context.Context,
	req *connect.Request[membav1.GetTokenRequest],
) (*connect.Response[membav1.GetTokenResponse], error) {
	slog.Info("GetToken called")
	// TODO: implement token generation
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// CreateOrJoinMultisig creates a new multisig or joins an existing one.
func (s *MultisigService) CreateOrJoinMultisig(
	ctx context.Context,
	req *connect.Request[membav1.CreateOrJoinMultisigRequest],
) (*connect.Response[membav1.CreateOrJoinMultisigResponse], error) {
	slog.Info("CreateOrJoinMultisig called")
	// TODO: implement
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// MultisigInfo returns info about a specific multisig.
func (s *MultisigService) MultisigInfo(
	ctx context.Context,
	req *connect.Request[membav1.MultisigInfoRequest],
) (*connect.Response[membav1.MultisigInfoResponse], error) {
	slog.Info("MultisigInfo called")
	// TODO: implement
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// Multisigs returns all multisigs for the authenticated user.
func (s *MultisigService) Multisigs(
	ctx context.Context,
	req *connect.Request[membav1.MultisigsRequest],
) (*connect.Response[membav1.MultisigsResponse], error) {
	slog.Info("Multisigs called")
	// TODO: implement
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// CreateTransaction creates a new transaction proposal.
func (s *MultisigService) CreateTransaction(
	ctx context.Context,
	req *connect.Request[membav1.CreateTransactionRequest],
) (*connect.Response[membav1.CreateTransactionResponse], error) {
	slog.Info("CreateTransaction called")
	// TODO: implement
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// Transactions returns transactions for a multisig.
func (s *MultisigService) Transactions(
	ctx context.Context,
	req *connect.Request[membav1.TransactionsRequest],
) (*connect.Response[membav1.TransactionsResponse], error) {
	slog.Info("Transactions called")
	// TODO: implement
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// SignTransaction adds a signature to a transaction.
func (s *MultisigService) SignTransaction(
	ctx context.Context,
	req *connect.Request[membav1.SignTransactionRequest],
) (*connect.Response[membav1.SignTransactionResponse], error) {
	slog.Info("SignTransaction called")
	// TODO: implement
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// CompleteTransaction marks a transaction as broadcast with its final hash.
func (s *MultisigService) CompleteTransaction(
	ctx context.Context,
	req *connect.Request[membav1.CompleteTransactionRequest],
) (*connect.Response[membav1.CompleteTransactionResponse], error) {
	slog.Info("CompleteTransaction called")
	// TODO: implement
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}
