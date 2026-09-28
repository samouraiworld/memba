package arcade

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// BatcherConfig tunes the day-close batcher. Enabled=false leaves it dormant.
type BatcherConfig struct {
	Enabled     bool
	MaxPerCycle int           // cap on broadcast attempts per scan cycle (rest drain later); default 100
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
// tick it attests the top-N verified runs of every CLOSED (game, day) board
// (day < today UTC) that still has pending entries. It is the attester-pays path — the realm's
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
			// A failed cycle may have broadcast a transaction without being
			// able to persist its outcome. Stop the loop so a broken database
			// cannot spend gas again on the same run every tick.
			n, err := func() (n int, err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("arcade day-close batcher panicked: %v", r)
					}
				}()
				return runBatchOnce(ctx, store, b, cfg.MaxPerCycle, time.Now)
			}()
			if err != nil {
				if ctx.Err() == nil {
					slog.Error("arcade day-close batcher stopped after failed cycle; operator restart required", "error", err)
				}
				return
			}
			if n > 0 {
				slog.Info("arcade day-close batch attested runs", "count", n)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// RunBatchOnce is the one-shot entry point. Transient failure counts live in
// the database, so repeated calls and process restarts share the same limit.
func RunBatchOnce(ctx context.Context, store *Store, b Broadcaster, maxPerCycle int, now func() time.Time) (int, error) {
	return runBatchOnce(ctx, store, b, maxPerCycle, now)
}

// runBatchOnce attests, for every FULLY-CLOSED (game, day) board, each
// address's best verified run — one on-chain board entry per address per game
// (the realm's granularity; attesting a worse run after a better one would trip
// its non-improving panic). The work list is data-driven — whatever (game, day)
// pairs hold pending runs — so a newly-enabled game needs no batcher change.
// Only days past the submit grace window are closed: a daily seed is
// submittable on its date and the next UTC day, so day D is closed once
// today >= D+2 — attesting earlier would race late (yesterday-window)
// submissions.
//
// Per attestation: broadcast → mark attested → retire the address's lesser runs.
// A realm rejection is classified: already-on-chain converges (mark attested);
// a log bound elsewhere or a deterministic shape failure is retired ('skipped');
// a transient failure is left 'verified' to retry — but only up to maxAttestRetries
// consecutive cycles (tracked in the database), after which the run is parked
// ('errored') so a poisoned row can't drip gas forever. maxPerCycle bounds one
// cycle's broadcast attempts, including failed or already-delivered transactions
// and failures to save a receipt locally; the rest drain on later cycles.
func runBatchOnce(ctx context.Context, store *Store, b Broadcaster, maxPerCycle int, now func() time.Time) (int, error) {
	if maxPerCycle <= 0 {
		maxPerCycle = 100
	}
	// Close only days strictly before yesterday (UTC) — i.e. day <= today-2.
	closeBefore := now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	boards, err := store.PendingDailyGameDays(closeBefore)
	if err != nil {
		return 0, err
	}
	attested, attempted := 0, 0
	for _, gd := range boards {
		if attempted >= maxPerCycle {
			return attested, nil
		}
		if ctx.Err() != nil {
			return attested, ctx.Err()
		}
		runs, err := store.BestVerifiedDaily(gd.Game, gd.Day, maxPerCycle-attempted)
		if err != nil {
			return attested, err
		}
		for _, run := range runs {
			if ctx.Err() != nil {
				return attested, ctx.Err()
			}
			if attempted >= maxPerCycle {
				return attested, nil // drain the rest next cycle
			}
			// Reserve this cycle's attempt before broadcasting: every outcome
			// may have spent gas, even if no attestation is recorded locally.
			attempted++
			txHash, err := b.AttestScore(ctx, run)
			switch {
			case err == nil:
				// broadcast succeeded — fall through to mark+resolve below.
			case errors.Is(err, ErrAlreadyOnChain):
				// The panic alone cannot tell an exact crash-recovery retry from
				// a different, better on-chain run. Read the board entry before
				// assigning this local run an attested receipt.
				reader, ok := b.(OnChainEntryReader)
				var entry OnChainEntry
				var found bool
				var readErr error
				if !ok {
					readErr = errors.New("arcade: broadcaster cannot resolve already-on-chain entry")
				} else {
					entry, found, readErr = reader.LookupEntry(ctx, run)
					if readErr == nil && !found {
						readErr = errors.New("arcade: already-on-chain rejection but board entry is absent")
					} else if readErr == nil && entry.Score < run.Score {
						readErr = errors.New("arcade: board entry is lower than rejected run")
					}
				}
				if readErr != nil {
					// A rejected broadcast can still spend gas. A failed readback
					// must count toward the durable retry cap just like any other
					// transient broadcast failure; never claim it was attested.
					if e := recordAttestFailure(store, run, gd, readErr); e != nil {
						return attested, e
					}
					continue
				}
				if entry.LogHash != run.LogHash || entry.Score != run.Score {
					// This was the best local run, so an equal-or-better
					// on-chain entry supersedes every local run for this
					// address and board. Drain them in one write.
					if e := store.ResolveSupersededDaily(gd.Game, gd.Day, run.Addr, ""); e != nil {
						return attested, e
					}
					continue
				}
				txHash = "already-onchain"
			case errors.Is(err, ErrLogBoundElsewhere), errors.Is(err, ErrPermanentReject):
				// Never attestable for us (bound elsewhere) or a deterministic
				// shape rejection — retire it so it stops retrying.
				if e := store.MarkSkipped(run.LogHash); e != nil {
					return attested, fmt.Errorf("arcade mark-skipped %s: %w", run.LogHash, e)
				}
				slog.Warn("arcade attest: permanent realm rejection — skipping run", "game", gd.Game, "day", gd.Day, "addr", run.Addr, "logHash", run.LogHash, "error", err)
				continue
			default:
				// Transient (network/gas/auth-not-yet-allowlisted): retry, but only
				// up to a bounded number of consecutive cycles.
				if e := recordAttestFailure(store, run, gd, err); e != nil {
					return attested, e
				}
				continue
			}
			if err := store.MarkAttested(run.LogHash, txHash, now().Unix()); err != nil {
				slog.Error("arcade attest broadcast succeeded but mark failed", "logHash", run.LogHash, "txHash", txHash, "error", err)
				// The broadcast may have spent gas. Bound repeated receipt-write
				// failures; if storage cannot persist the failure count, stop this
				// cycle before another broadcast.
				if e := recordAttestFailure(store, run, gd, err); e != nil {
					return attested, e
				}
				continue
			}
			// The best is attested; retire this address's lesser runs on this
			// (game, day) board — its runs in OTHER games are other boards.
			if err := store.ResolveSupersededDaily(gd.Game, gd.Day, run.Addr, run.LogHash); err != nil {
				slog.Error("arcade resolve superseded failed", "game", gd.Game, "day", gd.Day, "addr", run.Addr, "error", err)
			}
			attested++
		}
	}
	return attested, nil
}

func recordAttestFailure(store *Store, run Run, gd GameDay, failure error) error {
	failures, err := store.IncrementAttestFailures(run.LogHash)
	if err != nil {
		return err
	}
	if failures >= maxAttestRetries {
		if err := store.MarkErrored(run.LogHash); err != nil {
			return err
		}
		slog.Error("arcade attest failed too many times — parked (requeue by flipping status to verified)", "game", gd.Game, "day", gd.Day, "addr", run.Addr, "logHash", run.LogHash, "attempts", failures, "error", failure)
		return nil
	}
	slog.Warn("arcade attest failed — will retry next cycle", "game", gd.Game, "day", gd.Day, "addr", run.Addr, "attempt", failures, "error", failure)
	return nil
}
