package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/samouraiworld/memba/backend/internal/ratelimit"
)

// TestValidateRESTTokenAddress_ReturnsAddress proves the REST auth helper recovers the
// authenticated wallet address (needed to key the per-wallet upload cap) and still
// rejects a malformed token — same validation contract as ValidateRESTToken.
func TestValidateRESTTokenAddress_ReturnsAddress(t *testing.T) {
	h := setup(t)

	tokenJSON, err := json.Marshal(h.makeToken(t, "g1uploader"))
	if err != nil {
		t.Fatalf("marshal token: %v", err)
	}
	addr, err := h.svc.ValidateRESTTokenAddress(string(tokenJSON))
	if err != nil {
		t.Fatalf("valid token should authenticate: %v", err)
	}
	if addr != "g1uploader" {
		t.Fatalf("expected address g1uploader, got %q", addr)
	}

	if _, err := h.svc.ValidateRESTTokenAddress("{not valid json"); err == nil {
		t.Fatal("malformed token JSON must be rejected")
	}
}

// TestAllowUpload_PerWalletCap proves the per-authenticated-wallet media-upload cap:
// once a wallet exceeds its quota AllowUpload returns false, while a different wallet
// keeps its own bucket — and with no limiter installed it never blocks.
func TestAllowUpload_PerWalletCap(t *testing.T) {
	h := setup(t)

	// No limiter (harness default) → the cap is a no-op.
	for i := 0; i < 5; i++ {
		if !h.svc.AllowUpload("g1nolimit") {
			t.Fatalf("AllowUpload must never block when no limiter is configured (call %d)", i+1)
		}
	}

	// Install a tiny per-wallet quota so enforcement is fast + deterministic.
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	h.svc.SetUserLimiter(ratelimit.New(ctx, map[string]ratelimit.Config{
		ratelimit.ImageUploadEndpoint: {MaxRequests: 2, Window: time.Minute},
	}))

	if !h.svc.AllowUpload("g1alice") {
		t.Fatal("first upload for a wallet should pass")
	}
	if !h.svc.AllowUpload("g1alice") {
		t.Fatal("second upload for a wallet should pass")
	}
	if h.svc.AllowUpload("g1alice") {
		t.Fatal("third upload for the same wallet should be blocked")
	}
	if !h.svc.AllowUpload("g1bob") {
		t.Fatal("a different wallet must have its own bucket")
	}
}

// The frontend stores the session token camelCase (useAuth.saveToken) and
// sends that exact string as the Bearer for /api/upload/* and
// /api/arcade/submit. encoding/json decoded it to an empty address and
// signature, so every such request was refused with 401. Both spellings must
// authenticate, and a tampered token must still fail.
func TestValidateRESTTokenAddress_AcceptsFrontendCamelCaseToken(t *testing.T) {
	h := setup(t)
	tok := h.makeToken(t, "g1uploader")

	camel, err := json.Marshal(map[string]string{
		"nonce":           tok.Nonce,
		"userAddress":     tok.UserAddress,
		"expiration":      tok.Expiration,
		"chainId":         tok.ChainId,
		"serverSignature": tok.ServerSignature,
	})
	if err != nil {
		t.Fatal(err)
	}
	addr, err := h.svc.ValidateRESTTokenAddress(string(camel))
	if err != nil {
		t.Fatalf("the frontend's camelCase token must authenticate: %v", err)
	}
	if addr != "g1uploader" {
		t.Fatalf("expected g1uploader, got %q", addr)
	}

	tampered, _ := json.Marshal(map[string]string{
		"nonce": tok.Nonce, "userAddress": "g1attacker", "expiration": tok.Expiration,
		"chainId": tok.ChainId, "serverSignature": tok.ServerSignature,
	})
	if _, err := h.svc.ValidateRESTTokenAddress(string(tampered)); err == nil {
		t.Fatal("a token whose address was changed must be rejected")
	}
	if _, err := h.svc.ValidateRESTTokenAddress(`{"userAddress":"g1x","extra":1}`); err == nil {
		t.Fatal("an unsigned token must be rejected")
	}
}
