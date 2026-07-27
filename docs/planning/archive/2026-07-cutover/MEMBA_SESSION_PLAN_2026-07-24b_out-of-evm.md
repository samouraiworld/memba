# Memba — Session Plan (out-of-EVM lane), 2026-07-24 (evening)

**Constraint:** this session does everything **OUT of the EVM migration**. The EVM session is live
(`origin/dev/evm-migration`, actively pushing) — avoid its files, no conflicts.

## State at session start
- `main` = `52c16282`. Last session's 6 merges all landed (#1003, #1004, #999 Topaz Phase A live+verified, #980/#979/#987 deps).
- **EVM now pushes a remote branch** `origin/dev/evm-migration` (was local-only). It is **reworking the RPC layer**: `rpcFallback.ts` (+168/−55, CAL per-network routing), `config.ts` (removed my `isFeedWritable`, added `VITE_ENABLE_CAL`). Not PR'd to main.
- **test13 RPC availability degraded**: Memba's frontend primary (`rpc.test13.testnets.gno.land`) and backend-pinned node (`rpc.testnet13.samourai.live`) are **unreachable from a client vantage point**; onbloc fallback is up. The **chain is healthy** (backend indexer at head 1022956 ≈ onbloc 1022961). Endpoint availability, not a chain outage.
- Open PRs carried over: #997 (HELD draft, Phase B), #978/#977 (dependabot, blocked).

## The EVM collision map (checked file-by-file)
| My candidate work | File(s) | EVM touches? | Call |
|---|---|---|---|
| ChainHaltedBanner exemption + fallback | `ChainHaltedBanner.tsx`, `chainHealth.ts` | ❌ clear | **DO** |
| RPC staleness-failover (§1.a) | `rpcFallback.ts` | ✅ **+168/−55 active rework** | **DEFER** — hard conflict |
| RPC primary reorder (§1.b) | `config.ts` NETWORKS block | ❌ (EVM hunks are elsewhere in the file) | **DEFER** — marginal value, feeds EVM's new `isActivePrimaryRpcUrl`; let health-aware ordering land on their structure |

**Why defer the RPC-fallback swap even though the user greenlit it:** (a) it's the exact file EVM is rewriting → the conflict the owner told me to avoid; (b) it isn't needed for today's outage — existing failover already routes connection-failures to onbloc, and the indexer proves the chain is reachable and current; (c) the durable fix (health-aware ordering) belongs *on top of* EVM's new `rpcFallback` structure, not fighting it. **Recommend the EVM session owns health-aware RPC selection as part of the CAL.**

## Shipped this session
1. **#1005 — ChainHaltedBanner: probe test13 too + fix fallback suggestion.** Removed the hardcoded `test13` "known-good" exemption (a test13 user with all endpoints down got a broken app, no notice). Probe already races primary+fallbacks, so no false alarm. Fixed `getSuggestedFallback` to prefer **topaz** (realms live since Phase A) over Betanet. TDD, 12/12, build 0 TS, lint 55/55. EVM-clear.

## Next candidates (all EVM-clear, no owner gate) — natural order
Ranked by leverage, per the CTO panel + product review:
1. **Supply loop — Wave F.3 share-to-feed intents** (`?compose=<link>` prefill on score cards / listings / proposals). The feed has 4 posts, newest 2026-07-15; the binding constraint is **supply**, which the feed plan's own §6.3 names — and this is realm-free, frontend-lite, no owner gate. **Highest user leverage.**
2. **MP tier badges read-only (Wave F.1)** on PostCard/FeedProfile — but Reputation is hard-off (`POINTS_FEATURE_DEFERRED`), so this is dark-until-enabled. Lower now.
3. **Doc/CI hygiene:** the gno-core sweep doc entry (record deployer#123 closed #5908/#5892; the real code item is the `GNO_PIN` bump — but that gates Phase B, which is owner-gated, so doc-only here).
4. **ROADMAP.md staleness** (`:18` "cutover DONE", `:25` "finish the test13 ceremony" — both done) + the `gnoIcoSale.ts` "Now open" copy that never expires. Public-facing, low-effort.

## Owner-gated / blocked (unchanged)
- **#977** (backend deps → auto-deploys prod; the permission classifier blocks my merge).
- **#978** (remotion) — deterministic false-red: Dependabot's read-only token can't update the buf PR-comment. Fix is a workflow change (`if: github.actor != 'dependabot[bot]'`), owner-gated.
- **#997 Phase B**, `/api/render` blocklist bypass, the erasure/scrub build, migration 028 chain_id — all from the panel, all still owner-gated or EVM-adjacent.
