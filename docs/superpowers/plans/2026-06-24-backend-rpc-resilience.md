# Backend RPC Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every demo-critical backend chain-read survive a single RPC node going down, and stop any environment from silently reading the wrong chain — by adding automatic RPC failover (mirroring the frontend's `rpcFallback.ts`) and de-drifting the node defaults.

**Architecture:** All backend chain reads funnel through a handful of single-URL HTTP transports (`abciQuery`, `home_rpc.httpGetJSON`, `quest_verify.questAbciQuery`). Today each hits exactly one node with no retry, so a single-node hiccup blanks render/balance/marketplace/home/quest. We introduce one shared ordered-node helper (`rpcURLsInOrder`) + per-transport failover wrappers that try the pinned primary, then trusted test13 backups, advancing only on *transport* errors (a valid "no record" answer is a success, never a failover). Separately we fix the `gnoRPCURL()` test12 default (a latent wrong-chain footgun once failover exists) and the now-stale prod comments.

**Tech Stack:** Go 1.25 / ConnectRPC / `net/http` / `net/http/httptest` / `slices` (stdlib). No new dependencies.

## Global Constraints

- **Never commit to `main`.** Branch off **updated** `main`; one feature per branch; PR; admin-merge **only on explicit per-PR approval**, even with green CI.
- **No Claude attribution** anywhere — no `Co-Authored-By`, no "Generated with" footers, no Claude mention in commits/PRs/tags.
- **Commit message format:** concise, focused on the *why*. No trailers.
- **Backend logic changes are TDD** with permanent regression fixtures. Run `go test -race ./...` and `golangci-lint run` from `backend/` before every commit.
- **Failover triggers on transport failure only** — connection error, timeout, non-200 HTTP, or unparseable body. A 200 response carrying an ABCI `ResponseBase.Error` (e.g. `/std.InvalidAddressError`) or empty `Data` is a legitimate "no record" and MUST return `("", nil)` *without* advancing to the next node. This invariant is the difference between resilience and silently masking real empties.
- **Trust model:** the backup nodes are the same trusted test13 set the frontend already fails over to (`config.ts` test13 `rpcUrl`/`fallbackRpcUrls` + telemetry nodes). Quest-verification reads are no more sensitive than the frontend's own reads, so reusing that set is acceptable. Operators can override via `RPC_FALLBACK_URLS`.
- **Each PR independently revertible.**

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `backend/internal/service/rpc_resilient.go` | Single source of truth for the ordered node list (`rpcFallbackURLs`, `rpcURLsInOrder`) + the resilient GET wrapper. | **Create** |
| `backend/internal/service/rpc_resilient_test.go` | Unit tests for the node-list helpers + GET failover. | **Create** |
| `backend/internal/service/render_proxy.go` | `abciQuery` becomes a failover wrapper over a new `abciQueryOnce`; `gnoRPCURL()` default de-drifted test12→test13; stale comment fixed. | **Modify** (`22-43`, `97-148`) |
| `backend/internal/service/render_proxy_failover_test.go` | abciQuery failover regression tests. | **Create** |
| `backend/internal/service/home_rpc.go` | `fetchNetworkPulse`/`fetchValidatorsHealth` GET calls routed through the resilient GET wrapper. | **Modify** (`490-565`) |
| `backend/internal/service/home_rpc_test.go` | Add GET-failover test. | **Modify** |
| `backend/internal/service/quest_verify.go` | `questAbciQuery` becomes a failover wrapper over `questAbciQueryOnce`; stale "test12 in prod" comment fixed. | **Modify** (`80-91`, `398-440`) |
| `backend/internal/service/quest_verify_failover_test.go` | quest failover regression test. | **Create** |
| `backend/.env.example` | Document `RPC_FALLBACK_URLS`. | **Modify** |

**Decomposition:** PR 1 (Task 1) = the tiny, low-risk de-drift. PR 2 (Tasks 2–4) = the failover keystone, one task per transport so a reviewer can gate each independently.

**Tracked, not built (logged with revisit trigger):** `internal/indexer/tailer.go:415` (GET) and `internal/indexer/poller.go:172` (POST) are the NFT indexer's transports. The indexer is a background worker and NFT is flag-gated **off**, so it is not demo-critical. Fold its failover into the NFT go-live epic (E9-b). Not dropped — sequenced behind the flag that makes it matter.

**Tracked, not built #2 (from the post-build audit):** the failover wrappers have no last-known-good memoization and the `*Once` HTTP calls don't carry the inbound ctx deadline, so during a *hanging* (not fast-failing) primary outage the home snapshot's ~8 sequential sources each re-probe the dead primary (each bounded by `rpcAttemptTimeout` = 8s). The realistic fast-fail outage fails over near-instantly, so this is deferred: a bounded-TTL last-good memo + ctx-deadline propagation through `abciQuery`/`questAbciQuery`/`httpGetJSON` would cap the worst case. Revisit if a live outage shows compounding latency. (Documented in `rpc_resilient.go`'s `rpcAttemptTimeout` comment.)

---

## PR 1 — `fix/backend-rpc-pin-dedrift`

### Task 1: De-drift the RPC node defaults + stale comments

**Why first:** Once failover exists (PR 2), a wrong-chain default is *worse*, not better — test12 answers successfully with wrong-chain data, so the transport-error failover never fires. Fixing the default is a precondition for correct failover. This task is a 1-line default change + comment refresh; it ships fast and de-risks PR 2.

**Files:**
- Modify: `backend/internal/service/render_proxy.go:21-27` (gnoRPCURL default + comment)
- Modify: `backend/internal/service/render_proxy.go:29-35` (marketplaceRPCURL stale comment)
- Modify: `backend/internal/service/quest_verify.go:80-83` (questRPCURL stale comment)
- Test: `backend/internal/service/render_proxy_test.go` (add `TestGnoRPCURL_DefaultsToTest13`)

**Interfaces:**
- Produces: `gnoRPCURL() string` (unchanged signature) now defaults to the test13 samourai node.

- [ ] **Step 1: Write the failing test**

Add to `backend/internal/service/render_proxy_test.go`:

```go
func TestGnoRPCURL_DefaultsToTest13(t *testing.T) {
	t.Setenv("GNO_RPC_URL", "") // force the built-in default
	got := gnoRPCURL()
	if strings.Contains(got, "testnet12") || strings.Contains(got, "test12") {
		t.Fatalf("gnoRPCURL() still defaults to a test12 node: %q", got)
	}
	if got != "https://rpc.testnet13.samourai.live:443" {
		t.Fatalf("gnoRPCURL() default = %q, want the pinned test13 samourai node", got)
	}
}
```

Ensure `"strings"` is imported in the test file (it already imports `net/http`/`httptest`; add `strings` if absent).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/service/ -run TestGnoRPCURL_DefaultsToTest13 -v`
Expected: FAIL — `gnoRPCURL() default = "https://rpc.testnet12.samourai.live:443"`.

- [ ] **Step 3: Fix the default + comment**

In `backend/internal/service/render_proxy.go`, replace lines 21-27:

```go
// gnoRPCURL returns the RPC endpoint for the generic render/balance proxies.
// Overridable via GNO_RPC_URL (set to the pinned samourai test13 node in
// fly.toml). The built-in default is the same test13 node — NOT test12 — so an
// environment that forgets to set GNO_RPC_URL reads the right chain. The public
// node is reached only as a failover backup (see rpcURLsInOrder), which rate-
// limits the Fly egress IP (#466), so it is never the primary.
func gnoRPCURL() string {
	if url := os.Getenv("GNO_RPC_URL"); url != "" {
		return url
	}
	return "https://rpc.testnet13.samourai.live:443"
}
```

- [ ] **Step 4: Fix the two stale "test12 in prod" comments**

`render_proxy.go:29-35` — `marketplaceRPCURL`'s comment claims `GNO_RPC_URL` is "testnet12-defaulted". Since fly.toml now sets it to test13 and the default above is test13, replace the comment body (keep the function) with:

```go
// marketplaceRPCURL returns the RPC for the on-chain r/samcrew app realms read
// by the marketplace proxies and the analyst credit check (agent_registry,
// escrow_v2, …). It reads its OWN var (MARKETPLACE_RPC_URL, then NFT_RPC_URL)
// and defaults to the public test13 node, keeping marketplace reads decoupled
// from the generic GNO_RPC_URL even if that is ever repurposed. Failover backups
// are appended by rpcURLsInOrder.
```

`quest_verify.go:80-83` — `questRPCURL`'s comment says GNO_RPC_URL "is set to test12 in prod (fly.toml)". That is no longer true. Replace lines 80-83 with:

```go
// questRPCURL returns the RPC endpoint for server-side quest verification. It
// reads its own vars (QUEST_RPC_URL, then NFT_RPC_URL) rather than GNO_RPC_URL,
// keeping verification reads decoupled from the generic render proxy. Failover
// backups are appended by rpcURLsInOrder.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test ./internal/service/ -run TestGnoRPCURL_DefaultsToTest13 -v`
Expected: PASS.

- [ ] **Step 6: Full gate + commit**

Run: `cd backend && go test -race ./... && golangci-lint run`
Expected: PASS.

```bash
git add backend/internal/service/render_proxy.go backend/internal/service/quest_verify.go backend/internal/service/render_proxy_test.go
git commit -m "de-drift backend RPC default to test13 + retire stale 'test12 in prod' comments"
```

---

## PR 2 — `feat/backend-rpc-failover`

> Branch off `main` **after PR 1 merges** so the de-drifted defaults are present.

### Task 2: Shared ordered-node helper + resilient `abciQuery`

**Files:**
- Create: `backend/internal/service/rpc_resilient.go`
- Create: `backend/internal/service/rpc_resilient_test.go`
- Create: `backend/internal/service/render_proxy_failover_test.go`
- Modify: `backend/internal/service/render_proxy.go:97-148` (split `abciQuery` into wrapper + `abciQueryOnce`)

**Interfaces:**
- Produces:
  - `rpcFallbackURLs() []string` — backup nodes, `RPC_FALLBACK_URLS`-overridable.
  - `rpcURLsInOrder(primary string) []string` — `[primary, ...fallbacks]`, deduped.
  - `httpGetJSONResilient(ctx context.Context, base, suffix string, out any) error` — used by Task 3.
  - `abciQuery(rpcURL, path, data string) (string, error)` — unchanged signature, now fails over. `home_rpc`'s `queryFunc` seam (`service.go:109`) keeps pointing at it, so home qrender/balance reads inherit failover for free.
  - `abciQueryOnce(rpcURL, path, data string) (string, error)` — single-node attempt.

- [ ] **Step 1: Write the failing tests for the node-list helpers**

Create `backend/internal/service/rpc_resilient_test.go`:

```go
package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRPCURLsInOrder_PrimaryFirstDeduped(t *testing.T) {
	t.Setenv("RPC_FALLBACK_URLS", "")
	primary := "https://rpc.testnet13.samourai.live:443"
	got := rpcURLsInOrder(primary)
	if len(got) < 2 {
		t.Fatalf("want primary + fallbacks, got %v", got)
	}
	if got[0] != primary {
		t.Fatalf("primary must be first, got %q", got[0])
	}
	// No duplicates.
	seen := map[string]bool{}
	for _, u := range got {
		if seen[u] {
			t.Fatalf("duplicate url %q in %v", u, got)
		}
		seen[u] = true
	}
}

func TestRPCURLsInOrder_PrimaryAlsoInFallbacks_NoDup(t *testing.T) {
	primary := "https://node-a:443"
	t.Setenv("RPC_FALLBACK_URLS", "https://node-a:443,https://node-b:443")
	got := rpcURLsInOrder(primary)
	want := []string{"https://node-a:443", "https://node-b:443"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %v, want %v (primary deduped from fallbacks)", got, want)
	}
}

func TestRPCFallbackURLs_EnvOverride(t *testing.T) {
	t.Setenv("RPC_FALLBACK_URLS", " https://x:443 , ,https://y:443 ")
	got := rpcFallbackURLs()
	if len(got) != 2 || got[0] != "https://x:443" || got[1] != "https://y:443" {
		t.Fatalf("got %v, want trimmed [x, y] with blanks dropped", got)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/service/ -run TestRPCURLsInOrder -v`
Expected: FAIL — `undefined: rpcURLsInOrder`.

- [ ] **Step 3: Create the shared helper**

Create `backend/internal/service/rpc_resilient.go`:

```go
package service

import (
	"context"
	"os"
	"slices"
	"strings"
)

// defaultTest13Fallbacks are the backup test13 RPC nodes tried, in order, when
// the primary endpoint is unreachable. They mirror the trusted test13 nodes the
// frontend already fails over to (frontend/src/lib/config.ts test13 rpcUrl +
// fallbackRpcUrls + telemetry nodes). Used ONLY on a transport error from the
// primary — a valid "no record" answer never triggers failover.
var defaultTest13Fallbacks = []string{
	"https://rpc.test13.testnets.gno.land:443",        // public canonical
	"https://test13.rpc.onbloc.xyz:443",               // onbloc
	"https://rpc.test-13-aeddi-1.gnoland.network:443", // gno-core / aeddi
}

// rpcFallbackURLs returns the ordered backup node list. RPC_FALLBACK_URLS
// (comma-separated) overrides the built-in list; blank entries are dropped and
// surrounding whitespace trimmed. An unset/empty env yields the test13 default.
func rpcFallbackURLs() []string {
	if v := strings.TrimSpace(os.Getenv("RPC_FALLBACK_URLS")); v != "" {
		out := make([]string, 0, 4)
		for _, u := range strings.Split(v, ",") {
			if t := strings.TrimSpace(u); t != "" {
				out = append(out, t)
			}
		}
		return out
	}
	return defaultTest13Fallbacks
}

// rpcURLsInOrder returns [primary, ...fallbacks] with duplicates removed and
// order preserved. The primary (already env-resolved by the caller's *RPCURL()
// helper) is always tried first.
func rpcURLsInOrder(primary string) []string {
	urls := []string{primary}
	for _, u := range rpcFallbackURLs() {
		if !slices.Contains(urls, u) {
			urls = append(urls, u)
		}
	}
	return urls
}

// httpGetJSONResilient performs httpGetJSON against the primary base URL then
// each backup node until one succeeds. `base` is the RPC root (no trailing
// slash); `suffix` is the path+query (e.g. "/status", "/block?height=42").
// Returns the last error if every node fails.
func httpGetJSONResilient(ctx context.Context, base, suffix string, out any) error {
	var lastErr error
	for _, u := range rpcURLsInOrder(base) {
		if err := httpGetJSON(ctx, u+suffix, out); err != nil {
			lastErr = err
			continue
		}
		return nil
	}
	return lastErr
}
```

- [ ] **Step 4: Run to verify the helper tests pass**

Run: `cd backend && go test ./internal/service/ -run TestRPCURLsInOrder -v && go test ./internal/service/ -run TestRPCFallbackURLs -v`
Expected: PASS.

- [ ] **Step 5: Write the failing abciQuery failover test**

Create `backend/internal/service/render_proxy_failover_test.go`:

```go
package service

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// abciOK writes a valid JSON-RPC abci_query response whose ResponseBase.Data
// base64-decodes to `payload`.
func abciOK(t *testing.T, w http.ResponseWriter, payload string) {
	t.Helper()
	body := map[string]any{
		"result": map[string]any{
			"response": map[string]any{
				"ResponseBase": map[string]any{
					"Data":  base64.StdEncoding.EncodeToString([]byte(payload)),
					"Error": nil,
				},
			},
		},
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func TestAbciQuery_FailsOverToHealthyNode(t *testing.T) {
	// Primary node is down (502); the backup answers.
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer down.Close()
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		abciOK(t, w, "RENDER_OK")
	}))
	defer good.Close()

	t.Setenv("RPC_FALLBACK_URLS", good.URL) // single backup = the good node

	got, err := abciQuery(down.URL, "vm/qrender", "gno.land/r/x:")
	if err != nil {
		t.Fatalf("expected failover success, got err: %v", err)
	}
	if got != "RENDER_OK" {
		t.Fatalf("got %q, want RENDER_OK from the backup node", got)
	}
}

func TestAbciQuery_ValidEmptyDoesNotFailOver(t *testing.T) {
	// The primary answers 200 with a present ABCI error (a legitimate "no
	// record"). Failover MUST NOT fire; the backup must never be hit.
	var backupHits int
	backup := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		backupHits++
		abciOK(t, w, "SHOULD_NOT_BE_USED")
	}))
	defer backup.Close()
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		body := `{"result":{"response":{"ResponseBase":{"Data":"","Error":{"@type":"/std.InvalidAddressError"}}}}}`
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	defer primary.Close()

	t.Setenv("RPC_FALLBACK_URLS", backup.URL)

	got, err := abciQuery(primary.URL, "bank/balances/g1invalid", "")
	if err != nil {
		t.Fatalf("a present ABCI error should be a clean empty result, got err: %v", err)
	}
	if got != "" {
		t.Fatalf("got %q, want empty string for no-record", got)
	}
	if backupHits != 0 {
		t.Fatalf("backup was hit %d times; a valid empty must not trigger failover", backupHits)
	}
}

func TestAbciQuery_AllNodesDownReturnsError(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer down.Close()
	t.Setenv("RPC_FALLBACK_URLS", down.URL)

	_, err := abciQuery(down.URL, "vm/qrender", "gno.land/r/x:")
	if err == nil {
		t.Fatal("expected an error when every node is down")
	}
}
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd backend && go test ./internal/service/ -run TestAbciQuery_ -v`
Expected: FAIL — `TestAbciQuery_FailsOverToHealthyNode` errors because the current `abciQuery` only tries `down.URL` (a 502 currently slips past as a parse error and returns an error rather than failing over).

- [ ] **Step 7: Refactor `abciQuery` into a failover wrapper + `abciQueryOnce`**

In `backend/internal/service/render_proxy.go`, replace the function at lines 97-148. Keep the entire existing body but rename it `abciQueryOnce`, add an explicit non-200 check so a dead node deterministically triggers failover, and add the wrapper:

```go
// abciQuery sends an ABCI query with automatic failover: it tries the primary
// RPC (rpcURL) then each backup node from rpcURLsInOrder until one answers
// without a transport error. A valid "no record" answer (empty result, nil
// error) is a success and does NOT advance to the next node — only
// connection/timeout/non-200/parse errors fail over. Returns the last transport
// error if every node fails.
func abciQuery(rpcURL, path, data string) (string, error) {
	var lastErr error
	for _, u := range rpcURLsInOrder(rpcURL) {
		out, err := abciQueryOnce(u, path, data)
		if err == nil {
			return out, nil
		}
		lastErr = err
	}
	return "", lastErr
}

// abciQueryOnce performs a single ABCI query against one RPC node. (See abciQuery
// for the wire-format notes.)
func abciQueryOnce(rpcURL, path, data string) (string, error) {
	reqBody := abciQueryRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "abci_query",
		Params:  abciQueryParams{Path: path, Data: base64.StdEncoding.EncodeToString([]byte(data))},
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(rpcURL, "application/json", strings.NewReader(string(payload)))
	if err != nil {
		return "", fmt.Errorf("rpc request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	// A dead/sentry-throttled node returns a non-200 (often 502/503/429) with a
	// non-JSON body. Detect it explicitly so failover fires deterministically
	// instead of relying on a downstream JSON parse error.
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("rpc http %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	var result abciResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse response: %w", err)
	}

	if result.Error != nil {
		return "", fmt.Errorf("rpc error: %s", result.Error.Message)
	}

	// A present ABCI ResponseBase.Error (e.g. /std.InvalidAddressError for an
	// unfunded/invalid account, or a "not found" render) means the chain has no
	// record to return — surface it as a clean empty result, not a hard error.
	if abciErrorPresent(result.Result.Response.ResponseBase.Error) {
		return "", nil
	}

	if result.Result.Response.ResponseBase.Data == "" {
		return "", nil
	}

	decoded, err := base64.StdEncoding.DecodeString(result.Result.Response.ResponseBase.Data)
	if err != nil {
		return "", fmt.Errorf("decode base64: %w", err)
	}

	return string(decoded), nil
}
```

> NOTE: `result.Error != nil` (a JSON-RPC envelope error, e.g. method-not-found) currently returns an error → this WILL now fail over. That is acceptable: an envelope error from one node is a reason to try another. The "no record" path (`abciErrorPresent`) is the only success-with-empty case and is preserved.

- [ ] **Step 8: Run to verify all abciQuery tests pass**

Run: `cd backend && go test ./internal/service/ -run TestAbciQuery_ -v`
Expected: PASS (failover, no-failover-on-empty, all-down).

- [ ] **Step 9: Full gate + commit**

Run: `cd backend && go test -race ./... && golangci-lint run`
Expected: PASS (existing render_proxy + home_rpc + marketplace tests still green — home's `queryFunc=abciQuery` now fails over transparently).

```bash
git add backend/internal/service/rpc_resilient.go backend/internal/service/rpc_resilient_test.go backend/internal/service/render_proxy.go backend/internal/service/render_proxy_failover_test.go
git commit -m "add RPC failover: try backup test13 nodes when the primary is unreachable"
```

### Task 3: Resilient home-snapshot GET path

**Files:**
- Modify: `backend/internal/service/home_rpc.go:490-544` (`fetchNetworkPulse`), `546-565` (`fetchValidatorsHealth`)
- Modify: `backend/internal/service/home_rpc_test.go` (add failover test)

**Interfaces:**
- Consumes: `httpGetJSONResilient` (Task 2).
- The `/status`, `/validators`, and `/block` GETs in the home snapshot now fail over. `fetchNetworkPulse`/`fetchValidatorsHealth` keep their `(ctx, rpcURL)` signatures — `rpcURL` is treated as the primary base.

- [ ] **Step 1: Write the failing test**

Add to `backend/internal/service/home_rpc_test.go`:

```go
func TestFetchValidatorsHealth_FailsOver(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer down.Close()
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/validators" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(`{"result":{"validators":[{},{},{}]}}`))
	}))
	defer good.Close()

	t.Setenv("RPC_FALLBACK_URLS", good.URL)

	h, err := fetchValidatorsHealth(context.Background(), down.URL)
	if err != nil {
		t.Fatalf("expected failover success, got err: %v", err)
	}
	if h.Total != 3 {
		t.Fatalf("got Total=%d, want 3 from the backup node", h.Total)
	}
}
```

(`context`, `net/http`, `net/http/httptest` are already imported by `home_rpc_test.go`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/service/ -run TestFetchValidatorsHealth_FailsOver -v`
Expected: FAIL — the down node 502s and there is no failover yet.

- [ ] **Step 3: Route the GETs through the resilient wrapper**

In `home_rpc.go`, `fetchNetworkPulse` (line ~499): replace
`if err := httpGetJSON(ctx, rpcURL+"/status", &s); err != nil {`
with
`if err := httpGetJSONResilient(ctx, rpcURL, "/status", &s); err != nil {`

`fetchNetworkPulse` (line ~529-530): replace
```go
url := fmt.Sprintf("%s/block?height=%d", rpcURL, h-n)
if bErr := httpGetJSON(ctx, url, &b); bErr != nil {
```
with
```go
blockSuffix := fmt.Sprintf("/block?height=%d", h-n)
if bErr := httpGetJSONResilient(ctx, rpcURL, blockSuffix, &b); bErr != nil {
```

`fetchValidatorsHealth` (line ~556): replace
`if err := httpGetJSON(ctx, rpcURL+"/validators", &v); err != nil {`
with
`if err := httpGetJSONResilient(ctx, rpcURL, "/validators", &v); err != nil {`

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && go test ./internal/service/ -run TestFetchValidatorsHealth_FailsOver -v`
Expected: PASS.

- [ ] **Step 5: Full gate + commit**

Run: `cd backend && go test -race ./... && golangci-lint run`
Expected: PASS.

```bash
git add backend/internal/service/home_rpc.go backend/internal/service/home_rpc_test.go
git commit -m "route home-snapshot /status,/validators,/block GETs through RPC failover"
```

### Task 4: Resilient quest verification

**Files:**
- Modify: `backend/internal/service/quest_verify.go:398-440` (split `questAbciQuery`)
- Create: `backend/internal/service/quest_verify_failover_test.go`

**Interfaces:**
- Consumes: `rpcURLsInOrder` (Task 2).
- `questAbciQuery(rpcURL, path, data) (string, error)` keeps its signature, now fails over; `questAbciQueryOnce` is the single-node attempt. Same empty-is-success invariant as `abciQuery` (a present ABCI error / empty `Data` = "requirement not met", never a failover).

- [ ] **Step 1: Write the failing test**

Create `backend/internal/service/quest_verify_failover_test.go`:

```go
package service

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestQuestAbciQuery_FailsOver(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer down.Close()
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		data := base64.StdEncoding.EncodeToString([]byte("VERIFIED"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":{"response":{"ResponseBase":{"Data":"` + data + `","Error":null}}}}`))
	}))
	defer good.Close()

	t.Setenv("RPC_FALLBACK_URLS", good.URL)

	got, err := questAbciQuery(down.URL, "vm/qrender", "gno.land/r/x:")
	if err != nil {
		t.Fatalf("expected failover success, got err: %v", err)
	}
	if got != "VERIFIED" {
		t.Fatalf("got %q, want VERIFIED from the backup node", got)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/service/ -run TestQuestAbciQuery_FailsOver -v`
Expected: FAIL — no failover; the 503 surfaces as an error.

- [ ] **Step 3: Refactor `questAbciQuery` into wrapper + once**

In `quest_verify.go`, rename the existing function body (starting line 398) to `questAbciQueryOnce`, add the same explicit non-200 guard after the `client.Post` (mirroring Task 2), and prepend the wrapper:

```go
// questAbciQuery sends a quest-verification ABCI query with automatic failover
// across rpcURLsInOrder. An empty/no-record answer is a success ("requirement
// not met") and does NOT fail over — only transport errors advance to the next
// node. Returns the last error if every node fails (mapped to
// errVerifyUnavailable by the caller → reject, don't grant).
func questAbciQuery(rpcURL, path, data string) (string, error) {
	var lastErr error
	for _, u := range rpcURLsInOrder(rpcURL) {
		out, err := questAbciQueryOnce(u, path, data)
		if err == nil {
			return out, nil
		}
		lastErr = err
	}
	return "", lastErr
}
```

Then in `questAbciQueryOnce`, immediately after the `client.Post(...)` error check (current line ~418, before `io.ReadAll`), insert:

```go
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("rpc http %d", resp.StatusCode)
	}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && go test ./internal/service/ -run TestQuestAbciQuery_FailsOver -v`
Expected: PASS.

- [ ] **Step 5: Full gate + commit**

Run: `cd backend && go test -race ./... && golangci-lint run`
Expected: PASS (existing quest_verify/quest_meta/parity tests stay green).

```bash
git add backend/internal/service/quest_verify.go backend/internal/service/quest_verify_failover_test.go
git commit -m "add RPC failover to quest verification reads"
```

### Task 5: Document `RPC_FALLBACK_URLS`

**Files:**
- Modify: `backend/.env.example` (near the `*_RPC_URL` block, ~line 18-27)

- [ ] **Step 1: Add the doc block**

Append after the `NFT_RPC_URL` block in `backend/.env.example`:

```bash
# Backup RPC nodes tried (in order) when the primary above is unreachable.
# Comma-separated; unset/empty uses the built-in trusted test13 list
# (public node, onbloc, aeddi). Set to your own well-connected nodes in prod.
# RPC_FALLBACK_URLS=https://rpc.test13.testnets.gno.land:443,https://test13.rpc.onbloc.xyz:443
```

- [ ] **Step 2: Commit**

```bash
git add backend/.env.example
git commit -m "document RPC_FALLBACK_URLS override for backend RPC failover"
```

---

## Self-Review

**1. Spec coverage (vs. master plan E8-a + E8-b tail):**
- E8-a "fallback RPC list for indexer/marketplace/home-snapshot/quest-verifier" → Tasks 2 (marketplace via abciQuery), 3 (home-snapshot), 4 (quest-verifier). Indexer explicitly logged as tracked-not-built (NFT-gated) with revisit trigger — not silently dropped.
- E8-b tail "render_proxy.go default test12→test13" + quest_verify.go:90 de-drift → Task 1.
- `RPC_FALLBACK_URLS` env override documented → Task 5.

**2. Placeholder scan:** No TBD/TODO/"add error handling". Every code step shows the full function. ✔

**3. Type consistency:** `abciQuery`/`questAbciQuery` keep `(string, string, string) (string, error)`; `abciQueryOnce`/`questAbciQueryOnce` match. `rpcURLsInOrder(string) []string`, `rpcFallbackURLs() []string`, `httpGetJSONResilient(context.Context, string, string, any) error` are referenced consistently across tasks. `fetchValidatorsHealth`/`fetchNetworkPulse` signatures unchanged. ✔

**4. Invariant guard:** The "valid empty does NOT fail over" invariant has an explicit regression test (`TestAbciQuery_ValidEmptyDoesNotFailOver`) asserting the backup is hit 0 times. This is the single most important behavior to protect. ✔

## Execution Handoff

After Tasks 1–5: open PR 1 (`fix/backend-rpc-pin-dedrift`) first (1 commit), merge on approval, then PR 2 (`feat/backend-rpc-failover`, 4 commits) off the updated main. Each gated on CI-**green**. Post-merge verification: confirm the home snapshot / render still serve on the Netlify deploy-preview (local dev can't render valoper/NFT data — verify those on the preview). A multi-perspective review pass (silent-failure-hunter + a Go reviewer) before requesting merge, per the user's audit preference.
