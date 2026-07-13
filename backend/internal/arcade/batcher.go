package arcade

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

// BatcherConfig tunes the day-close batcher. Enabled=false leaves it dormant.
type BatcherConfig struct {
	Enabled     bool
	MaxPerCycle int           // cap on attestations per scan cycle (rest drain later); default 100
	Interval    time.Duration // scan cadence; default 15m
}

func (c BatcherConfig) withDefaults() BatcherConfig {
	if c.MaxPerCycle <= 0 {
		c.MaxPerCycle = 100
	}
	if c.Interval <= 0 {
		c.Interval = 15 * time.Minute
	}
	return c
}

// StartDayCloseBatcher runs the attester loop until ctx is cancelled: on each
// tick it attests the top-N verified runs of every CLOSED day (day < today UTC)
// that still has pending entries. It is the attester-pays path — the realm's
// competitive board is written by the backend's dedicated key. Dormant unless
// cfg.Enabled. Safe to run with a nil/zero everything else (it just no-ops).
func StartDayCloseBatcher(ctx context.Context, store *Store, b Broadcaster, cfg BatcherConfig) {
	if !cfg.Enabled || store == nil || b == nil {
		return
	}
	cfg = cfg.withDefaults()
	go func() {
		ticker := time.NewTicker(cfg.Interval)
		defer ticker.Stop()
		for {
			// Run once immediately, then on each tick. A panic in a cycle is
			// isolated so the loop survives to the next tick.
			func() {
				defer func() {
					if r := recover(); r != nil {
						slog.Error("arcade day-close batcher panicked", "recover", r)
					}
				}()
				n, err := RunBatchOnce(ctx, store, b, cfg.MaxPerCycle, time.Now)
				if err != nil {
					slog.Error("arcade day-close batch cycle failed", "error", err)
				} else if n > 0 {
					slog.Info("arcade day-close batch attested runs", "count", n)
				}
			}()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// RunBatchOnce attests, for every FULLY-CLOSED day, each address's best verified
// run — one on-chain board entry per address (the realm's granularity; attesting
// a worse run after a better one would trip its non-improving panic). Only days
// past the submit grace window are closed: a daily seed is submittable on its
// date and the next UTC day, so day D is closed once today >= D+2 — attesting
// earlier would race late (yesterday-window) submissions.
//
// Per attestation: broadcast → mark attested → mark the address's other runs for
// that day 'skipped' (so the day drains). A broadcast failure is logged and left
// 'verified' to retry next cycle, never aborting the batch. maxPerCycle bounds
// one cycle's work; the rest drain on later cycles. Returns runs attested.
// Exported for tests.
func RunBatchOnce(ctx context.Context, store *Store, b Broadcaster, maxPerCycle int, now func() time.Time) (int, error) {
	if maxPerCycle <= 0 {
		maxPerCycle = 100
	}
	// Close only days strictly before yesterday (UTC) — i.e. day <= today-2.
	closeBefore := now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	days, err := store.PendingDailyDays(closeBefore)
	if err != nil {
		return 0, err
	}
	attested := 0
	for _, day := range days {
		if ctx.Err() != nil {
			return attested, ctx.Err()
		}
		runs, err := store.BestVerifiedDaily(day, maxPerCycle-attested)
		if err != nil {
			return attested, err
		}
		for _, run := range runs {
			if ctx.Err() != nil {
				return attested, ctx.Err()
			}
			if attested >= maxPerCycle {
				return attested, nil // drain the rest next cycle
			}
			txHash, err := b.AttestScore(ctx, run)
			switch {
			case err == nil:
				// broadcast succeeded — fall through to mark+resolve below.
			case errors.Is(err, ErrAlreadyOnChain):
				// The entry is already on-chain at an equal-or-better score
				// (crash recovery, or a better run already attested). Our target
				// is met — mark done so we don't retry a deterministically-
				// panicking tx forever.
				txHash = "already-onchain"
			case errors.Is(err, ErrLogBoundElsewhere):
				// This run's log is bound on-chain to another address; it can
				// never be attested for us. Retire it so it stops retrying.
				if e := store.MarkSkipped(run.LogHash); e != nil {
					slog.Error("arcade mark-skipped failed", "logHash", run.LogHash, "error", e)
				}
				slog.Warn("arcade attest: log bound to another address on-chain — skipping run", "day", day, "addr", run.Addr, "logHash", run.LogHash)
				continue
			default:
				// Transient (network/gas/other): leave 'verified' to retry next
				// cycle; don't abort the batch.
				slog.Warn("arcade attest failed — will retry next cycle", "day", day, "addr", run.Addr, "error", err)
				continue
			}
			if err := store.MarkAttested(run.LogHash, txHash, now().Unix()); err != nil {
				slog.Error("arcade attest broadcast succeeded but mark failed", "logHash", run.LogHash, "txHash", txHash, "error", err)
				continue
			}
			// The best is attested; retire this address's lesser runs for the day.
			if err := store.ResolveSupersededDaily(day, run.Addr, run.LogHash); err != nil {
				slog.Error("arcade resolve superseded failed", "day", day, "addr", run.Addr, "error", err)
			}
			attested++
		}
	}
	return attested, nil
}
