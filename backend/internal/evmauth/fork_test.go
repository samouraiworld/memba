package evmauth

// Contract-account fixtures from Base Sepolia and Base mainnet forks, replayed
// offline. Phase 0 found three testnet/mainnet divergences, so every check runs
// on both chains.
//
// testdata/<chain>_fixtures.json is written by testdata/gen_fixtures.mjs
// (viem 2.57.3) against an anvil fork pinned at the Phase 0 blocks (Base
// Sepolia 47,800,000; Base 52,289,000). It deploys a SafeL2 1.5.0 2-of-3 and signs a
// SIWE message with two owners; it signs another with a Coinbase Smart Wallet
// v1 that is never deployed, wrapped in ERC-6492 exactly as viem wraps it. The
// keys are anvil's public test mnemonic.
//
// testdata/<chain>_rpc.json is the JSON-RPC conversation the verifier had
// with that fork, recorded by this file:
//
//	MEMBA_EVM_FORK_RPC_URL=http://127.0.0.1:8545 MEMBA_EVM_FORK_CHAIN=basesepolia MEMBA_EVM_FORK_RECORD=1 \
//	  go test -run TestForkFixtures/basesepolia ./internal/evmauth/
//
// Without MEMBA_EVM_FORK_RPC_URL the recording is replayed, so CI checks the
// verdicts with no network. With it (and no RECORD) the same cases run live.

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// forkChains maps each fixture name to its chain id.
var forkChains = map[string]uint64{"basesepolia": 84532, "base": 8453}

type forkFixtures struct {
	ChainID uint64 `json:"chainId"`
	Safe    struct {
		Address           string `json:"address"`
		Threshold         int    `json:"threshold"`
		Hash              string `json:"hash"`
		Signature         string `json:"signature"`
		OneOwnerSignature string `json:"oneOwnerSignature"`
	} `json:"safe"`
	CSW struct {
		Address                   string `json:"address"`
		Deployed                  bool   `json:"deployed"`
		Hash                      string `json:"hash"`
		Signature6492             string `json:"signature6492"`
		InnerSignature            string `json:"innerSignature"`
		OtherMessageSignature6492 string `json:"otherMessageSignature6492"`
	} `json:"coinbaseSmartWallet"`
}

type forkCase struct {
	name    string
	account string
	hash    string
	sig     string
	want    bool
	// reverts: the definite "no" must come from an executed revert, the
	// behaviour Phase 0 proved for Safe (not a returned failure value).
	reverts bool
}

func forkCases(fx forkFixtures) []forkCase {
	return []forkCase{
		{"safe 2-of-3 signature", fx.Safe.Address, fx.Safe.Hash, fx.Safe.Signature, true, false},
		{"safe signature replayed on another message", fx.Safe.Address, fx.CSW.Hash, fx.Safe.Signature, false, true},
		{"safe below threshold", fx.Safe.Address, fx.Safe.Hash, fx.Safe.OneOwnerSignature, false, true},
		{"undeployed smart wallet, ERC-6492", fx.CSW.Address, fx.CSW.Hash, fx.CSW.Signature6492, true, false},
		{"undeployed smart wallet, ERC-6492 for another message", fx.CSW.Address, fx.CSW.Hash, fx.CSW.OtherMessageSignature6492, false, false},
		{"undeployed smart wallet without the wrapper", fx.CSW.Address, fx.CSW.Hash, fx.CSW.InnerSignature, false, false},
		{"safe signature presented for the smart wallet", fx.CSW.Address, fx.Safe.Hash, fx.Safe.Signature, false, false},
	}
}

type exchange struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	Reply  json.RawMessage `json:"reply"` // {"result": …} or {"error": …}
}

func canonicalJSON(t *testing.T, raw []byte) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("canonical: %v", err)
	}
	out, _ := json.Marshal(v)
	return string(out)
}

func decodeHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if err != nil {
		t.Fatalf("hex %q: %v", s, err)
	}
	return b
}

func to20(t *testing.T, s string) (a [20]byte) {
	copy(a[:], decodeHex(t, s))
	return a
}

func to32(t *testing.T, s string) (h [32]byte) {
	copy(h[:], decodeHex(t, s))
	return h
}

// recorder sits between the client and a live node and keeps every exchange.
type recorder struct {
	t     *testing.T
	next  http.RoundTripper
	mu    sync.Mutex
	log   []exchange
	byKey map[string]bool
}

func (r *recorder) RoundTrip(req *http.Request) (*http.Response, error) {
	body, _ := io.ReadAll(req.Body)
	req.Body = io.NopCloser(bytes.NewReader(body))
	resp, err := r.next.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	respBody, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	resp.Body = io.NopCloser(bytes.NewReader(respBody))

	var in struct {
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	var out map[string]json.RawMessage
	if json.Unmarshal(body, &in) == nil && json.Unmarshal(respBody, &out) == nil {
		delete(out, "id")
		delete(out, "jsonrpc")
		reply, _ := json.Marshal(out)
		params := canonicalJSON(r.t, in.Params)
		r.mu.Lock()
		if key := in.Method + params; !r.byKey[key] {
			r.byKey[key] = true
			r.log = append(r.log, exchange{Method: in.Method, Params: json.RawMessage(params), Reply: reply})
		}
		r.mu.Unlock()
	}
	return resp, nil
}

// replayNode answers from a recording and fails the test on any request that
// was not recorded.
func replayNode(t *testing.T, log []exchange) *httptest.Server {
	byKey := map[string]json.RawMessage{}
	for _, e := range log {
		byKey[e.Method+canonicalJSON(t, e.Params)] = e.Reply
	}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Errorf("replay: %v", err)
			return
		}
		reply, ok := byKey[in.Method+canonicalJSON(t, in.Params)]
		if !ok {
			t.Errorf("replay: unrecorded %s %s", in.Method, in.Params)
			http.Error(w, "unrecorded", http.StatusBadRequest)
			return
		}
		var out map[string]json.RawMessage
		_ = json.Unmarshal(reply, &out)
		out["jsonrpc"], out["id"] = json.RawMessage(`"2.0"`), in.ID
		_ = json.NewEncoder(w).Encode(out)
	}))
}

func loadFixtures(t *testing.T, name string, chainID uint64) forkFixtures {
	t.Helper()
	raw, err := os.ReadFile("testdata/" + name + "_fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx forkFixtures
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.ChainID != chainID || fx.Safe.Threshold != 2 || fx.CSW.Deployed || !bytes.HasSuffix(decodeHex(t, fx.CSW.Signature6492), erc6492Suffix) {
		t.Fatalf("fixtures are not the documented setup: %+v", fx)
	}
	return fx
}

func TestForkFixtures(t *testing.T) {
	for name, chainID := range forkChains {
		t.Run(name, func(t *testing.T) { testForkFixtures(t, name, chainID) })
	}
}

func testForkFixtures(t *testing.T, name string, chainID uint64) {
	fx := loadFixtures(t, name, chainID)
	rpcPath := "testdata/" + name + "_rpc.json"
	live := os.Getenv("MEMBA_EVM_FORK_RPC_URL")
	if live != "" && os.Getenv("MEMBA_EVM_FORK_CHAIN") != name {
		t.Skip("live run targets another chain")
	}
	record := live != "" && os.Getenv("MEMBA_EVM_FORK_RECORD") == "1"

	var log []exchange
	url := live
	if live == "" {
		raw, err := os.ReadFile(rpcPath)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, &log); err != nil {
			t.Fatal(err)
		}
		srv := replayNode(t, log)
		defer srv.Close()
		url = srv.URL
	}
	client, err := NewClient(url, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	rec := &recorder{t: t, next: http.DefaultTransport, byKey: map[string]bool{}}
	if record {
		client.hc.Transport = rec
	}

	for _, tc := range forkCases(fx) {
		t.Run(tc.name, func(t *testing.T) {
			v := NewVerifier(fx.ChainID, client)
			ok, err := v.Verify(context.Background(), to20(t, tc.account), to32(t, tc.hash), decodeHex(t, tc.sig))
			if err != nil || ok != tc.want {
				t.Fatalf("Verify = %v, %v; want %v", ok, err, tc.want)
			}
		})
	}

	if record {
		rec.mu.Lock()
		out, _ := json.MarshalIndent(rec.log, "", " ")
		rec.mu.Unlock()
		if err := os.WriteFile(rpcPath, append(out, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
		return
	}
	if live == "" {
		// The Safe "no" verdicts must be executed reverts in the recording,
		// not some returned failure value: that is the case the verifier has
		// to turn into "invalid" instead of an outage.
		for _, tc := range forkCases(fx) {
			if !tc.reverts {
				continue
			}
			call := encodeIsValidSignature(to32(t, tc.hash), decodeHex(t, tc.sig))
			found := false
			for _, e := range log {
				if e.Method == "eth_call" && strings.Contains(string(e.Params), hex.EncodeToString(call)) {
					found = strings.Contains(string(e.Reply), `"error"`) && strings.Contains(strings.ToLower(string(e.Reply)), "revert")
				}
			}
			if !found {
				t.Errorf("%s: recording does not show a revert", tc.name)
			}
		}
	}
}
