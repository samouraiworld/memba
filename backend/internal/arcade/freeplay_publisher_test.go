package arcade

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type freeChainFake struct {
	receipt    FreePlayReceipt
	found      bool
	broadcasts int
	lookups    int
	ambiguous  bool
	noReadback bool
	lookupErr  error
	crash      bool
}

func (f *freeChainFake) Lookup(context.Context, FreePlayTarget, string) (FreePlayReceipt, bool, error) {
	f.lookups++
	return f.receipt, f.found, f.lookupErr
}
func (f *freeChainFake) Anchor(_ context.Context, target FreePlayTarget, e FreePlayEntry, _ FreePlayQuote) (string, error) {
	f.broadcasts++
	if f.crash {
		panic("process died after submission")
	}
	if f.ambiguous {
		return "", errors.New("lost_response")
	}
	f.receipt = FreePlayReceipt{Target: target, Entry: e, Height: 42, Attester: e.Player, TxHash: strings.Repeat("e", 64), SchemaVersion: 2}
	f.found = !f.noReadback
	return f.receipt.TxHash, nil
}

type freeSpendingFake struct {
	calls int
	err   error
}

func (f *freeSpendingFake) ReserveAttempt(context.Context, FreePlayRun, FreePlayQuote) error {
	f.calls++
	return f.err
}
func queuedFreeRun(t *testing.T) (*FreePlayStore, FreePlayRun) {
	t.Helper()
	s := freeStore(t)
	run := freeFixture(t)
	ctx := context.Background()
	q := freeQuote(run)
	if _, err := s.PutVerified(ctx, run, 10); err != nil {
		t.Fatal(err)
	}
	if err := s.PutQuote(ctx, q, 11); err != nil {
		t.Fatal(err)
	}
	if err := s.Queue(ctx, run.Entry.RunID, run.Entry.Player, run.PayloadHash, q.ID, q.Nonce, 12); err != nil {
		t.Fatal(err)
	}
	return s, run
}
func TestFreePlayPublisherRequiresExactReceipt(t *testing.T) {
	s, run := queuedFreeRun(t)
	chain := &freeChainFake{}
	spend := &freeSpendingFake{}
	p := FreePlayPublisher{Enabled: true, Signer: freeFixture(t).Entry.Player, Store: s, Chain: chain, Spending: spend, Now: func() time.Time { return time.Unix(20, 0) }}
	if worked, err := p.PublishOne(context.Background()); err != nil || !worked {
		t.Fatalf("publish %v %v", worked, err)
	}
	got, err := s.Get(context.Background(), run.Entry.RunID)
	if err != nil || got.Status != "confirmed" || got.Receipt == nil {
		t.Fatalf("receipt %+v %v", got, err)
	}
	if chain.broadcasts != 1 || spend.calls != 1 {
		t.Fatal("unexpected sends")
	}
	if worked, err := p.PublishOne(context.Background()); err != nil || worked {
		t.Fatalf("repeat %v %v", worked, err)
	}
	for name, change := range map[string]func(*FreePlayReceipt){
		"network":   func(r *FreePlayReceipt) { r.Target.ChainID = "onyx-1" },
		"score":     func(r *FreePlayReceipt) { r.Entry.Score++ },
		"version":   func(r *FreePlayReceipt) { r.Entry.SimVersion++ },
		"seed":      func(r *FreePlayReceipt) { r.Entry.Seed = "wrong" },
		"height":    func(r *FreePlayReceipt) { r.Height = 0 },
		"schema":    func(r *FreePlayReceipt) { r.SchemaVersion = 1 },
		"attester":  func(r *FreePlayReceipt) { r.Attester = "" },
		"tx stdout": func(r *FreePlayReceipt) { r.TxHash = "success!" },
	} {
		t.Run(name, func(t *testing.T) {
			r := *got.Receipt
			change(&r)
			if ValidateFreePlayReceipt(run, r) == nil {
				t.Fatal("false receipt accepted")
			}
		})
	}
}
func TestFreePlayPublisherReadbackRecoveryAndAmbiguity(t *testing.T) {
	for _, ambiguous := range []bool{true, false} {
		t.Run(map[bool]string{true: "lost_send", false: "pending_readback"}[ambiguous], func(t *testing.T) {
			s, run := queuedFreeRun(t)
			chain := &freeChainFake{ambiguous: ambiguous, noReadback: true}
			now := int64(20)
			spend := &freeSpendingFake{}
			p := FreePlayPublisher{Enabled: true, Signer: freeFixture(t).Entry.Player, Store: s, Chain: chain, Spending: spend, Now: func() time.Time { return time.Unix(now, 0) }}
			if _, err := p.PublishOne(context.Background()); err == nil {
				t.Fatal("pending delivery reported success")
			}
			now = 25
			if _, err := p.PublishOne(context.Background()); err == nil {
				t.Fatal("unknown outcome ignored")
			}
			if chain.broadcasts != 1 {
				t.Fatal("ambiguous send rebroadcast")
			}
			chain.receipt = FreePlayReceipt{Target: run.Target, Entry: run.Entry, Height: 50, Attester: run.Entry.Player, SchemaVersion: 2}
			chain.found = true
			now = 35
			if _, err := p.PublishOne(context.Background()); err != nil {
				t.Fatal(err)
			}
			got, err := s.Get(context.Background(), run.Entry.RunID)
			if err != nil || got.Status != "confirmed" || got.Receipt.TxHash != "" {
				t.Fatalf("invented hash or false receipt %+v %v", got, err)
			}
		})
	}
}
func TestFreePlayPublisherDormantOrBudgetDenied(t *testing.T) {
	s, _ := queuedFreeRun(t)
	chain := &freeChainFake{}
	p := FreePlayPublisher{Enabled: true, Signer: freeFixture(t).Entry.Player, Store: s, Chain: chain}
	if _, err := p.PublishOne(context.Background()); !errors.Is(err, ErrFreePlayPaused) {
		t.Fatal(err)
	}
	spend := &freeSpendingFake{err: errors.New("daily_budget_exhausted")}
	p.Spending = spend
	p.Now = func() time.Time { return time.Unix(20, 0) }
	if _, err := p.PublishOne(context.Background()); err == nil || chain.broadcasts != 0 {
		t.Fatal("budget bypass")
	}
}

func TestFreePlayPublisherCrashBeforeSavingHashDoesNotRespend(t *testing.T) {
	s, run := queuedFreeRun(t)
	chain := &freeChainFake{crash: true}
	spend := &freeSpendingFake{}
	now := int64(20)
	p := FreePlayPublisher{Enabled: true, Signer: run.Entry.Player, Store: s, Chain: chain, Spending: spend, Now: func() time.Time { return time.Unix(now, 0) }}
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("expected simulated process death")
			}
		}()
		_, _ = p.PublishOne(context.Background())
	}()
	var marker string
	if err := s.db.QueryRow(`SELECT tx_hash FROM arcade_freeplay_outbox_v2 WHERE run_id=?`, run.Entry.RunID).Scan(&marker); err != nil || marker != "unknown" {
		t.Fatalf("durable intent %q %v", marker, err)
	}
	// The process restarts after lease expiry; an RPC that still says not-found
	// cannot distinguish a delayed inclusion from a failed network submission.
	now = 81
	chain.crash = false
	if _, err := p.PublishOne(context.Background()); err == nil {
		t.Fatal("ambiguous crash reported confirmed")
	}
	if chain.broadcasts != 1 || spend.calls != 1 {
		t.Fatalf("spent twice: sends=%d reservations=%d", chain.broadcasts, spend.calls)
	}
	got, err := s.Get(context.Background(), run.Entry.RunID)
	if err != nil || got.Status != "submitted" || got.Receipt != nil {
		t.Fatalf("false receipt %+v %v", got, err)
	}
	chain.receipt = FreePlayReceipt{Target: run.Target, Entry: run.Entry, Height: 91, Attester: run.Entry.Player, SchemaVersion: 2}
	chain.found = true
	now = 86
	if _, err = p.PublishOne(context.Background()); err != nil {
		t.Fatal(err)
	}
	if chain.broadcasts != 1 {
		t.Fatal("recovery rebroadcast")
	}
}

func TestFreePlayPendingPollsOutliveRetryLimitWithDurableBackoff(t *testing.T) {
	s, run := queuedFreeRun(t)
	chain := &freeChainFake{noReadback: true}
	spend := &freeSpendingFake{}
	now := int64(20)
	p := FreePlayPublisher{Enabled: true, Signer: run.Entry.Player, Store: s, Chain: chain, Spending: spend, Now: func() time.Time { return time.Unix(now, 0) }}
	for poll := 1; poll <= 12; poll++ {
		if worked, err := p.PublishOne(context.Background()); !worked || err == nil {
			t.Fatalf("pending poll %d: %v %v", poll, worked, err)
		}
		got, err := s.Get(context.Background(), run.Entry.RunID)
		if err != nil {
			t.Fatal(err)
		}
		if got.BroadcastAttempts != 1 || got.OperationalFailures != 0 || got.ConfirmationPolls != poll || got.LastError != "confirmation_pending" {
			t.Fatalf("poll counters %+v", got)
		}
		want := now + freePlayCheckDelay(poll-1)
		if got.NextCheckAt != want {
			t.Fatalf("next check %d want %d", got.NextCheckAt, want)
		}
		// A restarted worker calling repeatedly before the persisted deadline must
		// not reach the network, change counters, or reserve another spending budget.
		calls := chain.lookups
		now = want - 1
		if worked, err := p.PublishOne(context.Background()); worked || err != nil || chain.lookups != calls {
			t.Fatalf("backoff bypass %v %v", worked, err)
		}
		now = want
	}
	chain.found = true
	chain.receipt.TxHash = strings.Repeat("f", 64)
	if worked, err := p.PublishOne(context.Background()); !worked || !errors.Is(err, ErrFreePlayReceipt) {
		t.Fatalf("mismatched inclusion hash %v %v", worked, err)
	}
	pendingRun, err := s.Get(context.Background(), run.Entry.RunID)
	if err != nil || pendingRun.Status != "submitted" {
		t.Fatalf("mismatch became confirmed %+v %v", pendingRun, err)
	}
	now = pendingRun.NextCheckAt
	chain.receipt.TxHash = strings.Repeat("e", 64)
	if worked, err := p.PublishOne(context.Background()); !worked || err != nil {
		t.Fatalf("late inclusion %v %v", worked, err)
	}
	got, err := s.Get(context.Background(), run.Entry.RunID)
	if err != nil || got.Status != "confirmed" || got.NextCheckAt != 0 || got.LastError != "" {
		t.Fatalf("late receipt %+v %v", got, err)
	}
	if chain.broadcasts != 1 || spend.calls != 1 {
		t.Fatal("confirmation polling spent again")
	}
	var pending string
	if err = s.db.QueryRow(`SELECT pending_run_id FROM arcade_freeplay_signers_v2 WHERE chain_id=? AND signer=?`, run.Target.ChainID, run.Entry.Player).Scan(&pending); err != nil || pending != "" {
		t.Fatalf("signer not released %q %v", pending, err)
	}
}

func TestFreePlayCrashAfterIntentBeforeAnchorDoesNotBroadcast(t *testing.T) {
	s, run := queuedFreeRun(t)
	ctx := context.Background()
	lease, ok, err := s.Claim(ctx, run.Entry.Player, strings.Repeat("7", 64), 20, 80)
	if err != nil || !ok {
		t.Fatalf("lease %v %v", ok, err)
	}
	spend := &freeSpendingFake{}
	if err = spend.ReserveAttempt(ctx, run, lease.Quote); err != nil {
		t.Fatal(err)
	}
	if err = s.reserveBroadcast(ctx, lease); err != nil {
		t.Fatal(err)
	}
	// Process dies here. No Anchor call happened, but a restarted process cannot
	// prove that from a committed marker and therefore must not clear it.
	chain := &freeChainFake{}
	p := FreePlayPublisher{Enabled: true, Signer: run.Entry.Player, Store: s, Chain: chain, Spending: spend, Now: func() time.Time { return time.Unix(81, 0) }}
	if worked, err := p.PublishOne(ctx); !worked || err == nil {
		t.Fatalf("ambiguous intent %v %v", worked, err)
	}
	got, err := s.Get(ctx, run.Entry.RunID)
	if err != nil || got.Status != "submitted" || got.BroadcastAttempts != 1 || got.ConfirmationPolls != 1 || got.OperationalFailures != 0 || got.LastError != "confirmation_pending" {
		t.Fatalf("intent %+v %v", got, err)
	}
	if chain.broadcasts != 0 || spend.calls != 1 {
		t.Fatal("crash recovery sent an ambiguous intent")
	}
}

func TestFreePlayOperationalLimitDoesNotPinSigner(t *testing.T) {
	s, run := queuedFreeRun(t)
	chain := &freeChainFake{lookupErr: errors.New("RPC unavailable")}
	now := int64(20)
	p := FreePlayPublisher{Enabled: true, Signer: run.Entry.Player, Store: s, Chain: chain, Spending: &freeSpendingFake{}, Now: func() time.Time { return time.Unix(now, 0) }}
	for failure := 1; failure <= 8; failure++ {
		if worked, err := p.PublishOne(context.Background()); !worked || err == nil {
			t.Fatalf("failure %d %v %v", failure, worked, err)
		}
		got, err := s.Get(context.Background(), run.Entry.RunID)
		if err != nil {
			t.Fatal(err)
		}
		if got.OperationalFailures != failure || got.BroadcastAttempts != 0 || got.ConfirmationPolls != 0 {
			t.Fatalf("wrong failure counters %+v", got)
		}
		now = got.NextCheckAt
	}
	if worked, err := p.PublishOne(context.Background()); worked || err != nil {
		t.Fatalf("pre-send limit %v %v", worked, err)
	}
	got, err := s.Get(context.Background(), run.Entry.RunID)
	if err != nil || got.Status != "queued" || got.LastError != "retry_limit_operator_review_required" {
		t.Fatalf("pre-send exhausted %+v %v", got, err)
	}
	var pending string
	if err = s.db.QueryRow(`SELECT pending_run_id FROM arcade_freeplay_signers_v2 WHERE chain_id=? AND signer=?`, run.Target.ChainID, run.Entry.Player).Scan(&pending); err != nil || pending != "" {
		t.Fatalf("failed run pinned signer %q %v", pending, err)
	}
}

func TestFreePlayExpiredQueuedQuoteRequiresFreshConsentWithoutRespending(t *testing.T) {
	s, run := queuedFreeRun(t)
	ctx := context.Background()
	old, ok, err := s.Claim(ctx, run.Entry.Player, strings.Repeat("8", 64), 999, 1060)
	if err != nil || !ok {
		t.Fatalf("old lease %v %v", ok, err)
	}
	q := freeQuote(run)
	q.ID = strings.Repeat("c", 64)
	q.Nonce = strings.Repeat("d", 64)
	q.ExpiresAt = 3000
	if err = s.PutQuote(ctx, q, 1001); err != nil {
		t.Fatal(err)
	}
	if allowed, err := s.ReauthorizationAllowed(ctx, run.Entry.RunID, 1001); err != nil || allowed {
		t.Fatalf("active lease authorizable %v %v", allowed, err)
	}
	if err = s.Queue(ctx, run.Entry.RunID, run.Entry.Player, run.PayloadHash, q.ID, q.Nonce, 1001); !errors.Is(err, ErrFreePlayConflict) {
		t.Fatalf("active lease replaced %v", err)
	}
	if allowed, err := s.ReauthorizationAllowed(ctx, run.Entry.RunID, 1061); err != nil || !allowed {
		t.Fatalf("expired unsent run trapped %v %v", allowed, err)
	}
	if err = s.Queue(ctx, run.Entry.RunID, run.Entry.Player, run.PayloadHash, q.ID, q.Nonce, 1061); err != nil {
		t.Fatal(err)
	}
	if err = s.reserveBroadcast(ctx, old); err == nil {
		t.Fatal("expired worker was not fenced")
	}
	chain := &freeChainFake{}
	spend := &freeSpendingFake{}
	p := FreePlayPublisher{Enabled: true, Signer: run.Entry.Player, Store: s, Chain: chain, Spending: spend, Now: func() time.Time { return time.Unix(1062, 0) }}
	if worked, err := p.PublishOne(ctx); err != nil || !worked {
		t.Fatalf("renewed publication %v %v", worked, err)
	}
	got, err := s.Get(ctx, run.Entry.RunID)
	if err != nil || got.Status != "confirmed" || got.BroadcastAttempts != 1 || chain.broadcasts != 1 || spend.calls != 1 {
		t.Fatalf("fresh consent %+v sends=%d reserves=%d %v", got, chain.broadcasts, spend.calls, err)
	}
	prior := freeQuote(run)
	if err = s.Queue(ctx, run.Entry.RunID, run.Entry.Player, run.PayloadHash, prior.ID, prior.Nonce, 1063); !errors.Is(err, ErrFreePlayConflict) {
		t.Fatal("old consent restored", err)
	}
}

func TestFreePlayUnknownOutcomeCannotRenewExpiredQuote(t *testing.T) {
	s, run := queuedFreeRun(t)
	ctx := context.Background()
	l, ok, err := s.Claim(ctx, run.Entry.Player, strings.Repeat("9", 64), 999, 1060)
	if err != nil || !ok {
		t.Fatalf("claim %v %v", ok, err)
	}
	if err = s.reserveBroadcast(ctx, l); err != nil {
		t.Fatal(err)
	}
	if err = s.saveAttempt(ctx, l, "unknown", errors.New("lost response"), 1000); err != nil {
		t.Fatal(err)
	}
	q := freeQuote(run)
	q.ID = strings.Repeat("c", 64)
	q.Nonce = strings.Repeat("d", 64)
	q.ExpiresAt = 3000
	if err = s.PutQuote(ctx, q, 1100); err != nil {
		t.Fatal(err)
	}
	if allowed, err := s.ReauthorizationAllowed(ctx, run.Entry.RunID, 1100); err != nil || allowed {
		t.Fatalf("unknown offered reauthorization %v %v", allowed, err)
	}
	if err = s.Queue(ctx, run.Entry.RunID, run.Entry.Player, run.PayloadHash, q.ID, q.Nonce, 1100); !errors.Is(err, ErrFreePlayConflict) {
		t.Fatal("ambiguous send reset", err)
	}
	var marker string
	if err = s.db.QueryRow(`SELECT tx_hash FROM arcade_freeplay_outbox_v2 WHERE run_id=?`, run.Entry.RunID).Scan(&marker); err != nil || marker != "unknown" {
		t.Fatalf("marker erased %q %v", marker, err)
	}
}
