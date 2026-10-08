package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/address"
	"github.com/samouraiworld/memba/backend/internal/auth"
	"github.com/samouraiworld/memba/backend/internal/siwe"
)

// The contract-signer path is checked end to end against the Base Sepolia fork
// recordings of internal/evmauth (#1498): a SafeL2 1.5.0 2-of-3 and a Coinbase
// Smart Wallet v1 that was never deployed (ERC-6492), both signing a real SIWE
// message for memba.club on chain 84532.

type forkFixture struct {
	Safe struct {
		Address, Message, Signature, OneOwnerSignature string
	} `json:"safe"`
	CSW struct {
		Address                   string
		Message                   string
		Signature6492             string `json:"signature6492"`
		OtherMessageSignature6492 string `json:"otherMessageSignature6492"`
	} `json:"coinbaseSmartWallet"`
}

func loadForkFixture(t *testing.T) forkFixture {
	t.Helper()
	raw, err := os.ReadFile("../evmauth/testdata/basesepolia_fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx forkFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	return fx
}

// replayRPC serves the recorded JSON-RPC conversation; any other request fails
// the test. calls counts the requests it answered.
func replayRPC(t *testing.T, calls *int) *httptest.Server {
	t.Helper()
	raw, err := os.ReadFile("../evmauth/testdata/basesepolia_rpc.json")
	if err != nil {
		t.Fatal(err)
	}
	var log []struct {
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
		Reply  json.RawMessage `json:"reply"`
	}
	if err := json.Unmarshal(raw, &log); err != nil {
		t.Fatal(err)
	}
	canon := func(b []byte) string {
		var v any
		_ = json.Unmarshal(b, &v)
		out, _ := json.Marshal(v)
		return string(out)
	}
	byKey := map[string]json.RawMessage{}
	for _, e := range log {
		byKey[e.Method+canon(e.Params)] = e.Reply
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*calls++
		var in struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Errorf("replay: %v", err)
			return
		}
		reply, ok := byKey[in.Method+canon(in.Params)]
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
	t.Cleanup(srv.Close)
	return srv
}

func contractHarness(t *testing.T, rpcURL string, contractOn bool) *testHarness {
	t.Helper()
	h := setup(t)
	env := map[string]string{
		SiweEnableEnv: "true", SiweChainIDsEnv: "84532", SiweDomainsEnv: "memba.club",
		EVMRPCURLsEnv: "84532=" + rpcURL,
	}
	if contractOn {
		env[SiweContractSignersEnv] = "true"
	}
	h.svc.ConfigureSiwe(envMap(env))
	now := time.Date(2026, 10, 7, 12, 0, 30, 0, time.UTC)
	h.svc.siwe.now = func() time.Time { return now }
	return h
}

// challengeFor signs, with the server key, the challenge the fixture message
// was written against (the fixture predates this server, so its nonce is
// taken from the message).
func (h *testHarness) challengeFor(t *testing.T, message string) *membav1.SiweChallenge {
	t.Helper()
	m, err := siwe.Parse(message)
	if err != nil {
		t.Fatal(err)
	}
	ch := &membav1.SiweChallenge{
		Nonce: m.Nonce, ChainId: "eip155:84532", Domain: m.Domain, Uri: m.URI,
		IssuedAt: "2026-10-07T12:00:00Z", Expiration: "2026-10-07T12:10:00Z", Statement: siweStatement,
	}
	if err := auth.SignSiweChallenge(h.svc.privateKey, ch); err != nil {
		t.Fatal(err)
	}
	return ch
}

func lowerScoped(addr string) string { return "eip155:84532:" + strings.ToLower(addr) }

func TestSiweContractSigners(t *testing.T) {
	fx := loadForkFixture(t)
	var calls int
	srv := replayRPC(t, &calls)

	cases := []struct {
		name, message, sig, want string
	}{
		{"safe 2-of-3", fx.Safe.Message, fx.Safe.Signature, lowerScoped(fx.Safe.Address)},
		{"undeployed smart wallet (ERC-6492)", fx.CSW.Message, fx.CSW.Signature6492, lowerScoped(fx.CSW.Address)},
		{"safe below threshold (reverts)", fx.Safe.Message, fx.Safe.OneOwnerSignature, ""},
		{"smart wallet, signature of another message", fx.CSW.Message, fx.CSW.OtherMessageSignature6492, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := contractHarness(t, srv.URL, true)
			tok, err := h.siweToken(h.challengeFor(t, tc.message), tc.message, tc.sig)
			if tc.want == "" {
				if tok != nil {
					t.Fatalf("token issued: %+v", tok)
				}
				wantDenied(t, err, "")
				return
			}
			if err != nil {
				t.Fatalf("GetSiweToken: %v", err)
			}
			exp, _ := time.Parse(time.RFC3339, tok.Expiration)
			if tok.UserAddress != tc.want || tok.ChainId != "eip155:84532" || time.Until(exp) > siweContractSessionTTL {
				t.Fatalf("token: %+v", tok)
			}
			// The chain-bound identity authenticates where a handler opts in…
			if got, err := h.svc.authenticateAccount(tok); err != nil || got != tc.want {
				t.Fatalf("authenticateAccount = %q, %v", got, err)
			}
			// …and stops as soon as the contract path is off.
			clock := h.svc.siwe.now
			h.svc.ConfigureSiwe(envMap(map[string]string{SiweEnableEnv: "true", SiweChainIDsEnv: "84532", SiweDomainsEnv: "memba.club"}))
			h.svc.siwe.now = clock
			if _, err := h.svc.authenticateAccount(tok); connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatal("contract session survived the contract path being turned off")
			}
		})
	}
	if calls == 0 {
		t.Fatal("the contract path never asked the chain")
	}
}

func TestSiweContractSignersOffNeverAsksTheChain(t *testing.T) {
	fx := loadForkFixture(t)
	var calls int
	srv := replayRPC(t, &calls)
	h := contractHarness(t, srv.URL, false)
	_, err := h.siweToken(h.challengeFor(t, fx.Safe.Message), fx.Safe.Message, fx.Safe.Signature)
	wantDenied(t, err, "")
	if calls != 0 {
		t.Fatalf("%d RPC calls with the contract path off", calls)
	}
}

func TestSiweContractRPCUnavailable(t *testing.T) {
	fx := loadForkFixture(t)
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) }))
	defer dead.Close()
	h := contractHarness(t, dead.URL, true)
	ch := h.challengeFor(t, fx.Safe.Message)
	tok, err := h.siweToken(ch, fx.Safe.Message, fx.Safe.Signature)
	var cerr *connect.Error
	if tok != nil || connect.CodeOf(err) != connect.CodeUnavailable || (errorAs(err, &cerr) && cerr.Message() != "") {
		t.Fatalf("got %v, %v; want a message-less Unavailable", tok, err)
	}
	// Not a verdict: nothing was consumed, so the same signed message can be
	// retried once the endpoint is back.
	var n int
	_ = h.db.QueryRow(`SELECT COUNT(*) FROM siwe_used_nonces`).Scan(&n)
	if n != 0 {
		t.Fatal("nonce consumed on an outage")
	}
	var calls int
	h.svc.siwe.verifiers = contractHarness(t, replayRPC(t, &calls).URL, true).svc.siwe.verifiers
	if _, err := h.siweToken(ch, fx.Safe.Message, fx.Safe.Signature); err != nil {
		t.Fatalf("retry after the outage: %v", err)
	}
}

func TestSiweContractSignerConfig(t *testing.T) {
	base := map[string]string{SiweEnableEnv: "1", SiweChainIDsEnv: "84532,8453", SiweDomainsEnv: "memba.club", SiweContractSignersEnv: "1"}
	with := func(urls string) map[string]string {
		m := map[string]string{EVMRPCURLsEnv: urls}
		for k, v := range base {
			m[k] = v
		}
		return m
	}
	cases := map[string]struct {
		urls   string
		chains []uint64
	}{
		"both chains":         {"84532=https://a.example/v2/SECRET, 8453=https://b.example/v2/SECRET", []uint64{84532, 8453}},
		"one chain":           {"84532=https://a.example/v2/SECRET", []uint64{84532}},
		"none":                {"", nil},
		"http refused":        {"84532=http://a.example/v2/SECRET", nil},
		"unserved chain":      {"10=https://a.example/v2/SECRET", nil},
		"listed twice":        {"84532=https://a.example/v2/SECRET,84532=https://b.example/v2/SECRET", nil},
		"not an entry":        {"https://a.example/v2/SECRET", nil},
		"loopback http (dev)": {"84532=http://127.0.0.1:8545", []uint64{84532}},
		"userinfo refused":    {"84532=https://u:SECRET@a.example", nil},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			cfg, problems := parseSiweConfig(envMap(with(tc.urls)))
			if !cfg.enabled {
				t.Fatal("a contract-signer problem must not turn key-holder sign-in off")
			}
			if len(cfg.verifiers) != len(tc.chains) {
				t.Fatalf("verifiers for %d chains, want %v (problems %v)", len(cfg.verifiers), tc.chains, problems)
			}
			for _, id := range tc.chains {
				if cfg.verifiers[id] == nil || cfg.verifiers[id].ChainID() != id {
					t.Fatalf("no verifier for %d", id)
				}
			}
			for _, p := range problems {
				if strings.Contains(p, "SECRET") || strings.Contains(p, "example") {
					t.Fatalf("problem leaks the endpoint: %q", p)
				}
			}
		})
	}
	// Off by default even with endpoints configured.
	m := with("84532=https://a.example")
	delete(m, SiweContractSignersEnv)
	if cfg, _ := parseSiweConfig(envMap(m)); len(cfg.verifiers) != 0 {
		t.Fatal("contract path on without MEMBA_SIWE_CONTRACT_SIGNERS")
	}
}

// Key holders keep their chain-agnostic identity with the contract path on.
func TestSiweEOAUnchangedWithContractPathOn(t *testing.T) {
	var calls int
	srv := replayRPC(t, &calls)
	h := contractHarness(t, srv.URL, true)
	key, addr := siweTestKey(1)
	ch := h.challenge(t, "https://memba.club", "eip155:84532")
	msg := viemMessage(ch, addr, nil)
	tok, err := h.siweToken(ch, msg, signEOA(key, msg))
	if err != nil || tok.UserAddress != address.EOA(addr).String() {
		t.Fatalf("%+v %v", tok, err)
	}
	if calls != 0 {
		t.Fatal("an EOA sign-in asked the chain")
	}
}

func errorAs(err error, target **connect.Error) bool {
	ce, ok := err.(*connect.Error)
	if ok {
		*target = ce
	}
	return ok
}
