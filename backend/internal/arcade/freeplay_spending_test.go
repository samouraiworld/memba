package arcade

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	membadb "github.com/samouraiworld/memba/backend/internal/db"
)

func freeBudgetFixture(t *testing.T, store *FreePlayStore, now func() time.Time) (*FreePlayBudget, FreePlayRun, FreePlayQuote) {
	t.Helper()
	run := freeFixture(t)
	current := now()
	q := freeQuote(run)
	q.ExpiresAt = current.Add(time.Hour).Unix()
	q.MaxFeeUgnot = 46
	q.MaxDepositUgnot = 28
	ctx := context.Background()
	if _, err := store.PutVerified(ctx, run, current.Unix()); err != nil {
		t.Fatal(err)
	}
	if err := store.PutQuote(ctx, q, current.Unix()); err != nil {
		t.Fatal(err)
	}
	if err := store.Queue(ctx, run.Entry.RunID, run.Entry.Player, run.PayloadHash, q.ID, q.Nonce, current.Unix()); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.Claim(ctx, run.Entry.Player, strings.Repeat("c", 64), current.Unix(), current.Add(time.Hour).Unix()); err != nil || !ok {
		t.Fatalf("claim=%v %v", ok, err)
	}
	b, err := NewFreePlayBudget(store, FreePlayBudgetSettings{run.Entry.Player, 2, 92, 56}, now)
	if err != nil {
		t.Fatal(err)
	}
	return b, run, q
}
func freeBudgetCounts(t *testing.T, database *sql.DB) (int64, int64, int64, int64) {
	t.Helper()
	var attempts, fee, deposit, journal int64
	if err := database.QueryRow(`SELECT COALESCE(SUM(attempts),0),COALESCE(SUM(fee_ugnot),0),COALESCE(SUM(deposit_ugnot),0) FROM arcade_freeplay_budget_v2`).Scan(&attempts, &fee, &deposit); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRow(`SELECT COUNT(*) FROM arcade_freeplay_spending_v2`).Scan(&journal); err != nil {
		t.Fatal(err)
	}
	return attempts, fee, deposit, journal
}
func TestFreePlayBudgetDurableConservativeReservations(t *testing.T) {
	path := t.TempDir() + "/budget.sqlite"
	database, err := membadb.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	if err = membadb.Migrate(database); err != nil {
		t.Fatal(err)
	}
	run := freeFixture(t)
	store, err := NewFreePlayStore(database, run.Target)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC)
	b, run, q := freeBudgetFixture(t, store, func() time.Time { return now })
	ctx := context.Background()
	if err = b.CanQuote(ctx, run, q); err != nil {
		t.Fatal(err)
	}
	if a, _, _, j := freeBudgetCounts(t, database); a != 0 || j != 0 {
		t.Fatal("quote reserved money")
	}
	if err = b.reserve(ctx, run, q); err != nil {
		t.Fatal(err)
	}
	// Restart the database and policy: the first allowance is still charged even
	// though no broadcast has been attempted. Same-day changed limits fail closed.
	if err = database.Close(); err != nil {
		t.Fatal(err)
	}
	database, err = membadb.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	store, err = NewFreePlayStore(database, run.Target)
	if err != nil {
		t.Fatal(err)
	}
	b, err = NewFreePlayBudget(store, b.settings, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	changed := b.settings
	changed.MaxAttempts++
	other, err := NewFreePlayBudget(store, changed, b.now)
	if err != nil {
		t.Fatal(err)
	}
	if err = other.reserve(ctx, run, q); !errors.Is(err, ErrFreePlayBudget) {
		t.Fatalf("changed limits=%v", err)
	}
	if err = b.reserve(ctx, run, q); err != nil {
		t.Fatal(err)
	}
	if err = b.reserve(ctx, run, q); !errors.Is(err, ErrFreePlayBudget) {
		t.Fatalf("overspend=%v", err)
	}
	if err = b.CanQuote(ctx, run, q); !errors.Is(err, ErrFreePlayBudget) {
		t.Fatalf("advisory=%v", err)
	}
	if a, f, d, j := freeBudgetCounts(t, database); a != 2 || f != 92 || d != 56 || j != 2 {
		t.Fatalf("counts=%d %d %d %d", a, f, d, j)
	}
}
func TestFreePlayBudgetRejectsAlteredOrUnleasedAuthorization(t *testing.T) {
	for _, name := range []string{"altered quote", "expired", "outbox lease expired", "signer lease expired", "owner mismatch", "unconsumed", "different quote", "pending other run", "ambiguous broadcast", "wrong target", "stored chain mismatch", "signer mismatch", "quote run mismatch", "overflow cap", "cancel"} {
		t.Run(name, func(t *testing.T) {
			store := freeStore(t)
			now := time.Unix(1000, 0)
			b, run, q := freeBudgetFixture(t, store, func() time.Time { return now })
			statement := ""
			switch name {
			case "altered quote":
				q.MaxFeeUgnot--
			case "expired":
				now = time.Unix(q.ExpiresAt, 0)
			case "outbox lease expired":
				statement = `UPDATE arcade_freeplay_outbox_v2 SET lease_until=0`
			case "signer lease expired":
				statement = `UPDATE arcade_freeplay_signers_v2 SET lease_until=0`
			case "owner mismatch":
				statement = `UPDATE arcade_freeplay_signers_v2 SET lease_owner='other'`
			case "unconsumed":
				statement = `UPDATE arcade_freeplay_quotes_v2 SET consumed=0`
			case "different quote":
				q.ID = strings.Repeat("d", 64)
			case "pending other run":
				statement = `UPDATE arcade_freeplay_signers_v2 SET pending_run_id='other'`
			case "ambiguous broadcast":
				statement = `UPDATE arcade_freeplay_outbox_v2 SET tx_hash='unknown',broadcast_attempts=1`
			case "wrong target":
				run.Target.ChainID = "other-chain"
			case "stored chain mismatch":
				statement = `UPDATE arcade_freeplay_runs_v2 SET chain_id='other-chain'`
			case "signer mismatch":
				statement = `UPDATE arcade_freeplay_signers_v2 SET signer='other'`
			case "quote run mismatch":
				other := run
				other.ClientRunID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
				var err error
				other.Entry.RunID, err = FreePlayRunID(other.Target, other.Entry.Player, other.Entry.Game, other.ClientRunID)
				if err != nil {
					t.Fatal(err)
				}
				other.PayloadHash = other.Entry.PayloadHash(other.Target)
				if _, err = store.PutVerified(context.Background(), other, now.Unix()); err != nil {
					t.Fatal(err)
				}
				if _, err = store.db.Exec(`UPDATE arcade_freeplay_quotes_v2 SET run_id=?`, other.Entry.RunID); err != nil {
					t.Fatal(err)
				}
			case "overflow cap":
				q.MaxFeeUgnot = FreePlayMaxScore
			}
			if statement != "" {
				if _, err := store.db.Exec(statement); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if name == "cancel" {
				cancel()
			}
			if err := b.reserve(ctx, run, q); err == nil {
				t.Fatal("accepted invalid authorization")
			}
			if a, f, d, j := freeBudgetCounts(t, store.db); a != 0 || f != 0 || d != 0 || j != 0 {
				t.Fatal("refusal consumed budget")
			}
		})
	}
}
func TestFreePlayBudgetTwoIndependentConnectionsCannotOverspend(t *testing.T) {
	path := t.TempDir() + "/budget.sqlite"
	first, err := membadb.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	if err = membadb.Migrate(first); err != nil {
		t.Fatal(err)
	}
	second, err := membadb.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	first.SetMaxOpenConns(1)
	second.SetMaxOpenConns(1)
	run := freeFixture(t)
	store, err := NewFreePlayStore(first, run.Target)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1000, 0)
	b, run, q := freeBudgetFixture(t, store, func() time.Time { return now })
	otherStore, err := NewFreePlayStore(second, run.Target)
	if err != nil {
		t.Fatal(err)
	}
	other, err := NewFreePlayBudget(otherStore, b.settings, b.now)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		policy := b
		if i%2 != 0 {
			policy = other
		}
		go func() { defer wg.Done(); <-start; results <- policy.reserve(context.Background(), run, q) }()
	}
	close(start)
	wg.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		} else if !errors.Is(err, ErrFreePlayBudget) {
			t.Fatal(err)
		}
	}
	if successes != 2 {
		t.Fatalf("successful reservations=%d", successes)
	}
	if a, f, d, j := freeBudgetCounts(t, first); a != 2 || f != 92 || d != 56 || j != 2 {
		t.Fatalf("counts=%d %d %d %d", a, f, d, j)
	}
}
func TestFreePlayBudgetRechecksClockAfterSQLiteWriterWait(t *testing.T) {
	for _, expiry := range []bool{false, true} {
		name := "UTC midnight"
		if expiry {
			name = "expiry"
		}
		t.Run(name, func(t *testing.T) {
			path := t.TempDir() + "/budget.sqlite"
			first, err := membadb.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer first.Close()
			if err = membadb.Migrate(first); err != nil {
				t.Fatal(err)
			}
			second, err := membadb.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer second.Close()
			first.SetMaxOpenConns(1)
			second.SetMaxOpenConns(1)
			initial := time.Date(2026, 1, 2, 23, 59, 59, 0, time.UTC)
			var seconds atomic.Int64
			seconds.Store(initial.Unix())
			clock := func() time.Time { return time.Unix(seconds.Load(), 0) }
			run := freeFixture(t)
			store, err := NewFreePlayStore(first, run.Target)
			if err != nil {
				t.Fatal(err)
			}
			original, run, q := freeBudgetFixture(t, store, clock)
			otherStore, err := NewFreePlayStore(second, run.Target)
			if err != nil {
				t.Fatal(err)
			}
			started := make(chan struct{})
			var once sync.Once
			b, err := NewFreePlayBudget(otherStore, original.settings, func() time.Time { value := clock(); once.Do(func() { close(started) }); return value })
			if err != nil {
				t.Fatal(err)
			}
			tx, err := first.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			if _, err = tx.Exec(`UPDATE arcade_freeplay_runs_v2 SET status=status`); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			result := make(chan error, 1)
			go func() { result <- b.reserve(ctx, run, q) }()
			<-started
			// The other pool is free, but this real SQLite writer must prevent completion.
			select {
			case err := <-result:
				t.Fatalf("writer did not block: %v", err)
			case <-time.After(30 * time.Millisecond):
			}
			if expiry {
				seconds.Store(q.ExpiresAt)
			} else {
				seconds.Store(initial.Add(2 * time.Second).Unix())
			}
			if err = tx.Commit(); err != nil {
				t.Fatal(err)
			}
			select {
			case err = <-result:
			case <-ctx.Done():
				t.Fatal("reservation did not finish")
			}
			if expiry {
				if !errors.Is(err, ErrFreePlayQuote) {
					t.Fatalf("expired=%v", err)
				}
				if a, _, _, j := freeBudgetCounts(t, first); a != 0 || j != 0 {
					t.Fatal("expired reservation persisted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var day string
			if err = first.QueryRow(`SELECT day_utc FROM arcade_freeplay_budget_v2`).Scan(&day); err != nil || day != "2026-01-03" {
				t.Fatalf("day=%s err=%v", day, err)
			}
		})
	}
}
func TestFreePlayBudgetSpendingRechecksPricesBeforeReservation(t *testing.T) {
	store := freeStore(t)
	_, settings, prices, now := freeCostFixture(t)
	b, run, q := freeBudgetFixture(t, store, func() time.Time { return now })
	// Per-attempt explicit operator caps must fit the daily approved allowance.
	settings.MaxFeeUgnot = 92
	settings.MaxDepositUgnot = 56
	reads := 0
	source := freePriceFunc(func(context.Context, FreePlayTarget) (FreePlayPrices, error) { reads++; return prices, nil })
	cost, err := NewFreePlayCostPolicy(settings, source, b.CanQuote, b.now)
	if err != nil {
		t.Fatal(err)
	}
	spending, err := NewFreePlayBudgetSpending(b, cost)
	if err != nil {
		t.Fatal(err)
	}
	prices.GasPrice.PriceUgnot++
	if err = spending.ReserveAttempt(context.Background(), run, q); !errors.Is(err, ErrFreePlayBudget) {
		t.Fatalf("price increase=%v", err)
	}
	if a, _, _, _ := freeBudgetCounts(t, store.db); a != 0 {
		t.Fatal("price refusal charged budget")
	}
	prices.GasPrice.PriceUgnot--
	if err = spending.ReserveAttempt(context.Background(), run, q); err != nil {
		t.Fatal(err)
	}
	if reads != 2 {
		t.Fatalf("fresh price reads=%d", reads)
	}
}
func TestFreePlayBudgetMissingMigrationAndConfigurationStayClosed(t *testing.T) {
	store := freeStore(t)
	now := time.Unix(1000, 0)
	b, run, q := freeBudgetFixture(t, store, func() time.Time { return now })
	if _, err := store.db.Exec(`DROP TABLE arcade_freeplay_spending_v2; DROP TABLE arcade_freeplay_budget_v2`); err != nil {
		t.Fatal(err)
	}
	if err := b.CanQuote(context.Background(), run, q); err == nil {
		t.Fatal("missing migration allowed quote")
	}
	if err := b.reserve(context.Background(), run, q); err == nil {
		t.Fatal("missing migration allowed reservation")
	}
	if _, err := NewFreePlayBudget(store, FreePlayBudgetSettings{}, nil); err == nil {
		t.Fatal("missing explicit limits allowed")
	}
	if _, err := NewFreePlayBudgetSpending(b, nil); err == nil {
		t.Fatal("missing prices allowed")
	}
}

func TestFreePlayBudgetJournalFailureRollsBackCounters(t *testing.T) {
	store := freeStore(t)
	now := time.Unix(1000, 0)
	b, run, q := freeBudgetFixture(t, store, func() time.Time { return now })
	if _, err := store.db.Exec(`CREATE TRIGGER fail_reservation BEFORE INSERT ON arcade_freeplay_spending_v2 BEGIN SELECT RAISE(ABORT,'test journal failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := b.reserve(context.Background(), run, q); err == nil {
		t.Fatal("journal failure accepted")
	}
	if a, f, d, j := freeBudgetCounts(t, store.db); a != 0 || f != 0 || d != 0 || j != 0 {
		t.Fatal("counter survived failed journal transaction")
	}
}

func TestFreePlayBudgetSafeIntegerBoundary(t *testing.T) {
	store := freeStore(t)
	now := time.Unix(1000, 0)
	b, run, q := freeBudgetFixture(t, store, func() time.Time { return now })
	limits := b.settings
	limits.MaxAttempts = FreePlayMaxScore
	limits.MaxFeeUgnot = FreePlayMaxScore
	limits.MaxDepositUgnot = FreePlayMaxScore
	b, err := NewFreePlayBudget(store, limits, b.now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.db.Exec(`INSERT INTO arcade_freeplay_budget_v2(chain_id,signer,day_utc,attempts,fee_ugnot,deposit_ugnot,max_attempts,max_fee_ugnot,max_deposit_ugnot) VALUES(?,?,?,?,?,?,?,?,?)`, run.Target.ChainID, limits.Signer, "1970-01-01", FreePlayMaxScore-1, FreePlayMaxScore-q.MaxFeeUgnot, FreePlayMaxScore-q.MaxDepositUgnot, FreePlayMaxScore, FreePlayMaxScore, FreePlayMaxScore); err != nil {
		t.Fatal(err)
	}
	if err = b.reserve(context.Background(), run, q); err != nil {
		t.Fatal(err)
	}
	if err = b.reserve(context.Background(), run, q); !errors.Is(err, ErrFreePlayBudget) {
		t.Fatalf("above safe cap=%v", err)
	}
	if a, f, d, j := freeBudgetCounts(t, store.db); a != FreePlayMaxScore || f != FreePlayMaxScore || d != FreePlayMaxScore || j != 1 {
		t.Fatalf("boundary=%d %d %d %d", a, f, d, j)
	}
}
