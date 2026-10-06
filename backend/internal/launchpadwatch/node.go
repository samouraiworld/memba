package launchpadwatch

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// errWrongChain marks a node that answered for another chain. Its readings are
// skipped: a pool such as rpc.gno.land has served other chains, so nothing it
// says may decide that the books are short or empty.
var errWrongChain = errors.New("wrong chain")

// node reads one RPC node strictly: a transport failure, a JSON-RPC or ABCI
// error and a malformed answer are all errors, never an empty or zero value.
type node struct {
	url    string
	client *http.Client
}

func newNode(url string) node {
	return node{url: url, client: &http.Client{Timeout: 10 * time.Second}}
}

func (n node) call(ctx context.Context, method string, params any, out any) error {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return fmt.Errorf("%s: http %d", method, resp.StatusCode)
	}
	var env struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&env); err != nil {
		return fmt.Errorf("%s: %w", method, err)
	}
	if env.Error != nil {
		return fmt.Errorf("%s: %s", method, env.Error.Message)
	}
	return json.Unmarshal(env.Result, out)
}

// checkChain fails with errWrongChain unless the node serves chainID, fails
// while the node is catching up, and returns its latest height.
func (n node) checkChain(ctx context.Context, chainID string) (int64, error) {
	var r struct {
		NodeInfo struct {
			Network string `json:"network"`
		} `json:"node_info"`
		SyncInfo struct {
			Height     string `json:"latest_block_height"`
			CatchingUp bool   `json:"catching_up"`
		} `json:"sync_info"`
	}
	if err := n.call(ctx, "status", map[string]any{}, &r); err != nil {
		return 0, err
	}
	if r.NodeInfo.Network != chainID {
		return 0, fmt.Errorf("%w: %s serves %q, want %q", errWrongChain, n.url, r.NodeInfo.Network, chainID)
	}
	if r.SyncInfo.CatchingUp {
		return 0, fmt.Errorf("%s is catching up", n.url)
	}
	return strconv.ParseInt(r.SyncInfo.Height, 10, 64)
}

func (n node) query(ctx context.Context, path, data string) (string, error) {
	var r struct {
		Response struct {
			ResponseBase struct {
				Error json.RawMessage `json:"Error"`
				Data  []byte          `json:"Data"`
			} `json:"ResponseBase"`
		} `json:"response"`
	}
	params := map[string]any{"path": path, "data": base64.StdEncoding.EncodeToString([]byte(data))}
	if err := n.call(ctx, "abci_query", params, &r); err != nil {
		return "", err
	}
	if e := strings.TrimSpace(string(r.Response.ResponseBase.Error)); e != "" && e != "null" {
		return "", fmt.Errorf("%s %q: %s", path, data, e)
	}
	return string(r.Response.ResponseBase.Data), nil
}

// qevalString evaluates an expression whose value is a string.
func (n node) qevalString(ctx context.Context, expr string) (string, error) {
	out, err := n.query(ctx, "vm/qeval", expr)
	if err != nil {
		return "", err
	}
	s := strings.TrimSpace(out)
	if !strings.HasPrefix(s, "(") || !strings.HasSuffix(s, " string)") {
		return "", fmt.Errorf("%s: not a string: %.80q", expr, s)
	}
	return strconv.Unquote(s[1 : len(s)-len(" string)")])
}

var intAnswer = regexp.MustCompile(`^\((-?[0-9]+) (?:int|int64|uint64)\)$`)

// qevalInt evaluates an expression whose value is an integer.
func (n node) qevalInt(ctx context.Context, expr string) (*big.Int, error) {
	out, err := n.query(ctx, "vm/qeval", expr)
	if err != nil {
		return nil, err
	}
	m := intAnswer.FindStringSubmatch(strings.TrimSpace(out))
	if m == nil {
		return nil, fmt.Errorf("%s: not an integer: %.80q", expr, out)
	}
	v, _ := new(big.Int).SetString(m[1], 10)
	return v, nil
}

// balance is the amount of denom the address holds; an account without that
// coin holds zero.
func (n node) balance(ctx context.Context, addr, denom string) (*big.Int, error) {
	out, err := n.query(ctx, "bank/balances/"+addr, "")
	if err != nil {
		return nil, err
	}
	coins := strings.TrimSpace(out)
	if strings.HasPrefix(coins, `"`) {
		if err := json.Unmarshal([]byte(coins), &coins); err != nil {
			return nil, fmt.Errorf("balance of %s: %w", addr, err)
		}
	}
	for coin := range strings.SplitSeq(coins, ",") {
		if amount, ok := strings.CutSuffix(coin, denom); ok && amount != "" && strings.Trim(amount, "0123456789") == "" {
			return parseAmount(amount)
		}
	}
	return new(big.Int), nil
}

// parseAmount reads a non-negative decimal integer exactly, at any size.
func parseAmount(s string) (*big.Int, error) {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok || strings.Trim(s, "0123456789") != "" {
		return nil, fmt.Errorf("not a non-negative decimal integer: %.40q", s)
	}
	return v, nil
}
