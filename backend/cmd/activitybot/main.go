// Command activitybot generates bounded, TESTNET-ONLY on-chain activity so the
// Memba feed/marketplace don't look like a ghost town during the launch window.
//
// SAFETY MODEL — this tool never holds a private key in Go. Like badge-mint, it
// plans a bounded batch of actions and either prints the `gnokey maketx`
// commands (default, --dry-run) or shells out to `gnokey` to broadcast them
// (--broadcast), using a key referenced by NAME from gnokey's keyring. The
// throwaway key lives only in gnokey's keyring / a flyctl secret, never here.
//
// Hard safety rails, all enforced before any broadcast:
//   - kill switch: ACTIVITYBOT_ENABLED must equal "true" or the bot exits 0
//     cleanly (so a scheduled job is a no-op until explicitly enabled);
//   - MaxActionsPerRun caps one invocation; MaxTransfersPerDay caps the rolling
//     day (tracked in a small JSON state file), so a runaway schedule can't
//     drain the faucet key;
//   - MaxTransferUgnot caps any single transfer; MaxGasWanted/MaxGasFeeUgnot cap
//     per-tx gas so a misconfig can't burn the balance;
//   - clean exit: the run stops at the first broadcast error and never panics
//     mid-batch — the day counter only advances for actions actually sent.
//
// Usage:
//
//	activitybot -scenario scenario.json                 # DRY-RUN: print gnokey cmds
//	ACTIVITYBOT_ENABLED=true activitybot -scenario scenario.json -broadcast -key activitybot
//
// Testnet only. See docs/ACTIVITYBOT_RUNBOOK.md.
package main

import (
	"flag"
	"fmt"
	"os"
	"time"
)

// ── Hard safety constants (compile-time; not overridable by flags) ──────────
const (
	// MaxActionsPerRun bounds a single invocation regardless of the scenario.
	MaxActionsPerRun = 25
	// MaxTransfersPerDay bounds value-moving actions across a rolling 24h,
	// tracked in the state file so a frequent schedule can't exceed it.
	MaxTransfersPerDay = 100
	// MaxTransferUgnot caps a single transfer (faucet-scale — a bug can't move
	// a large amount).
	MaxTransferUgnot = 1_000_000 // 1 GNOT
	// Per-tx gas ceilings.
	MaxGasWanted    = 20_000_000
	MaxGasFeeUgnot  = 2_000_000
	defaultGasWant  = 10_000_000
	defaultGasFeeUg = 1_000_000
)

func main() {
	var (
		scenarioPath = flag.String("scenario", "", "path to the scenario JSON (required)")
		statePath    = flag.String("state", "activitybot-state.json", "path to the rolling-counter state file")
		key          = flag.String("key", "activitybot", "gnokey key NAME for the bot signer (keyring, never a raw key)")
		chainID      = flag.String("chain-id", "test-13", "gno chain id")
		remote       = flag.String("remote", "https://rpc.test13.testnets.gno.land:443", "gno RPC endpoint")
		broadcast    = flag.Bool("broadcast", false, "broadcast via gnokey (default: dry-run, print commands only)")
		maxActions   = flag.Int("max", MaxActionsPerRun, "max actions this run (clamped to MaxActionsPerRun)")
	)
	flag.Parse()

	if *scenarioPath == "" {
		fatal("-scenario is required")
	}

	// Kill switch — a scheduled run is a clean no-op until explicitly enabled.
	if os.Getenv("ACTIVITYBOT_ENABLED") != "true" {
		fmt.Fprintln(os.Stderr, "activitybot: ACTIVITYBOT_ENABLED != \"true\" — disabled, exiting cleanly")
		return
	}

	scenario, err := loadScenario(*scenarioPath)
	if err != nil {
		fatal("load scenario: %v", err)
	}
	if err := scenario.validate(); err != nil {
		fatal("invalid scenario: %v", err)
	}

	limit := clamp(*maxActions, 0, MaxActionsPerRun)

	// Load + roll the day counter so MaxTransfersPerDay spans invocations.
	state, err := loadState(*statePath, time.Now().UTC())
	if err != nil {
		fatal("load state: %v", err)
	}

	runner := &Runner{
		scenario:  scenario,
		state:     state,
		key:       *key,
		chainID:   *chainID,
		remote:    *remote,
		broadcast: *broadcast,
		out:       os.Stdout,
		exec:      gnokeyExec, // real broadcaster; tests substitute a fake
	}

	fmt.Fprintf(os.Stderr, "activitybot: key=%q chain=%q remote=%q broadcast=%v max=%d transfers_today=%d/%d\n",
		*key, *chainID, *remote, *broadcast, limit, state.TransfersToday, MaxTransfersPerDay)

	sent, err := runner.Run(limit)
	if err != nil {
		// Persist whatever advanced before the error, then report — never panic.
		// A save failure here loosens the day cap (the spent transfers aren't
		// recorded), so surface it rather than swallow it.
		if serr := saveState(*statePath, runner.state); serr != nil {
			fmt.Fprintf(os.Stderr, "activitybot: WARNING failed to persist state after error (day cap may be undercounted): %v\n", serr)
		}
		fatal("run stopped after %d action(s): %v", sent, err)
	}

	if err := saveState(*statePath, runner.state); err != nil {
		// Any transfers this run already went out; failing to persist the
		// advanced day counter loosens the cap for the next run — same hazard as
		// the error path, so it's a loud failure, not a silent one.
		fatal("save state failed — day cap may be undercounted next run: %v", err)
	}
	fmt.Fprintf(os.Stderr, "activitybot: done — %d action(s) %s\n", sent, verbFor(*broadcast))
}

func verbFor(broadcast bool) string {
	if broadcast {
		return "broadcast"
	}
	return "planned (dry-run)"
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "activitybot: "+format+"\n", args...)
	os.Exit(1)
}
