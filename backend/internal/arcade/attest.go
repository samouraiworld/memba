package arcade

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// OnChainEntryReader resolves the board entry after a non-improving panic.
// The panic itself does not say whether this exact log was already delivered.
type OnChainEntryReader interface {
	LookupEntry(ctx context.Context, run Run) (entry OnChainEntry, found bool, err error)
}

type OnChainEntry struct {
	LogHash string `json:"inputLogSha256"`
	Score   int64  `json:"score"`
}

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
	// ErrPermanentReject: the realm rejected the entry on a DETERMINISTIC shape
	// check (score out of range, malformed day, bad game slug, oversize stats,
	// non-positive simVersion, empty hash). Re-simulated backend data should
	// never hit these, but if one does it will fail identically forever — the
	// batcher retires it instead of dripping gas on an unwinnable retry.
	ErrPermanentReject = errors.New("arcade: realm rejected the entry (permanent shape failure)")
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
	Realm     string // e.g. gno.land/r/samcrew/memba_arcade_leaderboard_v1
	ChainID   string // e.g. test-13
	Remote    string // RPC endpoint
	KeyName   string // gnokey keyring name of the dedicated low-privilege attester key
	GnokeyBin string // default "gnokey"
	// KeyringPassword unlocks the on-disk gnokey keyring to SIGN, fed to gnokey on
	// stdin (there is no TTY in the container). On an ephemeral, container-only,
	// single-user keyring this is a gnokey formality, not a security control — the
	// key material lives in the Fly secret + the keyring, never in this process.
	KeyringPassword string
	GasWanted       int64         // default DefaultAttestGasWanted
	GasFeeUgnot     int64         // default: sized from FallbackGasPrice, never above DefaultMaxAttestFeeUgnot
	MaxDepositUgnot int64         // storage-deposit cap per tx (-max-deposit); default DefaultAttestMaxDepositUgnot
	Timeout         time.Duration // per-broadcast wall clock; default 60s
}

func (c AttesterConfig) withDefaults() AttesterConfig {
	if c.GnokeyBin == "" {
		c.GnokeyBin = "gnokey"
	}
	if c.GasWanted <= 0 {
		c.GasWanted = DefaultAttestGasWanted
	}
	if c.GasFeeUgnot <= 0 {
		// Same sizing and cap as the env path. An over-ceiling GasWanted can't
		// be planned; the capped fee then under-pays, so gnokey's simulation or
		// CheckTx rejects the tx and it costs nothing — never an uncapped fee.
		c.GasFeeUgnot = DefaultMaxAttestFeeUgnot
		if p, err := PlanAttestFee(FeeSettings{GasWanted: c.GasWanted}, nil); err == nil {
			c.GasFeeUgnot = p.GasFeeUgnot
		}
	}
	if c.MaxDepositUgnot <= 0 {
		c.MaxDepositUgnot = DefaultAttestMaxDepositUgnot
	}
	if c.Timeout <= 0 {
		c.Timeout = 60 * time.Second
	}
	return c
}

// attesterExecFn runs gnokey with args and the given stdin (the keyring password
// for -insecure-password-stdin).
type attesterExecFn func(ctx context.Context, args []string, stdin string) (string, error)

// gnokeyBroadcaster shells out to `gnokey maketx call … -broadcast <key>`,
// mirroring cmd/activitybot's testnet broadcaster. The dedicated attester key
// lives only in the gnokey keyring — this process never handles a raw secret.
type gnokeyBroadcaster struct {
	cfg        AttesterConfig
	exec       attesterExecFn
	httpClient *http.Client
}

// NewGnokeyBroadcaster builds the production broadcaster.
func NewGnokeyBroadcaster(cfg AttesterConfig) Broadcaster {
	cfg = cfg.withDefaults()
	b := &gnokeyBroadcaster{cfg: cfg}
	b.exec = b.runGnokey
	return b
}

func (b *gnokeyBroadcaster) AttestScore(ctx context.Context, run Run) (string, error) {
	// Bound each broadcast: a black-holed RPC would otherwise block this call with
	// no deadline, and since the batcher is a single goroutine, one hung gnokey
	// would wedge every later attestation cycle.
	cctx, cancel := context.WithTimeout(ctx, b.cfg.Timeout)
	defer cancel()
	// gnokey reads the keyring password from the first line of stdin (there's no
	// TTY); the argv carries -insecure-password-stdin.
	out, err := b.exec(cctx, b.attestScoreArgv(run), b.cfg.KeyringPassword+"\n")
	if err != nil {
		// Classify the realm's rejection so the batcher converges instead of
		// retrying a deterministically-failing tx forever. These substrings mirror
		// the panic() literals in the FROZEN realm
		// samcrew-deployer/projects/memba/realms/memba_arcade_leaderboard_v1/leaderboard.gno
		// (multi-game AttestScore + assertEntryShape/assertGameSlug, as amended
		// on samcrew-deployer's feat/arcade-leaderboard-multigame — PR #149). If
		// that realm is ever un-frozen and its messages change, update these —
		// TestGnokeyBroadcaster_ClassifiesRealmPanics pins the current strings.
		lo := strings.ToLower(out)
		switch {
		case strings.Contains(lo, "existing entry is not improved"):
			// Benign: our target is already on-chain at an equal-or-better score.
			return "", ErrAlreadyOnChain
		case strings.Contains(lo, "already bound to another address"),
			strings.Contains(lo, "already attested for another address"):
			// The log is bound to a different address — never ours.
			return "", ErrLogBoundElsewhere
		case strings.Contains(lo, "out of range"),
			strings.Contains(lo, "must be non-empty"),
			strings.Contains(lo, "must be yyyy-mm-dd"),
			strings.Contains(lo, "must be positive"),
			strings.Contains(lo, "game must be 1-32 chars of [a-z0-9-]"),
			strings.Contains(lo, "stats too long"):
			// A deterministic shape rejection — retrying can never succeed.
			return "", ErrPermanentReject
		}
		return "", fmt.Errorf("arcade attest: gnokey failed: %w (%s)", err, strings.TrimSpace(out))
	}
	return parseTxHash(out), nil
}

// LookupEntry reads the authoritative realm entry for this address and board.
// Failure is retryable: the batcher must never invent a receipt from a panic.
func (b *gnokeyBroadcaster) LookupEntry(ctx context.Context, run Run) (OnChainEntry, bool, error) {
	expr := fmt.Sprintf("%s.GetEntryJSON(%q,%q,%q)", b.cfg.Realm, gameOrDefault(run.Game), run.Day, run.Addr)
	payload, err := json.Marshal(struct {
		JSONRPC string `json:"jsonrpc"`
		ID      int    `json:"id"`
		Method  string `json:"method"`
		Params  struct {
			Path string `json:"path"`
			Data string `json:"data"`
		} `json:"params"`
	}{JSONRPC: "2.0", ID: 1, Method: "abci_query", Params: struct {
		Path string `json:"path"`
		Data string `json:"data"`
	}{Path: "vm/qeval", Data: base64.StdEncoding.EncodeToString([]byte(expr))}})
	if err != nil {
		return OnChainEntry{}, false, err
	}
	queryCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(queryCtx, http.MethodPost, b.cfg.Remote, bytes.NewReader(payload))
	if err != nil {
		return OnChainEntry{}, false, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := b.httpClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return OnChainEntry{}, false, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return OnChainEntry{}, false, fmt.Errorf("arcade entry lookup: HTTP %d", resp.StatusCode)
	}
	var result struct {
		Result struct {
			Response struct {
				ResponseBase struct {
					Data  string          `json:"Data"`
					Error json.RawMessage `json:"Error"`
				} `json:"ResponseBase"`
			} `json:"response"`
		} `json:"result"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&result); err != nil {
		return OnChainEntry{}, false, err
	}
	rawError := strings.TrimSpace(string(result.Result.Response.ResponseBase.Error))
	if result.Error != nil || rawError != "" && rawError != "null" && rawError != `""` {
		return OnChainEntry{}, false, errors.New("arcade entry lookup: realm query failed")
	}
	data, err := base64.StdEncoding.DecodeString(result.Result.Response.ResponseBase.Data)
	if err != nil {
		return OnChainEntry{}, false, err
	}
	return parseOnChainEntry(data)
}

func parseOnChainEntry(data []byte) (OnChainEntry, bool, error) {
	s := strings.TrimSpace(string(data))
	// vm/qeval prints string return values as Go quoted literals followed by
	// a type annotation. Decode that representation before parsing the JSON.
	if !strings.HasPrefix(s, "{") && !strings.HasPrefix(s, "null") {
		start := strings.IndexByte(s, '"')
		if start < 0 {
			return OnChainEntry{}, false, fmt.Errorf("arcade entry lookup: unexpected qeval output %q", s)
		}
		var unquoted string
		decoded := false
		for end := start + 1; end < len(s); end++ {
			if s[end] != '"' {
				continue
			}
			if value, err := strconv.Unquote(s[start : end+1]); err == nil {
				unquoted, decoded = value, true
				break
			}
		}
		if !decoded {
			return OnChainEntry{}, false, errors.New("arcade entry lookup: malformed quoted result")
		}
		s = unquoted
	}
	if s == "null" {
		return OnChainEntry{}, false, nil
	}
	var entry OnChainEntry
	if err := json.Unmarshal([]byte(s), &entry); err != nil {
		return OnChainEntry{}, false, err
	}
	if entry.LogHash == "" {
		return OnChainEntry{}, false, errors.New("arcade entry lookup: missing input log hash")
	}
	return entry, true, nil
}

// attestScoreArgv builds the maketx-call argv for the multi-game realm's
// AttestScore, whose parameters (after the implicit cur) are, in order:
// game, addr, day, seed, score, simVersion, stateHash, logHash, stats.
// The barricade-era per-game positional args (waves/won/overtimeRound) are
// gone — that context now travels in the opaque stats JSON blob. gnokey
// coerces each string -arg to the function's param type. An empty Game
// backfills to 'barricade' (a pre-migration row can only be a BARRICADE run).
func (b *gnokeyBroadcaster) attestScoreArgv(run Run) []string {
	argv := []string{
		"maketx", "call",
		"-pkgpath", b.cfg.Realm,
		"-func", "AttestScore",
		"-args", gameOrDefault(run.Game),
		"-args", run.Addr,
		"-args", run.Day,
		"-args", run.Seed,
		"-args", strconv.FormatInt(run.Score, 10),
		"-args", strconv.FormatInt(run.SimVersion, 10),
		"-args", run.StateHash,
		"-args", run.LogHash,
		"-args", run.Stats,
		"-gas-fee", strconv.FormatInt(b.cfg.GasFeeUgnot, 10) + "ugnot",
		"-gas-wanted", strconv.FormatInt(b.cfg.GasWanted, 10),
		"-max-deposit", strconv.FormatInt(b.cfg.MaxDepositUgnot, 10) + "ugnot", // never let the chain's 100 GNOT default apply
		"-chainid", b.cfg.ChainID,
		"-remote", b.cfg.Remote,
		"-insecure-password-stdin", // read the keyring password from stdin (no TTY)
		"-broadcast",
		b.cfg.KeyName,
	}
	return argv
}

func (b *gnokeyBroadcaster) runGnokey(ctx context.Context, args []string, stdin string) (string, error) {
	cmd := exec.CommandContext(ctx, b.cfg.GnokeyBin, args...) // #nosec G204 -- gnokey bin + realm-attestation args built from re-simulated data, never raw request input
	cmd.Stdin = strings.NewReader(stdin)
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
