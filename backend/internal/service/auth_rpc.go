package service

import (
	"context"
	"errors"
	"strings"

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
		return nil, tokenDenied(err)
	}
	return connect.NewResponse(&membav1.GetTokenResponse{AuthToken: token}), nil
}

// tokenDenied maps a MakeToken failure to its wire error. Deliberately
// message-less (2026-02 audit hygiene: auth internals never reach clients),
// with ONE narrow exception: the session-account rejection surfaces
// auth.SessionRejectCode — the bare code and nothing else — so the UI can tell
// the user to switch off a session account instead of dead-ending on a
// generic. The code names no env var and discloses nothing actionable (the
// strict/lenient opt-in hint stays in server logs only).
func tokenDenied(err error) *connect.Error {
	if err != nil && strings.Contains(err.Error(), auth.SessionRejectCode) {
		return connect.NewError(connect.CodePermissionDenied, errors.New(auth.SessionRejectCode))
	}
	return connect.NewError(connect.CodePermissionDenied, nil)
}

// sigVerifyDenied maps an enforce-mode multisig signature-verification failure
// (tx_rpc.go A3 path) to its wire error. The verifier's reason — sign-bytes
// reconstruction internals — stays in the adjacent log line; the wire carries
// only static, actionable copy: useless to a forger probing the reconstruction,
// sufficient for a legitimate signer whose wallet produced a stale signature.
func sigVerifyDenied() *connect.Error {
	return connect.NewError(connect.CodeInvalidArgument,
		errors.New("signature verification failed — re-sign the transaction and try again"))
}
