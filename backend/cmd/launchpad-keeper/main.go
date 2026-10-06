// Command launchpad-keeper sweeps the Launchpad sales fees to the treasury.
//
// SweepFees pays every recorded ugnot fee to the treasury of the current
// config; anyone may call it and the caller chooses neither the receiver nor
// the amount. Sweeping often limits what a change of treasury can redirect.
//
// SAFETY MODEL: this tool never holds a private key. It signs through `gnokey`
// with a key referenced by NAME from gnokey's keyring: a dedicated hot key with
// a few GNOT for gas and no role. With -password-stdin, the keeper's own stdin
// is handed to gnokey (-insecure-password-stdin) and never read here.
//
// One run:
//  1. reads the fees at a stable reading and the current treasury, from a node
//     identity-checked as -chain-id;
//  2. does nothing when the fees are 0 (the realm refuses that), or when they
//     are below -min-fees and the last sweep is younger than -max-age;
//  3. otherwise prints the gnokey command, or with -broadcast runs it;
//  4. checks the transaction's LaunchpadFeesSwept event and bank transfer
//     against step 1 and pages LAUNCHPAD_WATCH_WEBHOOK_URL (required with
//     -broadcast) on a mismatch.
//
// Runs hold a lock next to the state file and gnokey is stopped at -timeout.
// Every failure but a mismatch only exits non-zero: alert on the exit status.
//
// Run it hourly from a scheduler: it sweeps once a day, or as soon as the fees
// reach -min-fees.
//
//	launchpad-keeper -chain-id gnoland-1 -remote https://rpc.mainnet.samourai.live -state keeper.json             # dry-run
//	launchpad-keeper -chain-id gnoland-1 -remote https://rpc.mainnet.samourai.live -state keeper.json -broadcast -key launchpad-keeper -password-stdin < pass
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/samouraiworld/memba/backend/internal/arcade"
	"github.com/samouraiworld/memba/backend/internal/launchpadwatch"
)

type options struct {
	chainID, remote, key, home, gnokey, state string
	minFees, maxFee, gasWanted                int64
	maxAge, timeout                           time.Duration
	broadcast, passwordStdin                  bool
}

// keeperState is what the keeper remembers between runs.
type keeperState struct {
	LastSweep time.Time `json:"lastSweep"`
}

func main() {
	var o options
	flag.StringVar(&o.chainID, "chain-id", "", "chain id the node must serve (required)")
	flag.StringVar(&o.remote, "remote", "", "RPC node, one node, never a pool (required)")
	flag.StringVar(&o.state, "state", "", "state file holding the last sweep time (required)")
	flag.StringVar(&o.key, "key", "", "gnokey key name (required with -broadcast)")
	flag.StringVar(&o.home, "home", "", "gnokey home directory (gnokey's default when empty)")
	flag.StringVar(&o.gnokey, "gnokey", "gnokey", "gnokey binary")
	flag.Int64Var(&o.minFees, "min-fees", 10_000_000, "sweep at once from this many ugnot of fees")
	flag.DurationVar(&o.maxAge, "max-age", 24*time.Hour, "otherwise sweep when the last sweep is older than this")
	flag.Int64Var(&o.gasWanted, "gas-wanted", 30_000_000, "gas wanted (a sweep measured about 15M)")
	flag.Int64Var(&o.maxFee, "max-fee", 2_000_000, "refuse a gas fee above this many ugnot")
	flag.DurationVar(&o.timeout, "timeout", 2*time.Minute, "give up on gnokey after this long")
	flag.BoolVar(&o.broadcast, "broadcast", false, "sign and broadcast (default: print the command)")
	flag.BoolVar(&o.passwordStdin, "password-stdin", false, "hand stdin to gnokey as the key password")
	flag.Parse()
	k := keeper{o: o, out: os.Stdout, warn: os.Stderr, client: &http.Client{Timeout: 10 * time.Second}, now: time.Now,
		webhook: os.Getenv("LAUNCHPAD_WATCH_WEBHOOK_URL"), run: runGnokey(o, os.Stdin)}
	if err := k.locked(context.Background()); err != nil {
		fmt.Fprintln(os.Stderr, "launchpad-keeper:", err)
		os.Exit(1)
	}
}

type keeper struct {
	o       options
	out     io.Writer
	warn    io.Writer
	client  *http.Client
	now     func() time.Time
	webhook string
	// run executes gnokey with these arguments and returns its stdout.
	run      func(ctx context.Context, args []string) (string, error)
	plan     func(ctx context.Context, remote, chainID string) (launchpadwatch.SweepPlan, error)
	gasPrice func(ctx context.Context, client *http.Client, remote, chainID string) (arcade.GasPrice, error)
}

// locked runs once while holding an exclusive lock next to the state file,
// so scheduled runs never overlap.
func (k keeper) locked(ctx context.Context) error {
	if k.o.state == "" {
		return errors.New("-state is required")
	}
	f, err := os.OpenFile(k.o.state+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return fmt.Errorf("another keeper run holds %s: %w", f.Name(), err)
	}
	return k.once(ctx)
}

func (k keeper) once(ctx context.Context) error {
	o := k.o
	switch {
	case o.chainID == "" || o.remote == "" || o.state == "":
		return errors.New("-chain-id, -remote and -state are required")
	case o.broadcast && o.key == "":
		return errors.New("-broadcast needs -key")
	case o.broadcast && k.webhook == "":
		return errors.New("-broadcast needs LAUNCHPAD_WATCH_WEBHOOK_URL, to page a sweep that differs from what was owed")
	case o.gasWanted <= 0 || o.maxFee <= 0 || o.minFees <= 0 || o.maxAge <= 0 || o.timeout <= 0:
		return errors.New("-gas-wanted, -max-fee, -min-fees, -max-age and -timeout must be positive")
	}
	plan, gasPrice := launchpadwatch.PlanSweep, arcade.FetchGasPrice
	if k.plan != nil {
		plan, gasPrice = k.plan, k.gasPrice
	}
	p, err := plan(ctx, o.remote, o.chainID)
	if err != nil {
		return err
	}
	st, err := readState(o.state)
	if err != nil {
		// Sweeping is safe whenever the realm holds fees: an unreadable state
		// only means a sweep may come early.
		_, _ = fmt.Fprintf(k.warn, "state unreadable, treated as never swept: %v\n", err)
	}
	if p.Fees.Sign() == 0 {
		_, _ = fmt.Fprintln(k.out, "no fees to sweep")
		return nil
	}
	if p.Fees.Cmp(big.NewInt(o.minFees)) < 0 && k.now().Sub(st.LastSweep) < o.maxAge {
		_, _ = fmt.Fprintf(k.out, "fees %s ugnot below %d and last sweep at %s: not due\n", p.Fees, o.minFees, st.LastSweep.Format(time.RFC3339))
		return nil
	}
	gp, err := gasPrice(ctx, k.client, o.remote, o.chainID)
	if err != nil {
		return fmt.Errorf("gas price: %w", err)
	}
	// Twice the minimum, as the arcade attester pays: a small price rise between
	// this read and the block does not reject the transaction.
	fee := new(big.Int).Mul(arcade.MinFeeUgnot(o.gasWanted, gp), big.NewInt(2))
	if fee.Cmp(big.NewInt(o.maxFee)) > 0 {
		return fmt.Errorf("gas fee %s ugnot is above -max-fee %d", fee, o.maxFee)
	}
	args := []string{"maketx", "call", "-pkgpath", launchpadwatch.SalesPath, "-func", "SweepFees", "-args", "ugnot",
		"-gas-fee", fee.String() + "ugnot", "-gas-wanted", strconv.FormatInt(o.gasWanted, 10),
		"-chainid", o.chainID, "-remote", o.remote, "-broadcast"}
	if o.home != "" {
		args = append(args, "-home", o.home)
	}
	if o.passwordStdin {
		args = append(args, "-insecure-password-stdin")
	}
	key := o.key
	if key == "" {
		key = "<key>"
	}
	args = append(args, key)
	_, _ = fmt.Fprintf(k.out, "fees %s ugnot owed to treasury %s at height %d\n", p.Fees, p.Treasury, p.Height)
	if !o.broadcast {
		_, _ = fmt.Fprintf(k.out, "%s %s\n", o.gnokey, strings.Join(args, " "))
		return nil
	}
	runCtx, cancel := context.WithTimeout(ctx, o.timeout)
	defer cancel()
	out, err := k.run(runCtx, args)
	if err != nil {
		return fmt.Errorf("SweepFees was not broadcast, failed, or timed out (if it landed, its event is unchecked: see the runbook): %w\n%s", err, out)
	}
	amount, err := launchpadwatch.CheckSweep(p, eventsLine(out))
	if err != nil {
		msg := fmt.Sprintf("LAUNCHPAD PAGE sweep: %s\nchain %s, planned fees %s to %s at height %d\nrpc: %s\ngnokey output:\n%s", err, o.chainID, p.Fees, p.Treasury, p.Height, o.remote, out)
		if nerr := launchpadwatch.Notify(k.client, k.webhook, msg); nerr != nil {
			return fmt.Errorf("%w (and the page failed: %v)", err, nerr)
		}
		return err
	}
	if err := writeState(o.state, keeperState{LastSweep: k.now().UTC()}); err != nil {
		return fmt.Errorf("swept %s ugnot but the state was not saved: %w", amount, err)
	}
	_, _ = fmt.Fprintf(k.out, "swept %s ugnot to %s\n", amount, p.Treasury)
	return nil
}

// eventsLine is the JSON array gnokey prints after "EVENTS:", or "" when absent.
func eventsLine(out string) []byte {
	for _, line := range strings.Split(out, "\n") {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(line), "EVENTS:"); ok {
			return []byte(strings.TrimSpace(rest))
		}
	}
	return nil
}

func readState(path string) (keeperState, error) {
	var st keeperState
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return st, nil
	}
	if err != nil {
		return st, err
	}
	if err := json.Unmarshal(raw, &st); err != nil {
		return st, fmt.Errorf("state %s: %w", path, err)
	}
	return st, nil
}

// writeState replaces the state file atomically and durably: the new bytes
// and the rename both reach the disk before it returns.
func writeState(path string, st keeperState) error {
	raw, err := json.Marshal(st)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(raw); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer func() { _ = dir.Close() }()
	return dir.Sync()
}

func runGnokey(o options, stdin io.Reader) func(context.Context, []string) (string, error) {
	return func(ctx context.Context, args []string) (string, error) {
		cmd := exec.CommandContext(ctx, o.gnokey, args...) //nolint:gosec // argv built here from validated flags
		// At the deadline gnokey is killed; a child still holding its output
		// must not keep the run waiting.
		cmd.WaitDelay = time.Second
		if o.passwordStdin {
			cmd.Stdin = stdin
		}
		var stdout strings.Builder
		cmd.Stdout = &stdout
		cmd.Stderr = os.Stderr
		err := cmd.Run()
		return stdout.String(), err
	}
}
