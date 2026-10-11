package arcade

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type freeSpendingFunc func(context.Context, FreePlayRun, FreePlayQuote) error

func (f freeSpendingFunc) ReserveAttempt(ctx context.Context, r FreePlayRun, q FreePlayQuote) error {
	return f(ctx, r, q)
}

type freeDeadlineChain struct {
	freeChainFake
	deadline time.Time
}

func (f *freeDeadlineChain) Anchor(ctx context.Context, target FreePlayTarget, entry FreePlayEntry, quote FreePlayQuote) (string, error) {
	f.deadline, _ = ctx.Deadline()
	return f.freeChainFake.Anchor(ctx, target, entry, quote)
}

func assertFreePlayUnsent(t *testing.T, s *FreePlayStore, run FreePlayRun, now int64) {
	t.Helper()
	got, err := s.Get(context.Background(), run.Entry.RunID)
	if err != nil || got.Status != "queued" || got.BroadcastAttempts != 0 || got.ConfirmationPolls != 0 || got.LastError != "quote_expired" {
		t.Fatalf("expired unsent state: %+v %v", got, err)
	}
	var marker, pending string
	if err = s.db.QueryRow(`SELECT tx_hash FROM arcade_freeplay_outbox_v2 WHERE run_id=?`, run.Entry.RunID).Scan(&marker); err != nil || marker != "" {
		t.Fatalf("marker %q %v", marker, err)
	}
	if err = s.db.QueryRow(`SELECT pending_run_id FROM arcade_freeplay_signers_v2 WHERE chain_id=? AND signer=?`, run.Target.ChainID, run.Entry.Player).Scan(&pending); err != nil || pending != "" {
		t.Fatalf("signer pinned %q %v", pending, err)
	}
	if allowed, err := s.ReauthorizationAllowed(context.Background(), run.Entry.RunID, now); err != nil || !allowed {
		t.Fatalf("fresh consent blocked %v %v", allowed, err)
	}
}

func TestFreePlayPublisherExpiresWhileReservingBudget(t *testing.T) {
	s, run := queuedFreeRun(t)
	chain := &freeChainFake{}
	var clock atomic.Int64
	clock.Store(999)
	entered, resume := make(chan struct{}), make(chan struct{})
	reservations := 0
	spend := freeSpendingFunc(func(ctx context.Context, _ FreePlayRun, _ FreePlayQuote) error {
		reservations++
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > time.Second {
			return errors.New("unbounded_budget_context")
		}
		close(entered)
		select {
		case <-resume:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	})
	p := FreePlayPublisher{Enabled: true, Signer: run.Entry.Player, Store: s, Chain: chain, Spending: spend, Now: func() time.Time { return time.Unix(clock.Load(), 0) }}
	done := make(chan error, 1)
	go func() { _, err := p.PublishOne(context.Background()); done <- err }()
	select {
	case <-entered:
	case err := <-done:
		t.Fatalf("budget not reached: %v", err)
	case <-time.After(time.Second):
		t.Fatal("budget not reached")
	}
	clock.Store(1000)
	close(resume)
	if err := <-done; !errors.Is(err, ErrFreePlayQuote) {
		t.Fatal(err)
	}
	if chain.broadcasts != 0 || reservations != 1 {
		t.Fatalf("sends=%d charged reservations=%d", chain.broadcasts, reservations)
	}
	assertFreePlayUnsent(t, s, run, 1000)
}

func TestFreePlayPublisherDeadlineBoundsAnchor(t *testing.T) {
	s, run := queuedFreeRun(t)
	chain := &freeDeadlineChain{}
	p := FreePlayPublisher{Enabled: true, Signer: run.Entry.Player, Store: s, Chain: chain, Spending: &freeSpendingFake{}, Now: func() time.Time { return time.Unix(999, 500000000) }}
	before := time.Now()
	if _, err := p.PublishOne(context.Background()); err != nil {
		t.Fatal(err)
	}
	if chain.broadcasts != 1 || chain.deadline.IsZero() || chain.deadline.After(time.Now().Add(500*time.Millisecond)) || chain.deadline.Before(before) {
		t.Fatalf("unbounded or expired Anchor deadline: %v", chain.deadline)
	}
}

func TestFreePlayPublisherExpiresAfterIntentBeforeAnchor(t *testing.T) {
	s, run := queuedFreeRun(t)
	chain := &freeChainFake{}
	spend := &freeSpendingFake{}
	// Advance only once the intent is committed. Skip reads while SQLite's
	// transaction owns the connection, so this clock never blocks its writer.
	expired := false
	now := func() time.Time {
		if expired {
			return time.Unix(1000, 0)
		}
		if s.db.Stats().InUse == 0 {
			var marker string
			if err := s.db.QueryRow(`SELECT tx_hash FROM arcade_freeplay_outbox_v2 WHERE run_id=?`, run.Entry.RunID).Scan(&marker); err != nil {
				t.Fatal(err)
			}
			if marker == "unknown" {
				expired = true
				return time.Unix(1000, 0)
			}
		}
		return time.Unix(999, 0)
	}
	p := FreePlayPublisher{Enabled: true, Signer: run.Entry.Player, Store: s, Chain: chain, Spending: spend, Now: now}
	if _, err := p.PublishOne(context.Background()); !errors.Is(err, ErrFreePlayQuote) {
		t.Fatal(err)
	}
	if chain.broadcasts != 0 || spend.calls != 1 {
		t.Fatalf("sends=%d reservations=%d", chain.broadcasts, spend.calls)
	}
	assertFreePlayUnsent(t, s, run, 1000)
}

func TestFreePlayBroadcastWaitRechecksAuthorization(t *testing.T) {
	s, run := queuedFreeRun(t)
	ctx := context.Background()
	lease, ok, err := s.Claim(ctx, run.Entry.Player, strings.Repeat("7", 64), 999, 1060)
	if err != nil || !ok {
		t.Fatalf("claim %v %v", ok, err)
	}
	s.db.SetMaxOpenConns(1)
	held, err := s.db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = held.Close() }()
	var clock atomic.Int64
	clock.Store(999)
	waitCount := s.db.Stats().WaitCount
	done := make(chan error, 1)
	go func() { done <- s.reserveBroadcast(ctx, lease, clock.Load) }()
	deadline := time.After(time.Second)
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for s.db.Stats().WaitCount == waitCount {
		select {
		case <-ticker.C:
		case <-deadline:
			t.Fatal("writer did not wait")
		}
	}
	clock.Store(1000)
	if err = held.Close(); err != nil {
		t.Fatal(err)
	}
	if err = <-done; !errors.Is(err, ErrFreePlayQuote) {
		t.Fatal(err)
	}
	if err = s.saveAttempt(ctx, lease, "", ErrFreePlayQuote, 1000); err != nil {
		t.Fatal(err)
	}
	assertFreePlayUnsent(t, s, run, 1000)
}

func TestFreePlayUnsentCancellationFencesStaleOwner(t *testing.T) {
	s, run := queuedFreeRun(t)
	ctx := context.Background()
	lease, ok, err := s.Claim(ctx, run.Entry.Player, strings.Repeat("7", 64), 20, 80)
	if err != nil || !ok {
		t.Fatalf("claim %v %v", ok, err)
	}
	if err = s.reserveBroadcast(ctx, lease, func() int64 { return 20 }); err != nil {
		t.Fatal(err)
	}
	next, ok, err := s.Claim(ctx, run.Entry.Player, strings.Repeat("8", 64), 81, 141)
	if err != nil || !ok {
		t.Fatalf("reclaim %v %v", ok, err)
	}
	if err = s.cancelUnsentBroadcast(ctx, lease); err == nil {
		t.Fatal("stale invocation cleared intent")
	}
	if next.TxHash != "unknown" {
		t.Fatal("lost intent")
	}
	got, err := s.Get(ctx, run.Entry.RunID)
	if err != nil || got.Status != "submitted" || got.BroadcastAttempts != 1 {
		t.Fatalf("cleared ambiguity %+v %v", got, err)
	}
}
