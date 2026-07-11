package service

import (
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"
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
