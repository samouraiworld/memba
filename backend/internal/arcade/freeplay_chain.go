package arcade

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/samouraiworld/memba/backend/internal/address"
)

var ErrFreePlayChain = errors.New("freeplay_chain_unavailable")

// This guard is supplied by the reviewed cost policy. It must refresh prices
// and validate the exact quote and gas allowance; there is no fallback policy.
type FreePlayBroadcastCostCheck interface {
	ValidateBroadcast(context.Context, FreePlayTarget, FreePlayEntry, FreePlayQuote, int64) error
}

// The injected broadcaster receives a fully constructed argv, never shell text.
// Any error after invocation remains ambiguous to the durable publisher.
type FreePlayBroadcastFunc func(context.Context, []string) (string, error)

type FreePlayChainConfig struct {
	Enabled         bool
	Target          FreePlayTarget
	RPCURL          string
	Signer          string
	GasWanted       int64
	MaxFeeUgnot     int64
	MaxDepositUgnot int64
	Timeout         time.Duration
}

type FreePlayRPCChain struct {
	cfg       FreePlayChainConfig
	http      *http.Client
	broadcast FreePlayBroadcastFunc
	cost      FreePlayBroadcastCostCheck
	now       func() time.Time
}

// Disabled instances can read public receipts. No constructor performs I/O.
// The caller owns the signer lease and durable spending reservation. A nil
// signer or cost guard cannot write even when Enabled is true.
func NewFreePlayRPCChain(cfg FreePlayChainConfig, client *http.Client, broadcast FreePlayBroadcastFunc, cost FreePlayBroadcastCostCheck) (*FreePlayRPCChain, error) {
	u, err := url.Parse(cfg.RPCURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1"))) || cfg.Target.Validate() != nil || cfg.Timeout <= 0 || cfg.Timeout > 45*time.Second {
		return nil, ErrFreePlayChain
	}
	if cfg.Enabled && (!freePlayGnoAddress(cfg.Signer) || cfg.GasWanted <= 0 || cfg.MaxFeeUgnot <= 0 || cfg.MaxDepositUgnot <= 0 || broadcast == nil || cost == nil) {
		return nil, ErrFreePlayChain
	}
	copyClient := http.Client{}
	if client != nil {
		copyClient = *client
	}
	copyClient.Timeout = cfg.Timeout
	copyClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &FreePlayRPCChain{cfg: cfg, http: &copyClient, broadcast: broadcast, cost: cost, now: time.Now}, nil
}

func freePlayGnoAddress(s string) bool {
	a, err := address.Parse(s)
	return err == nil && a.Kind() == address.KindGno && a.String() == s
}

const freePlayRPCBodyLimit = 2 << 20

func decodeFreePlayJSON(raw []byte, out any, strict bool) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	if strict {
		d.DisallowUnknownFields()
	}
	if err := d.Decode(out); err != nil {
		return ErrFreePlayChain
	}
	var extra any
	if err := d.Decode(&extra); !errors.Is(err, io.EOF) {
		return ErrFreePlayChain
	}
	return nil
}

func (c *FreePlayRPCChain) rpc(ctx context.Context, method string, params any, out any) error {
	payload, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		return ErrFreePlayChain
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.RPCURL, bytes.NewReader(payload))
	if err != nil {
		return ErrFreePlayChain
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return ErrFreePlayChain
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, freePlayRPCBodyLimit+1))
	if err != nil || resp.StatusCode != http.StatusOK || len(raw) > freePlayRPCBodyLimit {
		return ErrFreePlayChain
	}
	var envelope struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      int             `json:"id"`
		Result  json.RawMessage `json:"result"`
		Error   json.RawMessage `json:"error"`
	}
	if decodeFreePlayJSON(raw, &envelope, false) != nil || envelope.JSONRPC != "2.0" || envelope.ID != 1 || (len(envelope.Error) != 0 && string(envelope.Error) != "null") || len(envelope.Result) == 0 || string(envelope.Result) == "null" {
		return ErrFreePlayChain
	}
	return decodeFreePlayJSON(envelope.Result, out, false)
}

func (c *FreePlayRPCChain) qeval(ctx context.Context, expression string) (string, error) {
	var result struct {
		Response struct {
			Base struct {
				Data  string          `json:"Data"`
				Error json.RawMessage `json:"Error"`
			} `json:"ResponseBase"`
		} `json:"response"`
	}
	if c.rpc(ctx, "abci_query", map[string]string{"path": "vm/qeval", "data": base64.StdEncoding.EncodeToString([]byte(expression))}, &result) != nil {
		return "", ErrFreePlayChain
	}
	b := result.Response.Base
	if len(b.Error) != 0 && string(b.Error) != "null" && string(b.Error) != `""` {
		return "", ErrFreePlayChain
	}
	data, err := base64.StdEncoding.DecodeString(b.Data)
	if err != nil {
		return "", ErrFreePlayChain
	}
	text := strings.TrimSpace(string(data))
	if !strings.HasPrefix(text, "(") || !strings.HasSuffix(text, " string)") {
		return "", ErrFreePlayChain
	}
	value, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(text, "("), " string)"))
	if err != nil {
		return "", ErrFreePlayChain
	}
	return value, nil
}

type freePlayRealmConfig struct {
	SchemaVersion int    `json:"schemaVersion"`
	ChainID       string `json:"chainId"`
	Realm         string `json:"realm"`
	Mode          string `json:"mode"`
	Paused        *bool  `json:"paused"`
	MaxScore      int64  `json:"maxScore"`
	MaxSimVersion int64  `json:"maxSimVersion"`
	MaxPageSize   int    `json:"maxPageSize"`
}

func (c *FreePlayRPCChain) preflight(ctx context.Context, target FreePlayTarget) (freePlayRealmConfig, int64, error) {
	var config freePlayRealmConfig
	if target != c.cfg.Target || target.Validate() != nil || ctx.Err() != nil {
		return config, 0, ErrFreePlayChain
	}
	var status struct {
		Node struct {
			Network string `json:"network"`
		} `json:"node_info"`
		Sync struct {
			Height     string `json:"latest_block_height"`
			CatchingUp *bool  `json:"catching_up"`
		} `json:"sync_info"`
	}
	if c.rpc(ctx, "status", map[string]any{}, &status) != nil || status.Node.Network != target.ChainID || (status.Sync.CatchingUp == nil || *status.Sync.CatchingUp) {
		return config, 0, ErrFreePlayChain
	}
	height, err := strconv.ParseInt(status.Sync.Height, 10, 64)
	if err != nil || height < 1 {
		return config, 0, ErrFreePlayChain
	}
	raw, err := c.qeval(ctx, target.Realm+".GetConfigJSON()")
	if err != nil || decodeFreePlayJSON([]byte(raw), &config, true) != nil || config.Paused == nil || config.SchemaVersion != 2 || config.ChainID != target.ChainID || config.Realm != target.Realm || config.Mode != "free" || config.MaxScore != FreePlayMaxScore || config.MaxSimVersion != 2147483647 || config.MaxPageSize != 100 {
		return config, 0, ErrFreePlayChain
	}
	return config, height, nil
}

type freePlayFlatReceipt struct {
	SchemaVersion int    `json:"schemaVersion"`
	ChainID       string `json:"chainId"`
	Realm         string `json:"realm"`
	Mode          string `json:"mode"`
	FreePlayEntry
	Height   int64  `json:"height"`
	Attester string `json:"attester"`
}

func (c *FreePlayRPCChain) receipt(raw []byte, height int64) (FreePlayReceipt, error) {
	var flat freePlayFlatReceipt
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return FreePlayReceipt{}, ErrFreePlayReceipt
	}
	for _, key := range []string{"schemaVersion", "chainId", "realm", "mode", "game", "player", "rules", "simVersion", "runID", "seed", "score", "stateHash", "replayHash", "height", "attester"} {
		v, exists := fields[key]
		if !exists || string(v) == "null" {
			return FreePlayReceipt{}, ErrFreePlayReceipt
		}
	}
	if decodeFreePlayJSON(raw, &flat, true) != nil || flat.SchemaVersion != 2 || flat.ChainID != c.cfg.Target.ChainID || flat.Realm != c.cfg.Target.Realm || flat.Mode != "free" || flat.Height <= 0 || flat.Height > height || !freePlayGnoAddress(flat.Attester) || flat.FreePlayEntry.Validate() != nil {
		return FreePlayReceipt{}, ErrFreePlayReceipt
	}
	// Historical attesters may have been revoked since inclusion. The realm is
	// the authority for stored receipts; do not fabricate a transaction hash.
	return FreePlayReceipt{Target: c.cfg.Target, Entry: flat.FreePlayEntry, Height: flat.Height, Attester: flat.Attester, SchemaVersion: 2}, nil
}

func (c *FreePlayRPCChain) Lookup(ctx context.Context, target FreePlayTarget, runID string) (FreePlayReceipt, bool, error) {
	if c == nil || !fpHex64.MatchString(runID) {
		return FreePlayReceipt{}, false, ErrFreePlayChain
	}
	ctx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()
	_, height, err := c.preflight(ctx, target)
	if err != nil {
		return FreePlayReceipt{}, false, err
	}
	raw, err := c.qeval(ctx, target.Realm+".GetRunJSON("+strconv.Quote(runID)+")")
	if err != nil {
		return FreePlayReceipt{}, false, err
	}
	if raw == "null" {
		return FreePlayReceipt{}, false, nil
	}
	r, err := c.receipt([]byte(raw), height)
	if err != nil || r.Entry.RunID != runID {
		return FreePlayReceipt{}, false, ErrFreePlayReceipt
	}
	return r, true, nil
}

func (c *FreePlayRPCChain) ReadBoard(ctx context.Context, target FreePlayTarget, game, rules string, version int64, offset, limit int) ([]FreePlayReceipt, error) {
	if c == nil || !validFreePlayGame(game) || !fpRules.MatchString(rules) || version < 1 || version > 2147483647 || offset < 0 || offset > 100000 || limit < 1 || limit > 100 {
		return nil, ErrFreePlayChain
	}
	ctx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()
	_, height, err := c.preflight(ctx, target)
	if err != nil {
		return nil, err
	}
	expr := fmt.Sprintf("%s.GetBoardJSON(%q,%q,%d,%d,%d)", target.Realm, game, rules, version, offset, limit)
	raw, err := c.qeval(ctx, expr)
	if err != nil {
		return nil, err
	}
	var rows []json.RawMessage
	if decodeFreePlayJSON([]byte(raw), &rows, true) != nil || rows == nil || len(rows) > limit {
		return nil, ErrFreePlayReceipt
	}
	entries := make([]FreePlayReceipt, 0, len(rows))
	seen := map[string]bool{}
	for _, row := range rows {
		r, err := c.receipt(row, height)
		if err != nil || r.Entry.Game != game || r.Entry.Rules != rules || r.Entry.SimVersion != version || seen[r.Entry.Player] {
			return nil, ErrFreePlayReceipt
		}
		if len(entries) > 0 {
			p := entries[len(entries)-1]
			if r.Entry.Score > p.Entry.Score || r.Entry.Score == p.Entry.Score && (r.Height < p.Height || r.Height == p.Height && r.Entry.Player <= p.Entry.Player) {
				return nil, ErrFreePlayReceipt
			}
		}
		seen[r.Entry.Player] = true
		entries = append(entries, r)
	}
	return entries, nil
}

func (c *FreePlayRPCChain) validQuote(e FreePlayEntry, q FreePlayQuote) bool {
	return q.Payer == "studio" && fpHex64.MatchString(q.ID) && fpHex64.MatchString(q.Nonce) && q.RunID == e.RunID && q.PayloadHash == e.PayloadHash(c.cfg.Target) && q.ExpiresAt > c.now().Unix() && q.MaxFeeUgnot > 0 && q.MaxFeeUgnot <= c.cfg.MaxFeeUgnot && q.MaxDepositUgnot > 0 && q.MaxDepositUgnot <= c.cfg.MaxDepositUgnot
}

func (c *FreePlayRPCChain) Anchor(ctx context.Context, target FreePlayTarget, entry FreePlayEntry, quote FreePlayQuote) (string, error) {
	if c == nil || !c.cfg.Enabled || c.broadcast == nil || c.cost == nil {
		return "", ErrFreePlayPaused
	}
	if entry.Validate() != nil || !c.validQuote(entry, quote) {
		return "", ErrFreePlayChain
	}
	ctx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()
	ctx, expire := context.WithDeadline(ctx, time.Unix(quote.ExpiresAt, 0))
	defer expire()
	config, _, err := c.preflight(ctx, target)
	if err != nil || config.Paused == nil || *config.Paused {
		return "", ErrFreePlayChain
	}
	// Read current attester authorization separately from historical receipts.
	expr := target.Realm + `.IsAttester(` + strconv.Quote(c.cfg.Signer) + `)`
	attester, err := c.qevalBool(ctx, expr)
	if err != nil || !attester {
		return "", ErrFreePlayChain
	}
	if c.cost.ValidateBroadcast(ctx, target, entry, quote, c.cfg.GasWanted) != nil || ctx.Err() != nil || !c.validQuote(entry, quote) {
		return "", ErrFreePlayChain
	}
	argv := []string{"maketx", "call", "-pkgpath", target.Realm, "-func", "AnchorScore"}
	for _, arg := range []string{entry.Game, entry.Player, entry.Rules, strconv.FormatInt(entry.SimVersion, 10), entry.RunID, entry.Seed, strconv.FormatInt(entry.Score, 10), entry.StateHash, entry.ReplayHash} {
		argv = append(argv, "-args", arg)
	}
	argv = append(argv, "-gas-fee", strconv.FormatInt(quote.MaxFeeUgnot, 10)+"ugnot", "-gas-wanted", strconv.FormatInt(c.cfg.GasWanted, 10), "-max-deposit", strconv.FormatInt(quote.MaxDepositUgnot, 10)+"ugnot", "-chainid", target.ChainID, "-remote", c.cfg.RPCURL, "-insecure-password-stdin", "-broadcast", c.cfg.Signer)
	if ctx.Err() != nil || !c.validQuote(entry, quote) {
		return "", ErrFreePlayChain
	}
	out, err := c.broadcast(ctx, argv)
	if err != nil || ctx.Err() != nil {
		return "", ErrFreePlayChain
	}
	return freePlayTxHash(out)
}

func (c *FreePlayRPCChain) qevalBool(ctx context.Context, expression string) (bool, error) {
	var result struct {
		Response struct {
			Base struct {
				Data  string          `json:"Data"`
				Error json.RawMessage `json:"Error"`
			} `json:"ResponseBase"`
		} `json:"response"`
	}
	if c.rpc(ctx, "abci_query", map[string]string{"path": "vm/qeval", "data": base64.StdEncoding.EncodeToString([]byte(expression))}, &result) != nil {
		return false, ErrFreePlayChain
	}
	b := result.Response.Base
	if len(b.Error) != 0 && string(b.Error) != "null" && string(b.Error) != `""` {
		return false, ErrFreePlayChain
	}
	raw, err := base64.StdEncoding.DecodeString(b.Data)
	if err != nil {
		return false, ErrFreePlayChain
	}
	switch strings.TrimSpace(string(raw)) {
	case "(true bool)":
		return true, nil
	case "(false bool)":
		return false, nil
	default:
		return false, ErrFreePlayChain
	}
}

// Pinned e75 gnokey emits base64, not hex. Accept exactly one labeled 32-byte
// hash and normalize it; never use an arbitrary first stdout line as a hash.
func freePlayTxHash(out string) (string, error) {
	if len(out) > 64<<10 {
		return "", ErrFreePlayChain
	}
	var hash string
	for _, line := range strings.Split(out, "\n") {
		value, ok := strings.CutPrefix(strings.TrimSpace(line), "TX HASH:")
		if !ok {
			continue
		}
		if hash != "" {
			return "", ErrFreePlayChain
		}
		value = strings.TrimSpace(value)
		raw, err := base64.StdEncoding.DecodeString(value)
		if err != nil || len(raw) != 32 || base64.StdEncoding.EncodeToString(raw) != value {
			return "", ErrFreePlayChain
		}
		hash = hex.EncodeToString(raw)
	}
	if hash == "" {
		return "", ErrFreePlayChain
	}
	return hash, nil
}

// The address (not a key alias) is already the final argv from Anchor. Pinned
// e75 gnokey resolves it with GetByNameOrAddress. No keyring access occurs here;
// only a later explicit invocation can sign. Secrets never enter argv/errors.
func NewFreePlayGnokeyBroadcast(binary, home string, password func(context.Context) (string, error)) (FreePlayBroadcastFunc, error) {
	if !filepath.IsAbs(binary) || !filepath.IsAbs(home) || password == nil {
		return nil, ErrFreePlayChain
	}
	return func(ctx context.Context, argv []string) (string, error) {
		ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
		if ctx.Err() != nil {
			return "", ErrFreePlayChain
		}
		secret, err := password(ctx)
		if err != nil || ctx.Err() != nil || strings.ContainsAny(secret, "\r\n") {
			return "", ErrFreePlayChain
		}
		cmd := exec.CommandContext(ctx, binary, append([]string{"-home", home}, argv...)...) // #nosec G204 -- reviewed executable and direct argv, never shell.
		cmd.Stdin = strings.NewReader(secret + "\n")
		out := &freePlayCappedOutput{}
		cmd.Stdout = out
		cmd.Stderr = out
		cmd.WaitDelay = time.Second
		if ctx.Err() != nil {
			return "", ErrFreePlayChain
		}
		if cmd.Run() != nil || out.exceeded || ctx.Err() != nil {
			return "", ErrFreePlayChain
		}
		return out.String(), nil
	}, nil
}

type freePlayCappedOutput struct {
	bytes.Buffer
	exceeded bool
}

func (b *freePlayCappedOutput) Write(p []byte) (int, error) {
	if len(p) > 64<<10-b.Len() {
		b.exceeded = true
		return 0, ErrFreePlayChain
	}
	return b.Buffer.Write(p)
}

var _ FreePlayChain = (*FreePlayRPCChain)(nil)
var _ FreePlayBoardReader = (*FreePlayRPCChain)(nil)
