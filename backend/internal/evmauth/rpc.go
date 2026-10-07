// Package evmauth verifies contract-account signatures (EIP-1271, and ERC-6492
// for accounts not yet deployed) against an EVM chain through JSON-RPC.
//
// It is read-only by construction: the only methods it sends are eth_chainId,
// eth_getCode and eth_call. An ERC-6492 signature is checked by a deploy-less
// eth_call (the validator runs as constructor code in a simulation), never by a
// transaction, so nothing is ever deployed.
//
// Verdicts are three-way. (true, nil) is a valid signature. (false, nil) is a
// definite "no": the account reverted (a Safe REVERTS on a bad signature
// instead of returning a failure value), returned anything but the magic
// value, or has no code and no ERC-6492 wrapper. (false, err) with err wrapping
// ErrUnavailable means the chain could not be asked: transport failure,
// timeout, a malformed answer, or an endpoint that serves another chain. A
// caller denies the login in both negative cases; the distinction only decides
// whether the user is told to retry.
package evmauth

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

var (
	// ErrUnavailable wraps every failure to obtain an answer from the chain.
	ErrUnavailable = errors.New("evmauth: chain unavailable")
	// ErrWrongChain is an endpoint whose eth_chainId is not the expected one.
	ErrWrongChain = fmt.Errorf("%w: endpoint serves another chain", ErrUnavailable)
	// errReverted is an eth_call that executed and reverted.
	errReverted = errors.New("evmauth: execution reverted")
)

const (
	maxResponseBytes = 1 << 20
	// callGas bounds one verification. A counterfactual smart wallet is
	// deployed inside the simulation (a few hundred thousand gas); 5M leaves
	// room for heavier accounts and stays far under node RPC gas caps.
	callGas = 5_000_000
)

// Client is a minimal JSON-RPC client for the three read methods above.
type Client struct {
	url string
	hc  *http.Client
	id  atomic.Uint64
}

// NewClient returns a client for rawURL with a per-request timeout. The URL
// must be https; plain http is accepted only for a loopback host (a local
// node or test server). The URL may carry a provider key, so it is never put
// in an error or a log line.
func NewClient(rawURL string, timeout time.Duration) (*Client, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" || u.User != nil {
		return nil, errors.New("evmauth: invalid RPC URL")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if !isLoopback(u.Hostname()) {
			return nil, errors.New("evmauth: RPC URL must be https")
		}
	default:
		return nil, errors.New("evmauth: RPC URL must be https")
	}
	if timeout <= 0 {
		return nil, errors.New("evmauth: timeout must be positive")
	}
	return &Client{
		url: rawURL,
		hc: &http.Client{
			Timeout: timeout,
			// A redirect could move the call to an endpoint nobody configured.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      uint64 `json:"id"`
	Method  string `json:"method"`
	Params  []any  `json:"params"`
}

type rpcResponse struct {
	ID     json.RawMessage `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (c *Client) call(ctx context.Context, method string, params []any) (json.RawMessage, error) {
	id := c.id.Add(1)
	body, err := json.Marshal(rpcRequest{JSONRPC: "2.0", ID: id, Method: method, Params: params})
	if err != nil {
		return nil, fmt.Errorf("%w: encode request", ErrUnavailable)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("%w: build request", ErrUnavailable)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.hc.Do(req)
	if err != nil {
		// Deliberately not wrapped: *url.Error spells out the URL, key included.
		return nil, fmt.Errorf("%w: %s transport error", ErrUnavailable, method)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: %s HTTP %d", ErrUnavailable, method, resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil || len(raw) > maxResponseBytes {
		return nil, fmt.Errorf("%w: %s response unreadable", ErrUnavailable, method)
	}
	var r rpcResponse
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("%w: %s response not JSON-RPC", ErrUnavailable, method)
	}
	if string(r.ID) != strconv.FormatUint(id, 10) {
		return nil, fmt.Errorf("%w: %s response id mismatch", ErrUnavailable, method)
	}
	if r.Error != nil {
		if isRevert(r.Error.Code, r.Error.Message) {
			return nil, errReverted
		}
		return nil, fmt.Errorf("%w: %s RPC error %d", ErrUnavailable, method, r.Error.Code)
	}
	if len(r.Result) == 0 || string(r.Result) == "null" {
		return nil, fmt.Errorf("%w: %s empty result", ErrUnavailable, method)
	}
	return r.Result, nil
}

// isRevert recognises an executed-and-reverted eth_call. Geth-family nodes use
// code 3 (with revert data) and -32000 "execution reverted" (without); other
// clients put "revert" in a -32000/-32015 message. Anything else (rate limit,
// bad request, internal error) is an outage, not a verdict.
func isRevert(code int, msg string) bool {
	if code == 3 {
		return true
	}
	return (code == -32000 || code == -32015) && strings.Contains(strings.ToLower(msg), "revert")
}

func decodeHexResult(raw json.RawMessage) ([]byte, error) {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil || !strings.HasPrefix(s, "0x") {
		return nil, fmt.Errorf("%w: result is not hex", ErrUnavailable)
	}
	b, err := hex.DecodeString(s[2:])
	if err != nil {
		return nil, fmt.Errorf("%w: result is not hex", ErrUnavailable)
	}
	return b, nil
}

// ChainID returns eth_chainId.
func (c *Client) ChainID(ctx context.Context) (uint64, error) {
	raw, err := c.call(ctx, "eth_chainId", []any{})
	if err != nil {
		return 0, err
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil || !strings.HasPrefix(s, "0x") || len(s) < 3 || len(s) > 18 {
		return 0, fmt.Errorf("%w: eth_chainId result malformed", ErrUnavailable)
	}
	id, err := strconv.ParseUint(s[2:], 16, 64)
	if err != nil {
		return 0, fmt.Errorf("%w: eth_chainId result malformed", ErrUnavailable)
	}
	return id, nil
}

// Code returns eth_getCode(addr, "latest").
func (c *Client) Code(ctx context.Context, addr [20]byte) ([]byte, error) {
	raw, err := c.call(ctx, "eth_getCode", []any{hexAddr(addr), "latest"})
	if errors.Is(err, errReverted) {
		return nil, fmt.Errorf("%w: eth_getCode reported a revert", ErrUnavailable)
	}
	if err != nil {
		return nil, err
	}
	return decodeHexResult(raw)
}

// Call runs eth_call at "latest". to == nil is a deploy-less call: data is
// creation code and the result is what its constructor returns. A revert is
// returned as errReverted.
func (c *Client) Call(ctx context.Context, to *[20]byte, data []byte) ([]byte, error) {
	msg := map[string]string{
		"data": "0x" + hex.EncodeToString(data),
		"gas":  "0x" + strconv.FormatUint(callGas, 16),
	}
	if to != nil {
		msg["to"] = hexAddr(*to)
	}
	raw, err := c.call(ctx, "eth_call", []any{msg, "latest"})
	if err != nil {
		return nil, err
	}
	return decodeHexResult(raw)
}

func hexAddr(a [20]byte) string { return "0x" + hex.EncodeToString(a[:]) }
