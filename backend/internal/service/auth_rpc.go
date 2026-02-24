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
	_ *connect.Request[membav1.GetChallengeRequest],
) (*connect.Response[membav1.GetChallengeResponse], error) {
	slog.Info("GetChallenge called")
	challenge, err := auth.MakeChallenge(s.privateKey, auth.DefaultChallengeDuration)
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
	token, err := auth.MakeToken(s.privateKey, s.publicKey, auth.DefaultTokenDuration, req.Msg.GetInfoJson(), req.Msg.GetUserSignature())
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}
	return connect.NewResponse(&membav1.GetTokenResponse{AuthToken: token}), nil
}
