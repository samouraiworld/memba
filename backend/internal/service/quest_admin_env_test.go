package service

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// Unset/blank QUEST_ADMIN_ADDRESSES must fail closed: no built-in admin. The old
// default was a testnet multisig, which can't sign the wallet login anyway.
func TestQuestAdminAddresses_EmptyWhenUnset(t *testing.T) {
	for _, v := range []string{"", "   ", " , ,"} {
		t.Setenv("QUEST_ADMIN_ADDRESSES", v)
		if admins := questAdminAddresses(); len(admins) != 0 {
			t.Fatalf("QUEST_ADMIN_ADDRESSES=%q: expected no admins, got %v", v, admins)
		}
	}
}

func TestQuestAdminAddresses_EnvOverride(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", " g1aaa , ,g1bbb ")
	admins := questAdminAddresses()
	if !admins["g1aaa"] || !admins["g1bbb"] || len(admins) != 2 {
		t.Fatalf("expected exactly {g1aaa, g1bbb} from env (trimmed, blanks dropped), got %v", admins)
	}
}

// With no admins configured, the former default address (and everyone else) is
// denied on both admin RPCs.
func TestQuestAdminRPCs_DeniedWhenUnset(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", "")
	h := setup(t)
	user := h.makeToken(t, "g1alice")
	h.submitClaim(t, user, "fix-upstream-bug", "https://example.com/pr/1", "proof")
	claim := h.getClaim(t, "g1alice", "fix-upstream-bug")

	for _, addr := range []string{"g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0", "g1alice"} {
		tok := h.makeToken(t, addr)

		_, err := h.svc.ListPendingClaims(context.Background(), connect.NewRequest(&membav1.ListPendingClaimsRequest{AuthToken: tok}))
		if code := connectCode(err); code != connect.CodePermissionDenied {
			t.Fatalf("ListPendingClaims as %s: want PermissionDenied, got %v", addr, err)
		}

		_, err = h.svc.ReviewQuestClaim(context.Background(), connect.NewRequest(&membav1.ReviewQuestClaimRequest{
			AuthToken: tok, ClaimId: claim.id, Approved: true,
		}))
		if code := connectCode(err); code != connect.CodePermissionDenied {
			t.Fatalf("ReviewQuestClaim as %s: want PermissionDenied, got %v", addr, err)
		}
	}

	if got := h.getClaim(t, "g1alice", "fix-upstream-bug").status; got != "pending" {
		t.Fatalf("claim must stay pending when no admin is configured, got %q", got)
	}
}

func connectCode(err error) connect.Code {
	var ce *connect.Error
	if errors.As(err, &ce) {
		return ce.Code()
	}
	return 0
}
