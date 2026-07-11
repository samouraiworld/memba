package service

import (
	"crypto/ed25519"
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/auth"
)

// tokenDenied is the ONLY place an auth failure detail may reach the wire, and
// only as the bare session-reject code. Everything else must stay message-less
// (2026-02 audit hygiene) — these tests pin both sides of that contract.
func TestTokenDeniedWireContract(t *testing.T) {
	t.Run("session-account rejection surfaces the bare code only", func(t *testing.T) {
		wrapped := errors.New("failed to unmarshal token request info (" +
			auth.SessionRejectCode + ": strict — set MEMBA_ACCEPT_SESSION_PUBKEYS=1 to opt in)")
		cerr := tokenDenied(wrapped)

		if cerr.Code() != connect.CodePermissionDenied {
			t.Fatalf("code = %v, want permission_denied", cerr.Code())
		}
		if got := cerr.Message(); got != auth.SessionRejectCode {
			t.Fatalf("wire message = %q, want the bare code %q", got, auth.SessionRejectCode)
		}
		// The operator hint must never ride the wire.
		if strings.Contains(cerr.Message(), "MEMBA_ACCEPT_SESSION_PUBKEYS") {
			t.Fatal("wire message leaks the opt-in env var")
		}
		if strings.Contains(cerr.Message(), "unmarshal") {
			t.Fatal("wire message leaks internal error detail")
		}
	})

	t.Run("every other auth failure stays message-less", func(t *testing.T) {
		for _, msg := range []string{
			"signature mismatch",
			"challenge expired",
			"chain_id mismatch: bound test13, got test12",
		} {
			cerr := tokenDenied(errors.New(msg))
			if cerr.Code() != connect.CodePermissionDenied {
				t.Fatalf("%q: code = %v, want permission_denied", msg, cerr.Code())
			}
			if got := cerr.Message(); got != "" {
				t.Fatalf("%q: wire message = %q, want empty (message-less contract)", msg, got)
			}
		}
	})

	t.Run("nil error stays message-less", func(t *testing.T) {
		if got := tokenDenied(nil).Message(); got != "" {
			t.Fatalf("wire message = %q, want empty", got)
		}
	})
}

// authenticate guards all token-authenticated RPCs. Whatever ValidateToken's
// reason is — expired, bad signature, wrong chain, decode garbage — the wire
// must stay a message-less Unauthenticated (the reason is logged server-side).
func TestAuthenticateWireContract(t *testing.T) {
	pub, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	s := &MultisigService{publicKey: pub, acceptedChainIDs: []string{"test13"}}

	cases := map[string]*membav1.Token{
		"nil token":              nil,
		"garbage expiration+sig": {UserAddress: "g1attacker", Expiration: "not-a-time", ServerSignature: "!!!"},
		"expired token":          {UserAddress: "g1x", Expiration: "2020-01-01T00:00:00Z", ServerSignature: ""},
		"unsigned wrong-chain":   {UserAddress: "g1x", Expiration: "2999-01-01T00:00:00Z", ChainId: "evil-1"},
	}
	for name, tok := range cases {
		t.Run(name, func(t *testing.T) {
			_, aerr := s.authenticate(tok)
			if aerr == nil {
				t.Fatal("want rejection")
			}
			var cerr *connect.Error
			if !errors.As(aerr, &cerr) {
				t.Fatalf("want *connect.Error, got %T", aerr)
			}
			if cerr.Code() != connect.CodeUnauthenticated {
				t.Fatalf("code = %v, want unauthenticated", cerr.Code())
			}
			if got := cerr.Message(); got != "" {
				t.Fatalf("wire message = %q, want empty — authenticate must never echo ValidateToken's reason", got)
			}
		})
	}
}
