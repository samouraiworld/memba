package service

import (
	"context"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// ─── Sign-In with Ethereum RPCs ───────────────────────────────────
//
// Declared so the API surface exists for the EVM client, and Unimplemented:
// no challenge is issued and no EVM token is minted. The login itself lands
// behind an explicit, default-off switch in a later change.

// GetSiweChallenge is not served yet.
func (s *MultisigService) GetSiweChallenge(
	context.Context, *connect.Request[membav1.GetSiweChallengeRequest],
) (*connect.Response[membav1.GetSiweChallengeResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}

// GetSiweToken is not served yet.
func (s *MultisigService) GetSiweToken(
	context.Context, *connect.Request[membav1.GetSiweTokenRequest],
) (*connect.Response[membav1.GetSiweTokenResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, nil)
}
