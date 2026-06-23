# Final review fix report — Home Phase 2 / GetHomeSnapshot

Date: 2026-06-19  
Branch: feat/home-phase2  
Working directory: /Users/zxxma/Desktop/Code/Gno/memba-home-phase2

---

## Fix 1 — bounded + validated cache map key (BLOCKER)

**File:** `backend/internal/service/home_rpc.go`

**Chain-id logic (as-built):**
```go
chainID := req.Msg.GetChainId()
// HOME-CHAINID: this is a public, unauthenticated endpoint. Collapse empty,
// unknown, or (legacy) any chain_id to the server's configured chain so the
// cache map key is bounded to the accepted set — prevents cache-busting /
// unbounded map growth, and matches spec §6 (chain_id validated vs acceptedChainIDs).
if chainID == "" || len(s.acceptedChainIDs) == 0 || !slices.Contains(s.acceptedChainIDs, chainID) {
    chainID = s.chainID
}
```

Go version in `backend/go.mod` is `go 1.25.11` — well above 1.21, so `slices.Contains` (stdlib) is used directly (no helper needed). Import added: `"slices"`.

**Net invariant:** every `homeCached` map key is in `acceptedChainIDs ∪ {s.chainID}`. An unknown chain_id is served the configured chain's snapshot (no reject) — non-breaking for the frontend.

---

## Fix 1 — bounded-map unit test result

**Test:** `TestGetHomeSnapshot_CacheKeyBounded` in `backend/internal/service/home_rpc_test.go`

Setup: `s.chainID = "test13"`, `s.acceptedChainIDs = []string{"test13"}`, offline `homeQuery` (returns error), `HOME_SNAPSHOT_RPC_URL=http://127.0.0.1:1` (connection-refused).

Calls `GetHomeSnapshot` with `chain_id: "junk-1"` then `"junk-2"`. Asserts:
- Both responses non-nil (snapshot returned even on full failure)
- `len(s.homeCached) == 1` (both collapsed to "test13" key)
- `s.homeCached["test13"]` exists (not a junk key)

```
=== RUN   TestGetHomeSnapshot_CacheKeyBounded
--- PASS: TestGetHomeSnapshot_CacheKeyBounded (0.01s)
```

`TestGetHomeSnapshot_DefaultsChainID` continues to pass.

Full suite: `go test ./internal/service/` → **ok** (11.682s), `go vet ./internal/service/` → **clean**.

---

## Fix 2 — singleflight comment

**File:** `backend/internal/service/home_rpc.go`, `cachedHomeSnapshot`, at the `assemble()` call (MISS path).

```go
// NOTE: concurrent cache misses may each call assemble — deliberate (mirrors
// HandleMarketplaceAgentsProxy pattern); bounded by the endpoint's rate limit.
// A singleflight.Group is a future option if thundering-herd becomes an issue.
fresh := assemble(ctx, homeSnapshotRPCURL()) // MISS
```

No behavior change.

---

## Fix 3 — env var documentation

**File:** `backend/.env.example`

Added before the `# NFT indexer` section:

```
# ── Home snapshot ────────────────────────────────────────────────────────────
# RPC used by GetHomeSnapshot to read on-chain counts/pulse (defaults to NFT_RPC_URL, then test13).
HOME_SNAPSHOT_RPC_URL=https://rpc.test13.testnets.gno.land:443
# Cache TTL for the assembled home snapshot (Go duration, default 30s).
HOME_SNAPSHOT_TTL=30s
```

A `backend/.env.example` file existed with documented vars; style matched.

---

## Fix 4 — spec note

**File:** `docs/planning/HOME_PHASE2_GETHOMESNAPSHOT.md` §13

Added before the "Known v1 best-effort fields" paragraph:

> **chain_id handling (closes spec §6 validation requirement):** `GetHomeSnapshot` is a public, unauthenticated endpoint. Rather than rejecting unknown or empty `chain_id` values (which would break legacy callers), an empty or unrecognised `chain_id` is collapsed to `s.chainID` — bounding every cache key to the accepted set and preventing unbounded map growth / cache-busting. An unknown chain_id is served the configured chain's snapshot, not an error.

---

## Files changed

- `backend/internal/service/home_rpc.go` — `slices` import + bounded chain_id block + singleflight comment
- `backend/internal/service/home_rpc_test.go` — `TestGetHomeSnapshot_CacheKeyBounded` test
- `backend/.env.example` — HOME_SNAPSHOT_RPC_URL + HOME_SNAPSHOT_TTL docs
- `docs/planning/HOME_PHASE2_GETHOMESNAPSHOT.md` — §13 chain_id spec note
