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
	ambiguous  bool
	noReadback bool
	lookupErr  error
	crash      bool
}

func (f *freeChainFake) Lookup(context.Context, FreePlayTarget, string) (FreePlayReceipt, bool, error) {
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
			spend := &freeSpendingFake{}
			p := FreePlayPublisher{Enabled: true, Signer: freeFixture(t).Entry.Player, Store: s, Chain: chain, Spending: spend, Now: func() time.Time { return time.Unix(20, 0) }}
			if _, err := p.PublishOne(context.Background()); err == nil {
				t.Fatal("pending delivery reported success")
			}
			if _, err := p.PublishOne(context.Background()); err == nil {
				t.Fatal("unknown outcome ignored")
			}
			if chain.broadcasts != 1 {
				t.Fatal("ambiguous send rebroadcast")
			}
			chain.receipt = FreePlayReceipt{Target: run.Target, Entry: run.Entry, Height: 50, Attester: run.Entry.Player, SchemaVersion: 2}
			chain.found = true
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
	if _, err = p.PublishOne(context.Background()); err != nil {
		t.Fatal(err)
	}
	if chain.broadcasts != 1 {
		t.Fatal("recovery rebroadcast")
	}
}
