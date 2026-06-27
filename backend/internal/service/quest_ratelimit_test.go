package service

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/ratelimit"
)

// TestCompleteQuest_PerAddressRateLimit verifies the Q-03 per-address quota:
// once a wallet exceeds its quest-write quota it gets ResourceExhausted, while a
// different wallet keeps its own independent bucket.
func TestCompleteQuest_PerAddressRateLimit(t *testing.T) {
	h := setup(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	// Tiny quota so the test is fast and deterministic.
	h.svc.SetUserLimiter(ratelimit.New(ctx, map[string]ratelimit.Config{
		ratelimit.QuestWriteEndpoint: {MaxRequests: 2, Window: time.Minute},
	}))

	alice := h.makeToken(t, "g1alice")
	call := func(token *membav1.Token) error {
		_, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
			AuthToken: token,
			QuestId:   "connect-wallet", // off_chain, no network
		}))
		return err
	}

	if err := call(alice); err != nil {
		t.Fatalf("call 1 should pass: %v", err)
	}
	if err := call(alice); err != nil {
		t.Fatalf("call 2 should pass: %v", err)
	}
	err := call(alice)
	if err == nil {
		t.Fatal("call 3 should be rate-limited")
	}
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("expected ResourceExhausted, got %v (%v)", connect.CodeOf(err), err)
	}

	// A different wallet is unaffected — its own bucket.
	if err := call(h.makeToken(t, "g1bob")); err != nil {
		t.Fatalf("a different address should have its own bucket: %v", err)
	}
}

// TestCompleteQuest_NoLimiterIsDisabled confirms that with no limiter installed
// (the default in tests) the per-address gate is a no-op — never rejecting.
func TestCompleteQuest_NoLimiterIsDisabled(t *testing.T) {
	h := setup(t)
	token := h.makeToken(t, "g1carol")
	for i := range 5 {
		if _, err := h.svc.CompleteQuest(context.Background(), connect.NewRequest(&membav1.CompleteQuestRequest{
			AuthToken: token,
			QuestId:   "connect-wallet",
		})); err != nil {
			t.Fatalf("call %d should pass with no limiter: %v", i+1, err)
		}
	}
}
