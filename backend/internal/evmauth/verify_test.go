package evmauth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeNode answers JSON-RPC with a per-method handler. A handler returns the
// JSON of either {"result": …} or {"error": …}; the id is filled in.
type fakeNode struct {
	t        *testing.T
	handlers map[string]func(params []json.RawMessage) string
	calls    atomic.Int32
}

func (f *fakeNode) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.calls.Add(1)
	var req struct {
		ID     json.RawMessage   `json:"id"`
		Method string            `json:"method"`
		Params []json.RawMessage `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		f.t.Errorf("bad request: %v", err)
		return
	}
	h, ok := f.handlers[req.Method]
	if !ok {
		f.t.Errorf("unexpected method %s", req.Method)
		http.Error(w, "no", http.StatusBadRequest)
		return
	}
	body := strings.TrimSuffix(strings.TrimSpace(h(req.Params)), "}")
	_, _ = w.Write([]byte(body + `,"jsonrpc":"2.0","id":` + string(req.ID) + `}`))
}

func result(v string) string { return `{"result":"` + v + `"}` }

const (
	chainBaseSepolia = "0x14a34" // 84532
	someCode         = "0x6080"
	magicWord        = "0x1626ba7e00000000000000000000000000000000000000000000000000000000"
)

func newTestVerifier(t *testing.T, f *fakeNode) *Verifier {
	t.Helper()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	c, err := NewClient(srv.URL, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	return NewVerifier(84532, c)
}

func node(t *testing.T, call func([]json.RawMessage) string) *fakeNode {
	return &fakeNode{t: t, handlers: map[string]func([]json.RawMessage) string{
		"eth_chainId": func([]json.RawMessage) string { return result(chainBaseSepolia) },
		"eth_getCode": func([]json.RawMessage) string { return result(someCode) },
		"eth_call":    call,
	}}
}

var (
	acct  = [20]byte{0xaa}
	hash1 = [32]byte{0x01}
	sig65 = make([]byte, 65)
)

func TestVerifyOutcomes(t *testing.T) {
	cases := []struct {
		name    string
		call    string
		want    bool
		unavail bool
	}{
		{"magic value", result(magicWord), true, false},
		{"revert code 3", `{"error":{"code":3,"message":"execution reverted: GS026","data":"0x08c379a0"}}`, false, false},
		{"revert -32000", `{"error":{"code":-32000,"message":"execution reverted"}}`, false, false},
		{"revert -32015", `{"error":{"code":-32015,"message":"VM execution error: Reverted"}}`, false, false},
		{"failure value 0xffffffff", result("0xffffffff00000000000000000000000000000000000000000000000000000000"), false, false},
		{"magic, dirty padding", result("0x1626ba7e00000000000000000000000000000000000000000000000000000001"), false, false},
		{"magic, 4 bytes only", result("0x1626ba7e"), false, false},
		{"magic, 64 bytes", result(magicWord + strings.Repeat("0", 64)), false, false},
		{"empty return", result("0x"), false, false},
		{"rate limited", `{"error":{"code":-32005,"message":"rate limit"}}`, false, true},
		{"-32000 not a revert", `{"error":{"code":-32000,"message":"header not found"}}`, false, true},
		{"not hex", result("0xzz"), false, true},
		{"null result", `{"result":null}`, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v := newTestVerifier(t, node(t, func([]json.RawMessage) string { return tc.call }))
			ok, err := v.Verify(context.Background(), acct, hash1, sig65)
			if ok != tc.want || errors.Is(err, ErrUnavailable) != tc.unavail || (err != nil && !tc.unavail) {
				t.Fatalf("Verify = %v, %v; want %v, unavailable=%v", ok, err, tc.want, tc.unavail)
			}
		})
	}
}

func TestVerifyCallShape(t *testing.T) {
	var seen []json.RawMessage
	v := newTestVerifier(t, node(t, func(p []json.RawMessage) string { seen = p; return result(magicWord) }))
	if ok, err := v.Verify(context.Background(), acct, hash1, []byte{0xaa, 0xbb, 0xcc}); !ok || err != nil {
		t.Fatal(ok, err)
	}
	var msg map[string]string
	if err := json.Unmarshal(seen[0], &msg); err != nil {
		t.Fatal(err)
	}
	if msg["to"] != "0xaa00000000000000000000000000000000000000" || msg["gas"] != "0x4c4b40" || string(seen[1]) != `"latest"` {
		t.Fatalf("call object: %v %s", msg, seen[1])
	}
	// Reference: cast calldata "isValidSignature(bytes32,bytes)" 0x01… 0xaabbcc
	want := "0x1626ba7e0100000000000000000000000000000000000000000000000000000000000000" +
		"0000000000000000000000000000000000000000000000000000000000000040" +
		"0000000000000000000000000000000000000000000000000000000000000003" +
		"aabbcc0000000000000000000000000000000000000000000000000000000000"
	if msg["data"] != want {
		t.Fatalf("calldata\n%s\nwant\n%s", msg["data"], want)
	}
}

func TestEncodingsMatchReference(t *testing.T) {
	// cast calldata "isValidSignature(bytes32,bytes)" 0x0101…01 0xaabbcc
	var h [32]byte
	for i := range h {
		h[i] = 1
	}
	got := hex.EncodeToString(encodeIsValidSignature(h, []byte{0xaa, 0xbb, 0xcc}))
	if got != "1626ba7e"+strings.Repeat("01", 32)+
		"0000000000000000000000000000000000000000000000000000000000000040"+
		"0000000000000000000000000000000000000000000000000000000000000003"+
		"aabbcc0000000000000000000000000000000000000000000000000000000000" {
		t.Fatalf("isValidSignature calldata: %s", got)
	}
	// cast abi-encode "f(address,bytes32,bytes)" 0x…ff 0x0202…02 0x(dd × 33)
	var a [20]byte
	a[19] = 0xff
	for i := range h {
		h[i] = 2
	}
	got = hex.EncodeToString(encodeValidatorArgs(a, h, []byte(strings.Repeat("\xdd", 33))))
	if got != "00000000000000000000000000000000000000000000000000000000000000ff"+strings.Repeat("02", 32)+
		"0000000000000000000000000000000000000000000000000000000000000060"+
		"0000000000000000000000000000000000000000000000000000000000000021"+
		strings.Repeat("dd", 33)+strings.Repeat("00", 31) {
		t.Fatalf("validator args: %s", got)
	}
}

func TestVerifyNoCodeIsInvalidWithoutCall(t *testing.T) {
	f := node(t, func([]json.RawMessage) string { t.Error("eth_call on an account without code"); return result(magicWord) })
	f.handlers["eth_getCode"] = func([]json.RawMessage) string { return result("0x") }
	v := newTestVerifier(t, f)
	if ok, err := v.Verify(context.Background(), acct, hash1, sig65); ok || err != nil {
		t.Fatal(ok, err)
	}
}

func TestVerify6492UsesDeploylessCall(t *testing.T) {
	wrapped := append(append([]byte(nil), sig65...), erc6492Suffix...)
	for name, tc := range map[string]struct {
		out  string
		want bool
	}{
		"valid":      {result("0x01"), true},
		"invalid":    {result("0x00"), false},
		"two bytes":  {result("0x0001"), false},
		"reverted":   {`{"error":{"code":3,"message":"execution reverted"}}`, false},
		"empty":      {result("0x"), false},
		"magic word": {result(magicWord), false},
	} {
		t.Run(name, func(t *testing.T) {
			f := node(t, func(p []json.RawMessage) string {
				var msg map[string]string
				if err := json.Unmarshal(p[0], &msg); err != nil {
					t.Fatal(err)
				}
				if _, hasTo := msg["to"]; hasTo {
					t.Error("6492 verification must be a deploy-less call (no to)")
				}
				if !strings.HasPrefix(msg["data"], "0x"+strings.TrimSpace(erc6492ValidatorHex)) {
					t.Error("6492 call must run the pinned validator")
				}
				return tc.out
			})
			f.handlers["eth_getCode"] = func([]json.RawMessage) string { t.Error("6492 path must not need code"); return result("0x") }
			v := newTestVerifier(t, f)
			if ok, err := v.Verify(context.Background(), acct, hash1, wrapped); ok != tc.want || err != nil {
				t.Fatal(ok, err)
			}
		})
	}
}

func TestErc6492ValidatorPinned(t *testing.T) {
	sum := sha256.Sum256(erc6492Validator)
	if hex.EncodeToString(sum[:]) != "d46b6085a6558eb925573e4e395ccbc669a1db1b7aa49196cbb1a7540db6a470" || len(erc6492Validator) != 1684 {
		t.Fatalf("validator bytecode changed: sha256 %x, %d bytes", sum, len(erc6492Validator))
	}
}

func TestChainIdentity(t *testing.T) {
	f := node(t, func([]json.RawMessage) string { return result(magicWord) })
	f.handlers["eth_chainId"] = func([]json.RawMessage) string { return result("0x2105") } // Base mainnet
	v := newTestVerifier(t, f)
	ok, err := v.Verify(context.Background(), acct, hash1, sig65)
	if ok || !errors.Is(err, ErrWrongChain) || !errors.Is(err, ErrUnavailable) {
		t.Fatalf("wrong chain: %v %v", ok, err)
	}
}

func TestChainCheckCachedThenRechecked(t *testing.T) {
	var chainCalls atomic.Int32
	f := node(t, func([]json.RawMessage) string { return result(magicWord) })
	f.handlers["eth_chainId"] = func([]json.RawMessage) string { chainCalls.Add(1); return result(chainBaseSepolia) }
	v := newTestVerifier(t, f)
	now := time.Unix(1_800_000_000, 0)
	v.now = func() time.Time { return now }
	for range 3 {
		if ok, err := v.Verify(context.Background(), acct, hash1, sig65); !ok || err != nil {
			t.Fatal(ok, err)
		}
	}
	if chainCalls.Load() != 1 {
		t.Fatalf("eth_chainId asked %d times within the TTL", chainCalls.Load())
	}
	now = now.Add(chainCheckTTL)
	if _, err := v.Verify(context.Background(), acct, hash1, sig65); err != nil {
		t.Fatal(err)
	}
	if chainCalls.Load() != 2 {
		t.Fatal("identity not re-checked after the TTL")
	}
}

func TestTransportFailures(t *testing.T) {
	t.Run("HTTP 429", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTooManyRequests) }))
		defer srv.Close()
		c, _ := NewClient(srv.URL, time.Second)
		if _, err := NewVerifier(84532, c).Verify(context.Background(), acct, hash1, sig65); !errors.Is(err, ErrUnavailable) {
			t.Fatal(err)
		}
	})
	t.Run("redirect not followed", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "http://127.0.0.1:1/elsewhere", http.StatusTemporaryRedirect)
		}))
		defer srv.Close()
		c, _ := NewClient(srv.URL, time.Second)
		if _, err := c.ChainID(context.Background()); !errors.Is(err, ErrUnavailable) {
			t.Fatal(err)
		}
	})
	t.Run("timeout", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case <-r.Context().Done():
			case <-time.After(2 * time.Second):
			}
		}))
		defer srv.Close()
		c, _ := NewClient(srv.URL, 50*time.Millisecond)
		if _, err := c.ChainID(context.Background()); !errors.Is(err, ErrUnavailable) {
			t.Fatal(err)
		}
	})
	t.Run("id mismatch", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":999,"result":"0x14a34"}`))
		}))
		defer srv.Close()
		c, _ := NewClient(srv.URL, time.Second)
		if _, err := c.ChainID(context.Background()); !errors.Is(err, ErrUnavailable) {
			t.Fatal(err)
		}
	})
	t.Run("oversized response", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"0x` + strings.Repeat("0", maxResponseBytes) + `"}`))
		}))
		defer srv.Close()
		c, _ := NewClient(srv.URL, time.Second)
		if _, err := c.ChainID(context.Background()); !errors.Is(err, ErrUnavailable) {
			t.Fatal(err)
		}
	})
	t.Run("error never spells the URL", func(t *testing.T) {
		c, err := NewClient("http://127.0.0.1:1/v2/SECRETKEY", 200*time.Millisecond)
		if err != nil {
			t.Fatal(err)
		}
		_, err = c.ChainID(context.Background())
		if !errors.Is(err, ErrUnavailable) || strings.Contains(err.Error(), "SECRETKEY") || strings.Contains(err.Error(), "127.0.0.1") {
			t.Fatalf("error leaks the endpoint: %v", err)
		}
	})
}

func TestOversizedSignatureNeverReachesTheNode(t *testing.T) {
	f := node(t, func([]json.RawMessage) string { return result(magicWord) })
	v := newTestVerifier(t, f)
	if ok, err := v.Verify(context.Background(), acct, hash1, make([]byte, MaxSignatureBytes+1)); ok || err != nil {
		t.Fatal(ok, err)
	}
	if f.calls.Load() != 0 {
		t.Fatal("oversized signature was sent to the node")
	}
}

func TestNewClientURLPolicy(t *testing.T) {
	for _, ok := range []string{"https://base-sepolia.example/v2/key", "http://127.0.0.1:8545", "http://localhost:8545", "http://[::1]:8545"} {
		if _, err := NewClient(ok, time.Second); err != nil {
			t.Errorf("%s refused: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "http://rpc.example", "ws://127.0.0.1:8545", "https://user:pw@rpc.example", "https://", "file:///etc/passwd", "://x"} {
		if _, err := NewClient(bad, time.Second); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	if _, err := NewClient("https://rpc.example", 0); err == nil {
		t.Error("zero timeout accepted")
	}
}

func FuzzVerifyResponses(f *testing.F) {
	f.Add(`{"result":"0x1626ba7e00000000000000000000000000000000000000000000000000000000"}`, []byte{1})
	f.Add(`{"error":{"code":3,"message":"execution reverted"}}`, append(make([]byte, 65), erc6492Suffix...))
	f.Fuzz(func(t *testing.T, body string, sig []byte) {
		v := newTestVerifier(t, node(t, func([]json.RawMessage) string {
			if !strings.HasPrefix(strings.TrimSpace(body), "{") {
				return `{"result":"0x"}`
			}
			return body
		}))
		ok, err := v.Verify(context.Background(), acct, hash1, sig)
		if ok && err != nil {
			t.Fatal("valid with an error")
		}
	})
}
