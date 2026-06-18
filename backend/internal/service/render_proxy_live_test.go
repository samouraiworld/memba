package service

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// Live RPC checks against the gno.land test13 node. Gated behind MEMBA_LIVE_RPC
// so CI stays hermetic. Run with:
//
//	MEMBA_LIVE_RPC=1 go test ./internal/service/ -run Live -v
//
// These exercise the real abci_query wire format (base64-encoded `data`,
// "<pkgpath>:<renderpath>" colon syntax, RawMessage-tolerant ABCI error) end to
// end against the live chain — the bug this file's siblings fix.
const liveTest13RPC = "https://rpc.test13.testnets.gno.land:443"

func requireLiveRPC(t *testing.T) {
	t.Helper()
	if os.Getenv("MEMBA_LIVE_RPC") == "" {
		t.Skip("set MEMBA_LIVE_RPC=1 to run live test13 RPC checks")
	}
}

func TestLive_AbciQuery_RenderColonReturnsData(t *testing.T) {
	requireLiveRPC(t)
	out, err := abciQuery(liveTest13RPC, "vm/qrender", "gno.land/r/samcrew/memba_dao:")
	if err != nil {
		t.Fatalf("abciQuery vm/qrender failed: %v", err)
	}
	if !strings.Contains(out, "MembaDAO") {
		t.Fatalf("expected MembaDAO render, got %q", out)
	}
}

// TestLive_AbciQuery_ObjectErrorIsCleanEmpty proves the json.RawMessage fix: a
// malformed address makes gno.land return ResponseBase.Error as a JSON object
// (/std.InvalidAddressError). Before the fix this crashed json.Unmarshal; now it
// is a clean empty result, not an error.
func TestLive_AbciQuery_ObjectErrorIsCleanEmpty(t *testing.T) {
	requireLiveRPC(t)
	out, err := abciQuery(liveTest13RPC, "auth/accounts/g1notarealaddress", "")
	if err != nil {
		t.Fatalf("expected clean empty result, got error: %v", err)
	}
	if out != "" {
		t.Fatalf("expected empty result for object-typed ABCI error, got %q", out)
	}
}

func TestLive_HandleRenderProxy_ReturnsData(t *testing.T) {
	requireLiveRPC(t)
	t.Setenv("GNO_RPC_URL", liveTest13RPC)
	rec := httptest.NewRecorder()
	HandleRenderProxy().ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/api/render?realm=gno.land/r/samcrew/memba_dao", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "MembaDAO") {
		t.Fatalf("expected MembaDAO in body, got %q", rec.Body.String())
	}
}

func TestLive_HandleMarketplaceAgentsProxy_ReturnsData(t *testing.T) {
	requireLiveRPC(t)
	// The marketplace proxy reads r/samcrew realms via marketplaceRPCURL (test13),
	// NOT the testnet12 GNO_RPC_URL — set its var to pin the live endpoint.
	t.Setenv("MARKETPLACE_RPC_URL", liveTest13RPC)
	rec := httptest.NewRecorder()
	HandleMarketplaceAgentsProxy("gno.land/r/samcrew/agent_registry").ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/api/marketplace/agents", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Agent Registry") {
		t.Fatalf("expected Agent Registry in body, got %q", rec.Body.String())
	}
}

// TestLive_HandleMarketplaceEscrowProxy_ReturnsData proves the escrow proxy
// reads the live escrow_v2 realm on test13 (the v1 "escrow" path 404s there).
func TestLive_HandleMarketplaceEscrowProxy_ReturnsData(t *testing.T) {
	requireLiveRPC(t)
	t.Setenv("MARKETPLACE_RPC_URL", liveTest13RPC)
	rec := httptest.NewRecorder()
	HandleMarketplaceAgentsProxy("gno.land/r/samcrew/escrow_v2").ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, "/api/marketplace/escrow", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Escrow") {
		t.Fatalf("expected Escrow render, got %q", rec.Body.String())
	}
}

// TestLive_RegisterUsername_ResolveAddress proves the register-username verifier
// path: r/sys/users.Render ignores its path arg (always-passes bug), so the
// verifier uses vm/qeval ResolveAddress, which returns "(nil ...)" for an
// unregistered address. Mirrors quest_verify.go's defaultVerifyOnChainQuest.
func TestLive_RegisterUsername_ResolveAddress(t *testing.T) {
	requireLiveRPC(t)
	t.Setenv("QUEST_RPC_URL", liveTest13RPC)

	// Well-formed but unregistered address → not verified.
	const unregistered = "g1w4ek2u3jta047h6lta047h6lta047h6l9huexc"
	out, err := questEval(verifyUserRegistryPath + `.ResolveAddress("` + unregistered + `")`)
	if err != nil {
		t.Fatalf("questEval ResolveAddress failed: %v", err)
	}
	if !strings.HasPrefix(strings.TrimSpace(out), "(nil") {
		t.Fatalf("expected (nil ...) for unregistered address, got %q", out)
	}
}

// TestLive_QuestHelpers_ReturnData proves the server-side quest verifier RPC
// path (questAbciQuery / questRender / accountInfo, defaulting to test13) speaks
// the correct wire format and returns real data.
func TestLive_QuestHelpers_ReturnData(t *testing.T) {
	requireLiveRPC(t)
	t.Setenv("QUEST_RPC_URL", liveTest13RPC)

	// vm/qrender via the quest helper returns real render output.
	if out, err := questRender("gno.land/r/samcrew/memba_dao", ""); err != nil {
		t.Fatalf("questRender failed: %v", err)
	} else if !strings.Contains(out, "MembaDAO") {
		t.Fatalf("expected MembaDAO from questRender, got %q", out)
	}

	// submit-candidature verifier's realm renders (0 applications today, but the
	// realm root proves the colon/base64 path against test13).
	if out, err := questRender(verifyCandidaturePath, ""); err != nil {
		t.Fatalf("questRender(candidature) failed: %v", err)
	} else if !strings.Contains(out, "Candidature") {
		t.Fatalf("expected Candidature render, got %q", out)
	}

	// accountInfo over auth/accounts must tolerate the object-typed ABCI error a
	// malformed/unknown address yields and report (0,0,nil) — "requirement not
	// met", never a transport error.
	if seq, accNum, err := accountInfo("g1notarealaddress"); err != nil {
		t.Fatalf("accountInfo(malformed) should be clean, got error: %v", err)
	} else if seq != 0 || accNum != 0 {
		t.Fatalf("expected (0,0) for unknown account, got (%d,%d)", seq, accNum)
	}
}
