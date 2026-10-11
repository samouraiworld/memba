package arcade

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"
)

type freePriceFunc func(context.Context, FreePlayTarget) (FreePlayPrices, error)

func (f freePriceFunc) ReadFreePlayPrices(ctx context.Context, target FreePlayTarget) (FreePlayPrices, error) {
	return f(ctx, target)
}
func freeCostFixture(t *testing.T) (FreePlayRun, FreePlayCostSettings, FreePlayPrices, time.Time) {
	t.Helper()
	run := freeFixture(t)
	now := time.Unix(1000, 0)
	// Arbitrary test units, not approved deployment values or mainnet defaults.
	s := FreePlayCostSettings{Target: run.Target, GasWanted: 101, StorageBytes: 7, FeeMarginNumerator: 3, FeeMarginDenominator: 2, MaxFeeUgnot: 100, MaxDepositUgnot: 100, MaxPriceAge: time.Minute, QuoteLifetime: time.Minute}
	p := FreePlayPrices{Target: run.Target, Height: 10, ObservedAt: now, GasPrice: GasPrice{Gas: 10, PriceUgnot: 3}, StoragePriceUgnot: 4}
	return run, s, p, now
}
func TestFreePlayCostExactRoundingAndFailClosed(t *testing.T) {
	_, s, p, now := freeCostFixture(t)
	plan, err := PlanFreePlayCost(s, p, now)
	if err != nil || plan.GasWanted != 101 || plan.FeeUgnot != 46 || plan.DepositUgnot != 28 {
		t.Fatalf("plan=%+v err=%v", plan, err)
	}
	for name, mutate := range map[string]func(*FreePlayCostSettings, *FreePlayPrices){
		"no default gas":     func(s *FreePlayCostSettings, _ *FreePlayPrices) { s.GasWanted = 0 },
		"no default deposit": func(s *FreePlayCostSettings, _ *FreePlayPrices) { s.StorageBytes = 0 },
		"no default cap":     func(s *FreePlayCostSettings, _ *FreePlayPrices) { s.MaxFeeUgnot = 0 },
		"discounted margin":  func(s *FreePlayCostSettings, _ *FreePlayPrices) { s.FeeMarginNumerator = 1 },
		"wrong network":      func(_ *FreePlayCostSettings, p *FreePlayPrices) { p.Target.ChainID = "other-chain" },
		"stale": func(_ *FreePlayCostSettings, p *FreePlayPrices) {
			p.ObservedAt = now.Add(-time.Minute - time.Nanosecond)
		},
		"future":            func(_ *FreePlayCostSettings, p *FreePlayPrices) { p.ObservedAt = now.Add(time.Nanosecond) },
		"zero price":        func(_ *FreePlayCostSettings, p *FreePlayPrices) { p.GasPrice.Gas = 0 },
		"fee above cap":     func(s *FreePlayCostSettings, _ *FreePlayPrices) { s.MaxFeeUgnot = 45 },
		"deposit above cap": func(s *FreePlayCostSettings, _ *FreePlayPrices) { s.MaxDepositUgnot = 27 },
		"fee overflow": func(s *FreePlayCostSettings, p *FreePlayPrices) {
			s.GasWanted = math.MaxInt64
			p.GasPrice.PriceUgnot = math.MaxInt64
		},
		"deposit overflow": func(s *FreePlayCostSettings, p *FreePlayPrices) {
			s.StorageBytes = math.MaxInt64
			p.StoragePriceUgnot = math.MaxInt64
		},
	} {
		t.Run(name, func(t *testing.T) {
			settings, prices := s, p
			mutate(&settings, &prices)
			if _, err := PlanFreePlayCost(settings, prices, now); err == nil {
				t.Fatal("accepted invalid cost plan")
			}
		})
	}
}
func TestFreePlayCostQuoteAndBroadcastRecheck(t *testing.T) {
	run, s, prices, now := freeCostFixture(t)
	reads, checks := 0, 0
	source := freePriceFunc(func(context.Context, FreePlayTarget) (FreePlayPrices, error) { reads++; return prices, nil })
	policy, err := NewFreePlayCostPolicy(s, source, func(context.Context, FreePlayRun, FreePlayQuote) error { checks++; return nil }, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	q, err := policy.Quote(context.Background(), run)
	if err != nil || reads != 1 || checks != 1 || q.MaxFeeUgnot != 46 || q.MaxDepositUgnot != 28 || q.Payer != "studio" || q.RunID != run.Entry.RunID || q.PayloadHash != run.PayloadHash {
		t.Fatalf("q=%+v reads=%d checks=%d err=%v", q, reads, checks, err)
	}
	if err = policy.ValidateBroadcast(context.Background(), run.Target, run.Entry, q, s.GasWanted); err != nil || reads != 2 {
		t.Fatalf("fresh guard: %v reads=%d", err, reads)
	}
	prices.GasPrice.PriceUgnot++
	if err = policy.ValidateBroadcast(context.Background(), run.Target, run.Entry, q, s.GasWanted); !errors.Is(err, ErrFreePlayBudget) {
		t.Fatalf("price increase: %v", err)
	}
	prices.GasPrice.PriceUgnot--
	if err = policy.ValidateBroadcast(context.Background(), run.Target, run.Entry, q, s.GasWanted+1); !errors.Is(err, ErrFreePlayConflict) {
		t.Fatalf("gas wanted mismatch: %v", err)
	}
	now = now.Add(time.Minute)
	if err = policy.ValidateBroadcast(context.Background(), run.Target, run.Entry, q, s.GasWanted); !errors.Is(err, ErrFreePlayQuote) {
		t.Fatalf("expired: %v", err)
	}
}
func TestFreePlayCostNoFallbackAndExpiryAcrossWait(t *testing.T) {
	run, s, prices, now := freeCostFixture(t)
	if _, err := NewFreePlayCostPolicy(s, nil, nil, nil); !errors.Is(err, ErrFreePlayPaused) {
		t.Fatal("missing live price/budget accepted")
	}
	source := freePriceFunc(func(context.Context, FreePlayTarget) (FreePlayPrices, error) {
		return FreePlayPrices{}, errors.New("offline")
	})
	policy, err := NewFreePlayCostPolicy(s, source, func(context.Context, FreePlayRun, FreePlayQuote) error { return nil }, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	if _, err = policy.Quote(context.Background(), run); !errors.Is(err, ErrFreePlayPrices) {
		t.Fatalf("fallback: %v", err)
	}
	policy.prices = freePriceFunc(func(context.Context, FreePlayTarget) (FreePlayPrices, error) { return prices, nil })
	policy.availability = func(context.Context, FreePlayRun, FreePlayQuote) error { now = now.Add(2 * time.Minute); return nil }
	if _, err = policy.Quote(context.Background(), run); !errors.Is(err, ErrFreePlayQuote) {
		t.Fatalf("quote expired while checking budget: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = policy.CurrentPlan(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
}
