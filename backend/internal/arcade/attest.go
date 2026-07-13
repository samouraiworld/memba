package arcade

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

var (
	// ErrAlreadyOnChain: the realm rejected the attestation because this
	// address/day already holds an entry at an equal-or-better score — the goal
	// (the best run on-chain) is already met. Benign: it happens on crash
	// recovery (a broadcast that succeeded before MarkAttested ran). The batcher
	// marks the run attested instead of retrying the same panicking tx forever.
	ErrAlreadyOnChain = errors.New("arcade: entry already on-chain (not improved)")
	// ErrLogBoundElsewhere: the input log is bound on-chain to a DIFFERENT
	// address — this run can never be attested for us. The batcher retires it
	// ('skipped') rather than retrying a permanently-failing tx every cycle.
	ErrLogBoundElsewhere = errors.New("arcade: input log bound to another address on-chain")
)

// Broadcaster attests a verified run to the on-chain leaderboard realm. The only
// implementation is a gnokey subprocess (see below); it's an interface so the
// batcher is testable without a chain and so a future in-process signer can drop in.
type Broadcaster interface {
	// AttestScore writes (or improves) the run's entry on the realm's competitive
	// daily board and returns the broadcast tx hash.
	AttestScore(ctx context.Context, run Run) (txHash string, err error)
}

// AttesterConfig describes the realm + the attester key. The key is a gnokey
// keyring NAME (never a raw secret in this process); the ceremony that funds it
// and adds it to the realm's attester allowlist is an OWNER step.
type AttesterConfig struct {
	Realm       string // e.g. gno.land/r/samcrew/memba_arcade_leaderboard_v1
	ChainID     string // e.g. test-13
	Remote      string // RPC endpoint
	KeyName     string // gnokey keyring name of the dedicated low-privilege attester key
	GnokeyBin   string // default "gnokey"
	GasWanted   int    // default 5_000_000
	GasFeeUgnot int    // default 1_000_000
}

func (c AttesterConfig) withDefaults() AttesterConfig {
	if c.GnokeyBin == "" {
		c.GnokeyBin = "gnokey"
	}
	if c.GasWanted <= 0 {
		c.GasWanted = 5_000_000
	}
	if c.GasFeeUgnot <= 0 {
		c.GasFeeUgnot = 1_000_000
	}
	return c
}

type attesterExecFn func(ctx context.Context, args []string) (string, error)

// gnokeyBroadcaster shells out to `gnokey maketx call … -broadcast <key>`,
// mirroring cmd/activitybot's testnet broadcaster. The dedicated attester key
// lives only in the gnokey keyring — this process never handles a raw secret.
type gnokeyBroadcaster struct {
	cfg  AttesterConfig
	exec attesterExecFn
}

// NewGnokeyBroadcaster builds the production broadcaster.
func NewGnokeyBroadcaster(cfg AttesterConfig) Broadcaster {
	cfg = cfg.withDefaults()
	b := &gnokeyBroadcaster{cfg: cfg}
	b.exec = b.runGnokey
	return b
}

func (b *gnokeyBroadcaster) AttestScore(ctx context.Context, run Run) (string, error) {
	out, err := b.exec(ctx, b.attestScoreArgv(run))
	if err != nil {
		// Classify the realm's rejection so the batcher can converge instead of
		// retrying a deterministically-failing tx forever. The realm panics with
		// stable messages (leaderboard.gno); a benign "not improved" means our
		// target is already on-chain, and a cross-address "duplicate/bound" means
		// this run can never be ours.
		lo := strings.ToLower(out)
		switch {
		case strings.Contains(lo, "existing entry is not improved"):
			return "", ErrAlreadyOnChain
		case strings.Contains(lo, "already bound to another address"),
			strings.Contains(lo, "already attested for another address"):
			return "", ErrLogBoundElsewhere
		}
		return "", fmt.Errorf("arcade attest: gnokey failed: %w (%s)", err, strings.TrimSpace(out))
	}
	return parseTxHash(out), nil
}

// attestScoreArgv builds the maketx-call argv for the realm's AttestScore, whose
// parameters (after the implicit cur) are, in order: addr, day, seed, score,
// waves, won, overtimeRound, simVersion, stateHash, logHash. gnokey coerces each
// string -arg to the function's param type.
func (b *gnokeyBroadcaster) attestScoreArgv(run Run) []string {
	argv := []string{
		"maketx", "call",
		"-pkgpath", b.cfg.Realm,
		"-func", "AttestScore",
		"-args", run.Addr,
		"-args", run.Day,
		"-args", run.Seed,
		"-args", strconv.FormatInt(run.Score, 10),
		"-args", strconv.FormatInt(run.Waves, 10),
		"-args", boolArg(run.Won),
		"-args", strconv.FormatInt(run.OvertimeRound, 10),
		"-args", strconv.FormatInt(run.SimVersion, 10),
		"-args", run.StateHash,
		"-args", run.LogHash,
		"-gas-fee", strconv.Itoa(b.cfg.GasFeeUgnot) + "ugnot",
		"-gas-wanted", strconv.Itoa(b.cfg.GasWanted),
		"-chainid", b.cfg.ChainID,
		"-remote", b.cfg.Remote,
		"-broadcast",
		b.cfg.KeyName,
	}
	return argv
}

func (b *gnokeyBroadcaster) runGnokey(ctx context.Context, args []string) (string, error) {
	cmd := exec.CommandContext(ctx, b.cfg.GnokeyBin, args...) // #nosec G204 -- gnokey bin + realm-attestation args built from re-simulated data, never raw request input
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// parseTxHash pulls the tx hash out of gnokey's broadcast output ("TX HASH: …"),
// falling back to the first non-empty line. Best-effort — the hash is a stored
// breadcrumb, not load-bearing.
func parseTxHash(out string) string {
	for line := range strings.SplitSeq(out, "\n") {
		line = strings.TrimSpace(line)
		if rest, ok := strings.CutPrefix(line, "TX HASH:"); ok {
			return strings.TrimSpace(rest)
		}
	}
	for line := range strings.SplitSeq(out, "\n") {
		if s := strings.TrimSpace(line); s != "" {
			return s
		}
	}
	return ""
}

func boolArg(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
