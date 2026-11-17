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
	"slices"
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
	Realm   string // e.g. gno.land/r/samcrew/memba_arcade_leaderboard_v1
	ChainID string // e.g. test-13
	Remote  string // RPC endpoint, always tried first
	// Fallbacks are tried in order when Remote cannot serve a lookup or a
	// broadcast: it is unreachable, answers an HTTP error, or refuses to run
	// code (rpc.allow_code_execution, gnolang/gno#6413, refuses vm/qeval and
	// gnokey's .app/simulate alike). A fallback is used only after its /status
	// reports ChainID. An answer from the realm itself never fails over.
	Fallbacks []string
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
	var lastErr error
	for i, remote := range b.cfg.remotes() {
		if i > 0 {
			if err := b.checkChain(ctx, remote); err != nil {
				lastErr = err
				continue
			}
		}
		txHash, retry, err := b.attestScoreAt(ctx, run, remote)
		if err == nil || !retry || ctx.Err() != nil {
			return txHash, err
		}
		lastErr = err
	}
	return "", lastErr
}

// attestScoreAt broadcasts through one node. retry reports a failure of the
// node, which the next node may not share, seen before the transaction could
// have been submitted (see nodeUnavailable). A timeout or a dropped connection
// is ambiguous, so it never fails over: a second broadcast could land after
// the first and spend a second fee. Even then the realm keeps the best run and
// refuses the duplicate as not improved (ErrAlreadyOnChain).
func (b *gnokeyBroadcaster) attestScoreAt(ctx context.Context, run Run, remote string) (txHash string, retry bool, err error) {
	// Bound each broadcast: a black-holed RPC would otherwise block this call with
	// no deadline, and since the batcher is a single goroutine, one hung gnokey
	// would wedge every later attestation cycle.
	cctx, cancel := context.WithTimeout(ctx, b.cfg.Timeout)
	defer cancel()
	// gnokey reads the keyring password from the first line of stdin (there's no
	// TTY); the argv carries -insecure-password-stdin.
	out, err := b.exec(cctx, b.attestScoreArgvAt(run, remote), b.cfg.KeyringPassword+"\n")
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
			return "", false, ErrAlreadyOnChain
		case strings.Contains(lo, "already bound to another address"),
			strings.Contains(lo, "already attested for another address"):
			// The log is bound to a different address — never ours.
			return "", false, ErrLogBoundElsewhere
		case strings.Contains(lo, "out of range"),
			strings.Contains(lo, "must be non-empty"),
			strings.Contains(lo, "must be yyyy-mm-dd"),
			strings.Contains(lo, "must be positive"),
			strings.Contains(lo, "game must be 1-32 chars of [a-z0-9-]"),
			strings.Contains(lo, "stats too long"):
			// A deterministic shape rejection — retrying can never succeed.
			return "", false, ErrPermanentReject
		}
		retry = cctx.Err() == nil && nodeUnavailable(lo)
		return "", retry, fmt.Errorf("arcade attest via %s: gnokey failed: %w (%s)", remote, err, strings.TrimSpace(out))
	}
	return parseTxHash(out), false, nil
}

// nodeUnavailable reports whether gnokey's output (lowercased) blames the node
// rather than the transaction: the node refused to run code (gnokey's
// simulation runs before any broadcast; gno v1.8.0 answers it with a 403, which
// gnokey's RPC client prints as "invalid status code received"), or no
// connection could be opened to it.
func nodeUnavailable(lo string) bool {
	for _, marker := range []string{
		"does not allow over rpc",
		"invalid status code received",
		"connection refused",
		"no such host",
		"dial tcp",
		"tls handshake",
	} {
		if strings.Contains(lo, marker) {
			return true
		}
	}
	return false
}

// remotes returns Remote and then each distinct non-empty fallback.
func (c AttesterConfig) remotes() []string {
	out := []string{c.Remote}
	for _, u := range c.Fallbacks {
		if u = strings.TrimSpace(u); u != "" && !slices.Contains(out, u) {
			out = append(out, u)
		}
	}
	return out
}

// checkChain refuses a fallback node whose /status does not report ChainID
// (a reachable node is not proof it serves our chain) or that is catching up,
// whose state may be behind the chain. A redirect is refused: the answer must
// come from the configured node.
func (b *gnokeyBroadcaster) checkChain(ctx context.Context, remote string) error {
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, strings.TrimRight(remote, "/")+"/status", nil)
	if err != nil {
		return err
	}
	client := *b.client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("arcade fallback %s: %w", remote, err)
	}
	defer func() { _ = resp.Body.Close() }()
	var st struct {
		Result struct {
			NodeInfo struct {
				Network string `json:"network"`
			} `json:"node_info"`
			SyncInfo struct {
				CatchingUp *bool `json:"catching_up"`
			} `json:"sync_info"`
		} `json:"result"`
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("arcade fallback %s: /status HTTP %d", remote, resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&st); err != nil {
		return fmt.Errorf("arcade fallback %s: /status: %w", remote, err)
	}
	if got := st.Result.NodeInfo.Network; got != b.cfg.ChainID {
		return fmt.Errorf("arcade fallback %s reports %q, not %q", remote, got, b.cfg.ChainID)
	}
	if c := st.Result.SyncInfo.CatchingUp; c == nil || *c {
		return fmt.Errorf("arcade fallback %s is catching up or does not say", remote)
	}
	return nil
}

func (b *gnokeyBroadcaster) client() *http.Client {
	if b.httpClient != nil {
		return b.httpClient
	}
	return http.DefaultClient
}

// LookupEntry reads the authoritative realm entry for this address and board.
// Failure is retryable: the batcher must never invent a receipt from a panic.
func (b *gnokeyBroadcaster) LookupEntry(ctx context.Context, run Run) (OnChainEntry, bool, error) {
	var lastErr error
	for i, remote := range b.cfg.remotes() {
		if i > 0 {
			if err := b.checkChain(ctx, remote); err != nil {
				lastErr = err
				continue
			}
		}
		entry, found, retry, err := b.lookupEntryAt(ctx, run, remote)
		if err == nil || !retry || ctx.Err() != nil {
			return entry, found, err
		}
		lastErr = err
	}
	return OnChainEntry{}, false, lastErr
}

// lookupEntryAt queries one node. retry reports a failure of the node (no
// answer, an HTTP error, or a JSON-RPC error such as a refusal to run code)
// rather than an answer from the realm.
func (b *gnokeyBroadcaster) lookupEntryAt(ctx context.Context, run Run, remote string) (entry OnChainEntry, found, retry bool, err error) {
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
		return OnChainEntry{}, false, false, err
	}
	queryCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(queryCtx, http.MethodPost, remote, bytes.NewReader(payload))
	if err != nil {
		return OnChainEntry{}, false, false, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := b.client().Do(req)
	if err != nil {
		return OnChainEntry{}, false, true, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return OnChainEntry{}, false, true, fmt.Errorf("arcade entry lookup via %s: HTTP %d", remote, resp.StatusCode)
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
		return OnChainEntry{}, false, true, err
	}
	if result.Error != nil {
		return OnChainEntry{}, false, true, fmt.Errorf("arcade entry lookup via %s: %s", remote, result.Error.Message)
	}
	rawError := strings.TrimSpace(string(result.Result.Response.ResponseBase.Error))
	if rawError != "" && rawError != "null" && rawError != `""` {
		return OnChainEntry{}, false, false, errors.New("arcade entry lookup: realm query failed")
	}
	data, err := base64.StdEncoding.DecodeString(result.Result.Response.ResponseBase.Data)
	if err != nil {
		return OnChainEntry{}, false, false, err
	}
	entry, found, err = parseOnChainEntry(data)
	return entry, found, false, err
}

// QevalString returns the string result carried by a vm/qeval answer. qeval
// prints a string as a Go quoted literal followed by a type annotation; an
// answer that is already bare JSON (an object or null) is returned as it is.
func QevalString(out string) (string, error) {
	s := strings.TrimSpace(out)
	if strings.HasPrefix(s, "{") || strings.HasPrefix(s, "null") {
		return s, nil
	}
	start := strings.IndexByte(s, '"')
	if start < 0 {
		return "", fmt.Errorf("unexpected qeval output %.64q", s) // its start only: the answer is a node's, of any length
	}
	for end := start + 1; end < len(s); end++ {
		if s[end] != '"' {
			continue
		}
		if value, err := strconv.Unquote(s[start : end+1]); err == nil {
			return value, nil
		}
	}
	return "", errors.New("malformed quoted result")
}

func parseOnChainEntry(data []byte) (OnChainEntry, bool, error) {
	s, err := QevalString(string(data))
	if err != nil {
		return OnChainEntry{}, false, fmt.Errorf("arcade entry lookup: %w", err)
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
	return b.attestScoreArgvAt(run, b.cfg.Remote)
}

func (b *gnokeyBroadcaster) attestScoreArgvAt(run Run, remote string) []string {
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
		"-remote", remote,
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
