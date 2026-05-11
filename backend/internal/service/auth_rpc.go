package service

import (
	"context"

	"log/slog"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/auth"
)

// ─── Auth RPCs ────────────────────────────────────────────────────

func (s *MultisigService) GetChallenge(
	_ context.Context,
	req *connect.Request[membav1.GetChallengeRequest],
) (*connect.Response[membav1.GetChallengeResponse], error) {
	pubkeyJSON := req.Msg.GetUserPubkeyJson()
	// AUTH-CHAINID-01: prefer the client-supplied chain_id; fall back to the
	// server's configured chain. Clients pre-PR0b don't send chain_id, hence
	// the fallback during the 24h grace window.
	chainID := req.Msg.GetChainId()
	if chainID == "" {
		chainID = s.chainID
	}
	slog.Info("GetChallenge called", "has_pubkey", pubkeyJSON != "", "chain_id", chainID)
	challenge, err := auth.MakeChallenge(s.privateKey, auth.DefaultChallengeDuration, pubkeyJSON, chainID)
	if err != nil {
		return nil, internalError("internal", err)
	}
	return connect.NewResponse(&membav1.GetChallengeResponse{Challenge: challenge}), nil
}

func (s *MultisigService) GetToken(
	_ context.Context,
	req *connect.Request[membav1.GetTokenRequest],
) (*connect.Response[membav1.GetTokenResponse], error) {
	slog.Info("GetToken called")
	// Pass server's default chainID for the AUTH-CHAINID-01 grace fallback.
	token, err := auth.MakeToken(s.privateKey, s.publicKey, auth.DefaultTokenDuration, req.Msg.GetInfoJson(), req.Msg.GetUserSignature(), s.chainID)
	if err != nil {
		slog.Warn("GetToken: auth failed", "error", err)
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}
	return connect.NewResponse(&membav1.GetTokenResponse{AuthToken: token}), nil
}
