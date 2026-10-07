package service

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
	"github.com/samouraiworld/memba/backend/internal/evmsafe"
)

const (
	testSafeChain = "eip155:84532"
	testSafe      = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
	ownerA        = "0xa11ce00000000000000000000000000000000001"
	ownerB        = "0xb0b0000000000000000000000000000000000002"
	stranger      = "0xc0ffee0000000000000000000000000000000003"
)

// fakeSafeChain steers the chain's answer (checkSafeOwner): the check itself is
// tested in internal/evmsafe.
type fakeSafeChain struct {
	verdict evmsafe.Verdict
	down    bool
	asked   int
}

// safeRegistryHarness: SIWE on for Base Sepolia, Safes on, the chain check stubbed.
func safeRegistryHarness(t *testing.T) (*testHarness, *fakeSafeChain) {
	t.Helper()
	h, _ := siweHarness(t)
	chains, problems := h.svc.ConfigureSafeRegistry(envMap(map[string]string{"MEMBA_EVM_SAFE_CHAINS": "84532"}))
	if len(chains) != 1 || chains[0] != 84532 || len(problems) != 0 {
		t.Fatalf("configure: %v %v", chains, problems)
	}
	fake := &fakeSafeChain{verdict: evmsafe.Owner}
	prev := checkSafeOwner
	checkSafeOwner = func(_ context.Context, _ evmsafe.Reader, chainID uint64, safe, account [20]byte) (evmsafe.Verdict, error) {
		fake.asked++
		if chainID != 84532 {
			t.Errorf("checked on chain %d", chainID)
		}
		if fake.down {
			return 0, evmsafe.ErrUnavailable
		}
		return fake.verdict, nil
	}
	t.Cleanup(func() { checkSafeOwner = prev })
	return h, fake
}

func (h *testHarness) register(t *testing.T, user, safe, name string, joined bool) (*membav1.SafeRecord, error) {
	t.Helper()
	res, err := h.svc.RegisterSafe(context.Background(), connect.NewRequest(&membav1.RegisterSafeRequest{
		AuthToken: h.evmToken(t, testSafeChain, user), ChainId: testSafeChain, SafeAddress: safe, Name: name, Joined: joined,
	}))
	if err != nil {
		return nil, err
	}
	return res.Msg.Safe, nil
}

func (h *testHarness) safes(t *testing.T, user string) []*membav1.SafeRecord {
	t.Helper()
	res, err := h.svc.Safes(context.Background(), connect.NewRequest(&membav1.SafesRequest{AuthToken: h.evmToken(t, testSafeChain, user), ChainId: testSafeChain}))
	if err != nil {
		t.Fatalf("Safes: %v", err)
	}
	return res.Msg.Safes
}

func TestSafeRegistryOffByDefault(t *testing.T) {
	h, _ := siweHarness(t)
	if chains, _ := h.svc.ConfigureSafeRegistry(envMap(nil)); len(chains) != 0 {
		t.Fatalf("chains = %v with nothing set", chains)
	}
	_, err := h.register(t, ownerA, testSafe, "", true)
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("RegisterSafe off: %v", err)
	}
	_, err = h.svc.Safes(context.Background(), connect.NewRequest(&membav1.SafesRequest{AuthToken: h.evmToken(t, testSafeChain, ownerA), ChainId: testSafeChain}))
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("Safes off: %v", err)
	}
}

func TestSafeRegistryConfig(t *testing.T) {
	h := setup(t)
	chains, problems := h.svc.ConfigureSafeRegistry(envMap(map[string]string{
		"MEMBA_EVM_SAFE_CHAINS": "84532,8453,1",
		"MEMBA_EVM_RPC_URLS":    "84532=http://evil.example,garbage",
	}))
	// Base keeps its public endpoint; Base Sepolia's configured endpoint is refused (not https), so it is not served.
	if len(chains) != 1 || chains[0] != 8453 {
		t.Fatalf("chains = %v", chains)
	}
	joined := strings.Join(problems, " | ")
	if !strings.Contains(joined, "invalid endpoint for chain 84532") || !strings.Contains(joined, "not <chain id>=<url>") || strings.Contains(joined, "evil.example") {
		t.Fatalf("problems = %q", joined)
	}
}

func TestRegisterSafeChecksOwnershipOnChain(t *testing.T) {
	h, chain := safeRegistryHarness(t)

	rec, err := h.register(t, ownerA, "0x5AFE5AFE5AFE5AFE5AFE5AFE5AFE5AFE5AFE5AFE", "Treasury", true)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if rec.Address != testSafe || rec.ChainId != testSafeChain || rec.Name != "Treasury" || !rec.Joined {
		t.Fatalf("record = %+v", rec)
	}
	if chain.asked != 1 {
		t.Fatalf("chain asked %d times", chain.asked)
	}

	chain.verdict = evmsafe.NotOwner
	if _, err := h.register(t, stranger, testSafe, "Mine now", true); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("non-owner: %v", err)
	}
	chain.verdict = evmsafe.NotASafe
	if _, err := h.register(t, ownerB, testSafe, "", true); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("not a Safe: %v", err)
	}
	chain.down = true
	if _, err := h.register(t, ownerB, testSafe, "", true); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("chain down: %v", err)
	}
	// Nothing was stored for the refused callers.
	if got := h.safes(t, stranger); len(got) != 0 {
		t.Fatalf("stranger's list = %v", got)
	}
	if got := h.safes(t, ownerB); len(got) != 0 {
		t.Fatalf("ownerB's list = %v", got)
	}
}

func TestSafeNamesAreSharedWithOtherOwners(t *testing.T) {
	h, chain := safeRegistryHarness(t)
	if _, err := h.register(t, ownerA, testSafe, "Treasury", true); err != nil {
		t.Fatal(err)
	}
	rec, err := h.register(t, ownerB, testSafe, "", true)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Name != "" || rec.SharedName != "Treasury" || rec.NamedBy != ownerA {
		t.Fatalf("ownerB's record = %+v", rec)
	}
	// The first namer's rename follows; their own name always wins for themselves.
	if _, err := h.register(t, ownerA, testSafe, "Ops treasury", true); err != nil {
		t.Fatal(err)
	}
	if got := h.safes(t, ownerB); len(got) != 1 || got[0].SharedName != "Ops treasury" {
		t.Fatalf("ownerB's list = %+v", got)
	}
	if got := h.safes(t, ownerA); len(got) != 1 || got[0].Name != "Ops treasury" || got[0].SharedName != "" {
		t.Fatalf("ownerA's list = %+v", got)
	}

	// Leaving needs no chain read and keeps the name; the Safe leaves the list.
	asked := chain.asked
	chain.down = true
	rec, err = h.register(t, ownerB, testSafe, "", false)
	if err != nil || rec.Joined {
		t.Fatalf("leave: %+v %v", rec, err)
	}
	if chain.asked != asked {
		t.Fatal("leaving read the chain")
	}
	if got := h.safes(t, ownerB); len(got) != 0 {
		t.Fatalf("list after leaving = %+v", got)
	}
	// Coming back is checked again.
	if _, err := h.register(t, ownerB, testSafe, "", true); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("rejoin while the chain is down: %v", err)
	}
	// Leaving a Safe never registered is a registration: checked.
	if _, err := h.register(t, stranger, "0x1111111111111111111111111111111111111111", "", false); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("leave unregistered: %v", err)
	}
}

func TestSafeRegistryRefusesWhatItCannotServe(t *testing.T) {
	h, chain := safeRegistryHarness(t)
	ctx := context.Background()
	call := func(token *membav1.Token, chainID, safe, name string) error {
		_, err := h.svc.RegisterSafe(ctx, connect.NewRequest(&membav1.RegisterSafeRequest{AuthToken: token, ChainId: chainID, SafeAddress: safe, Name: name, Joined: true}))
		return err
	}
	tok := h.evmToken(t, testSafeChain, ownerA)
	for name, c := range map[string]struct {
		err  error
		want connect.Code
	}{
		"a Gno session":               {call(h.evmToken(t, "gnoland-1", "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"), testSafeChain, testSafe, ""), connect.CodeUnauthenticated},
		"a session for another chain": {call(h.evmToken(t, "eip155:8453", ownerA), testSafeChain, testSafe, ""), connect.CodeUnauthenticated},
		"a chain not served":          {call(h.evmToken(t, "eip155:8453", ownerA), "eip155:8453", testSafe, ""), connect.CodeInvalidArgument},
		"no token":                    {call(nil, testSafeChain, testSafe, ""), connect.CodeUnauthenticated},
		"a bad checksum":              {call(tok, testSafeChain, "0x5aFE5afe5afe5afe5afe5afe5afe5afe5afe5afe", ""), connect.CodeInvalidArgument},
		"a short address":             {call(tok, testSafeChain, "0x5afe", ""), connect.CodeInvalidArgument},
		"a name too long":             {call(tok, testSafeChain, testSafe, strings.Repeat("n", 257)), connect.CodeInvalidArgument},
		"a name with a control char":  {call(tok, testSafeChain, testSafe, "a\nb"), connect.CodeInvalidArgument},
		"a name that is not UTF-8":    {call(tok, testSafeChain, testSafe, "\xff"), connect.CodeInvalidArgument},
	} {
		if connect.CodeOf(c.err) != c.want {
			t.Errorf("%s: got %v, want %v", name, c.err, c.want)
		}
	}
	if chain.asked != 0 {
		t.Fatalf("the chain was read %d times for refused calls", chain.asked)
	}
	if err := call(tok, testSafeChain, testSafe, strings.Repeat("n", 256)); err != nil {
		t.Fatalf("a 256-byte name: %v", err)
	}
	if err := call(tok, testSafeChain, " "+testSafe+" ", ""); err != nil {
		t.Fatalf("surrounding spaces: %v", err)
	}
}

// With both chains served, a session on one chain cannot register a Safe on the other.
func TestSafeRegistryBindsTheSessionChain(t *testing.T) {
	h, chain := safeRegistryHarness(t)
	h.svc.ConfigureSiwe(envMap(map[string]string{SiweEnableEnv: "true", SiweChainIDsEnv: "84532,8453", SiweDomainsEnv: testSiweDomains}))
	if chains, _ := h.svc.ConfigureSafeRegistry(envMap(map[string]string{"MEMBA_EVM_SAFE_CHAINS": "84532,8453"})); len(chains) != 2 {
		t.Fatalf("chains = %v", chains)
	}
	_, err := h.svc.RegisterSafe(context.Background(), connect.NewRequest(&membav1.RegisterSafeRequest{
		AuthToken: h.evmToken(t, "eip155:8453", ownerA), ChainId: testSafeChain, SafeAddress: testSafe, Joined: true,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated || chain.asked != 0 {
		t.Fatalf("Base session registering on Base Sepolia: %v (chain asked %d)", err, chain.asked)
	}
}

func TestSafeRegistryStaysOutOfGnoHandlers(t *testing.T) {
	h, _ := safeRegistryHarness(t)
	if _, err := h.register(t, ownerA, testSafe, "Treasury", true); err != nil {
		t.Fatal(err)
	}
	// The Gno multisig list never sees EVM Safes, and an EVM token cannot read it.
	_, err := h.svc.Multisigs(context.Background(), connect.NewRequest(&membav1.MultisigsRequest{AuthToken: h.evmToken(t, testSafeChain, ownerA), ChainId: testSafeChain}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("Multisigs with an EVM token: %v", err)
	}
	var n int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM user_multisigs").Scan(&n); err != nil || n != 0 {
		t.Fatalf("user_multisigs rows = %d (%v)", n, err)
	}
}
