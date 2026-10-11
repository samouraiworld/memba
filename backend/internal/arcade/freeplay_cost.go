package arcade

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"math/big"
	"time"
)

var (
	ErrFreePlayPrices = errors.New("live_prices_unavailable")
	ErrFreePlayBudget = errors.New("studio_budget_unavailable")
)

// FreePlayPrices is a fresh observation, never a launch-time fallback. Height
// identifies the node status observation, not a proof that both price queries
// were atomically read at that height. The trusted RPC source must check chain.
type FreePlayPrices struct {
	Target            FreePlayTarget
	Height            int64
	ObservedAt        time.Time
	GasPrice          GasPrice
	StoragePriceUgnot int64 // ugnot per byte
}
type FreePlayPriceSource interface {
	ReadFreePlayPrices(context.Context, FreePlayTarget) (FreePlayPrices, error)
}

// Every field is operator-supplied; zero does NOT take a default. GasWanted
// and StorageBytes must be separately reviewed upper bounds, not copied from
// one small rehearsal. Their values are never inferred from mainnet samples.
type FreePlayCostSettings struct {
	Target               FreePlayTarget
	GasWanted            int64
	StorageBytes         int64
	FeeMarginNumerator   int64
	FeeMarginDenominator int64
	MaxFeeUgnot          int64
	MaxDepositUgnot      int64
	MaxPriceAge          time.Duration
	QuoteLifetime        time.Duration
}
type FreePlayCostPlan struct{ GasWanted, FeeUgnot, DepositUgnot int64 }

func (s FreePlayCostSettings) validate() error {
	if s.Target.Validate() != nil || s.GasWanted <= 0 || s.StorageBytes <= 0 || s.FeeMarginDenominator <= 0 || s.FeeMarginNumerator < s.FeeMarginDenominator || s.MaxFeeUgnot <= 0 || s.MaxDepositUgnot <= 0 || s.MaxFeeUgnot > FreePlayMaxScore || s.MaxDepositUgnot > FreePlayMaxScore || s.MaxPriceAge <= 0 || s.QuoteLifetime < time.Second {
		return ErrFreePlayPaused
	}
	return nil
}

func PlanFreePlayCost(s FreePlayCostSettings, p FreePlayPrices, now time.Time) (FreePlayCostPlan, error) {
	if err := s.validate(); err != nil {
		return FreePlayCostPlan{}, err
	}
	if p.Target != s.Target || p.Height <= 0 || p.ObservedAt.IsZero() || p.ObservedAt.After(now) || now.Sub(p.ObservedAt) > s.MaxPriceAge || p.GasPrice.Gas <= 0 || p.GasPrice.PriceUgnot <= 0 || p.StoragePriceUgnot <= 0 {
		return FreePlayCostPlan{}, ErrFreePlayPrices
	}
	// One ceil after the exact rational multiplication, with no int64 overflow.
	numerator := new(big.Int).Mul(big.NewInt(s.GasWanted), big.NewInt(p.GasPrice.PriceUgnot))
	numerator.Mul(numerator, big.NewInt(s.FeeMarginNumerator))
	denominator := new(big.Int).Mul(big.NewInt(p.GasPrice.Gas), big.NewInt(s.FeeMarginDenominator))
	fee, remainder := new(big.Int).QuoRem(numerator, denominator, new(big.Int))
	if remainder.Sign() != 0 {
		fee.Add(fee, big.NewInt(1))
	}
	deposit := new(big.Int).Mul(big.NewInt(s.StorageBytes), big.NewInt(p.StoragePriceUgnot))
	if fee.Sign() <= 0 || deposit.Sign() <= 0 || fee.Cmp(big.NewInt(s.MaxFeeUgnot)) > 0 || deposit.Cmp(big.NewInt(s.MaxDepositUgnot)) > 0 {
		return FreePlayCostPlan{}, ErrFreePlayBudget
	}
	return FreePlayCostPlan{s.GasWanted, fee.Int64(), deposit.Int64()}, nil
}

// FreePlayCostPolicy implements the quote port and the transport's structural
// ValidateBroadcast guard. The same instance/settings must serve quote, budget
// and transport. It is not wired by main and never signs or broadcasts.
type FreePlayCostPolicy struct {
	settings     FreePlayCostSettings
	prices       FreePlayPriceSource
	now          func() time.Time
	availability func(context.Context, FreePlayRun, FreePlayQuote) error
}

func NewFreePlayCostPolicy(settings FreePlayCostSettings, prices FreePlayPriceSource, availability func(context.Context, FreePlayRun, FreePlayQuote) error, now func() time.Time) (*FreePlayCostPolicy, error) {
	if err := settings.validate(); err != nil {
		return nil, err
	}
	if prices == nil || availability == nil {
		return nil, ErrFreePlayPaused
	}
	if now == nil {
		now = time.Now
	}
	return &FreePlayCostPolicy{settings, prices, now, availability}, nil
}
func (p *FreePlayCostPolicy) CurrentPlan(ctx context.Context) (FreePlayCostPlan, error) {
	if err := ctx.Err(); err != nil {
		return FreePlayCostPlan{}, err
	}
	prices, err := p.prices.ReadFreePlayPrices(ctx, p.settings.Target)
	if err != nil {
		return FreePlayCostPlan{}, ErrFreePlayPrices
	}
	if err = ctx.Err(); err != nil {
		return FreePlayCostPlan{}, err
	}
	return PlanFreePlayCost(p.settings, prices, p.now())
}
func (p *FreePlayCostPolicy) Quote(ctx context.Context, run FreePlayRun) (FreePlayQuote, error) {
	if run.Target != p.settings.Target || run.Entry.Validate() != nil || run.PayloadHash != run.Entry.PayloadHash(run.Target) {
		return FreePlayQuote{}, ErrFreePlayConflict
	}
	plan, err := p.CurrentPlan(ctx)
	if err != nil {
		return FreePlayQuote{}, err
	}
	var identity [64]byte
	if _, err = rand.Read(identity[:]); err != nil {
		return FreePlayQuote{}, err
	}
	quote := FreePlayQuote{ID: hex.EncodeToString(identity[:32]), Nonce: hex.EncodeToString(identity[32:]), RunID: run.Entry.RunID, PayloadHash: run.PayloadHash, Payer: "studio", ExpiresAt: p.now().Add(p.settings.QuoteLifetime).Unix(), MaxFeeUgnot: plan.FeeUgnot, MaxDepositUgnot: plan.DepositUgnot}
	if err = p.availability(ctx, run, quote); err != nil {
		return FreePlayQuote{}, err
	}
	if err = ctx.Err(); err != nil {
		return FreePlayQuote{}, err
	}
	if quote.ExpiresAt <= p.now().Unix() {
		return FreePlayQuote{}, ErrFreePlayQuote
	}
	return quote, nil
}

// ValidateBroadcast matches the transport guard without importing its concrete
// type. The guard never reserves/refunds money: durable reservation is a separate
// publisher stage. An error after Anchor starts remains conservatively unknown.
func (p *FreePlayCostPolicy) ValidateBroadcast(ctx context.Context, target FreePlayTarget, entry FreePlayEntry, quote FreePlayQuote, gasWanted int64) error {
	if target != p.settings.Target || entry.Validate() != nil || entry.RunID != quote.RunID || entry.PayloadHash(target) != quote.PayloadHash || !fpHex64.MatchString(quote.ID) || !fpHex64.MatchString(quote.Nonce) || quote.Payer != "studio" || quote.MaxFeeUgnot <= 0 || quote.MaxDepositUgnot <= 0 || quote.MaxFeeUgnot > p.settings.MaxFeeUgnot || quote.MaxDepositUgnot > p.settings.MaxDepositUgnot || gasWanted != p.settings.GasWanted {
		return ErrFreePlayConflict
	}
	if quote.ExpiresAt <= p.now().Unix() {
		return ErrFreePlayQuote
	}
	plan, err := p.CurrentPlan(ctx)
	if err != nil {
		return err
	}
	if quote.ExpiresAt <= p.now().Unix() {
		return ErrFreePlayQuote
	}
	if plan.FeeUgnot > quote.MaxFeeUgnot || plan.DepositUgnot > quote.MaxDepositUgnot {
		return ErrFreePlayBudget
	}
	return ctx.Err()
}
