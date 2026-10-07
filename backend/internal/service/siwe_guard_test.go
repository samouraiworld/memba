package service

import (
	"context"
	srand "crypto/rand"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// evmToken is a token correctly signed by this server's key for an EVM chain:
// the strongest form a Sign-In with Ethereum session can take. Nothing mints
// one yet; the tests forge it to prove Gno-only handlers refuse it anyway.
func (h *testHarness) evmToken(t *testing.T, chainID, user string) *membav1.Token {
	t.Helper()
	nonce := make([]byte, 32)
	_, _ = srand.Read(nonce)
	tok := &membav1.Token{
		Nonce:       hex.EncodeToString(nonce),
		UserAddress: user,
		Expiration:  time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
		ChainId:     chainID,
	}
	b, err := proto.Marshal(tok)
	if err != nil {
		t.Fatal(err)
	}
	tok.ServerSignature = base64.StdEncoding.EncodeToString(ed25519.Sign(h.svc.privateKey, b))
	return tok
}

const evmUser = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"

// Every RPC behind authenticate refuses an EVM-chain token, in both the
// configured posture and the legacy accept-any one (no accepted chain set),
// where ValidateToken alone would have let it through.
func TestAuthenticatedRPCsRefuseEVMTokens(t *testing.T) {
	for _, accepted := range [][]string{nil, {"gnoland-1"}, {"gnoland-1", "eip155:8453"}} {
		h := setup(t)
		h.svc.acceptedChainIDs = accepted
		h.svc.SetBlockParty(true, "", "") // SubmitScore checks its feature flag before auth
		for _, chain := range []string{"eip155:8453", "eip155:84532", "eip155:", "eip155:junk"} {
			tok := h.evmToken(t, chain, evmUser)
			ctx := context.Background()
			calls := map[string]func() error{
				"SubmitScore": func() error {
					_, err := h.svc.SubmitScore(ctx, connect.NewRequest(&membav1.SubmitScoreRequest{AuthToken: tok}))
					return err
				},
				"FavoriteAgent": func() error {
					_, err := h.svc.FavoriteAgent(ctx, connect.NewRequest(&membav1.FavoriteAgentRequest{AuthToken: tok, AgentId: "a"}))
					return err
				},
				"GetFavorites": func() error {
					_, err := h.svc.GetFavorites(ctx, connect.NewRequest(&membav1.GetFavoritesRequest{AuthToken: tok}))
					return err
				},
				"CreateOrJoinMultisig": func() error {
					_, err := h.svc.CreateOrJoinMultisig(ctx, connect.NewRequest(&membav1.CreateOrJoinMultisigRequest{AuthToken: tok}))
					return err
				},
				"MultisigInfo": func() error {
					_, err := h.svc.MultisigInfo(ctx, connect.NewRequest(&membav1.MultisigInfoRequest{AuthToken: tok}))
					return err
				},
				"Multisigs": func() error {
					_, err := h.svc.Multisigs(ctx, connect.NewRequest(&membav1.MultisigsRequest{AuthToken: tok}))
					return err
				},
				"UpdateProfile": func() error {
					_, err := h.svc.UpdateProfile(ctx, connect.NewRequest(&membav1.UpdateProfileRequest{AuthToken: tok, Profile: &membav1.Profile{Bio: "x"}}))
					return err
				},
				"CompleteQuest": func() error {
					_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{AuthToken: tok, QuestId: "q"}))
					return err
				},
				"ListPendingClaims": func() error {
					_, err := h.svc.ListPendingClaims(ctx, connect.NewRequest(&membav1.ListPendingClaimsRequest{AuthToken: tok}))
					return err
				},
				"ReviewQuestClaim": func() error {
					_, err := h.svc.ReviewQuestClaim(ctx, connect.NewRequest(&membav1.ReviewQuestClaimRequest{AuthToken: tok}))
					return err
				},
				"SubmitQuestClaim": func() error {
					_, err := h.svc.SubmitQuestClaim(ctx, connect.NewRequest(&membav1.SubmitQuestClaimRequest{AuthToken: tok}))
					return err
				},
				"SyncQuests": func() error {
					_, err := h.svc.SyncQuests(ctx, connect.NewRequest(&membav1.SyncQuestsRequest{AuthToken: tok}))
					return err
				},
				"CreateServiceListing": func() error {
					_, err := h.svc.CreateServiceListing(ctx, connect.NewRequest(&membav1.CreateServiceListingRequest{AuthToken: tok}))
					return err
				},
				"UpdateServiceListing": func() error {
					_, err := h.svc.UpdateServiceListing(ctx, connect.NewRequest(&membav1.UpdateServiceListingRequest{AuthToken: tok}))
					return err
				},
				"CreateTeam": func() error {
					_, err := h.svc.CreateTeam(ctx, connect.NewRequest(&membav1.CreateTeamRequest{AuthToken: tok, Name: "t"}))
					return err
				},
				"GetMyTeams": func() error {
					_, err := h.svc.GetMyTeams(ctx, connect.NewRequest(&membav1.GetMyTeamsRequest{AuthToken: tok}))
					return err
				},
				"GetTeam": func() error {
					_, err := h.svc.GetTeam(ctx, connect.NewRequest(&membav1.GetTeamRequest{AuthToken: tok}))
					return err
				},
				"JoinTeam": func() error {
					_, err := h.svc.JoinTeam(ctx, connect.NewRequest(&membav1.JoinTeamRequest{AuthToken: tok}))
					return err
				},
				"LeaveTeam": func() error {
					_, err := h.svc.LeaveTeam(ctx, connect.NewRequest(&membav1.LeaveTeamRequest{AuthToken: tok}))
					return err
				},
				"UpdateTeamMemberRole": func() error {
					_, err := h.svc.UpdateTeamMemberRole(ctx, connect.NewRequest(&membav1.UpdateTeamMemberRoleRequest{AuthToken: tok}))
					return err
				},
				"CompleteTransaction": func() error {
					_, err := h.svc.CompleteTransaction(ctx, connect.NewRequest(&membav1.CompleteTransactionRequest{AuthToken: tok}))
					return err
				},
				"CreateTransaction": func() error {
					_, err := h.svc.CreateTransaction(ctx, connect.NewRequest(&membav1.CreateTransactionRequest{AuthToken: tok}))
					return err
				},
				"GetTransaction": func() error {
					_, err := h.svc.GetTransaction(ctx, connect.NewRequest(&membav1.GetTransactionRequest{AuthToken: tok}))
					return err
				},
				"SignTransaction": func() error {
					_, err := h.svc.SignTransaction(ctx, connect.NewRequest(&membav1.SignTransactionRequest{AuthToken: tok}))
					return err
				},
				"Transactions": func() error {
					_, err := h.svc.Transactions(ctx, connect.NewRequest(&membav1.TransactionsRequest{AuthToken: tok}))
					return err
				},
			}
			for name, call := range calls {
				err := call()
				var cerr *connect.Error
				if !errors.As(err, &cerr) || cerr.Code() != connect.CodeUnauthenticated || cerr.Message() != "" {
					t.Errorf("accepted=%v chain=%q %s: err = %v, want a message-less Unauthenticated", accepted, chain, name, err)
				}
			}
		}
	}
}

// The same server-signed token on a Gno chain passes: the refusal is about the
// namespace, not the signature.
func TestAuthenticateStillAcceptsGnoTokens(t *testing.T) {
	h := setup(t)
	h.svc.acceptedChainIDs = []string{"gnoland-1"}
	tok := h.evmToken(t, "gnoland-1", "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	addr, err := h.svc.authenticate(tok)
	if err != nil || addr != "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" {
		t.Fatalf("authenticate = %q, %v", addr, err)
	}
	// Legacy token without a chain id (grace path) is unaffected too.
	legacy := h.makeToken(t, "g1testuser123")
	if _, err := h.svc.authenticate(legacy); err != nil {
		t.Fatal(err)
	}
}

func TestRESTTokensRefuseEVMChains(t *testing.T) {
	h := setup(t)
	for _, accepted := range [][]string{nil, {"gnoland-1", "eip155:8453"}} {
		h.svc.acceptedChainIDs = accepted
		raw, err := protojson.Marshal(h.evmToken(t, "eip155:8453", evmUser))
		if err != nil {
			t.Fatal(err)
		}
		if addr, chain, err := h.svc.ValidateRESTTokenIdentity(string(raw)); err == nil {
			t.Fatalf("accepted=%v: REST accepted an EVM token for %q on %q", accepted, addr, chain)
		}
		if err := h.svc.ValidateRESTToken(string(raw)); err == nil {
			t.Fatal("ValidateRESTToken accepted an EVM token")
		}
	}
	raw, _ := protojson.Marshal(h.evmToken(t, "gnoland-1", "g1testuser123"))
	h.svc.acceptedChainIDs = []string{"gnoland-1"}
	if addr, err := h.svc.ValidateRESTTokenAddress(string(raw)); err != nil || addr != "g1testuser123" {
		t.Fatalf("Gno REST token refused: %q %v", addr, err)
	}
}

func TestSiweRPCsAreUnimplemented(t *testing.T) {
	h := setup(t)
	_, err := h.svc.GetSiweChallenge(context.Background(), connect.NewRequest(&membav1.GetSiweChallengeRequest{ChainId: "eip155:8453"}))
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("GetSiweChallenge: %v", err)
	}
	_, err = h.svc.GetSiweToken(context.Background(), connect.NewRequest(&membav1.GetSiweTokenRequest{Message: "x", Signature: "0x"}))
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("GetSiweToken: %v", err)
	}
}
