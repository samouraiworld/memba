# Home Phase 2 — `GetHomeSnapshot` (server-side home aggregation)

- Date: 2026-06-19
- Status: **IMPLEMENTED** on `feat/home-phase2` (plan: `docs/superpowers/plans/2026-06-19-home-phase2-gethomesnapshot.md`). End-to-end smoke green vs live test13 (all 8 sources populated, no stale). Non-breaking / additive — the endpoint may be left undeployed to keep full Phase-1 fidelity. See §13 for the as-built deltas.
- Depends on: Phase 0/1 (the Control Room home — PR #439). Phase 2 builds on the existing panels/hooks.
- Decisions locked: snapshot = **global chain/DB data only**; `ListProfiles`/"newest members" = **separate follow-up** (not this spec).

---

## 1. Goal

Replace the home's per-client on-chain read fan-out with **one cached backend call**. On-chain RPC load becomes **O(1) per cache window regardless of visitor count**. The change is **non-breaking**: if the endpoint is absent or errors, the home falls back to the Phase-1 per-source hooks.

## 2. Why it's feasible now (backend capability — verified)

- The Go backend can already perform arbitrary on-chain ABCI reads — `service.abciQuery(rpcURL, path, data)` (`backend/internal/service/render_proxy.go:97`) does `vm/qrender` and `vm/qeval` over plain JSON-RPC; proven in live code (`analyst.go:87` does a parameterized `vm/qeval`; the render proxies do `vm/qrender`). No gnoclient/tm2 dep, no new chain-access plumbing.
- Block height/status: the indexer's `httpGet(ctx, client, rpcURL+"/status")` (`indexer/tailer.go`) is reusable; `/validators` isn't called yet but is the same trivial GET.
- DB counts are cheap single queries: `nft_collections`/`nft_tokens`/`nft_sales`, `user_ranks` (count), `service_listings` (active), `multisigs`/`transactions`.
- A proven in-memory TTL cache pattern exists: `HandleMarketplaceAgentsProxy` (`render_proxy.go:245`) — `sync.RWMutex` + cached value + `cachedAt` + TTL + **serve-stale-on-error** (`X-Cache: HIT/MISS/STALE`). This is the template for the snapshot cache.

## 3. Scope

**IN — the global, cacheable, chain/DB-backed data that is the expensive RPC fan-out today:**
- Network pulse (block height, validators).
- Ecosystem counts (tokens, collections, agents, validators, daos).
- Featured-DAO headline state.
- Validators health (cheap subset).
- Directory registry members (the few on-chain registry entries).

**OUT (unchanged — by decision):**
- **Personalized authed data** (needs-you votes/sigs/candidature, your-worlds) — per-user; stays on the existing client-side hooks (already cached; the vote-scan stays authed-only). A global snapshot must not carry per-user data or it loses the single-cache O(1) win.
- **Gnolove data** (contributor count/top, repo count, member count) — already **one cheap cached HTTP call** from the frontend; it's not part of the on-chain stampede. Stays a direct frontend call.
- **`ListProfiles` / Directory "newest members"** — needs a `profiles.created_at` migration (table has only `updated_at`) + a new RPC. Separate follow-up.
- Phase 3 live cross-feature activity ledger.

Net effect on the home's network traffic: from ~6–8 on-chain reads per visitor → **1 `GetHomeSnapshot`** (+ the unchanged single Gnolove call + the authed personalized hooks).

## 4. The snapshot payload

`HomeSnapshot` (every field tolerant of its source failing → zero/empty + listed in `stale_sources`; the call never fails wholesale):

| Field | Type | Source (server-side) |
|---|---|---|
| `network.block_height` | int64 | RPC `/status` |
| `network.avg_block_time_ms` | int64 (optional) | RPC `/status`+`/block` (or omit v1) |
| `network.validators_total` | int32 | RPC `/validators` |
| `counts.daos` | int32 | `vm/qrender` DAO registry (or DB if indexed) |
| `counts.tokens` | int32 | `vm/qrender` tokenfactory list |
| `counts.collections` | int32 | DB `COUNT(*) nft_collections` |
| `counts.agents` | int32 | cached agent-registry render (existing proxy) |
| `counts.validators` | int32 | = `network.validators_total` |
| `featured_dao` | {realm_path, name, members, treasury_ugnot, open_proposals, latest_proposal_title} | one `vm/qrender` of the configured featured DAO |
| `validators_health` | {status: healthy/degraded/down, active, total, avg_uptime?} | RPC `/validators` (cheap subset — no 100-RPC signatures, matches Phase-1 ValidatorsPanel) |
| `directory_members` | repeated {name, address, avatar_url} | one `vm/qrender` of the users registry realm (first N) |
| `as_of_block` | int64 | chain height at assembly |
| `indexer_last_block` | int64 | `nft_indexer_state.last_processed_block` (freshness/lag) |
| `generated_at` | string (RFC3339) | server timestamp |
| `stale_sources` | repeated string | names of sources that failed this assembly (served zero/last-good) |

Proto (in `api/memba/v1/memba.proto`, on `MultisigService`):
```proto
rpc GetHomeSnapshot(GetHomeSnapshotRequest) returns (GetHomeSnapshotResponse);
message GetHomeSnapshotRequest { string chain_id = 1; }
message GetHomeSnapshotResponse { HomeSnapshot snapshot = 1; }
// + HomeSnapshot and the nested NetworkPulse / EcosystemCounts / FeaturedDao /
//   ValidatorsHealth / DirectoryMember messages mirroring the table above.
```

## 5. Caching & assembly

- **Cache:** single-entry, in-memory, per backend instance. `sync.RWMutex` + `cached *HomeSnapshot` + `cachedAt time.Time` + `ttl` (config `HOME_SNAPSHOT_TTL`, default ~30s). On a request: if fresh → return cached; if stale/empty → re-assemble, store, return; if re-assembly fails but a prior value exists → **serve stale** (mark `stale_sources`). Mirrors `HandleMarketplaceAgentsProxy`. Result: O(1) on-chain load per TTL window regardless of traffic; the home's steady traffic keeps it warm.
- **Assembly (`assembleHomeSnapshot(ctx, rpcURL) (*HomeSnapshot, error)`):** each source wrapped so a single failure degrades that field only (append to `stale_sources`), never aborting the whole snapshot. Sources are independent → may run concurrently with a small `errgroup`/bounded goroutines, but sequential is acceptable since it runs at most once per TTL window. Keep each source a small named function for isolated testing.
- **No background goroutine v1** (lazy-TTL is enough and lighter). A `StartHomeSnapshotRefresher` background warmer is a possible later option if zero-traffic warmth is wanted.

## 6. `chain_id` / network

`GetHomeSnapshotRequest.chain_id` validated against `s.acceptedChainIDs` (default to the service's `chainID` when empty), used to select the RPC URL. Note: NFT/indexer DB data is single-network (test13) and not chain-tagged today — so practically one network; the param is convention parity (matches multisig/quest protos) and forward-compat. The cache key includes `chain_id`.

## 7. Frontend integration

- `src/lib/homeApi.ts` → `fetchHomeSnapshot(chainId)` wrapping `api.getHomeSnapshot({ chainId })`, returning a typed `HomeSnapshot`.
- `src/hooks/home/useHomeSnapshot.ts` → `useQuery(['home','snapshot', chainId], fetchHomeSnapshot, { staleTime: 30_000 })`.
- The chain/DB panels (NetworkPulse, Ecosystem, FeaturedDao, Validators, Directory-members) read their data from the snapshot **when present**, and **fall back to their existing Phase-1 per-source hook** when the snapshot is absent or errored — mirroring `NFTActivityFeed`'s indexer-first / on-chain-fallback shape. Cleanest implementation: each panel calls a small adapter `useX(snapshot)` that returns snapshot data or delegates to the Phase-1 hook. Personalized panels + Gnolove/Directory-count keep their existing hooks untouched.
- Net: the home issues one `GetHomeSnapshot` for all chain/DB panels; the per-source hooks remain as the resilient fallback.

## 8. Rollout (non-breaking)

Additive and reversible: ship the backend endpoint first (no frontend change → no effect); then flip the frontend to prefer the snapshot. If the endpoint is undeployed/erroring, every panel transparently uses its Phase-1 source. No flag-day, no regression risk to the shipped home.

## 9. Components / files

- **Backend:** `api/memba/v1/memba.proto` (+ rpc & messages) → `make proto-gen` (regenerates Go + TS) → `backend/internal/service/home_rpc.go` (the `GetHomeSnapshot` handler, the TTL cache, `assembleHomeSnapshot` + the per-source fns). Add `homeSnapshotRPCURL()` env helper or reuse `marketplaceRPCURL()`. **Optional targeted cleanup:** the 3 duplicate `abciQuery`/`queryRender` helpers (render_proxy/quest_verify/poller) could be consolidated into one — do it only if it stays small.
- **Frontend:** `src/lib/homeApi.ts`, `src/hooks/home/useHomeSnapshot.ts`, and the per-panel snapshot-or-fallback adapters.

## 10. Testing

- **Backend:** unit-test `assembleHomeSnapshot` with a mocked DB + an injectable ABCI-query func (introduce a seam — pass the query fn / interface so a fake RPC can be supplied). Assert: full assembly; per-source error tolerance (one source throws → it's in `stale_sources`, others populated); cache HIT/MISS/STALE behavior incl. serve-stale-on-error; `chain_id` validation/rejection. Handler test for the request/response mapping.
- **Frontend:** `fetchHomeSnapshot` maps fields; the adapters prefer snapshot data and fall back to the per-source hook when the snapshot is absent/errored; panels render identically from either path.

## 11. Risks & notes

- **abciQuery testability:** there are 3 copies and no seam today. The plan must introduce an injectable query function for `assembleHomeSnapshot` so it's unit-testable without a live chain.
- **Validators health depth:** the snapshot uses the cheap `/validators` subset (active/total + status), same as Phase-1's ValidatorsPanel; real participation/incidents would need the monitoring API (6 HTTP) — out of scope, optional later.
- **Multi-replica cache:** each backend instance caches independently (fine — O(1) per instance per window). A shared/DB-backed snapshot (à la `analyst_reports.expires_at` TTL) is a later option only if needed.
- **Counts source choice:** prefer DB counts where the indexer already has the data (collections); use `vm/qrender` only where the chain is the sole source (tokens list, featured DAO, registry members). Keep total on-chain reads per assembly small (~4–5 qrenders + 2 GETs).

## 12. Out of scope (tracked elsewhere)

- `ListProfiles` + `profiles.created_at` migration → Directory "newest members" (separate small task).
- Server-side Gnolove proxying; per-user personalized snapshot.
- Phase 3 live cross-feature activity ledger (needs the indexer widened beyond NFT events).

---

## 13. As-built deltas (from the spec, decided during implementation)

Recon against the live chain + codebase corrected three spec assumptions:

1. **RPC target = test13 via a dedicated `homeSnapshotRPCURL()`** (env `HOME_SNAPSHOT_RPC_URL` → `NFT_RPC_URL` → test13 default). The spec implied reusing `marketplaceRPCURL()`, which does not exist; the only helper, `gnoRPCURL()`, defaults to **testnet12** — wrong chain for the home.
2. **`counts.daos` is OMITTED from the snapshot and stays client-side.** There is no `daos` DB table and no on-chain DAO-registry render; today the count is a gnoweb-namespace HTML scrape (`traction.ts`), cached client-side — the same class as Gnolove, which the spec already keeps client-side. `useEcosystemCounts` keeps `daos` from traction; the other 4 counts come from the snapshot.
3. **On-chain `vm/qrender` data must be `base64("<pkgpath>:<path>")` — base64-encoded, COLON separator.** Verified against live test13: the existing `abciQuery`'s plain-newline form is rejected. `abciQuery` was left unchanged (shared with the marketplace proxy); the home sources base64+colon-encode their data argument. (qeval, unused here, is base64 + dot.)

**Implementation shape:** cache lifted onto the `MultisigService` struct (a ConnectRPC method can't hold closure state like the REST marketplace proxy); an injectable `queryFunc` seam over `abciQuery` makes `assembleHomeSnapshot` unit-testable; each of the 8 sources is individually fault-wrapped (failure → `stale_sources`, never aborts); frontend integration bakes "snapshot-first, Phase-1 fallback" **into each Phase-1 hook** (gating its on-chain query with `enabled: !usable`) so panels are untouched and only activate the snapshot on the configured network (`SNAPSHOT_NETWORK = "test13"`).

**Known v1 best-effort fields** (panels degrade to "—"/omit when the snapshot is active; all additive — leave the endpoint undeployed for full Phase-1 fidelity):
- `network.avg_block_time_ms = 0` (not computed v1) → NetworkPulse avg-block-time shows "—".
- `validators_health` is the cheap subset (status/active/total only) — no `avg_uptime`/incidents (need the monitoring API) → ValidatorsPanel uptime "—", incident card hidden.
- `featured_dao.members = 0` (memberstore tier read deferred) → members "—"; `treasury_ugnot = 0` (DAO unfunded; parser handles funded); no `latest_proposal_id` in the payload → the per-proposal deep-link is suppressed on the snapshot path (open-proposal **count** still shown).
- `directory_members = []` in production because `r/sys/users` renders stats-only (no member list) — matches the live Phase-1 frontend exactly.
