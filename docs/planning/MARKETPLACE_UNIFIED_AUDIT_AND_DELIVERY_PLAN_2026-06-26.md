# Memba Marketplace — Unified Audit & Delivery Plan (v2)

**Date:** 2026-06-26
**Owner:** CTO (cross-perspective expert team: 2× Gno core eng, FSE, UX, UI, security, + 5 Gno users)
**Status:** 🟢 v2 CONFIRMED by expert panel (confirmation pass 2026-06-26). **Wave W0 COMPLETE 2026-06-26** (W0.1–W0.5 implemented + tested on branch `feat/marketplace-w0-safety`; G0 gate green — see §9 "W0 — completion record"). Next: W1 on GO.
**Single source of truth** for the Marketplace program. Supersedes the trading-relevant scope of the per-lane docs (`NFT_MARKETPLACE_*`, `MARKETPLACE_ACTIVATION.md`, `SERVICES_ACTIVATION.md`).

> **v2 changelog (why this differs from v1):** A 3-lens adversarial panel (realm-security, frontend-arch, product/econ) reviewed the v1 plan and returned REWORK / SHIP-WITH-FIXES / REWORK. v2 incorporates every finding: v1 descoped to **NFT + Services** (Tokens + Agents earned as v1.1/v1.2); **per-lane fees** (not flat 2%); **shell-only unification with lane-native trade panels**; **zero XP for trade volume + product KPIs/kill-thresholds at every gate**; on-chain correctness fixes (no `tokenfactory_v2` redeploy, no `Pause` on the fee realm, `SplitProceedsBPS`, safe OTC redesign); and wave-boundary corrections (structured reads/offers/pagination are **realm** changes folded into the v3.1 redeploy, not W0 frontend tasks). Panel findings are archived in §14.

---

## 0. TL;DR

We are turning three disconnected, dark half-products + a missing fourth into **one Marketplace**: one front door, lane-native trade flows, one DAO-owned **per-lane** fee spine. The on-chain stack is security-strong and gno-core-compatible. **v1 = a polished 2-lane marketplace (NFTs + Services)** on the unified shell + fee spine; **Tokens (OTC) and Agents are earned as v1.1/v1.2** on real activity. Near-term "production" = **public launch on test13** (mainnet chain-gated on gno #5669). Each wave closes with a tiered **deep-review → security-review → triple-check** gate that is also a **product gate** (KPIs + kill-threshold), not just CI.

**Locked decisions (2026-06-26):**
1. **v1 scope = NFT + Services.** Token-OTC → v1.1, Agents → v1.2, each gated on real activity. No "coming soon" tabs — a lane tab renders only when the lane is live.
2. **Per-lane fee** in `memba_market_config` (a `feeBPS(assetType)` map, DAO-tunable): NFT **2%**, Services **2%/5%** (existing), Token-OTC **≤0.5%** (set when built), Agents TBD. All → DAO treasury. Creator royalties (5%, cap 10%) preserved on top.
3. **Token venue = OTC fixed-price** (v1.1), restricted to `tokenfactory_v2`-minted tokens (provenance you control), not generic grc20.
4. **Target = public test13 launch + full design rework** (mockups approved).
5. **Unify the shell only** — one front door / discovery / activity / identity / fee-row convention; **each lane owns its trade panel.**
6. **"Sell anything"** single entry that routes by asset type.
7. **Zero XP for trade volume** (anti-wash); don't headline raw volume; per-lane product KPIs + kill-thresholds at every gate.
8. **Treasury & admin:** fee-config treasury + admin = the **2-of-2 multisig** now, with a 2-step `TransferAdmin` → **memba_dao executor**; after handoff, fee changes flow through DAO proposals. `MaxFeeBPS = 500` (5%) clamp.
9. **Agent payments = on-chain** (when v1.2 is built) so the per-lane fee → DAO applies — but the engine must be **fully specified before it is committed** (it is roadmap, not v1).

---

## Table of contents
1. Audit verdict (4-lens) + panel review outcome
2. Current-state inventory
3. Gno ecosystem & breaking-change status
4. Target architecture
5. Fee spine specification (`memba_market_config`) — per-lane, no-Pause, SplitProceedsBPS
6. v1 lane specs — NFT, Services
7. Roadmap lane specs — Token-OTC (v1.1), Agents (v1.2)
8. Design rework specification (shell-only)
9. Delivery plan — v1 Waves W0–W2; v1.1/v1.2 roadmap
10. Quality program — tiered reviews, triple-check, product gates (KPIs + kill-thresholds)
11. Cold-start / liquidity strategy
12. Risk register
13. Go-live runbook outline
14. Appendix A — expert-panel findings (archived) · Appendix B — file/realm index

---

## 1. Audit verdict (4-lens) + panel review outcome

**Headline:** There is no "Marketplace" yet — three flag-gated, currently-dark surfaces (NFT / Services / AI agents) with **no unified front door, no shared asset model, no DAO fee layer**, plus a missing token-trading lane. The realms are security-strong and gno-core-compatible. The work is **~70% productization/unification, ~30% new on-chain capability**.

### 1.1 Frontend (FSE/UX)
- Three separate "marketplaces" (`MarketplaceHub`/`CollectionPublic`, `FreelanceServices`, `Marketplace.tsx` (agents)), three flags, three data substrates (NFT = on-chain RPC; Services = backend REST `/api/marketplace/escrow`; Agents = backend REST `/api/marketplace/agents` + `SEED_AGENTS` mock).
- 🔴 **Gating/allowlist mismatch (top safety risk):** `CollectionPublic` trades **v3** (`source="v3"`, `CollectionPublic.tsx:371`) but gates on the **v2** validity predicate (`isNftMarketValid()` → `memba_nft_market_v2`, `config.ts:532,579`); v3 is excluded from `REALM_ALLOWLIST.test13` (`config.ts:212-235`) and the broadcast layer never consults the allowlist (`grc20.ts:127`). **Correct fix is ~5 lines** (gate on the engine actually traded), **not** a global broadcast assert — see §9 W0.1.
- 🟠 Offers built but `OFFERS_ENABLED=false`; accept-offer can't be wired today because **there is no on-chain offers read** (realm change, §6.1).
- 🟠 Brittle reads: regex over markdown `Render()` (`nftMarketplace.ts:73-103`) drops listings on format drift, truncates seller addresses, lossy fractional math; **`render.gno` itself truncates** (`truncPath`) so listing-match can silently fail; token grid O(supply) fan-out (`v3TokenGrid.ts:48`). The realm exposes **no structured getter** — going structured is a **realm change** (folded into v3.1).
- 🟢 Broadcast layer solid (untrusted-RPC + chain-ID + confirm gates, `grc20.ts:127-203`).

### 1.2 Realms (Gno core / security)
- Strong posture: CEI/state-before-send, `IsUserCall()` guards, escrow safety valves, royalty clamps, the **`MarketTransfer`-only royalty moat**. No critical exploit in the live path.
- **Fees today:** NFT **v2 = 250 bps, v3 = 200 bps** (the v1 "keep 2%" is a *cut* for v2); tokenfactory mint **2.5%**; escrow **2% release / 5% cancel**. Recipients **`const`/hard-coded** in `tokenfactory_v2` (`g1pavqf…`) and `escrow_v2` (`g1x7k…`).
- **`memba_market_core.SplitProceeds(price, royaltyAmount)` takes NO bps param** — hardcodes `const FeeBPS=200` (`split.gno:8`, `params.gno:14`). Per-lane fees require a new `SplitProceedsBPS`.
- **`tokenfactory_v2` owns every minted token's grc20 ledger; `escrow_v2` custodies live funds** — neither can be naively redeployed (§5.2).
- Token trading does not exist. Admin single-key on market/escrow (governance gap, not exploit).

### 1.3 Strategy/docs
- Documented end-state already = "one canonical registry + versioned engines + frontend router." The unifying shell + fee spine were specified, never built. Stale docs: `NFT_ACTIVATION.md`, `MARKETPLACE_ACTIVATION.md`, `SERVICES_ACTIVATION.md`, `NFT_V3_TRADING_UI_SCOPE.md`.

### 1.4 Panel review outcome (2026-06-26)
- **Realm-security: REWORK** — config-realm SPOF, SplitProceeds contradiction, unsafe generic-grc20 OTC, redeploy-bricks-ledgers, dust-fill fee evasion, migration window.
- **Frontend-arch: SHIP-WITH-FIXES** — W0 tasks misattributed (structured reads/offers/pagination are realm changes), broadcast-assert wrong mechanism, UnifiedListing leaks on services, no marketplace E2E, fee-fact error (v2=250).
- **Product/econ: REWORK** — 4-lane v1 unschedulable + empty tabs, 2% kills OTC liquidity, wash-trading via XP, services 2%/5% incoherent with "flat 2%", unified panel confuses, no KPIs/kill-thresholds, no cold-start story.
- **Resolution:** all folded into this v2 (see §0 decisions + §14).

---

## 2. Current-state inventory

### 2.1 Realms on test13
| Realm | gno.land path | Address | State | Note |
|---|---|---|---|---|
| `memba_collections` (canonical registry, **irreversible**) | `r/samcrew/memba_collections` | multisig seq 43 | ✅ live | launchpad reads live; trading gated |
| `memba_nft_v2` | `r/samcrew/memba_nft_v2` | `g106ve73py5fk2q9enleautuvajf6y9l0pd6h3zg` | ✅ live | fee 250 bps |
| `memba_nft_market_v2` | `r/samcrew/memba_nft_market_v2` | `g15unfxh9zfm75puw2lqmsun2lv8c397e0efkp2u` | ✅ live | dark |
| `memba_nft_market_v3` | `r/samcrew/memba_nft_market_v3` | `g1pucv5exvs0pxlfe39qlyu4pge47llcx78nx5nj` | ✅ deployed | **not registered, not wired**; fee 200 bps; **no structured getters** |
| `memba_market_core` (pure pkg) | `p/samcrew/memba_market_core` | — | built; not in `realm-versions.json` | `SplitProceeds` hardcodes 200 |
| `tokenfactory_v2` | `r/samcrew/tokenfactory_v2` | fee→`g1pavqf…` | ✅ live | **owns all minted ledgers — never redeploy** |
| `escrow_v2` | `r/samcrew/escrow_v2` | fee→`g1x7k…` (const) | ✅ live | **custodies funds**; redeploy needs migration |
| `agent_registry` | (live) | — | ✅ live | agents read via backend + mock |
| `grc721` fork | `p/samcrew/grc721` | — | ✅ live | vendored |

- **Admin multisig:** `samcrew-core-test1` 2-of-2 = `g10kw7e55e9wc8j8v6904ck29dqwr9fm9u280juh`. v3 `AdminAddress` = `g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0`.
- `RegisterMarket(v3)` NOT done.

### 2.2 Frontend surfaces — see §1.1. Services + Agents are **backend-fed**, a fact that shapes the shell adapters (§4).

---

## 3. Gno ecosystem & breaking-change status

**No code-level breaking change** to the marketplace realms from recent gno-core activity. Every API used (`chain/banker`, coins, grc20 teller `Transfer(0, cur, …)`, `p/nt/*/v0`, interrealm-v2 crossing) is byte-stable vs today's `origin/master`. grc721 #5792 hits upstream `p/demo/.../grc721`, which the realms don't use (they vendor `p/samcrew/grc721`). `GNO_CORE_BREAKING_CHANGES.md` is stale/orthogonal (boards2/GovDAO).

**Pre-ship gates (not blockers):** (1) refresh gno checkout; (2) recompile + `gno test ./...` for all touched realms (incl. new `memba_market_config`, modified `memba_market_core`, `memba_nft_market_v3.1`) on fresh master, **with an adversarial mock grc20** (fee-on-transfer / reverting / reentrant) in the suite once OTC is built; (3) confirm the deploy target exposes `chain/banker`, `chain/runtime/unsafe`, `p/nt/*/v0`; (4) spot-check gas/storage money paths after recompile (#5198 storage-deposit refund). Mainnet remains gated on gno #5669 → test13 is production.

---

## 4. Target architecture

**One front door · lane-native flows · one per-lane fee spine.** Keep the layered on-chain design (the moat); add the unifying shell + fee spine.

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 4 — Unified frontend SHELL (NEW)                           │
│   One front door, discovery grid, activity feed, identity, fee   │
│   convention, "Sell anything". LANE-NATIVE trade panels.         │
│   UnifiedListing = discriminated union w/ per-lane laneData.     │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 3 — Fee spine (NEW): r/samcrew/memba_market_config         │
│   DAO-owned. feeBPS(assetType) MAP + treasury. PURE non-failing  │
│   getter (NO Pause). Engines clamp locally + safe fallback.      │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 2 — Trade engines (versioned, swappable)                   │
│   nft_market_v3.1 (v1) · escrow_v2 (v1) · token_otc_v1 (v1.1) ·  │
│   agent_payments (v1.2). Each registers/reads config.            │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 1 — Asset registries (immutable / never-redeploy)          │
│   memba_collections · tokenfactory_v2 · escrow_v2 · agent_registry│
└─────────────────────────────────────────────────────────────────┘
```

### 4.1 Common model (frontend) — discriminated union, not a flat shape
```ts
type AssetType = 'nft' | 'service' | 'token' | 'agent';
interface BaseListing {
  assetType: AssetType;
  id: string; title: string; image?: string; verified: boolean;
  seller: string;            // full bech32, never truncated in trade paths
  feeBps: number;            // read from memba_market_config per lane
  source: 'chain' | 'backend';
  engine: { path: string; addr: string };
}
type UnifiedListing =
  | (BaseListing & { assetType:'nft';   price:{amount:bigint;denom:'ugnot'}; royaltyBps:number; actions:('buy'|'offer'|'list')[] })
  | (BaseListing & { assetType:'service'; milestones:{title:string;amount:bigint}[]; actions:('hire'|'fund'|'release'|'dispute')[] })
  | (BaseListing & { assetType:'token'; unitPrice:bigint; available:bigint; actions:('fill'|'list')[] })   // v1.1
  | (BaseListing & { assetType:'agent'; perCall:bigint; actions:('subscribe'|'topup')[] });                 // v1.2
```
- **Reads:** a per-lane adapter returns `UnifiedListing[]` from its substrate (NFT = structured qeval against v3.1; Services/Agents = backend REST). No regex.
- **Writes:** the shell routes to the **lane's own trade panel + builders**, then `doContractBroadcast` (unchanged gates). There is **no single shared trade panel** — only a shared fee-row convention and card/shell chrome.

### 4.2 Why shell-only (not one panel, not one contract)
A single contract for all assets is an immutability/security mistake. A single trade *panel* across own-an-item / hire-a-human / swap-fungible / pay-per-call is a forced metaphor that confuses (panel finding H5). We unify what genuinely is shared — discovery, identity, activity, the fee convention — and let each transaction be itself.

---

## 5. Fee spine — `r/samcrew/memba_market_config`

DAO-owned source of truth for **per-lane** protocol fee + treasury. Fixes hard-coded recipients and the `memba_market_core` immutability tension.

### 5.1 ABI (draft — finalize in W1 design review)
```
// reads — PURE, non-failing, no panic path
GetFeeBPS(assetType string) int        // e.g. "nft"->200, "service"->200, "token"->50
GetTreasury() address
GetLaneConfig(assetType string) (int, address)
Render(path) string                     // human view + audit log

// admin — multisig now → 2-step to memba_dao executor → DAO proposals after handoff
SetFeeBPS(cur realm, assetType string, bps int)   // clamp 0..MaxFeeBPS(500)
SetTreasury(cur realm, a address)                 // 2-step propose/accept
TransferAdmin(cur realm, a address); AcceptAdmin(cur realm)
// NO Pause() — see C1 below
```
- **No `Pause`.** A pausable config read on every trade is a single point of failure that bricks all lanes at once. `GetFeeBPS`/`GetTreasury` are pure reads over set-once-then-stable state with **no failure path**.
- **Engines clamp + fall back, never revert on config.** Each engine holds a compile-time `MaxFeeBPS` const and a safe local fallback recipient/bps. On an implausible read (`bps>MaxFeeBPS` or `treasury==""`) the engine uses its fallback and still settles the trade — a fee misconfig must never strand a user's swap. **Per-engine `Pause` remains the kill switch.**
- **Audit trail:** every setter emits an event; every settlement event emits the **`feeBps` + `treasury` actually used** (so the indexer/audit are authoritative across config changes).
- **`MaxFeeBPS=500`**; DAO can tune any lane's bps via proposal post-handoff. (decision #8)

### 5.2 `memba_market_core` change + engine migration
- **Add `SplitProceedsBPS(price, feeBPS, royaltyAmount int64)`** to `memba_market_core`; keep `SplitProceeds` as a `feeBPS=FeeBPS` wrapper for conformance. Version-bump + re-review. **All** engines call the bps-taking variant with the config value.
- **`memba_nft_market_v3.1`** (redeploy): read NFT-lane bps + treasury from config via fallback; **add structured getters** (`GetListingsPage`, `GetOffersForToken`, `TokensOfCollection(offset,limit)`) so the frontend can drop regex/`O(supply)`; emit `feeBps`/`treasury` in `Sale`.
- **`escrow_v2`:** route the **2% release** fee → `treasury` via config. ⚠️ Confirmation pass: `FeeRecipient`/`AdminAddress` are **`const`** (`escrow.gno:46-47`) — an in-place setter is **not** achievable; **redeploy + fund migration is the expected path**, not the unlikely branch. **W0.5's audit pre-scopes the drain/migration ceremony** (open contracts/balances), and that ceremony is **costed into W2** at GO. The 5% cancel fee → freelancer semantics are unchanged.
- **`tokenfactory_v2`: NEVER redeployed** (it owns all minted grc20 ledgers — a redeploy bricks every token). Its *mint* fee (`var feeRecipient` but **no setter wired**) is therefore **practically frozen as-is** under the no-redeploy lock — adding a setter would itself require the forbidden redeploy. **Only the OTC *trade* fee** (new v1.1 engine reading config) is DAO-routable. Leave the mint fee as-is and document.

### 5.3 Fee semantics (locked, per-lane)
| Lane | Protocol fee | Notes |
|---|---|---|
| NFT | **2.0% → DAO** | v3.1; royalty 5% (cap 10%) on top, unchanged. v2 retires (was 250). |
| Services | **2% release → DAO**; **5% cancel → freelancer** (NOT protocol) | Confirmation pass corrected this: only the 2% release fee is DAO revenue (`escrow.gno:322`); the 5% cancel fee is paid by the cancelling client **to the freelancer** as compensation (`escrow.gno:482-485`), a party-to-party transfer, never labelled "→ DAO". Surfaced honestly in the panel (§6.2). |
| Token-OTC (v1.1) | **≤0.5% → DAO** | competitive vs DEX ~0.3%; set when built. |
| Agents (v1.2) | TBD → DAO | set when the engine is specified. |
- **UI invariant:** the fee row reads `feeBps` from chain per lane (kills the `nftConfig.ts:49-55` hardcode drift). On services it shows the real release/cancel split — never a false "flat 2%".

---

## 6. v1 lane specs

### 6.1 NFT lane (v3.1)
- **Engine:** `memba_nft_market_v3.1` (config-reading + structured getters). Atomic CEI buy (`market.gno:241` pattern), escrow-based offers, ugnot settlement.
- **Frontend:** structured reads (no regex), buy/list/**offers ON** (now possible — v3.1 exposes `GetOffersForToken`), accept-offer wired, portfolio/"my listings" (consume `nftApi.ts:80`), paginated/windowed token grid.
- **Migration (decision #5):** migrate reads to v3.1; keep the v2 collection tradeable via v3.1 **if compatible** (determine compatibility in W0/W1 — if incompatible, v2 collection is read-only with a clear notice, no stranded dead-ends). Retire `memba_nft_market_v2` after verified.
- **Registration ceremony (panel H3):** **Pause v3 (if ever registered) → verify no in-flight → RegisterMarket(v3.1) → smoke-test one sale → UnregisterMarket(v3)**; gate asserts the registered set is exactly `{v3.1}`. Document that stale `SetApprovalForAll` to a retired engine persists.

### 6.2 Services lane (escrow_v2)
- **Engine:** `escrow_v2`, fee → config treasury (§5.2). Milestone funding, dispute, auto-refund/auto-resolve timeouts unchanged.
- **Cancel-fee honesty (panel H4 + confirmation pass C1):** the 5% cancel fee is paid by the **cancelling client → the freelancer** (`escrow.gno:482-485`, compensation for lost opportunity) and is **NOT protocol/DAO revenue** — only the 2% release fee goes to the DAO. The lane-native service panel must show: 2% release → DAO, 5% cancel → freelancer. **Never** label the 5% "→ DAO". This is the exact dishonesty the task exists to prevent.
- **Frontend:** fold `FreelanceServices` into the shell as the Services lane (adapter over the existing backend REST + chain `Render`); lane-native panel = milestone list (fund/release/dispute), not a buy button. Retire the standalone page (redirect, preserve URLs).
- **Block-height dates caveat:** escrow/offer timeouts are block counts (~2s assumption); surface dates via RPC `/block?height=N` (the reviews-realm "6 Jan 1970" class bug).

---

## 7. Roadmap lane specs (earned after v1)

### 7.1 Token-OTC — `r/samcrew/memba_token_otc_v1` (v1.1)
Fixed-price OTC of grc20, **restricted to `tokenfactory_v2`-minted symbols** (no generic grc20). Mirrors NFT *flow*, but with fungible-specific safety:
1. Seller `tokenfactory_v2.Approve(symbol, otcRealm, amount)`.
2. `ListTokens(cur, symbol, amount, unitPrice)`.
3. `Fill(cur, listingId, qty, expectedUnitPrice)` attaching `qty*unitPrice` ugnot. **Atomic CEI:** re-validate balance **and** allowance; effects first; `TransferFrom`; **measure buyer balance delta == qty** (revert on mismatch — fee-on-transfer defense); pay fee→treasury (per-lane ≤0.5%) then seller-last.
4. `CancelListing(cur, listingId)` — seller only; ids never reused; `Fill` binds `expectedUnitPrice` (front-run/price-change revert).
- **Anti-dust-evasion:** per-fill minimum notional + `fee>0 || feeBps==0` invariant.
- **No `salesLog` growth** — history via events only (indexer owns it).
- **Reentrancy guard** if generic tokens are ever allowed later. **Tests:** adversarial mock grc20 (fee-on-transfer / reverting / reentrant) or the gate is theater.
- **Provenance UI:** verified ("featured") section + labelled **unverified** section (never silent-hide).

### 7.2 Agents — `r/samcrew/memba_agent_payments_v1` (v1.2)
**Must be fully specified before commit.** On-chain credit purchases (decision #9): credits = an **escrow-like deposit with a refund-on-timeout valve** (custody state machine like escrow). Per-lane fee → DAO. Backend `agent_registry` reads replace `SEED_AGENTS` mock. If unspecced at v1.1 close, it stays roadmap, not committed.

---

## 8. Design rework specification (shell-only)

Full rework to Memba's **black + teal `#00d4aa` + gold `#c9a227`** theme + §13 light tokens. Mockups approved (discovery + a representative trade panel).

- **IA:** one front door at `/:net/marketplace`. Legacy `/nft`, `/services`, `/marketplace`(agents) **redirect** in with lane filter; URL-state via `useSearchParams` (net-new — tasked in W1). **Lane tabs render only for live lanes** (no "coming soon"): v1 shows NFTs + Services only.
- **Shell-shared:** discovery grid (lane-typed cards), stats strip (Volume 30d **net of self-transfers**, listings, DAO fees 30d [gold], traders), live activity (all live lanes), search, identity, the **fee-row convention**.
- **Lane-native trade panels:** NFT (buy/offer + 2% + royalty breakdown), Services (milestones + release/cancel fee honesty). No forced single panel.
- **"Sell anything"** → chooser → routes to the live lane's create flow (NFT create, post a service).
- **AAA bars:** light/dark/mobile parity (`useIsMobile`/`MobileShell`/`--mb-*`), empty/loading/error per lane, a11y pass, integer-exact prices, no truncated addresses in trade paths. No i18n (project has none — not a gap).

---

## 9. Delivery plan

> v1 = **W0 → W1 (NFT) → W2 (Services)**. Shell unified from W1; tabs appear only as lanes land. Every wave ends in the §10 product gate. **Put a calendar/person-week estimate on each wave before GO** (panel C1).

### Wave W0 — Safety & foundation
- **W0.1 (frontend, ~5 lines)** Fix the gating bug the *right* way: gate `CollectionPublic` on the engine it trades (`isNftMarketV3Valid = () => isRealmValid(NFT_MARKETPLACE_V3_PATH)`); add v3.1's path to `REALM_ALLOWLIST.test13` **only at W1.2 registration** (until then the page stays correctly dark). Optional defense-in-depth: assert `isRealmValid(engine.marketPath)` **at the trade-builder call site**, never a global `doContractBroadcast` path-assert (would break DAO/escrow/gnoswap and miss the operator-address approval). Files: `config.ts`, `tradeEngine.ts`, `TradeModal.tsx`.
- **W0.2 (frontend)** Typed parser + **golden tests over the existing `Render()` markdown** (incl. truncated-path cases, `truncPath` match bug). *Structured reads themselves move to W1.2 (realm change).*
- **W0.3 (frontend)** **Window** token enumeration to the visible page (true O(1)-per-page needs the v3.1 `TokensOfCollection` getter — W1.2). Relabel honestly: W0 = windowing, W1.2 = paginated getter.
- **W0.4 (frontend)** Retire dead code: `NFTTxToast.tsx`, `NFTImage.tsx`, duplicate escrow builders, stale `escrowTemplate.ts`/`nftTemplate.ts`, fix stale comments. **Do NOT delete `SEED_LISTINGS` until §11 seeding replaces it.**
- **W0.5 (realm/ops)** Recompile all realms on fresh gno master + `gno test ./...`. **On-chain audit of `escrow_v2` open contracts/balances** (decides in-place setter vs migration for W2).
- **Exit (G0):** no un-gated trade path; golden-tested parser; realms green on master; escrow fund-state known.

#### W0 — completion record (2026-06-26, branch `feat/marketplace-w0-safety`)
All five tasks implemented with TDD where applicable; full unit suite + `npm run build` green (one unrelated pre-existing `DAOsTab` timeout flake, proven by isolated 20s-timeout pass).
- **W0.1 ✅** `isNftMarketV3Valid()` added; `CollectionPublic` now gates on the v3 engine it trades (4 new gating tests + page-test mock updated). v3 stays out of the allowlist → surface correctly dark. Commit `bf96858`.
- **W0.2 ✅** Listing parser hardened — fixed lossy fractional-price decode (`"2.5"` → 2_500_000, was 2_000_005); golden tests reproduce `render.gno` byte-for-byte; the `truncPath` >2-segment match hazard is pinned for the W1.2 structured-getter fix. Commit `0605ccf`.
- **W0.3 ✅** `fetchV3Tokens` windowed (default 60) with chunked concurrency (≤12 in-flight) — bounds the O(supply) RPC fan-out; caller-compatible. Commit `fbf30be`.
- **W0.4 ✅** Removed dead code: `NFTTxToast`, `NFTImage`, retired `nftTemplate`/`grc1155Template` codegen (+ tests). **Triple-check correction:** the confirmation pass claimed `SEED_LISTINGS` is live in `FreelanceServices` — FALSE; `FreelanceServices` reads listings from `api.getServiceListings` (backend) and escrow builders from `lib/marketplace/builders`, so `escrowTemplate.ts`/`SEED_LISTINGS` has **zero live importers**. Kept `escrowTemplate.ts` anyway, reserved for §11 seeding. Commit `07f57b4`.
- **W0.5 ✅ — two findings:**
  - **escrow_v2 on-chain audit (test13):** `Render` + `stats` show **Total Contracts: 0, Active: 0, Total Value: 0 ugnot**. The realm custodies **no user funds**, so a W2 redeploy **orphans nothing — a clean redeploy is safe and no migration ceremony is needed** (supersedes the "redeploy + fund migration" worry in §5.2/§12-R4/§9-W2 for test13; re-check on mainnet before that launch).
  - **Recompile vs fresh upstream gno master (`9e8df24a6`, 2026-06-26):** `memba_market_core`, `memba_collections`, `memba_nft_market_v2`, `memba_nft_v2` all **compile + `gno test` PASS** → confirms the breaking-change analysis (no gno-core API break). `memba_nft_market_v3`'s own code compiles, but standalone `gno test` couldn't resolve its `memba_collections` dependency from the module cache (cross-realm harness wiring, not a code break); its authoritative suite is the deployer gnodev harness (samcrew-deployer#33). The shared gno checkout was restored to its original detached HEAD afterward.

### Wave W1 — Unified shell + NFT lane live + fee spine
- **W1.1 (realm)** Build + deploy `memba_market_config` (§5: per-lane map, no Pause, pure getter, 2-step admin, clamp). Add `SplitProceedsBPS` to `memba_market_core` (version bump, re-review). Security review.
- **W1.2 (realm)** `memba_nft_market_v3.1`: config-reading (fallback-safe) + **structured getters** (listings page, offers-for-token, paginated enumerate) + emit `feeBps`/`treasury`. Redeploy. Registration ceremony (§6.1). Security review.
- **W1.3 (frontend)** Unified shell: front door + discovery + activity + identity + URL-state + redirects (NFT tab live, Services tab appears in W2). `UnifiedListing` discriminated union + lane router.
- **W1.4 (frontend)** NFT lane end-to-end on v3.1: structured reads, buy/list/**offers ON**, accept-offer wired (v3.1 offers getter), portfolio view, fee row reads chain.
- **W1.5 (design)** NFT + shell visual rework; light/dark/mobile; empty/error states; `MobileShell` wiring.
- **W1.6 (backend/indexer)** Ingest config-fee + v3.1 `Sale` events (with `feeBps`/`treasury`); volume (**net of self-transfer**) / floor / DAO-fees endpoints.
- **W1.7 (frontend)** "Sell anything" → NFT create (Services added W2).
- **W1.8 (test)** Playwright E2E for the NFT lane (none exist today — net-new).
- **Exit (G1):** NFT lane live on test13 deploy-preview; 2%→DAO verified on-chain; offers/accept work; design AAA; security clean; **product KPI met** (§10).

### Wave W2 — Services lane folded in
- **W2.1 (realm)** `escrow_v2` fee → config treasury (in-place setter or migration per W0.5 audit). Cancel-fee honesty spec.
- **W2.2 (frontend)** Services adapter + lane-native milestone panel; fold `FreelanceServices` into shell; Services tab appears; retire standalone page (redirect, preserve URLs).
- **W2.3 (frontend)** "Sell anything" → post a service.
- **W2.4 (test)** Services E2E.
- **Exit (G2):** Services lane live + unified; fee→DAO; design/security gates; product KPI met. **v1 COMPLETE.**

### Roadmap (earned, separately planned)
- **v1.1 — Token-OTC** (§7.1): new realm + adversarial-token tests + security review + ≤0.5% fee + provenance UI. Gated on v1 KPIs + a written go-decision.
- **v1.2 — Agents** (§7.2): spec the on-chain payment engine first; backend real reads; per-lane fee. Gated on v1.1.

### W1/W2 entry conditions (from the confirmation pass — not W0 gates)
These are recorded so they aren't lost; none blocks W0.
- **W1.1:** decide **read-at-settlement vs snapshot** for `feeBPS(assetType)` and document user-facing fee predictability (the `MaxFeeBPS=500` clamp bounds the worst case if a DAO change lands between quote and settlement).
- **W1.2:** every new v3.1 getter (`GetListingsPage`/`GetOffersForToken`/`TokensOfCollection`) ships with **hard offset/limit page caps**, and **add a secondary offers-by-token index** (current `offerKey=collection:token:buyer` layout has no per-token index → naive `GetOffersForToken` iterates all offers). Otherwise the getters are an on-chain gas/DoS surface.
- **W1.3:** the "tab renders only when live" predicate for NFT must key off the **new `isNftMarketV3Valid()`**, not the legacy v2 `isNftMarketValid()`.
- **W1 (type finalize):** the §4.1 `service` variant must carry **both** fee rates (2% release / 5% cancel) — `BaseListing.feeBps` alone can't express the asymmetry; the service panel reads both lane-natively.
- **W2.2:** carry the **Services backend-auth dependency** into the shell explicitly — `FreelanceServices` posting needs `auth.token` (bearer) and `${API_BASE_URL}/api/marketplace/escrow`; define shell behavior when unauthenticated or `API_BASE_URL` unset. "Sell anything → post a service" inherits this.
- **W2 (schedule risk):** treat escrow fee-routing as **redeploy + fund migration** (const recipients); surface the migration-ceremony schedule cost at GO, gated on the W0.5 audit result.

---

## 10. Quality program — tiered reviews, triple-check, product gates

Per your AAA methodology, but **tiered** so ceremony matches risk (panel M4).

### 10.1 Rigor tiers
- **Tier 1 (realm / money-path):** TDD + gnodev integration harness + **adversarial mock-token tests** (for OTC) + full multi-perspective security review + triple-check. Applies to: `memba_market_config`, `memba_market_core` change, v3.1, escrow_v2 change, token_otc_v1, agent_payments.
- **Tier 2 (frontend / shell / adapters):** code review + targeted unit/E2E + design pass. Pre/post deep review only for the shell architecture (W1.3) and the visual rework (W1.5).
- **Tier 3 (dead-code / docs / mechanical):** normal code review. No 7-perspective ceremony for deleting `NFTTxToast.tsx`.

### 10.2 Triple-check protocol (Tier 1 + load-bearing Tier 2)
Every "done" claim verified three independent ways — (1) code read (file:line), (2) automated test, (3) live observation (RPC/abci, deploy-preview, Playwright). < 3 ⇒ "unverified", not done. An adversarial reviewer tries to disprove each gate claim before sign-off (this caught 3 false negatives in the Quests audit).

### 10.3 Product gates (every Gn is a product gate, not just CI)
Each gate adds **per-lane KPIs + a kill threshold**:
- **Engineering exit:** realms green on master; money path verified on-chain; no un-gated trade path; design AAA (light/dark/mobile, empty/error, a11y); security review zero High/Critical; docs + `realm-versions.json` updated.
- **Product exit (example, tune before GO):** "G1→W2 requires the NFT lane has ≥ N real (non-team) listings and ≥1 organic sale within 14 days of preview launch; else **pause and diagnose** before building the next lane." Each lane has a **kill runbook** (in-flight tx, stranded listings, shell paused-lane state, user comms) — the UX half of the pre-signed `Pause`/`UnregisterMarket`.
- **Anti-wash (decision #7):** marketplace volume grants **zero** Quests XP; raw volume not headlined; verified vs total volume shown separately.

### 10.4 Frequency
Deep reviews: pre+post on Tier-1 waves + shell/design. Security reviews: every realm-touching wave. Triple-check: every gate (G0–G2 for v1, then v1.1/v1.2).

---

## 11. Cold-start / liquidity strategy (panel M3 — new section)

An empty marketplace is the most likely failure mode. v1 = NFT + Services specifically because **Services has organic demand** (hire-a-human) independent of speculation, and NFTs are visually rich.
- **Seeding:** do NOT delete the only seed mechanism without a replacement. Convert `SEED_LISTINGS` into a **curated genesis/featured set** (real team collections + a few real service listings) so launch day is non-empty.
- **Seller acquisition:** recruit N creators + N service providers before public launch (use gnobuilders/gnolove network); the verified-badge program gives them status.
- **Incentives (non-XP):** the strategy doc's **90-day fee waiver on new launches** + 0% primary-mint fee — growth levers that don't feed wash-trading.
- **Discovery depth:** search + verified filter + activity feed make a small marketplace feel alive.
- **KPIs** (§10.3) tell us if cold-start is failing before we build the next lane.

---

## 12. Risk register
| # | Risk | Sev | Mitigation | When |
|---|---|---|---|---|
| R1 | v3 gating/allowlist mismatch | 🔴 | Engine-correct gate (W0.1); add v3.1 to allowlist at registration | W0 |
| R2 | Config realm = SPOF if it can fail/pause | 🔴 | No Pause; pure getter; engines clamp + fallback, never revert; per-engine kill switch | W1 |
| R3 | `SplitProceeds` has no bps param | 🟠 | Add `SplitProceedsBPS`, version bump, route all engines | W1 |
| R4 | Redeploying tokenfactory_v2 bricks ledgers; escrow_v2 orphans funds | 🔴 | Never redeploy tokenfactory_v2; escrow redeploy gated on fund audit + migration | W0/W2 |
| R5 | NFT registry migration window (two/zero engines, stale approvals) | 🟠 | Pause-first ceremony; assert exact set; document stale approvals | W1 |
| R6 | OTC generic-grc20 unsafe (allowance≠balance, fee-on-transfer, reentrancy) | 🔴 | tokenfactory-only allowlist; delta==qty; atomic re-validate; reentrancy guard; adversarial tests | v1.1 |
| R7 | Dust-fill fee evasion (partial fills) | 🟠 | Per-fill min notional + `fee>0` invariant | v1.1 |
| R8 | **Cold-start / empty marketplace** | 🔴 | 2-lane focus, Services organic demand, curated seeding, seller acquisition, KPIs | v1 |
| R9 | **OTC 2% fee kills liquidity** | 🟠→resolved | Per-lane fee ≤0.5% on token-OTC | v1.1 |
| R10 | **Wash-trading / fee-farming** | 🟠→resolved | Zero XP for volume; net-of-self volume; verified vs total | all |
| R11 | Services fee incoherence (2%/5% vs "flat 2%") | 🟠 | Per-path fee honesty in panel; spec who pays cancel | W2 |
| R12 | Netlify native flag trap (`assertSafeFlags`) | 🟠 | Keep lane flags in `SAFETY_GATED_FLAGS` until realm live; deploy via `netlify.toml`, never `deploy-frontend.yml` | each |
| R13 | Mainnet blocked on gno #5669 → test13 = play-money revenue | 🟡 | State plainly; fee spine is validated, not monetized, until mainnet | program |
| R14 | No marketplace E2E exists | 🟠 | Per-wave Playwright specs | each |
| R15 | **Legal/regulatory surface** (services escrow, later token trading) | 🟡 | One-line counsel read (counsel already engaged for wallet R&D) | before v1 / before v1.1 |
| R16 | Agent payment engine committed but unspecified | 🟠→resolved | Roadmap only; spec before commit (decision #9) | v1.2 |

---

## 13. Go-live runbook outline (per wave)
1. Recompile realms on fresh gno master; `gno test ./...` (+ adversarial mock tokens for OTC) green.
2. Deploy new/changed realms via multisig ceremony; record in `realm-versions.json`.
3. NFT: pause-first registration ceremony (§6.1); assert exact registered set; pre-sign + securely store `Pause`/`UnregisterMarket`.
4. Set `memba_market_config` per-lane bps + treasury; verify each engine reads + falls back safely.
5. Frontend: enable lane on **deploy-preview**; E2E + triple-check; verify fee lands in DAO treasury on-chain; verify **product KPI**.
6. Promote: remove flag from `SAFETY_GATED_FLAGS`, set Netlify native env, deploy via `netlify.toml` (NOT `deploy-frontend.yml`).
7. Post-launch: monitor indexer/activity/Sentry; verified-badge SLA; watch KPI vs kill-threshold.

---

## 14. Appendix A — expert-panel findings (archived 2026-06-26)

**Realm-security (REWORK):** C1 config-realm SPOF + fail-closed ambiguity → no Pause, pure getter, clamp+fallback. C2 generic-grc20 OTC unsafe → tokenfactory allowlist + delta check + reentrancy. H1 `SplitProceeds` no bps param → `SplitProceedsBPS`. H2 dust-fill evasion → min notional + `fee>0`. H3 migration window/stale approvals → pause-first ceremony. H4 tokenfactory/escrow redeploy bricks state → never redeploy tokenfactory; escrow fund-audit gate. M1 OTC front-run → bind `expectedUnitPrice`. M2 agent credits = custody → escrow-like valve. M3 emit used bps/treasury in events. M4 `salesLog` unbounded for OTC → events-only.

**Frontend-arch (SHIP-WITH-FIXES):** C1 structured reads = realm change → fold into v3.1. C2 accept-offer = realm change → v3.1 offers getter. H1 broadcast-assert wrong mechanism → engine-correct gate. H2/H3 UnifiedListing leaks on services + shell is ~1.5k LOC re-home + URL-state net-new → discriminated union + tasked. M1 fee fact v2=250. M2 pagination needs realm getter. M4 no marketplace E2E → tasked. (i18n not used — not a gap.)

**Product/econ (REWORK):** C1 4-lane v1 unschedulable + agent engine unspecified → descope to 2 lanes + dates. C2 empty "coming soon" tabs → flag whole tabs. H1 reorder Services before OTC → Services in v1. H2 2% kills OTC liquidity → per-lane fee. H3 wash-trading via XP → zero XP for volume. H4 services 2%/5% incoherent → per-path honesty. H5 unified panel confuses → shell-only + lane-native panels. M1 no KPIs → product gates. M2 no UX kill story → per-lane kill runbook. M3 cold-start → §11. M4 tier the rigor → §10.1. L3 legal → R15.

## 14b. Appendix B — file/realm index
**Realms** (`samcrew-deployer/projects/memba/realms/`): `memba_nft_market_v3/{market,offers,admin,render,params}.gno`, `memba_collections/{collection,transfer,mint,royalty,config,governance,merkle,payment}.gno`, `memba_market_core/{split,events,params}.gno`, `tokenfactory_v2/tokenfactory.gno`, `escrow_v2/escrow.gno`.
**Frontend** (`Memba/frontend/src/`): `pages/{MarketplaceHub,CollectionPublic,Marketplace,FreelanceServices,CreateCollectionLaunchpad}.tsx`, `pages/useCollectionPublic.ts`, `lib/{nftMarketplace,nftMarketplaceV3,tradeEngine,nftHub,nftApi,nftConfig,v3TokenGrid,grc20,config,agentRegistry}.ts`, `lib/marketplace/builders.ts`, `lib/safeFlags.ts`, `components/nft/{TradeModal,PriceBreakdown}.tsx`.
**Docs to update/deprecate:** `NFT_ACTIVATION.md`, `MARKETPLACE_ACTIVATION.md`, `SERVICES_ACTIVATION.md`, `NFT_V3_TRADING_UI_SCOPE.md` (stale); note marketplace compat in `GNO_CORE_COMPAT.md`.

---

*End of plan v2. Awaiting user GO to begin Wave W0 (with calendar estimates attached at GO).*
