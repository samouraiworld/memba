# Home Phase 2 — `GetHomeSnapshot` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the home's per-visitor on-chain read fan-out with one cached backend ConnectRPC (`GetHomeSnapshot`) that assembles the home's global chain/DB data server-side, so on-chain RPC load is O(1) per cache window regardless of traffic — non-breaking, with each frontend panel falling back to its existing Phase-1 source when the endpoint is absent or errors.

**Architecture:** Add `rpc GetHomeSnapshot` + messages to `api/memba/v1/memba.proto`, regenerate Go+TS. Implement the handler in a new `backend/internal/service/home_rpc.go` with (a) an in-memory TTL cache lifted onto the `MultisigService` struct mirroring `HandleMarketplaceAgentsProxy`'s serve-stale-on-error semantics, and (b) `assembleHomeSnapshot` whose every source is wrapped so a single failure degrades that field only (appended to `stale_sources`) and never aborts the snapshot. On the frontend, add `homeApi.ts` + `useHomeSnapshot`, then make each Phase-1 home hook snapshot-first internally (gate its on-chain query with `enabled: !snapshotUsable`) so panels are untouched and the fan-out actually collapses.

**Tech Stack:** Go 1.x + ConnectRPC + `database/sql`/`modernc.org/sqlite` (backend), buf (codegen), Vite + React + TypeScript + `@connectrpc/connect` + TanStack Query + Vitest (frontend).

## Global Constraints

- **Commits:** NO Claude/Anthropic attribution of any kind (no `Co-Authored-By`, no "Generated with" footer). Commit messages: one concise line focused on the *why*. Never push without explicit user approval. All work on branch `feat/home-phase2` (already created off `feat/home-rework`, in worktree `/Users/zxxma/Desktop/Code/Gno/memba-home-phase2`).
- **Non-breaking / additive:** every frontend change must leave the home fully functional when the endpoint is undeployed or errors — Phase-1 per-source hooks remain the fallback. No flag-day.
- **Chain target = test13.** The home shows test13 data. Do **not** use `gnoRPCURL()` (defaults to testnet12). Use a dedicated `homeSnapshotRPCURL()` helper defaulting to the test13 RPC (`https://rpc.test13.testnets.gno.land:443`), overridable via `HOME_SNAPSHOT_RPC_URL`, falling back to `NFT_RPC_URL` then the default.
- **`daos` is OUT of the snapshot** — stays a client-side `fetchTractionMetrics` (gnoweb namespace) call, same class as Gnolove.
- **Personalized/authed data is OUT** — `GetHomeSnapshot` is an unauthenticated public read carrying only global data.
- **Proto conventions:** `snake_case` fields; `uint32` for small counts, `uint64` for ugnot; timestamps are RFC3339 `string` (never `google.protobuf.Timestamp`); nested-message fields are optional in generated TS; annotate the request's identifying field `// no auth required — public read`.
- **TDD:** every code task = failing test → run-it-fails → minimal impl → run-it-passes → commit. On-chain-parsing tasks are fixture-driven: capture a real live test13 response, pin it as a test fixture, then write the parser against it. Never invent a wire format.
- **Fault tolerance:** each source in `assembleHomeSnapshot` is independently wrapped; one source failing populates `stale_sources` and leaves its field zero/empty; the call never fails wholesale.

---

## File Structure

**Backend (new + modified):**
- `api/memba/v1/memba.proto` — *modify*: add `rpc GetHomeSnapshot` + `GetHomeSnapshotRequest`/`GetHomeSnapshotResponse`/`HomeSnapshot`/`NetworkPulse`/`EcosystemCounts`/`FeaturedDao`/`ValidatorsHealth`/`DirectoryMember`.
- `backend/gen/memba/v1/...` — *generated* by `make proto-gen` (do not hand-edit; commit whatever it emits).
- `backend/internal/service/home_rpc.go` — *new*: the `GetHomeSnapshot` handler, the struct-field cache accessors, `assembleHomeSnapshot`, the per-source functions, the injectable query seam, and a local `httpGetJSON` helper.
- `backend/internal/service/home_rpc_test.go` — *new*: unit tests for assembly fault-tolerance, cache HIT/MISS/STALE, chain_id defaulting, and each source parser (fixture-driven).
- `backend/internal/service/testdata/home/*.json|*.txt` — *new*: pinned real test13 response fixtures (one per on-chain source).
- `backend/internal/service/service.go` — *modify*: add cache fields to `MultisigService` + initialize in `NewMultisigService`.

**Frontend (new + modified):**
- `frontend/src/lib/homeApi.ts` — *new*: `fetchHomeSnapshot(chainId)` thin wrapper over `api.getHomeSnapshot`, returns `null` on error (mirror `nftApi.ts`).
- `frontend/src/hooks/home/useHomeSnapshot.ts` — *new*: react-query hook, gated to the snapshot network.
- `frontend/src/lib/homeApi.test.ts`, `frontend/src/hooks/home/useHomeSnapshot.test.ts` — *new*.
- `frontend/src/hooks/home/useNetworkPulse.ts` — *modify*: snapshot-first.
- `frontend/src/hooks/home/useEcosystemCounts.ts` — *modify*: snapshot-first (tokens/agents/validators/collections); `daos` stays client-side.
- `frontend/src/hooks/home/useValidatorHealth.ts` — *modify*: snapshot-first.
- `frontend/src/hooks/home/useDirectoryHighlights.ts` — *modify*: members preview snapshot-first; `memberCount` stays client-side (traction).
- `frontend/src/components/home/panels/FeaturedDaoPanel.tsx` — *modify*: inline `useFeaturedDao` becomes snapshot-first.
- Corresponding `*.test.ts(x)` — *modify*: add snapshot-present + fallback cases.
- `frontend/src/lib/config.ts` — *modify if needed*: export `SNAPSHOT_NETWORK` (the network key the backend snapshot represents, `"test13"`).

---

## Phase A — Proto + codegen

### Task A1: Add the `GetHomeSnapshot` RPC and messages to the proto

**Files:**
- Modify: `api/memba/v1/memba.proto` (service block ends at the `}` after `ListNFTTokens`, ~line 62; messages appended after the NFT message group)

**Interfaces:**
- Produces (Go, package alias `v1`/`membav1`): `v1.GetHomeSnapshotRequest{ChainId string}`, `v1.GetHomeSnapshotResponse{Snapshot *v1.HomeSnapshot}`, `v1.HomeSnapshot{Network *NetworkPulse, Counts *EcosystemCounts, FeaturedDao *FeaturedDao, ValidatorsHealth *ValidatorsHealth, DirectoryMembers []*DirectoryMember, AsOfBlock int64, IndexerLastBlock int64, GeneratedAt string, StaleSources []string}`, and nested `NetworkPulse{BlockHeight int64, AvgBlockTimeMs int64, ValidatorsTotal uint32}`, `EcosystemCounts{Tokens, Collections, Agents, Validators uint32}`, `FeaturedDao{RealmPath, Name string, Members uint32, TreasuryUgnot uint64, OpenProposals uint32, LatestProposalTitle string}`, `ValidatorsHealth{Status string, Active, Total uint32}`, `DirectoryMember{Name, Address, AvatarUrl string}`.
- Produces (TS, from `../gen/memba/v1/memba_pb`): `GetHomeSnapshotResponse`, `HomeSnapshot`, `NetworkPulse`, `EcosystemCounts`, `FeaturedDao`, `ValidatorsHealth`, `DirectoryMember`; client method `api.getHomeSnapshot({ chainId })`.

- [ ] **Step 1: Add the rpc line to the `MultisigService` block.** Insert immediately before the closing `}` of `service MultisigService` (after the `ListNFTTokens` line):

```proto
  // Home — aggregated dashboard snapshot (public read, server-cached)
  rpc GetHomeSnapshot(GetHomeSnapshotRequest) returns (GetHomeSnapshotResponse);
```

- [ ] **Step 2: Append the messages** at the end of the file (after the existing NFT messages):

```proto
// --- Home Snapshot Messages ---

// NetworkPulse is the chain liveness summary.
message NetworkPulse {
  int64 block_height = 1; // 0 = unknown
  int64 avg_block_time_ms = 2; // 0 = unknown / not computed in v1
  uint32 validators_total = 3;
}

// EcosystemCounts are the per-feature live counts that feed the Ecosystem tiles.
// NOTE: `daos` is intentionally absent — it is sourced client-side from the
// gnoweb namespace (same class as gnolove), not from the on-chain stampede.
message EcosystemCounts {
  uint32 tokens = 1; // 0 = unknown / source failed
  uint32 collections = 2;
  uint32 agents = 3;
  uint32 validators = 4;
}

// FeaturedDao is the configured headline DAO's summary state.
message FeaturedDao {
  string realm_path = 1;
  string name = 2;
  uint32 members = 3;
  uint64 treasury_ugnot = 4; // 0 = unknown (best-effort bank query)
  uint32 open_proposals = 5;
  string latest_proposal_title = 6;
}

// ValidatorsHealth is the cheap network-health subset (no per-validator signatures).
message ValidatorsHealth {
  string status = 1; // "healthy" | "degraded" | "down"
  uint32 active = 2;
  uint32 total = 3;
}

// DirectoryMember is one on-chain users-registry entry (preview).
message DirectoryMember {
  string name = 1;
  string address = 2;
  string avatar_url = 3;
}

// HomeSnapshot is the assembled global home payload. Every field tolerates its
// source failing (zero/empty + listed in stale_sources); the call never fails wholesale.
message HomeSnapshot {
  NetworkPulse network = 1;
  EcosystemCounts counts = 2;
  FeaturedDao featured_dao = 3;
  ValidatorsHealth validators_health = 4;
  repeated DirectoryMember directory_members = 5;
  int64 as_of_block = 6;
  int64 indexer_last_block = 7; // max(last_processed_block) across indexed realms
  string generated_at = 8; // RFC3339
  repeated string stale_sources = 9; // names of sources that failed this assembly
}

message GetHomeSnapshotRequest {
  string chain_id = 1; // no auth required — public read
}

message GetHomeSnapshotResponse {
  HomeSnapshot snapshot = 1;
}
```

- [ ] **Step 3: Lint the proto.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 && make proto-lint`
Expected: PASS (no lint errors). If it flags the new messages, fix field ordering/naming to satisfy `STANDARD` and re-run.

- [ ] **Step 4: Commit.**

```bash
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 add api/memba/v1/memba.proto
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 commit -m "proto: add GetHomeSnapshot RPC + HomeSnapshot messages"
```

### Task A2: Regenerate Go + TS bindings

**Files:**
- Generated: `backend/gen/memba/v1/memba.pb.go`, `backend/gen/memba/v1/membav1connect/memba.connect.go`, `frontend/src/gen/memba/v1/memba_pb.ts` (+ possibly `memba_connect.ts`).

- [ ] **Step 1: Run codegen.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 && make proto-gen`
Expected: regenerates with no errors; `git status` shows modified files under `backend/gen/` and `frontend/src/gen/`. (Note: the stale `frontend/src/gen/memba/v1/memba_connect.ts` may also change or be removed — that is expected; commit whatever is emitted.)

- [ ] **Step 2: Verify the new symbols exist.**

Run: `grep -rn "GetHomeSnapshot" /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend/gen /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/frontend/src/gen`
Expected: hits in `memba.pb.go` (messages), `memba.connect.go` (`MultisigServiceHandler.GetHomeSnapshot`, `MultisigServiceGetHomeSnapshotProcedure`, handler wiring inside `NewMultisigServiceHandler`), and `memba_pb.ts` (the `getHomeSnapshot` entry in the `MultisigService` `GenService` descriptor + the response/message types).

- [ ] **Step 3: Confirm the backend still compiles (interface now requires the method — expect a failure that names it).**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go build ./...`
Expected: FAIL with an error indicating `*MultisigService` does not implement `MultisigServiceHandler` (missing method `GetHomeSnapshot`). This confirms the interface picked up the new method; Task B/D will add the implementation. (If it unexpectedly passes, the concrete service may use `UnimplementedMultisigServiceHandler` embedding — verify and proceed.)

- [ ] **Step 4: Commit the generated code.**

```bash
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 add backend/gen frontend/src/gen
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 commit -m "proto: regenerate Go+TS bindings for GetHomeSnapshot"
```

---

## Phase B — Backend skeleton: struct cache + query seam + handler stub

This phase makes the build pass with a minimal handler and the cache+seam scaffolding, all unit-tested, before any real on-chain source is wired.

### Task B1: Add the snapshot cache fields to `MultisigService` and the RPC-URL/TTL helpers

**Files:**
- Modify: `backend/internal/service/service.go:19` (struct) and `:57`–`:94` (`NewMultisigService`)
- Create: `backend/internal/service/home_rpc.go`

**Interfaces:**
- Produces: `homeSnapshotRPCURL() string`; `homeSnapshotTTL() time.Duration`; struct fields `homeCacheMu sync.RWMutex`, `homeCached map[string]*membav1.HomeSnapshot`, `homeCachedAt map[string]time.Time`, `homeQuery queryFunc`; type `queryFunc func(rpcURL, path, data string) (string, error)`.

- [ ] **Step 1: Write the failing test** for the env helpers. Create `backend/internal/service/home_rpc_test.go`:

```go
package service

import (
	"os"
	"testing"
	"time"
)

func TestHomeSnapshotRPCURL_DefaultsToTest13(t *testing.T) {
	os.Unsetenv("HOME_SNAPSHOT_RPC_URL")
	os.Unsetenv("NFT_RPC_URL")
	if got := homeSnapshotRPCURL(); got != "https://rpc.test13.testnets.gno.land:443" {
		t.Fatalf("default = %q, want test13 rpc", got)
	}
}

func TestHomeSnapshotRPCURL_PrefersExplicitEnv(t *testing.T) {
	os.Setenv("HOME_SNAPSHOT_RPC_URL", "https://example/rpc")
	defer os.Unsetenv("HOME_SNAPSHOT_RPC_URL")
	if got := homeSnapshotRPCURL(); got != "https://example/rpc" {
		t.Fatalf("got %q, want explicit env", got)
	}
}

func TestHomeSnapshotTTL_Default(t *testing.T) {
	os.Unsetenv("HOME_SNAPSHOT_TTL")
	if got := homeSnapshotTTL(); got != 30*time.Second {
		t.Fatalf("default ttl = %v, want 30s", got)
	}
}
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go test ./internal/service/ -run TestHomeSnapshot -v`
Expected: FAIL — `undefined: homeSnapshotRPCURL` / `homeSnapshotTTL`.

- [ ] **Step 3: Create `home_rpc.go` with the helpers and the seam type.** New file `backend/internal/service/home_rpc.go`:

```go
package service

import (
	"os"
	"time"
)

// queryFunc is the injectable seam over abciQuery so assembleHomeSnapshot is
// unit-testable without a live chain. Defaults to the package-level abciQuery.
type queryFunc func(rpcURL, path, data string) (string, error)

// homeSnapshotRPCURL returns the RPC the home snapshot reads (test13 by default).
// IMPORTANT: do not use gnoRPCURL() here — it defaults to testnet12.
func homeSnapshotRPCURL() string {
	if v := os.Getenv("HOME_SNAPSHOT_RPC_URL"); v != "" {
		return v
	}
	if v := os.Getenv("NFT_RPC_URL"); v != "" {
		return v
	}
	return "https://rpc.test13.testnets.gno.land:443"
}

// homeSnapshotTTL is the cache window (default 30s, env HOME_SNAPSHOT_TTL as a Go duration).
func homeSnapshotTTL() time.Duration {
	if v := os.Getenv("HOME_SNAPSHOT_TTL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return 30 * time.Second
}
```

- [ ] **Step 4: Run to verify the helper tests pass.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go test ./internal/service/ -run TestHomeSnapshot -v`
Expected: PASS.

- [ ] **Step 5: Add cache fields to the struct and init them in the constructor.** In `service.go`, add to the `MultisigService` struct (after `acceptedChainIDs []string`):

```go
	// Home snapshot cache (Phase 2) — single entry per chain_id, in-memory,
	// serve-stale-on-error. See home_rpc.go.
	homeCacheMu  sync.RWMutex
	homeCached   map[string]*membav1.HomeSnapshot
	homeCachedAt map[string]time.Time
	homeQuery    queryFunc
```

In `NewMultisigService`, in the returned `&MultisigService{...}` literal, add:

```go
		homeCached:   make(map[string]*membav1.HomeSnapshot),
		homeCachedAt: make(map[string]time.Time),
		homeQuery:    abciQuery,
```

Ensure `service.go` imports `sync`, `time`, and the generated package (already imported as `membav1` — verify the existing import alias; if the file imports it under a different alias, use that). If `sync`/`time` are not yet imported, add them.

- [ ] **Step 6: Run to verify the package still builds (handler still missing — that's fine for now).**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go vet ./internal/service/ 2>&1 | head -20`
Expected: no errors about the new fields (the missing-method build error from A2 may still appear at the `cmd` layer — that is expected until B2).

- [ ] **Step 7: Commit.**

```bash
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 add backend/internal/service/service.go backend/internal/service/home_rpc.go backend/internal/service/home_rpc_test.go
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 commit -m "backend: home snapshot cache fields + rpc-url/ttl/query seam"
```

### Task B2: Implement the cached `GetHomeSnapshot` handler over a pluggable assembler

This wires the handler + cache so the build passes and HIT/MISS/STALE is tested, using a trivial assembler injected in tests. The real assembler is filled in Phase C.

**Files:**
- Modify: `backend/internal/service/home_rpc.go`
- Modify: `backend/internal/service/home_rpc_test.go`

**Interfaces:**
- Consumes: the struct fields from B1; `internalError` (`service.go:114`), `connect`, `membav1`.
- Produces: `func (s *MultisigService) GetHomeSnapshot(ctx context.Context, req *connect.Request[membav1.GetHomeSnapshotRequest]) (*connect.Response[membav1.GetHomeSnapshotResponse], error)`; internal `func (s *MultisigService) cachedHomeSnapshot(ctx context.Context, chainID string, assemble func(context.Context, string) *membav1.HomeSnapshot) *membav1.HomeSnapshot`.

- [ ] **Step 1: Write the failing cache test.** Add to `home_rpc_test.go`:

```go
func TestCachedHomeSnapshot_MissThenHitThenStale(t *testing.T) {
	s := &MultisigService{
		homeCached:   make(map[string]*membav1.HomeSnapshot),
		homeCachedAt: make(map[string]time.Time),
	}
	calls := 0
	ok := func(ctx context.Context, rpc string) *membav1.HomeSnapshot {
		calls++
		return &membav1.HomeSnapshot{AsOfBlock: int64(calls)}
	}

	// MISS — assembles, caches.
	got := s.cachedHomeSnapshot(context.Background(), "test13", ok)
	if got.AsOfBlock != 1 || calls != 1 {
		t.Fatalf("miss: got block=%d calls=%d", got.AsOfBlock, calls)
	}
	// HIT — within TTL, no re-assembly.
	got = s.cachedHomeSnapshot(context.Background(), "test13", ok)
	if got.AsOfBlock != 1 || calls != 1 {
		t.Fatalf("hit: got block=%d calls=%d", got.AsOfBlock, calls)
	}
	// Force expiry, then a failing assemble → serve stale.
	s.homeCacheMu.Lock()
	s.homeCachedAt["test13"] = time.Now().Add(-time.Hour)
	s.homeCacheMu.Unlock()
	fail := func(ctx context.Context, rpc string) *membav1.HomeSnapshot { calls++; return nil }
	got = s.cachedHomeSnapshot(context.Background(), "test13", fail)
	if got == nil || got.AsOfBlock != 1 {
		t.Fatalf("stale: expected last-good block=1, got %+v", got)
	}
}
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go test ./internal/service/ -run TestCachedHomeSnapshot -v`
Expected: FAIL — `s.cachedHomeSnapshot undefined`.

- [ ] **Step 3: Implement the cache accessor + handler.** Add to `home_rpc.go` (and add imports `context`, `log/slog`, `connectrpc.com/connect`, the generated pkg alias `membav1`, `time`):

```go
// cachedHomeSnapshot returns a fresh snapshot from cache, re-assembles on
// expiry, and serves the last-good value if re-assembly returns nil (stale).
func (s *MultisigService) cachedHomeSnapshot(
	ctx context.Context,
	chainID string,
	assemble func(context.Context, string) *membav1.HomeSnapshot,
) *membav1.HomeSnapshot {
	ttl := homeSnapshotTTL()

	s.homeCacheMu.RLock()
	cached, ok := s.homeCached[chainID]
	at := s.homeCachedAt[chainID]
	s.homeCacheMu.RUnlock()
	if ok && cached != nil && time.Since(at) < ttl {
		return cached // HIT
	}

	fresh := assemble(ctx, homeSnapshotRPCURL()) // MISS
	if fresh == nil {
		// Serve stale if we have any prior value.
		s.homeCacheMu.RLock()
		stale := s.homeCached[chainID]
		s.homeCacheMu.RUnlock()
		if stale != nil {
			slog.Warn("home snapshot assemble failed; serving stale", "chain_id", chainID)
			return stale
		}
		return nil
	}

	s.homeCacheMu.Lock()
	s.homeCached[chainID] = fresh
	s.homeCachedAt[chainID] = time.Now()
	s.homeCacheMu.Unlock()
	return fresh
}

// GetHomeSnapshot returns the cached, server-assembled global home payload.
// Public read (no auth). chain_id defaults to the server's configured chain.
func (s *MultisigService) GetHomeSnapshot(
	ctx context.Context,
	req *connect.Request[membav1.GetHomeSnapshotRequest],
) (*connect.Response[membav1.GetHomeSnapshotResponse], error) {
	chainID := req.Msg.GetChainId()
	if chainID == "" {
		chainID = s.chainID
	}

	snap := s.cachedHomeSnapshot(ctx, chainID, s.assembleHomeSnapshot)
	if snap == nil {
		// No cache and assembly produced nothing — return an empty snapshot
		// (non-breaking: the frontend treats this as "use Phase-1 fallback").
		snap = &membav1.HomeSnapshot{StaleSources: []string{"all"}}
	}
	return connect.NewResponse(&membav1.GetHomeSnapshotResponse{Snapshot: snap}), nil
}
```

- [ ] **Step 4: Add a temporary stub `assembleHomeSnapshot`** so the package builds (Phase C replaces the body). Add to `home_rpc.go`:

```go
// assembleHomeSnapshot builds the global snapshot from chain + DB sources.
// Each source is independently fault-tolerant (see Phase C). Returns a non-nil
// snapshot even when sources fail (their names go in stale_sources).
func (s *MultisigService) assembleHomeSnapshot(ctx context.Context, rpcURL string) *membav1.HomeSnapshot {
	return &membav1.HomeSnapshot{GeneratedAt: time.Now().UTC().Format(time.RFC3339)}
}
```

- [ ] **Step 5: Run the cache test + full package build.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go test ./internal/service/ -run TestCachedHomeSnapshot -v && go build ./...`
Expected: cache test PASS; `go build ./...` now PASSES (the `MultisigServiceHandler` interface is satisfied).

- [ ] **Step 6: Commit.**

```bash
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 add backend/internal/service/home_rpc.go backend/internal/service/home_rpc_test.go
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 commit -m "backend: cached GetHomeSnapshot handler over pluggable assembler"
```

---

## Phase C — Backend sources (fixture-driven, fault-tolerant)

Each task adds one source function, captures a real test13 response as a fixture, TDD's the parser against the fixture, and wires the source into `assembleHomeSnapshot` behind fault tolerance. **General rule for every source function:** signature `func (s *MultisigService) <source>(ctx context.Context, rpcURL string) (<typed result>, error)`; on-chain ones take the query via `s.homeQuery` (the seam) so tests inject a fake. In `assembleHomeSnapshot`, each call is wrapped:

```go
if v, err := s.sourceX(ctx, rpcURL); err != nil {
	snap.StaleSources = append(snap.StaleSources, "sourceX")
} else {
	// assign v into snap...
}
```

### Task C1: DB counts — collections + active service listings + indexer height

This is the cheap, deterministic, fully-unit-testable source (no chain). Use an in-memory sqlite DB seeded via the existing migrations.

**Files:**
- Modify: `backend/internal/service/home_rpc.go`, `backend/internal/service/home_rpc_test.go`

**Interfaces:**
- Consumes: `s.db` (`*sql.DB`).
- Produces: `func (s *MultisigService) countCollections(ctx context.Context) (uint32, error)`; `func (s *MultisigService) maxIndexerBlock(ctx context.Context) (int64, error)`.

- [ ] **Step 1: Write the failing test** using a migrated in-memory DB. Add to `home_rpc_test.go` (mirror how existing service tests open a DB — check `quest_rpc_test.go`/`nft_rpc_test.go` for the exact `db.Open`/`db.Migrate` test helper and reuse it verbatim):

```go
func TestCountCollections(t *testing.T) {
	s := newTestService(t) // reuse the existing test helper that opens+migrates an in-memory DB
	_, err := s.db.Exec(`INSERT INTO nft_collections (collection_id, name) VALUES ('a','A'),('b','B')`)
	if err != nil { t.Fatal(err) }
	n, err := s.countCollections(context.Background())
	if err != nil || n != 2 {
		t.Fatalf("got n=%d err=%v, want 2", n, err)
	}
}

func TestMaxIndexerBlock(t *testing.T) {
	s := newTestService(t)
	_, err := s.db.Exec(`INSERT INTO nft_indexer_state (realm_path, last_processed_block) VALUES ('r1', 100), ('r2', 250)`)
	if err != nil { t.Fatal(err) }
	b, err := s.maxIndexerBlock(context.Background())
	if err != nil || b != 250 {
		t.Fatalf("got b=%d err=%v, want 250", b, err)
	}
}
```

> If no `newTestService(t)` helper exists, create one in `home_rpc_test.go` that opens `db.Open(":memory:")` (or the project's existing test DB path pattern), runs `db.Migrate`, and returns `&MultisigService{db: d, homeCached: ..., homeCachedAt: ..., homeQuery: abciQuery}`. Copy the open+migrate lines verbatim from an existing `*_rpc_test.go`.

- [ ] **Step 2: Run to verify it fails.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go test ./internal/service/ -run 'TestCountCollections|TestMaxIndexerBlock' -v`
Expected: FAIL — undefined methods.

- [ ] **Step 3: Implement.** Add to `home_rpc.go`:

```go
func (s *MultisigService) countCollections(ctx context.Context) (uint32, error) {
	var n uint32
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM nft_collections`).Scan(&n)
	return n, err
}

func (s *MultisigService) maxIndexerBlock(ctx context.Context) (int64, error) {
	var b sql.NullInt64
	err := s.db.QueryRowContext(ctx, `SELECT MAX(last_processed_block) FROM nft_indexer_state`).Scan(&b)
	if err != nil {
		return 0, err
	}
	return b.Int64, nil
}
```

(Add `database/sql` to imports if not present.)

- [ ] **Step 4: Run to verify pass.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go test ./internal/service/ -run 'TestCountCollections|TestMaxIndexerBlock' -v`
Expected: PASS.

- [ ] **Step 5: Wire into `assembleHomeSnapshot`** (replace the stub body incrementally). Set `snap.Counts` (create if nil) `.Collections` and `snap.IndexerLastBlock`, each behind the fault-tolerance wrapper (source names `"collections"`, `"indexer_block"`). Keep `GeneratedAt`. Re-run the cache test to confirm no regression.

- [ ] **Step 6: Commit.**

```bash
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 add backend/internal/service/home_rpc.go backend/internal/service/home_rpc_test.go
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 commit -m "backend: home snapshot DB sources (collections count, indexer height)"
```

### Task C2: Network pulse + validators health (RPC `/status` + `/validators`)

**Files:**
- Modify: `backend/internal/service/home_rpc.go`, `backend/internal/service/home_rpc_test.go`
- Create: `backend/internal/service/testdata/home/status.json`, `backend/internal/service/testdata/home/validators.json`

**Interfaces:**
- Produces: `func httpGetJSON(ctx context.Context, url string, out any) error` (local replica of the indexer's unexported `httpGet`); `func fetchNetworkPulse(ctx context.Context, rpcURL string) (*membav1.NetworkPulse, error)`; `func fetchValidatorsHealth(ctx context.Context, rpcURL string) (*membav1.ValidatorsHealth, error)`.

- [ ] **Step 1: Capture real fixtures from live test13.**

Run:
```bash
mkdir -p /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend/internal/service/testdata/home
curl -s https://rpc.test13.testnets.gno.land:443/status -o /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend/internal/service/testdata/home/status.json
curl -s https://rpc.test13.testnets.gno.land:443/validators -o /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend/internal/service/testdata/home/validators.json
```
Expected: both files contain JSON with a top-level `result`. Inspect them: confirm `result.sync_info.latest_block_height` (string) in status.json, and the validator-set array shape in validators.json (likely `result.validators` — confirm the actual key and count). **Derive the parse structs from these real files.**

- [ ] **Step 2: Write failing tests** that parse the captured fixtures via the parser functions (serve the fixture over an `httptest.Server` so the real fetch path is exercised). Add to `home_rpc_test.go`:

```go
func TestFetchNetworkPulse_FromFixture(t *testing.T) {
	body, err := os.ReadFile("testdata/home/status.json")
	if err != nil { t.Fatal(err) }
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" { w.Write(body); return }
		w.WriteHeader(404)
	}))
	defer srv.Close()
	p, err := fetchNetworkPulse(context.Background(), srv.URL)
	if err != nil { t.Fatal(err) }
	if p.BlockHeight <= 0 {
		t.Fatalf("block height not parsed: %d", p.BlockHeight)
	}
}

func TestFetchValidatorsHealth_FromFixture(t *testing.T) {
	body, err := os.ReadFile("testdata/home/validators.json")
	if err != nil { t.Fatal(err) }
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/validators" { w.Write(body); return }
		w.WriteHeader(404)
	}))
	defer srv.Close()
	v, err := fetchValidatorsHealth(context.Background(), srv.URL)
	if err != nil { t.Fatal(err) }
	if v.Total == 0 || v.Status == "" {
		t.Fatalf("validators not parsed: %+v", v)
	}
}
```

(Add imports `net/http`, `net/http/httptest`, `os`.)

- [ ] **Step 3: Run to verify it fails.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go test ./internal/service/ -run 'FetchNetworkPulse|FetchValidatorsHealth' -v`
Expected: FAIL — undefined functions.

- [ ] **Step 4: Implement** `httpGetJSON`, `fetchNetworkPulse`, `fetchValidatorsHealth` in `home_rpc.go`, with structs matching the captured fixtures. Skeleton (adjust struct fields to the real `validators.json` shape captured in Step 1):

```go
func httpGetJSON(ctx context.Context, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil { return err }
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil { return err }
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK { return fmt.Errorf("http %d", resp.StatusCode) }
	body, err := io.ReadAll(resp.Body)
	if err != nil { return err }
	return json.Unmarshal(body, out)
}

func fetchNetworkPulse(ctx context.Context, rpcURL string) (*membav1.NetworkPulse, error) {
	var s struct {
		Result struct {
			SyncInfo struct {
				LatestBlockHeight string `json:"latest_block_height"`
			} `json:"sync_info"`
		} `json:"result"`
	}
	if err := httpGetJSON(ctx, rpcURL+"/status", &s); err != nil { return nil, err }
	h, err := strconv.ParseInt(s.Result.SyncInfo.LatestBlockHeight, 10, 64)
	if err != nil { return nil, fmt.Errorf("parse height: %w", err) }
	return &membav1.NetworkPulse{BlockHeight: h}, nil
}

func fetchValidatorsHealth(ctx context.Context, rpcURL string) (*membav1.ValidatorsHealth, error) {
	var v struct {
		Result struct {
			Validators []json.RawMessage `json:"validators"` // confirm key from fixture
		} `json:"result"`
	}
	if err := httpGetJSON(ctx, rpcURL+"/validators", &v); err != nil { return nil, err }
	total := uint32(len(v.Result.Validators))
	status := "healthy"
	if total == 0 { status = "down" }
	return &membav1.ValidatorsHealth{Status: status, Active: total, Total: total}, nil
}
```

(Add imports `encoding/json`, `fmt`, `io`, `strconv`.)

- [ ] **Step 5: Run to verify pass.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go test ./internal/service/ -run 'FetchNetworkPulse|FetchValidatorsHealth' -v`
Expected: PASS.

- [ ] **Step 6: Wire into `assembleHomeSnapshot`** — set `snap.Network`, `snap.AsOfBlock = snap.Network.BlockHeight`, `snap.ValidatorsHealth`, and `snap.Counts.Validators = snap.ValidatorsHealth.Total`, each behind the fault wrapper (`"network"`, `"validators"`). Re-run the full service test package.

- [ ] **Step 7: Commit.**

```bash
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 add backend/internal/service/home_rpc.go backend/internal/service/home_rpc_test.go backend/internal/service/testdata/home/status.json backend/internal/service/testdata/home/validators.json
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 commit -m "backend: home snapshot network pulse + validators health (/status, /validators)"
```

### Task C3: On-chain counts — tokens + agents (vm/qrender via the seam)

**Files:**
- Modify: `backend/internal/service/home_rpc.go`, `backend/internal/service/home_rpc_test.go`
- Create: `backend/internal/service/testdata/home/tokens_render.txt`, `backend/internal/service/testdata/home/agents_render.txt`

**Interfaces:**
- Consumes: `s.homeQuery` (the seam); the realm paths — tokenfactory + agent registry. Find the exact paths the frontend uses: agent registry via `AGENT_REGISTRY_REALM` (default `gno.land/r/samcrew/agent_registry`, per `analyst.go`); tokenfactory via the frontend `lib/grc20`/`lib/config` (`getTokenFactoryPath()`-equivalent) — read `frontend/src/lib/config.ts` for the test13 tokenfactory path and reuse the literal.
- Produces: `func (s *MultisigService) countTokens(ctx context.Context, rpcURL string) (uint32, error)`; `func (s *MultisigService) countAgents(ctx context.Context, rpcURL string) (uint32, error)`.

- [ ] **Step 1: Capture real render fixtures.** Determine the exact `data` encoding empirically — try the plain newline form first (what `abciQuery` sends today), and if test13 returns an error, try base64 (per the wire-format note). Record whichever WORKS:

```bash
# Example (tokenfactory listing render). Replace <tokenfactory_path> with the real test13 path.
curl -s -X POST https://rpc.test13.testnets.gno.land:443 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"abci_query","params":{"path":"vm/qrender","data":"<tokenfactory_path>\n"}}' \
  -o /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend/internal/service/testdata/home/tokens_render_raw.json
```
Inspect the response. If `result.response.ResponseBase.Error` is non-empty (encoding rejected), retry with base64-encoded `data`. **Record the decoded render text** (the base64-decoded `Data`) into `tokens_render.txt`, and likewise for the agent registry into `agents_render.txt`. Document in a comment which encoding worked — this resolves the abciQuery/base64 uncertainty empirically. If neither works for a source, mark that source best-effort (it will simply land in `stale_sources` in prod and the frontend falls back).

- [ ] **Step 2: Write failing parser tests** against the captured decoded render text. The count parser depends on the actual render format (list of token/agent entries). Inspect the fixture, then assert the count your parser extracts matches the visible number of entries:

```go
func TestCountTokens_FromFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/home/tokens_render.txt")
	if err != nil { t.Fatal(err) }
	s := &MultisigService{homeQuery: func(rpc, path, data string) (string, error) { return string(raw), nil }}
	n, err := s.countTokens(context.Background(), "ignored")
	if err != nil { t.Fatal(err) }
	if n != /* observed count in fixture */ 0 {
		t.Fatalf("token count = %d", n)
	}
}
```

(Replace the expected count with the real number observed in the fixture. Write the analogous `TestCountAgents_FromFixture`.)

- [ ] **Step 3: Run to verify it fails.** (undefined methods)

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go test ./internal/service/ -run 'CountTokens|CountAgents' -v`

- [ ] **Step 4: Implement** `countTokens`/`countAgents` using `s.homeQuery(rpcURL, "vm/qrender", path+"\n")` (or the base64 form proven in Step 1) and a parser derived from the fixture's actual structure. Prefer a `vm/qeval` count expression if the realm exposes one (e.g. a `Count()`/`Len()` exported fn — check the render output / realm docs); only fall back to counting rendered entries if no count fn exists. Keep the parser small and tolerant (return `0, err` on malformed input rather than panicking).

- [ ] **Step 5: Run to verify pass.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go test ./internal/service/ -run 'CountTokens|CountAgents' -v`
Expected: PASS.

- [ ] **Step 6: Wire into `assembleHomeSnapshot`** — `snap.Counts.Tokens`, `snap.Counts.Agents`, behind fault wrappers (`"tokens"`, `"agents"`). Re-run the full service package.

- [ ] **Step 7: Commit.**

```bash
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 add backend/internal/service/home_rpc.go backend/internal/service/home_rpc_test.go backend/internal/service/testdata/home/
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 commit -m "backend: home snapshot on-chain counts (tokens, agents)"
```

### Task C4: Featured DAO + directory members (vm/qrender via the seam)

**Files:**
- Modify: `backend/internal/service/home_rpc.go`, `backend/internal/service/home_rpc_test.go`
- Create: `backend/internal/service/testdata/home/featured_dao_render.txt`, `backend/internal/service/testdata/home/registry_render.txt`

**Interfaces:**
- Consumes: `s.homeQuery`; the featured-DAO realm (frontend `getFeaturedDaoRealm("test13")` in `lib/config.ts` — reuse the literal); the users-registry realm (frontend `getUserRegistryPath()` in `lib/config.ts`).
- Produces: `func (s *MultisigService) fetchFeaturedDao(ctx context.Context, rpcURL string) (*membav1.FeaturedDao, error)`; `func (s *MultisigService) fetchDirectoryMembers(ctx context.Context, rpcURL string, limit int) ([]*membav1.DirectoryMember, error)`.

- [ ] **Step 1: Capture fixtures.** `vm/qrender` the featured-DAO realm and the users-registry realm (same encoding proven in C3). Save decoded render text to the two fixture files. For the directory registry, the frontend parser is `parseUserRegistry` (`frontend/src/lib/directory.ts`) — read it to mirror the field extraction (name/address/avatar) in Go. For the featured DAO, the frontend uses `getDAOConfig` + `getDAOProposals` (`frontend/src/lib/dao`) — read those parsers to mirror name/memberCount/open-proposals/latest-title extraction. `treasury_ugnot` is best-effort: if a treasury address is derivable, query `bank/balances/<addr>` via `s.homeQuery`; else leave 0 and do not fail the source.

- [ ] **Step 2: Write failing fixture tests** (`TestFetchFeaturedDao_FromFixture`, `TestFetchDirectoryMembers_FromFixture`) injecting the captured text via `s.homeQuery`, asserting the parsed `Name`/`Members`/`OpenProposals` and the member list length + first entry fields match what's visible in the fixtures.

- [ ] **Step 3: Run to verify it fails.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go test ./internal/service/ -run 'FetchFeaturedDao|FetchDirectoryMembers' -v`

- [ ] **Step 4: Implement** both functions with parsers mirroring the frontend's `parseUserRegistry` / DAO parsers, derived from the captured fixtures. `fetchDirectoryMembers` slices to `limit` (use 4, matching `MEMBER_PREVIEW_COUNT`).

- [ ] **Step 5: Run to verify pass.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go test ./internal/service/ -run 'FetchFeaturedDao|FetchDirectoryMembers' -v`

- [ ] **Step 6: Wire into `assembleHomeSnapshot`** — `snap.FeaturedDao`, `snap.DirectoryMembers`, behind fault wrappers (`"featured_dao"`, `"directory_members"`). Set `snap.GeneratedAt` at the end. Re-run the full service package.

- [ ] **Step 7: Commit.**

```bash
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 add backend/internal/service/home_rpc.go backend/internal/service/home_rpc_test.go backend/internal/service/testdata/home/
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 commit -m "backend: home snapshot featured DAO + directory members"
```

### Task C5: Assembly fault-tolerance + chain_id defaulting tests

**Files:**
- Modify: `backend/internal/service/home_rpc_test.go`

- [ ] **Step 1: Write the failing test** asserting that when on-chain sources fail (inject `s.homeQuery` returning an error) but DB sources succeed, `assembleHomeSnapshot` still returns a non-nil snapshot with the failed source names in `StaleSources` and DB-backed fields populated:

```go
func TestAssembleHomeSnapshot_PartialFailureIsTolerated(t *testing.T) {
	s := newTestService(t)
	s.homeQuery = func(rpc, path, data string) (string, error) { return "", fmt.Errorf("chain down") }
	_, _ = s.db.Exec(`INSERT INTO nft_collections (collection_id, name) VALUES ('a','A')`)
	// Point network/validators at a dead URL so those sources fail too.
	snap := s.assembleHomeSnapshot(context.Background(), "http://127.0.0.1:1") // unreachable
	if snap == nil { t.Fatal("snapshot must never be nil") }
	if snap.Counts == nil || snap.Counts.Collections != 1 {
		t.Fatalf("DB source should still populate: %+v", snap.Counts)
	}
	if len(snap.StaleSources) == 0 {
		t.Fatal("failed sources must be recorded in StaleSources")
	}
}

func TestGetHomeSnapshot_DefaultsChainID(t *testing.T) {
	s := newTestService(t)
	s.chainID = "test13"
	s.homeQuery = func(rpc, path, data string) (string, error) { return "", fmt.Errorf("x") }
	resp, err := s.GetHomeSnapshot(context.Background(), connect.NewRequest(&membav1.GetHomeSnapshotRequest{}))
	if err != nil { t.Fatal(err) }
	if resp.Msg.Snapshot == nil { t.Fatal("snapshot must be present even on full failure") }
}
```

- [ ] **Step 2: Run.** Expected: PASS if Phase C wiring is correct; if it FAILS, fix `assembleHomeSnapshot` so every source is individually wrapped and `snap` is always non-nil (it should never early-return nil).

- [ ] **Step 3: Run the entire backend test suite + build.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go build ./... && go test ./...`
Expected: all green.

- [ ] **Step 4: Commit.**

```bash
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 add backend/internal/service/home_rpc_test.go backend/internal/service/home_rpc.go
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 commit -m "backend: assert home snapshot fault-tolerance + chain_id default"
```

---

## Phase D — Frontend API layer

### Task D1: `homeApi.ts` wrapper

**Files:**
- Create: `frontend/src/lib/homeApi.ts`, `frontend/src/lib/homeApi.test.ts`

**Interfaces:**
- Consumes: `api` from `./api`; types from `../gen/memba/v1/memba_pb`.
- Produces: `fetchHomeSnapshot(chainId: string): Promise<HomeSnapshot | null>` (re-export type `HomeSnapshot`).

- [ ] **Step 1: Write the failing test.** `frontend/src/lib/homeApi.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"

vi.mock("./api", () => ({ api: { getHomeSnapshot: vi.fn() } }))
const { api } = await import("./api")

describe("fetchHomeSnapshot", () => {
  it("returns the snapshot on success", async () => {
    vi.mocked(api.getHomeSnapshot).mockResolvedValue({ snapshot: { staleSources: [] } } as never)
    const { fetchHomeSnapshot } = await import("./homeApi")
    const snap = await fetchHomeSnapshot("test13")
    expect(snap).not.toBeNull()
  })
  it("returns null on error (endpoint absent)", async () => {
    vi.mocked(api.getHomeSnapshot).mockRejectedValue(new Error("not implemented"))
    const { fetchHomeSnapshot } = await import("./homeApi")
    expect(await fetchHomeSnapshot("test13")).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/frontend && npx vitest run src/lib/homeApi.test.ts`
Expected: FAIL — cannot find `./homeApi`.

- [ ] **Step 3: Implement** `frontend/src/lib/homeApi.ts` (mirror `nftApi.ts`):

```ts
/**
 * homeApi.ts — typed wrapper over the GetHomeSnapshot ConnectRPC endpoint.
 * Returns the snapshot, or null on any error (the endpoint may be undeployed).
 * Callers MUST treat null as "use the Phase-1 per-source hooks".
 */
import { api } from "./api"

export type { HomeSnapshot } from "../gen/memba/v1/memba_pb"
import type { HomeSnapshot } from "../gen/memba/v1/memba_pb"

export async function fetchHomeSnapshot(chainId: string): Promise<HomeSnapshot | null> {
  try {
    const res = await api.getHomeSnapshot({ chainId })
    return res.snapshot ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run to verify pass.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/frontend && npx vitest run src/lib/homeApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 add frontend/src/lib/homeApi.ts frontend/src/lib/homeApi.test.ts
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 commit -m "frontend: homeApi.ts fetchHomeSnapshot wrapper"
```

### Task D2: `useHomeSnapshot` hook (gated to the snapshot network)

**Files:**
- Create: `frontend/src/hooks/home/useHomeSnapshot.ts`, `frontend/src/hooks/home/useHomeSnapshot.test.ts`
- Modify (if no such export exists): `frontend/src/lib/config.ts` — add `export const SNAPSHOT_NETWORK = "test13"` (the network the backend snapshot represents). First check `config.ts` for an existing network-key constant to reuse.

**Interfaces:**
- Consumes: `fetchHomeSnapshot` (homeApi); `useNetwork()` → `{ networkKey, chainId? }` (read `useNetwork` to get the chain-id/network-key it exposes); `SNAPSHOT_NETWORK`.
- Produces: `useHomeSnapshot(): { snapshot: HomeSnapshot | null; usable: boolean; isLoading: boolean }`. `usable` is true only when on `SNAPSHOT_NETWORK`, not loading, and `snapshot` is non-null with at least one populated section (i.e. not the empty `{staleSources:["all"]}` shell).

- [ ] **Step 1: Write the failing test** (`useHomeSnapshot.test.ts`) following the `useValidatorHealth.test.ts` convention (mock `../../lib/homeApi`, mock `../useNetwork`, lazy-import the hook, `makeWrapper` with `retry:false`): assert (a) on `SNAPSHOT_NETWORK` with a populated snapshot → `usable===true`; (b) on a different network → `usable===false` and `fetchHomeSnapshot` not called (query disabled); (c) snapshot null → `usable===false`.

- [ ] **Step 2: Run to verify it fails.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/frontend && npx vitest run src/hooks/home/useHomeSnapshot.test.ts`

- [ ] **Step 3: Implement** `useHomeSnapshot.ts`:

```ts
import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { fetchHomeSnapshot, type HomeSnapshot } from "../../lib/homeApi"
import { SNAPSHOT_NETWORK } from "../../lib/config"

const STALE_TIME = 30_000

export interface HomeSnapshotResult {
  snapshot: HomeSnapshot | null
  usable: boolean
  isLoading: boolean
}

export function useHomeSnapshot(): HomeSnapshotResult {
  const { networkKey, chainId } = useNetwork()
  const onSnapshotNetwork = networkKey === SNAPSHOT_NETWORK

  const query = useQuery({
    queryKey: ["home", "snapshot", chainId ?? networkKey],
    queryFn: () => fetchHomeSnapshot(chainId ?? networkKey),
    enabled: onSnapshotNetwork,
    staleTime: STALE_TIME,
    retry: false,
  })

  const snapshot = query.data ?? null
  const populated = !!snapshot && !(snapshot.staleSources?.length === 1 && snapshot.staleSources[0] === "all")
  return {
    snapshot,
    usable: onSnapshotNetwork && !query.isLoading && populated,
    isLoading: onSnapshotNetwork && query.isLoading,
  }
}
```

(If `useNetwork()` exposes the chain id under a different name, adapt; if it has no chain id, pass `networkKey` only.)

- [ ] **Step 4: Run to verify pass.** Then commit.

```bash
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 add frontend/src/hooks/home/useHomeSnapshot.ts frontend/src/hooks/home/useHomeSnapshot.test.ts frontend/src/lib/config.ts
git -C /Users/zxxma/Desktop/Code/Gno/memba-home-phase2 commit -m "frontend: useHomeSnapshot hook gated to snapshot network"
```

---

## Phase E — Frontend panels go snapshot-first (each hook internally)

**Pattern for E1–E5 (apply to each hook):** call `useHomeSnapshot()` at the top. Compute `usable`. Gate the existing on-chain `useQuery`(s) with `enabled: !usable && <existing enabled>`. When `usable`, return values mapped from the snapshot; else return the existing on-chain-derived values. The hook's **public return shape is unchanged** → panels are untouched. Each task extends the hook's existing `*.test.ts` with two cases: "uses snapshot when usable" and "falls back to on-chain when snapshot not usable (on-chain query still fires)".

> Note on `bigint`: snapshot `uint64`/`uint32` proto fields arrive as `bigint`/`number` in TS — convert with `Number(...)` where the Phase-1 shape uses `number`.

### Task E1: `useNetworkPulse` snapshot-first

**Files:** Modify `frontend/src/hooks/home/useNetworkPulse.ts` + create/extend `useNetworkPulse.test.ts` (no test exists today — create it).

- [ ] **Step 1:** Write failing test: snapshot present → `blockHeight`/`totalValidators` come from `snapshot.network`; `memberCount`/`daoCount` still come from traction (always client-side). Snapshot not usable → existing `getNetworkStats` path fires.
- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3:** Implement: add `const { snapshot, usable } = useHomeSnapshot()`; set `statsQuery`'s `enabled: !usable`; in the return, when `usable` use `Number(snapshot!.network?.blockHeight ?? 0)`, `Number(snapshot!.network?.validatorsTotal ?? 0)`, `Number(snapshot!.network?.avgBlockTimeMs ?? 0)/1000` for `avgBlockTime` seconds; keep `daoCount`/`memberCount` from `tractionQuery` unchanged; `loading` = `usable ? false : statsQuery.isLoading`.
- [ ] **Step 4:** Run, verify pass. Commit (`frontend: useNetworkPulse snapshot-first`).

### Task E2: `useEcosystemCounts` snapshot-first (daos stays client-side)

**Files:** Modify `useEcosystemCounts.ts` + extend `useEcosystemCounts.test.ts`.

- [ ] **Step 1:** Write failing test: snapshot usable → `tokens`/`agents`/`validators`/`collections` from `snapshot.counts`; `daos` STILL from `fetchTractionMetrics` (assert the traction task runs even when the snapshot is usable). Snapshot not usable → the full `Promise.allSettled` path runs.
- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3:** Implement: add `useHomeSnapshot()`; gate the main `query` (the `fetchEcosystemCounts` one) with `enabled: !usable`; keep `daos` on a small always-on query (`["home","ecosystem-daos"]` → `fetchTractionMetrics().then(m => m.daoCount)`); when `usable`, return `{ tokens: Number(snapshot.counts?.tokens ?? 0), agents: ..., validators: ..., collections: ..., daos: <from daos query> }`. Preserve the `null`-means-unknown semantics: if a snapshot count is 0 because its source was stale, the panel shows "—" — acceptable (matches current 0→"—" mapping in `EcosystemPanel.fmtCount`, which treats null as "—"; map snapshot 0 to `null` only if you want "—" vs "0" — keep 0 as `0` to show a real zero, or map to `null` if the source name is in `snapshot.staleSources`).
- [ ] **Step 4:** Run, verify pass. Commit (`frontend: useEcosystemCounts snapshot-first, daos stays client-side`).

### Task E3: `useValidatorHealth` snapshot-first

**Files:** Modify `useValidatorHealth.ts` + extend `useValidatorHealth.test.ts`.

- [ ] **Step 1:** Write failing test: snapshot usable → `status`/`active`/`total` from `snapshot.validatorsHealth`; `avgUptime`/`latestIncident` → `null` (not in snapshot v1). Not usable → existing `getValidators` path fires (the existing tests already cover this; just add the snapshot case).
- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3:** Implement: gate the existing `query` with `enabled: !usable`; when usable map `status: snapshot.validatorsHealth?.status as ... ?? "healthy"`, `active: Number(...)`, `total: Number(...)`, `avgUptime: null`, `latestIncident: null`, `loading: false`.
- [ ] **Step 4:** Run, verify pass. Commit (`frontend: useValidatorHealth snapshot-first`).

### Task E4: `useDirectoryHighlights` snapshot-first (members preview only)

**Files:** Modify `useDirectoryHighlights.ts` + extend `useDirectoryHighlights.test.ts`.

- [ ] **Step 1:** Write failing test: snapshot usable → `members` from `snapshot.directoryMembers` (mapped to `DirectoryUser`); `memberCount` STILL from traction (client-side). Not usable → existing registry `queryRender` path fires.
- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3:** Implement: gate the registry portion. Cleanest: keep the existing `query` but pass `enabled: !usable` and, when usable, return `members` mapped from `snapshot.directoryMembers` (`{ name, address, avatarUrl }` → the `DirectoryUser` shape — check `parseUserRegistry`'s `DirectoryUser` type for exact fields) while keeping `memberCount` from the traction result. Since the existing hook fetches both traction + registry in one `fetchDirectoryHighlights`, split: when `usable`, run a traction-only query for `memberCount` and take `members` from the snapshot; when not usable, run the existing combined fetch. Keep the public shape identical.
- [ ] **Step 4:** Run, verify pass. Commit (`frontend: useDirectoryHighlights members preview snapshot-first`).

### Task E5: `FeaturedDaoPanel` inline hook snapshot-first

**Files:** Modify `frontend/src/components/home/panels/FeaturedDaoPanel.tsx` + extend `FeaturedDaoPanel.test.tsx`.

- [ ] **Step 1:** Write failing test: snapshot usable with a populated `featuredDao` → panel renders that name/members/open-count without calling `getDAOConfig`/`getDAOProposals`. Snapshot not usable → existing on-chain `useFeaturedDao` path fires. Snapshot usable but `featuredDao` empty → panel self-hides (`return null`), preserving current behavior.
- [ ] **Step 2:** Run, verify fail.
- [ ] **Step 3:** Implement: in `useFeaturedDao`, add `const { snapshot, usable } = useHomeSnapshot()`; set the query's `enabled: !!realmPath && !usable`; when `usable`, return the mapped `snapshot.featuredDao` (or `null` if it's empty/realm_path blank). Map `treasury_ugnot` only if you surface treasury (current panel may not — keep parity). Preserve both self-hide conditions.
- [ ] **Step 4:** Run, verify pass. Commit (`frontend: FeaturedDaoPanel snapshot-first`).

---

## Phase F — Integration & verification

### Task F1: Full test suites + lint + typecheck

- [ ] **Step 1: Backend.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/backend && go build ./... && go test ./... && go vet ./...`
Expected: all green.

- [ ] **Step 2: Frontend.**

Run: `cd /Users/zxxma/Desktop/Code/Gno/memba-home-phase2/frontend && npm run test && npx tsc --noEmit && npm run lint`
Expected: all green (the existing 2328 tests + the new ones). Fix any type errors from `bigint`/optional-field handling.

- [ ] **Step 3: Commit any fixups** (`chore: green backend+frontend for home snapshot`).

### Task F2: Live smoke against a locally-run backend (optional but recommended)

- [ ] **Step 1:** Run the backend locally pointed at test13 (`HOME_SNAPSHOT_RPC_URL` defaulted), exercise the endpoint:

```bash
# From the backend dir, run the server (reuse the project's run target/command), then:
curl -s -X POST http://localhost:<port>/memba.v1.MultisigService/GetHomeSnapshot \
  -H 'Content-Type: application/json' -d '{"chainId":"test13"}' | head -c 2000
```
Expected: JSON with a `snapshot` object; `staleSources` should be empty or list only sources that genuinely failed. Confirm `network.blockHeight`, `counts.collections`, and `directoryMembers` look right vs the live home. Record findings; if a source is consistently stale, revisit its encoding (Task C3 base64 note).

- [ ] **Step 2:** Frontend manual check via the preview workflow: load the home on test13, confirm panels render identically and the Network tab shows a single `GetHomeSnapshot` call (plus the unchanged gnolove + traction calls), not the per-source on-chain fan-out. Toggle the endpoint off (or point at a backend without it) and confirm panels fall back to Phase-1 sources with no visual regression.

### Task F3: Update the spec status + push decision

- [ ] **Step 1:** Update `docs/planning/HOME_PHASE2_GETHOMESNAPSHOT.md` status line to reflect "implemented" and note the three deltas (test13 RPC target, `daos` stays client-side, fixture-driven on-chain parsing). Commit (`docs: mark Phase 2 spec implemented + record deltas`).
- [ ] **Step 2:** STOP. Do not push or open a PR. Surface to the user for review/approval per the hard rules (ask before pushing; never merge without approval).

---

## Self-Review

**Spec coverage (against `HOME_PHASE2_GETHOMESNAPSHOT.md`):**
- §1 goal (one cached call, O(1), non-breaking fallback) → Phase B cache + Phase E `enabled`-gated fallback. ✅
- §3 IN scope: network pulse (C2), ecosystem counts tokens/collections/agents/validators (C1+C2+C3), featured DAO (C4), validators health (C2), directory members (C4). ✅ — **`daos` deliberately moved OUT** (documented delta; recon proved no DB/registry source; same class as gnolove).
- §3 OUT scope (personalized, gnolove, ListProfiles, Phase 3) → untouched. ✅
- §4 payload fields → all present in the proto (A1), minus `daos` (delta) and `avg_uptime` (omitted v1 — needs monitoring API, matches "cheap subset"); `avg_block_time_ms` field kept but best-effort/0. ✅
- §5 cache (RWMutex, cached, cachedAt, TTL, serve-stale) → B2, but lifted to struct fields (delta: closure state impossible on a ConnectRPC method). ✅
- §5 assembly per-source fault tolerance + small named functions → Phase C wrappers + C5 test. ✅
- §6 chain_id default-to-server + cache key includes chain_id → B2. ✅ (No reject-unknown-chain guard added — none exists today; not required.)
- §7 frontend `homeApi.ts` + `useHomeSnapshot` + per-panel snapshot-or-fallback → D1/D2/E1–E5 (delta: fallback baked into each Phase-1 hook so panels are untouched — cleaner than separate adapter components). ✅
- §8 rollout non-breaking → ship backend first, frontend prefers snapshot, falls back when absent. ✅
- §10 testing (assembleHomeSnapshot mocked DB + injectable ABCI func; per-source error tolerance; cache HIT/MISS/STALE; chain_id; frontend mapping + fallback) → B1/B2/C1–C5/D/E. ✅
- §11 risks: abciQuery testability seam (B1 `queryFunc`); validators cheap subset (C2); multi-replica per-instance cache (acceptable per spec); counts source choice (DB for collections, chain for tokens/agents) — all addressed. ✅

**Placeholder scan:** On-chain parse steps (C3/C4) intentionally derive parser code + expected counts from captured real fixtures rather than inventing wire formats — the steps give exact capture commands and assert against observed values. This is fixture-driven TDD, not a placeholder; the implementer fills the observed count/format from the real response. The `newTestService(t)` helper is specified to be copied from an existing `*_rpc_test.go` (exact source named). Featured-DAO/registry parsers are specified to mirror named existing frontend parsers (`parseUserRegistry`, `lib/dao` config/proposals parsers).

**Type consistency:** Proto field names (A1) ↔ Go (`Snapshot.Network.BlockHeight`, `Counts.Tokens`, …) ↔ TS (`snapshot.network?.blockHeight`, `snapshot.counts?.tokens`, …) verified consistent. `queryFunc`/`s.homeQuery` used identically in B1/C3/C4. `useHomeSnapshot` return `{snapshot, usable, isLoading}` consumed identically across E1–E5. `fetchHomeSnapshot` return `HomeSnapshot | null` matches `useHomeSnapshot`'s `snapshot`.

**Open items the implementer must resolve from live data (flagged, not guessed):** (1) exact `abci_query` `data` encoding for test13 (plain newline vs base64) — Task C3 Step 1 determines empirically and documents; (2) the `/validators` JSON key/shape — Task C2 Step 1 captures and confirms; (3) `useNetwork()`'s chain-id accessor name — Task D2 adapts; (4) tokenfactory/featured-DAO/registry realm path literals — read from `frontend/src/lib/config.ts` at implementation time.
