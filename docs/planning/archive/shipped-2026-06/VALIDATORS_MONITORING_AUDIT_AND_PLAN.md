# Validators / Network Monitoring — Root-Cause Audit & Implementation Plan

**Date:** 2026-06-17
**Scope:** `/test13/validators` and `/test13/validators/hacker` not matching the network's real state vs reference dashboard **gnockpit** (`https://gnockpit.test-13-aeddi-1.gnoland.network/`).
**Status:** ✅ **SHIPPED & live-verified** (2026-06-17) via #423 → #425 → #426. Network Nodes shows 14 on test13. Phase 2b (full roster reframe) deferred.
**Non-goal / coordination:** Touches monitoring code only (`config.ts`, `lib/validators.ts`, `pages/ValidatorsHacker.tsx`). **Does not touch NFT Marketplace** (parallel effort).

---

## 1. TL;DR

The page is missing data for **two independent reasons**:

1. **Peer view is incomplete because of which RPC node Memba asks.** `/net_info` returns only a node's *directly-connected* peers. Memba's configured RPCs (`rpc.test13.testnets.gno.land`, `test13.rpc.onbloc.xyz`) see **5 peers** and cannot even see the validator nodes. gnockpit runs against the well-connected **aeddi-1 core node**, which sees **13 peers** (including both validators). → **This is the actual bug.**
2. **Model mismatch.** test13 genuinely has only **2 consensus validators**. gnockpit's headline table is a *network node roster* (all peers, annotated with consensus/VP/sign% status). Memba's Validators page lists only the 2 bonded validators and hides peers in a separate "Hacker" tab — so it *looks* like validators are missing when really the roster concept differs.

---

## 2. Evidence (live, 2026-06-17, height ~273834)

### Consensus validator set = 2 everywhere (correct)
- `/validators` (all 3 RPCs, `per_page=100`): **2** → `gno-core-val-01`, `gno-core-val-02`
- `/genesis` validators: **2**
- `/dump_consensus_state` `round_state.validators`: **2**

### Peer count depends entirely on the node queried
| RPC node | `/net_info` n_peers | Sees validator nodes? |
|---|---|---|
| `rpc.test13.testnets.gno.land` (Memba **primary**) | **5** | ❌ sentry-01/02, aeddi-1, moul-1, gfanton-1 |
| `test13.rpc.onbloc.xyz` (Memba fallback) | **5** | ❌ |
| `rpc.test-13-aeddi-1.gnoland.network` (**gnockpit**) | **13** | ✅ val-01/02 + sentries + RPC + samourai-crew-1 + samourai-dev-sentry-1 + community |

Peers visible from **aeddi-1**: `gno-core-sentry-01/02`, `gno-core-val-01/02`, `gno-core-rpc-*` (2), `gno-core-snapshot-01`, `onbloc-test13-rpc-*` (2), `samourai-crew-1`, `samourai-dev-sentry-1`, `moul-1`, `gfanton-1`.

### gnockpit's structure
Headline table columns: **Name, Address, IP, Consensus, VP, Peers, Sign%, Speed, Status** → it is a *peer/node roster* enriched with validator status, not a pure validator list. Built off `/net_info` of its co-located aeddi-1 node + `/status` + `/validators` + `/dump_consensus_state`.

---

## 3. Root cause

- **RC-1 (the bug): `/net_info` is node-local + Memba queries poorly-connected public RPCs.** Both configured endpoints sit behind sentries → 5 peers, validator nodes invisible. There is **no RPC endpoint that returns full network topology**; the only ways to approximate it are (a) query a well-connected node, or (b) union `/net_info` across several nodes.
- **RC-2 (perception): Validators page ≠ network roster.** Even with a perfect RPC, the main page would still show 2 validators while gnockpit shows ~13 nodes, because Memba models "validators" as the bonded set only and relegates peers to Hacker mode.

### How Memba's telemetry RPC is selected today
`ValidatorsHacker.tsx` → `getTelemetryRpcUrl()` (config.ts) → returns `VITE_SAMOURAI_SENTRY_RPC_URL` **if set and trusted**, else falls back to `GNO_RPC_URL` (= `rpc.test13.testnets.gno.land`). `VITE_SAMOURAI_SENTRY_RPC_URL` is currently **empty** → peers come from testnets.gno.land → only 5. `gnoland.network` is already in `TRUSTED_RPC_DOMAINS`, so aeddi-1 is allowed.

---

## 4. Solution options

### Option A — Hotfix: point telemetry at a well-connected node (~30–60 min)
Set the peer/telemetry RPC to a node that sees the full roster — either the Samourai sentry (preferred, Samourai-owned) or `rpc.test-13-aeddi-1.gnoland.network` (what gnockpit uses).
- Mechanism already exists: set `VITE_SAMOURAI_SENTRY_RPC_URL`, or add aeddi-1 as the telemetry default for test13 in `config.ts`.
- Effect: Hacker peers **5 → 13** immediately. Zero code logic change.
- Limit: still a single-node view; main Validators page still shows 2.

### Option B — Correct fix (RECOMMENDED): multi-node peer aggregation + roster reframe
1. **Aggregate `/net_info` across N trusted nodes** (aeddi-1 + onbloc + testnets + samourai sentry), union peers by node-id, add a "seen by k/N nodes" field. Resilient and the most complete topology achievable without a backend.
2. **Reframe the Validators page to a network roster** matching gnockpit: rows = union of consensus validators (`/validators`) ∪ valoper candidates (`r/gnops/valopers`) ∪ peers (`/net_info`), keyed by address/node-id, with a **Status** column (Active validator / Candidate / Peer node) and the existing VP/Sign%/uptime enrichment.
3. **Clarify copy:** show "2 active validators · 13 network nodes" so the two concepts are explicit.

### Option C — Backend aggregator (heavy, future)
A small ConnectRPC handler that polls multiple nodes server-side and serves a unified roster (avoids client fan-out, enables history). Overkill for now; revisit if topology/history becomes a product feature.

**Recommendation:** Ship **A now** (immediate parity on peers), then **B** as the proper fix. Defer C.

---

## 5. Implementation plan (Option A → B)

### Phase 0 — Hotfix (Option A)
- [ ] In `config.ts` test13 block: set a well-connected telemetry RPC (Samourai sentry if a test13 one is exposed, else aeddi-1). Confirm host is in `TRUSTED_RPC_DOMAINS` (`gnoland.network` ✅).
- [ ] Verify Hacker peers jumps 5 → 13. Compare against `curl .../net_info` on aeddi-1.
- [ ] Ship behind env so it's reversible.

### Phase 1 — Multi-node peer aggregation (Option B.1)
- [ ] New `getAggregatedNetPeers(rpcUrls[])` in `lib/validators.ts`: fan-out `/net_info` to all trusted test13 nodes in parallel, union by peer node-id (handle empty `id` — fall back to `remote_ip`+moniker key; **note:** gno `/net_info` returned empty `id` fields in probing — confirm the real field path, possibly `node_info.id` casing or `peer.id`), tag each peer with `seenBy` count and `isOutbound` per source.
- [ ] Wire `ValidatorsHacker.tsx` peers panel to the aggregated source; show "seen by k/N nodes".
- [ ] TDD: unit-test the union/dedup with fixtures from the 3 nodes' real responses.

### Phase 2 — Roster reframe (Option B.2/B.3)
- [ ] Build a unified roster model: validators (`/validators`) ∪ valopers (`r/gnops/valopers`) ∪ aggregated peers; key by address; derive Status (Active/Candidate/Peer).
- [ ] Update `Validators.tsx` table: add Status column, render full roster, keep VP/Sign%/uptime/moniker enrichment; default sort validators first.
- [ ] Header copy: "N active validators · M network nodes".
- [ ] Empty/loading/partial-failure states (some nodes may be down).

### Phase 3 — Verification
- [ ] Counts match gnockpit within tolerance (validators=2, nodes≈13).
- [ ] Resilient to one RPC being down (union still returns).
- [ ] No regression on test12.
- [ ] Manual check on `https://memba.samourai.app/test13/validators` + `/hacker`.

---

## 6. Risks / notes
- `/net_info` peer `id` came back empty in probing — **must confirm the correct dedup key** before Phase 1 (don't assume `node_info.id`).
- Single-node aggregation still can't guarantee *every* node (PEX topology); document this as a known limit (gnockpit has the same limit).
- Client fan-out adds requests; cache and stagger (existing 15–30s poll cadence is fine).
- valoper registry render is help-text at the root path; per-address render is the real data — verify the parse path used by `fetchValoperMonikers` still holds.
- Keep telemetry RPC behind env/trusted-domain allowlist (security posture already in place).

---

## 7. Implementation log (2026-06-17)

### Done — Phase 0 + Phase 1 (the bug fix)
- **`lib/validators.ts`**
  - `parseNetPeer(raw)` (new, exported, pure): parses a `/net_info` peer. Fixes a **latent bug** — gno tm2 has no `node_info.id`; the node ID is in `node_info.net_address` (`<id>@<ip>:<port>`). The old parser read `node_info.id` → every peer had an empty ID (broke any dedup/identity). Also strips loopback/wildcard default rpc addrs.
  - `mergePeerLists(lists)` (new, exported, pure): unions peer lists by node-id (fallback `moniker|ip`), tallying `seenByCount`; backfills blank moniker/rpcAddr/ip from later sources.
  - `getAggregatedNetPeers(rpcUrls, signal)` (new, exported): fans out `getNetPeers` across nodes, merges; best-effort (skips dead nodes, null only if all fail).
  - `getNetPeers` refactored onto `parseNetPeer`. `PeerInfo` gains `seenByCount`.
- **`lib/config.ts`**
  - `NetworkConfig.telemetryRpcUrls?` (new). test13 set to `[aeddi-1, samourai-dev-sentry-1]` (both trusted).
  - `getTelemetryRpcUrls()` (new): deduped, trust-filtered union of env sentry → telemetryRpcUrls → primary → fallbacks. `getTelemetryRpcUrl()` now returns the best-connected node (`[0]`).
- **`pages/ValidatorsHacker.tsx`**: peer fetch (initial load + 15s poll) now uses `getAggregatedNetPeers(getTelemetryRpcUrls())`. Existing peer panel renders the fuller list automatically.

### Verification
- Unit: `validators.netinfo.test.ts` (12) + `config.test.ts` additions (5) — green. Full suite **1989 passing**, `tsc -b` clean, eslint clean.
- **Live** (height ~274k): single-node `/net_info` = 13/6/5/5 (aeddi/samourai/testnets/onbloc); **aggregated = 14 unique peers**, including both `gno-core-val-01/02` that the primary RPC never reported. Matches/exceeds gnockpit (13). Node IDs now populate; `seenByCount` correct.

### Done — Phase 2a (chosen)
test13 genuinely has **2 consensus validators**, so the main `/validators` count is correct. Phase 2a surfaces the fuller picture without redefining "validators":
- `pages/Validators.tsx`: new **"Network Nodes"** stat card (aggregated peer count via `getAggregatedNetPeers(getTelemetryRpcUrls())`, best-effort) that links to the node roster (`/validators/hacker`). `pages/validators.css`: `.val-stat-card--link`.
- Verified: tsc/eslint clean, 1994 tests, build OK.

### Done — routing fix (#425, CRITICAL follow-up)
The live smoke-test after #423 showed **Network Nodes: 5**, not 14. Root cause: `getNetPeers` routed through `rpcCall → resilientRpcCall`, whose resilient layer **ignores the URL argument** and always queries the global primary — so `getAggregatedNetPeers` hit one node N times. Fix:
- `lib/rpcFallback.ts`: new `directRpcCall(rpcUrl, …)` — single-node fetch, no failover.
- `lib/validators.ts`: `getNetPeers` now uses `directRpcCall`.
- `lib/validators.netinfo.test.ts`: +4 fetch-routing regression tests (mock `fetch` per URL) — the pure parse/merge tests and the curl-based "live" check both bypassed this layer, which is why #423 looked green but failed in prod.
- Browser CORS verified: aeddi-1 / samourai / onbloc / testnets all return 200 cross-origin (CSP `connect-src` already covers them).

### Done — non-blocking fix (#426)
`getAggregatedNetPeers` (up to 8s/node) was inside the blocking initial `Promise.all` on both pages → a slow/dead telemetry node (e.g. gnoland1's dead `aeddi.org`) delayed the whole render. Now fire-and-forget on both `Validators.tsx` and `ValidatorsHacker.tsx`; table/dashboard render immediately, peer count fills in async.

### Other networks — no change needed
`getTelemetryRpcUrls()` already unions each network's primary + fallbacks, so gnoland1 aggregation already spans its nodes (samourai 8 / moul 7 / betanet.testnets 6; dead aeddi.org skipped). test12 is legacy single-node; mainnet not live. Explicit `telemetryRpcUrls` only added for test13 (to include the samourai sentry, not otherwise a fallback, and prioritise aeddi-1).

### Final live verification (2026-06-17, deployed)
- `https://memba.samourai.app/test13/validators` → **Network Nodes: 14**, Active Validators: 2 (correct — test13 has exactly 2 consensus validators).
- `https://memba.samourai.app/test13/validators/hacker` → **Peers: 14**, all node families present (val / sentry / rpc / snapshot / samourai / onbloc / moul / gfanton / aeddi).
- Shipped via #423 → #425 → #426. test13 is the pre-mainnet testnet; the validator set may grow over time and the page reads it live.

### Done — Phase 2b (Network Nodes roster)
**Data constraint found:** consensus validators (`/validators`), valopers (`r/gnops/valopers`) and peers (`/net_info`) live in **three different address spaces** — consensus addr (`g15sysd…`) ≠ valoper addr (`g1aeddl…`) ≠ P2P node-id (`g142k7z…`). They **cannot be joined by address**, so a literal "one merged table" is infeasible. gnockpit's table is itself peer-based.

Faithful realization: a **peer-based Network Nodes roster** added below the validator-metrics table (which keeps VP/Sign%/uptime for the consensus set):
- `lib/validators.ts`: `deriveNodeRole` + `buildNodeRoster` (pure, tested) — role = validator / sentry / rpc / snapshot / node, from moniker heuristics + the valoper moniker set; sorted validators-first. `NodeRole` / `NodeRosterRow` types.
- `components/validators/NetworkNodesRoster.tsx`: premium-styled table (Name / Role / Node-ID / IP / seen-by) with search; `validators.css` role badges.
- `pages/Validators.tsx`: stores aggregated `NetInfo` + valoper moniker set; "Network Nodes" stat now anchors down to the roster.
- Verified: tsc/eslint clean, 2086 tests (10 new roster tests), build OK.
