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

// maxAttestRetries bounds how many cycles a run may fail a TRANSIENT attestation
// (network/gas/auth-not-yet-allowlisted) before it is parked 'errored' — a
// dead-letter so one poisoned row can't retry (and drip gas) forever. Genuine
// long outages can be requeued by flipping 'errored' rows back to 'verified'.
const maxAttestRetries = 8

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
		failures := map[string]int{} // logHash -> consecutive transient failures (across cycles)
		for {
			// Run once immediately, then on each tick. A panic in a cycle is
			// isolated so the loop survives to the next tick.
			func() {
				defer func() {
					if r := recover(); r != nil {
						slog.Error("arcade day-close batcher panicked", "recover", r)
					}
				}()
				n, err := runBatchOnce(ctx, store, b, cfg.MaxPerCycle, time.Now, failures)
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

// RunBatchOnce is the stateless entry point (tests + one-shot callers): it runs a
// single batch cycle with a fresh failure counter. The long-running loop uses
// runBatchOnce with a persistent counter so transient failures are bounded across
// cycles.
func RunBatchOnce(ctx context.Context, store *Store, b Broadcaster, maxPerCycle int, now func() time.Time) (int, error) {
	return runBatchOnce(ctx, store, b, maxPerCycle, now, map[string]int{})
}

// runBatchOnce attests, for every FULLY-CLOSED day, each address's best verified
// run — one on-chain board entry per address (the realm's granularity; attesting
// a worse run after a better one would trip its non-improving panic). Only days
// past the submit grace window are closed: a daily seed is submittable on its
// date and the next UTC day, so day D is closed once today >= D+2 — attesting
// earlier would race late (yesterday-window) submissions.
//
// Per attestation: broadcast → mark attested → retire the address's lesser runs.
// A realm rejection is classified: already-on-chain converges (mark attested);
// a log bound elsewhere or a deterministic shape failure is retired ('skipped');
// a transient failure is left 'verified' to retry — but only up to maxAttestRetries
// consecutive cycles (tracked in `failures`), after which the run is parked
// ('errored') so a poisoned row can't drip gas forever. maxPerCycle bounds one
// cycle's work; the rest drain on later cycles.
func runBatchOnce(ctx context.Context, store *Store, b Broadcaster, maxPerCycle int, now func() time.Time, failures map[string]int) (int, error) {
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
			case errors.Is(err, ErrLogBoundElsewhere), errors.Is(err, ErrPermanentReject):
				// Never attestable for us (bound elsewhere) or a deterministic
				// shape rejection — retire it so it stops retrying.
				retire(store, run.LogHash)
				delete(failures, run.LogHash)
				slog.Warn("arcade attest: permanent realm rejection — skipping run", "day", day, "addr", run.Addr, "logHash", run.LogHash, "error", err)
				continue
			default:
				// Transient (network/gas/auth-not-yet-allowlisted): retry, but only
				// up to a bounded number of consecutive cycles.
				failures[run.LogHash]++
				if failures[run.LogHash] >= maxAttestRetries {
					if e := store.MarkErrored(run.LogHash); e != nil {
						slog.Error("arcade mark-errored failed", "logHash", run.LogHash, "error", e)
					} else {
						delete(failures, run.LogHash)
					}
					slog.Error("arcade attest failed too many times — parked (requeue by flipping status to verified)", "day", day, "addr", run.Addr, "logHash", run.LogHash, "attempts", maxAttestRetries, "error", err)
					continue
				}
				slog.Warn("arcade attest failed — will retry next cycle", "day", day, "addr", run.Addr, "attempt", failures[run.LogHash], "error", err)
				continue
			}
			if err := store.MarkAttested(run.LogHash, txHash, now().Unix()); err != nil {
				slog.Error("arcade attest broadcast succeeded but mark failed", "logHash", run.LogHash, "txHash", txHash, "error", err)
				continue
			}
			delete(failures, run.LogHash)
			// The best is attested; retire this address's lesser runs for the day.
			if err := store.ResolveSupersededDaily(day, run.Addr, run.LogHash); err != nil {
				slog.Error("arcade resolve superseded failed", "day", day, "addr", run.Addr, "error", err)
			}
			attested++
		}
	}
	return attested, nil
}

func retire(store *Store, logHash string) {
	if e := store.MarkSkipped(logHash); e != nil {
		slog.Error("arcade mark-skipped failed", "logHash", logHash, "error", e)
	}
}
