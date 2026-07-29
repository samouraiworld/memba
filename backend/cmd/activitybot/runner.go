package main

import (
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
)

// execFn broadcasts one already-built gnokey argv and returns its combined
// output. Real runs use gnokeyExec; tests substitute a fake so no tx is sent.
type execFn func(args []string) (string, error)

// Runner walks a scenario's actions up to a per-run limit, respecting the
// rolling day budget, and either prints the gnokey command (dry-run) or
// broadcasts it. It stops at the first broadcast error and never panics
// mid-batch; state.TransfersToday only advances for value-moving actions that
// actually went out.
type Runner struct {
	scenario  *Scenario
	state     *State
	key       string
	chainID   string
	remote    string
	broadcast bool
	out       io.Writer
	exec      execFn
}

// Run processes up to `limit` actions and returns the number acted on (printed
// in dry-run, broadcast otherwise). A value-moving action past the day budget
// is skipped (not an error); a broadcast failure stops the run.
func (r *Runner) Run(limit int) (int, error) {
	acted := 0
	for i, a := range r.scenario.Actions {
		if acted >= limit {
			break
		}
		if a.isValueMoving() && r.state.transfersRemaining() <= 0 {
			_, _ = fmt.Fprintf(r.out, "# skip action %d (%s): daily transfer budget reached (%d/%d)\n",
				i, a.Type, r.state.TransfersToday, MaxTransfersPerDay)
			continue
		}

		argv := r.buildArgv(a)

		if !r.broadcast {
			// Dry-run: print the command and MOVE ON. It must never advance the
			// real daily counter — otherwise dry-running would silently eat the
			// live transfer budget.
			_, _ = fmt.Fprintf(r.out, "gnokey %s\n", joinShell(argv))
			acted++
			continue
		}

		out, err := r.exec(argv)
		if err != nil {
			// Stop cleanly; the caller persists advanced state and reports.
			return acted, fmt.Errorf("action %d (%s): %w\n%s", i, a.Type, err, out)
		}
		_, _ = fmt.Fprintf(r.out, "# action %d (%s) broadcast: %s\n", i, a.Type, firstLine(out))

		// Only a successfully-broadcast value-moving action spends the budget.
		if a.isValueMoving() {
			r.state.TransfersToday++
		}
		acted++
	}
	return acted, nil
}

// buildArgv builds the `gnokey maketx` argv for an action (without the leading
// "gnokey"). Gas is pinned within the per-tx safety ceilings.
func (r *Runner) buildArgv(a Action) []string {
	gasWanted := strconv.Itoa(minInt(defaultGasWant, MaxGasWanted))
	gasFee := strconv.Itoa(minInt(defaultGasFeeUg, MaxGasFeeUgnot)) + "ugnot"

	switch a.Type {
	case ActionFeedPost:
		return []string{
			"maketx", "call",
			"-pkgpath", r.scenario.FeedRealm,
			"-func", "CreatePost",
			"-args", a.Body,
			"-args", "0", // replyTo = 0 (top-level)
			"-gas-fee", gasFee,
			"-gas-wanted", gasWanted,
			"-chainid", r.chainID,
			"-remote", r.remote,
			"-broadcast",
			r.key,
		}
	case ActionTransfer:
		return []string{
			"maketx", "send",
			"-to", a.ToAddress,
			"-send", strconv.FormatInt(a.Ugnot, 10) + "ugnot",
			"-gas-fee", gasFee,
			"-gas-wanted", gasWanted,
			"-chainid", r.chainID,
			"-remote", r.remote,
			"-broadcast",
			r.key,
		}
	case ActionSweep:
		return []string{
			"maketx", "call",
			"-pkgpath", r.scenario.FeedRealm,
			"-func", "SweepTombstones",
			"-args", strconv.Itoa(a.Limit), // cur realm is VM-injected; only limit is passed
			"-gas-fee", gasFee,
			"-gas-wanted", gasWanted,
			"-chainid", r.chainID,
			"-remote", r.remote,
			"-broadcast",
			r.key,
		}
	default:
		// validate() already rejected unknown types; defensive.
		return []string{"# unknown action type: " + string(a.Type)}
	}
}

// gnokeyExec runs the real gnokey binary. Testnet only; the key is a keyring
// name, never a raw secret.
func gnokeyExec(args []string) (string, error) {
	cmd := exec.Command("gnokey", args...) //nolint:gosec // args are bot-built from a validated scenario, not user input
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func firstLine(s string) string {
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			return s[:i]
		}
	}
	return s
}

// joinShell renders an argv for the dry-run print, single-quoting args that
// contain spaces so the printed line is copy-pasteable.
func joinShell(argv []string) string {
	var b strings.Builder
	for i, a := range argv {
		if i > 0 {
			b.WriteByte(' ')
		}
		if strings.ContainsRune(a, ' ') {
			b.WriteByte('\'')
			b.WriteString(a)
			b.WriteByte('\'')
		} else {
			b.WriteString(a)
		}
	}
	return b.String()
}
