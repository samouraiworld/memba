package arcade

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

func TestFreePlayStoreImmutableAndScoped(t *testing.T) {
	ctx := context.Background()
	s := freeStore(t)
	run := freeFixture(t)
	if _, err := s.PutVerified(ctx, run, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PutVerified(ctx, run, 11); err != nil {
		t.Fatal(err)
	}
	changed := run
	changed.Entry.Score++
	changed.PayloadHash = changed.Entry.PayloadHash(changed.Target)
	if _, err := s.PutVerified(ctx, changed, 12); !errors.Is(err, ErrFreePlayConflict) {
		t.Fatalf("overwrite=%v", err)
	}
	other, err := NewFreePlayStore(s.db, FreePlayTarget{"onyx-1", FreePlayRealm})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = other.Get(ctx, run.Entry.RunID); !errors.Is(err, ErrFreePlayMissing) {
		t.Fatalf("cross-chain read=%v", err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT COUNT(*) FROM arcade_freeplay_runs_v2`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("count=%d err=%v", count, err)
	}
}
func TestFreePlayQueueAtomicRetriesAndLease(t *testing.T) {
	ctx := context.Background()
	s := freeStore(t)
	run := freeFixture(t)
	q := freeQuote(run)
	if _, err := s.PutVerified(ctx, run, 10); err != nil {
		t.Fatal(err)
	}
	if err := s.PutQuote(ctx, q, 11); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 32)
	for range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- s.Queue(ctx, run.Entry.RunID, run.Entry.Player, run.PayloadHash, q.ID, q.Nonce, 12)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	// Exact retries remain valid after quote expiry. Different nonces do not.
	if err := s.Queue(ctx, run.Entry.RunID, run.Entry.Player, run.PayloadHash, q.ID, q.Nonce, 2000); err != nil {
		t.Fatal(err)
	}
	if err := s.Queue(ctx, run.Entry.RunID, run.Entry.Player, run.PayloadHash, q.ID, "wrong", 13); !errors.Is(err, ErrFreePlayConflict) {
		t.Fatalf("nonce=%v", err)
	}
	l, ok, err := s.Claim(ctx, run.Entry.Player, strings.Repeat("c", 64), 14, 80)
	if err != nil || !ok {
		t.Fatalf("claim %v %v", ok, err)
	}
	if _, ok, err = s.Claim(ctx, run.Entry.Player, strings.Repeat("d", 64), 15, 81); err != nil || ok {
		t.Fatalf("double lease %v %v", ok, err)
	}
	next, ok, err := s.Claim(ctx, run.Entry.Player, strings.Repeat("d", 64), 81, 150)
	if err != nil || !ok {
		t.Fatalf("recovery %v %v", ok, err)
	}
	if err = s.saveAttempt(ctx, l, "", nil, 81); err == nil {
		t.Fatal("stale worker saved")
	}
	if err = s.saveAttempt(ctx, next, "", nil, 81); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT COUNT(*) FROM arcade_freeplay_outbox_v2`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("outbox=%d %v", count, err)
	}
}
func TestFreePlayExpiredQuoteDoesNotQueue(t *testing.T) {
	ctx := context.Background()
	s := freeStore(t)
	run := freeFixture(t)
	q := freeQuote(run)
	if _, err := s.PutVerified(ctx, run, 10); err != nil {
		t.Fatal(err)
	}
	if err := s.PutQuote(ctx, q, 11); err != nil {
		t.Fatal(err)
	}
	if err := s.Queue(ctx, run.Entry.RunID, run.Entry.Player, run.PayloadHash, q.ID, q.Nonce, 1000); !errors.Is(err, ErrFreePlayQuote) {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, run.Entry.RunID)
	if err != nil || got.Status != "verified" {
		t.Fatalf("%+v %v", got, err)
	}
}

func TestFreePlaySignerSerializesDifferentRunsAndPinsUnknownOutcome(t *testing.T) {
	ctx := context.Background()
	s, first := queuedFreeRun(t)
	vectors, _ := freeVectors(t)
	second, err := VerifyFreePlayRun(ctx, vectors[1].Target, vectors[1].Player, vectors[1].Input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PutVerified(ctx, second, 11); err != nil {
		t.Fatal(err)
	}
	q := freeQuote(second)
	q.ID = strings.Repeat("1", 64)
	q.Nonce = strings.Repeat("2", 64)
	if err = s.PutQuote(ctx, q, 12); err != nil {
		t.Fatal(err)
	}
	if err = s.Queue(ctx, second.Entry.RunID, second.Entry.Player, second.PayloadHash, q.ID, q.Nonce, 13); err != nil {
		t.Fatal(err)
	}
	l, ok, err := s.Claim(ctx, first.Entry.Player, strings.Repeat("3", 64), 20, 80)
	if err != nil || !ok || l.Run.Entry.RunID != first.Entry.RunID {
		t.Fatalf("first lease %+v %v %v", l, ok, err)
	}
	// Another queued run is available, but the account sequence is still owned.
	if _, ok, err = s.Claim(ctx, first.Entry.Player, strings.Repeat("4", 64), 21, 81); err != nil || ok {
		t.Fatalf("concurrent account lease %v %v", ok, err)
	}
	if err = s.reserveBroadcast(ctx, l, func() int64 { return 20 }); err != nil {
		t.Fatal(err)
	}
	if err = s.saveAttempt(ctx, l, "unknown", errors.New("transport died"), 21); err != nil {
		t.Fatal(err)
	}
	next, ok, err := s.Claim(ctx, first.Entry.Player, strings.Repeat("5", 64), 26, 86)
	if err != nil || !ok || next.Run.Entry.RunID != first.Entry.RunID || next.TxHash != "unknown" {
		t.Fatalf("unknown run was not pinned %+v %v %v", next, ok, err)
	}
	// A stale worker cannot replace the new owner's durable marker.
	if err = s.reserveBroadcast(ctx, l, func() int64 { return 20 }); err == nil {
		t.Fatal("stale signer published")
	}
	receipt := FreePlayReceipt{Target: first.Target, Entry: first.Entry, Height: 42, Attester: first.Entry.Player, SchemaVersion: 2}
	if err = s.confirm(ctx, next, receipt); err != nil {
		t.Fatal(err)
	}
	final, ok, err := s.Claim(ctx, first.Entry.Player, strings.Repeat("6", 64), 27, 87)
	if err != nil || !ok || final.Run.Entry.RunID != second.Entry.RunID {
		t.Fatalf("second run not released %+v %v %v", final, ok, err)
	}
}

func TestFreePlayRenewalAndExpiredWorkerCannotBothReserve(t *testing.T) {
	ctx := context.Background()
	s, run := queuedFreeRun(t)
	l, ok, err := s.Claim(ctx, run.Entry.Player, strings.Repeat("9", 64), 999, 1060)
	if err != nil || !ok {
		t.Fatalf("claim %v %v", ok, err)
	}
	q := freeQuote(run)
	q.ID = strings.Repeat("c", 64)
	q.Nonce = strings.Repeat("d", 64)
	q.ExpiresAt = 3000
	if err = s.PutQuote(ctx, q, 1061); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	go func() { <-start; results <- s.reserveBroadcast(ctx, l, func() int64 { return 1061 }) }()
	go func() {
		<-start
		results <- s.Queue(ctx, run.Entry.RunID, run.Entry.Player, run.PayloadHash, q.ID, q.Nonce, 1061)
	}()
	close(start)
	a, b := <-results, <-results
	if (a == nil) == (b == nil) {
		t.Fatalf("must choose exactly one writer: %v / %v", a, b)
	}
}
