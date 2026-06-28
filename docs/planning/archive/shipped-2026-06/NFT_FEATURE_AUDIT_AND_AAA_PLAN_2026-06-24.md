# Memba NFT Feature — Cross-Perspective Audit & AAA Implementation Plan

> **Date:** 2026-06-24 · **Author:** deep-audit session (read-only) · **Status:** FOR REVIEW
> **Chain baseline:** test13 (`gno` @ `chain/test13` = `f45cc5c88`, 2026-06-05)
> **Method:** 5 parallel mapping agents → 6 adversarial expert auditors → independent verification of the top claims.
> **Scope note:** This document is **analysis + plan only**. No code was changed. No repo branches were touched.

---

## 0. TL;DR (read this first)

The Memba NFT on-chain stack (**`memba_collections`** registry + **`memba_nft_market_v3`** engine + **`memba_market_core`** pure package + **`grc721`** fork) is **architecturally strong and security-sound**: CEI ordering, seller-last payouts, a `RegisterMarket` "moat", overflow-safe royalty math, domain-separated Merkle allowlists, an idempotent + reorg-aware indexer, an SSRF-hardened image proxy, and **100% frontend↔realm ABI alignment**. The adversarial panel found **no critical, currently-exploitable on-chain vulnerability**.

**The real gating issue is not safety — it is _unproven correctness of the money paths_ plus _activation/operational discipline_:**

1. **🔴 BLOCKER — Settlement is untested with real value.** Every realm test exercises only the *guard* paths that abort **before** any coin/NFT moves. The full `BuyNFT` / `AcceptOffer` settlement, offer refunds, and the `market_v3 ↔ memba_collections` cross-realm round-trip (`MarketTransfer` + `RoyaltyInfo`) have **no test**. Code comments reference a "Task C5" integration suite that **does not exist**. This is the one thing that must change before real funds touch v3.
2. **🟠 Indexer silently swallows schema drift.** `atoiSafe()` coerces any missing/garbled numeric field to `0`, and `applySale()` doesn't validate the `via` enum — a future event-format change degrades volume/floor/points **silently**.
3. **🟠 Activation is under-specified.** The go-live sequence (audit → `RegisterMarket` → indexer-confirmed → allowlist/router → E2E → flag-flip) and a written **rollback** (the kill-switches *exist* — see below — but aren't in any runbook, and no pre-signed pause tx is staged).
4. **🟠 Economic: creator-controlled royalty farming.** Royalty-weighted points do **not** deter a *creator* who routes royalties to their own wallet — they recover their own royalty and pay only the 2% fee + gas. Mitigation is entirely off-chain today.

**Corrected during verification (do not action these as written by the sub-audits):**
- The "CRITICAL: cross-realm `/p/` arithmetic panics on test13 (gno #5747)" claim is **REFUTED** — it only affects in-place mutation of `/p/`-declared *composite* types (e.g. `uint256`); `market_core.SplitProceeds` is plain `int64` and is safe.
- "No rollback path exists" is **REFUTED** — `memba_collections.UnregisterMarket` + `Pause` and `market_v3.Pause` all exist.
- "No indexer-lag monitoring" is **REFUTED** — `/metrics` already exposes NFT-tailer lag (#479).

**One hard strategic gate (not NFT-specific):** current **gnoland1 mainnet (1.1, 2026-04-01) lacks interrealm-v2 Phase 3** (gno #5669). Memba's interrealm-v2 realms **cannot deploy to mainnet** until the chain upgrades. NFT mainnet is downstream of that.

**Methodology constraint honored throughout:** a **parallel session owns PR #443** (`feat/nft-marketplace-phase2`) which rewrites the trading UI. This plan's actionable surface is deliberately **conflict-free**: on-chain realms, backend indexer, Creator Studio, docs, tests. See §6.

---

## 1. Verdict by question you asked

| Your goal | Verdict |
|---|---|
| **"Perfectly functional"** | Functional on the read path + ABI; **money paths unproven by tests** (WS-A). v3 not yet wired to write (allowlist seam, by design). |
| **"Top quality"** | High code quality; gaps are *test coverage*, *indexer input-validation*, and *doc/runbook completeness*, not structure. |
| **"Safe"** | No critical exploit found across 6 lenses + verification. Residual risks are economic (farming) and operational (activation/rollback discipline), both addressable. |
| **Breaking changes that could hit Memba** | One strategic chain gate (#5669 not on mainnet). NFT-relevant upstream PRs (#5747/#5792/#5745) are **not** breaking for the deployed stack (verified); compat docs are stale and should track them. |

---

## 2. Scope, method & what was verified

**Repos synced (non-destructively):** all core repos fetched; `Memba`, `gnodaokit`, `tokenfactory`, `adena-wallet`, `gno-docs`, `samcrew-deployer` already current with their remotes; `gno` left on its `chain/test13` detached pin (fetch-only). Nothing pulled into the `memba-nft-phase2` worktree or any feature branch. Full state in §11.

**Audit lenses (parallel):** Gno smart-contract security · DeFi/market economics · frontend/web security · gno-core chain-compat · backend/indexer data-integrity · QA/release-readiness. **Then** an independent verifier was tasked to *refute* the three highest-stakes claims; results folded in below (and corrected the panel where it overreached).

**Canonical source audited:**
- Realms: `samcrew-deployer/projects/memba/realms/{memba_collections,memba_nft_market_v3,memba_market_core,grc721}` (+ `memba_nft_market_v2`, `nft_market` for lineage).
- Frontend (`main`): `Memba/frontend/src/{lib/nftMarketplaceV3.ts,lib/launchpad.ts,lib/grc721.ts,lib/nftConfig.ts,lib/config.ts,pages/*,components/nft/*}`.
- Backend: `Memba/backend/internal/{indexer,service/nft_rpc.go,points,metrics,db/migrations/012_nft_events.sql}`.
- Docs: the full `docs/planning/NFT_*` corpus + `features/NFT_ACTIVATION.md`, `MAINNET_PREPARATION.md`, `GNO_CORE_COMPAT.md`.

---

## 3. Current-state architecture (concise)

```
Frontend (main; trading UI being replaced by #443)
  builders → MsgCall ─────────────────────────────────────────┐
  reads → vm/qrender + vm/qeval                                │
                                                               ▼
  r/samcrew/memba_nft_market_v3   (engine: listings + escrowed offers)
        │  RoyaltyInfo()          (read)        ┌──────────────────────────┐
        │  MarketTransfer()  ───── moat ───────▶│ r/samcrew/memba_collections│  ← canonical, IMMUTABLE
        │  banker sends (royalty, fee, seller-last)               │  registry: every collection's
        ▼                                                         │  grc721 ledger + mint phases +
  emits ONE "Sale" event (via=buy|offer, fee/royalty/denom)       │  royalty + proceeds + RegisterMarket
        │                                       p/samcrew/grc721 ─┘  (embedded, unexported)
        ▼                                       p/samcrew/memba_market_core (pure split math + frozen events)
  Backend indexer (event tailer)
        raw_events ledger → dispatch → nft_{sales,listings,offers,tokens,collections}
        reorg-safe (5-block) · idempotent · points.Recompute (royalty-weighted, deterministic)
        /metrics (signed-login ratio + NFT tailer lag)
```

**Deployed on test13 (live-verified 2026-06-23):**
- `memba_collections` ✅ deployed, in frontend allowlist (launchpad/create live).
- `memba_nft_market_v3` ✅ deployed at `g1pucv5exvs0pxlfe39qlyu4pge47llcx78nx5nj`, **NOT `RegisterMarket`-ed, NOT in frontend allowlist** (intentional — awaits Phase-3 router).
- Admin multisig (samcrew-core-test1, 2-of-2): `g10kw7e55e9wc8j8v6904ck29dqwr9fm9u280juh`.
- Feature flag `VITE_ENABLE_NFT=false` (gate enforced on all routes; #472 merged today).

**Economic params (frozen / tunable within hard caps):** platform fee v3 = **200 bps (2.0%)**; royalty default 5%, creator cap 750 bps, hard cap 1000 bps; createFee 1 GNOT; MinPrice 1000 ugnot; MaxPrice 1e15; primaryFeeBPS default 0 (≤2000). Points = royalty-weighted, non-binding, clawback-eligible (Phase-4 $MEMBA).

---

## 4. Findings (prioritized, post-verification)

Severity = exploit/impact × likelihood. **Status** reflects independent verification. Each notes whether it lands in **#443-owned** files (coordinate, don't edit).

### 🔴 Blockers for a real-fund go-live

**F1 — Money paths have zero settlement tests.** *(security + QA panels, confirmed)*
The realm suites (`*_b1..b8_test.gno`, `transfer_test`, `royalty_test`) only fire **guards that abort before** the cross-call/banker stage. There is **no test** that:
- runs `BuyNFT` end-to-end and asserts seller = `price − fee − royalty`, fee→recipient, royalty→recipient, and NFT ownership moved;
- runs `AcceptOffer` settlement from escrow;
- runs `CancelOffer` / `ClaimExpiredOffer` and asserts the buyer is refunded;
- runs `market_v3 ↔ memba_collections` together (`MarketTransfer` + `RoyaltyInfo` round-trip) — they're only tested in isolation;
- asserts `market_v3.splitProceeds` ≡ `market_core.SplitProceeds` (conformance).
Code comments defer these to "Task C5" — **which does not exist in the repo.**
**Impact:** a settlement/banker bug would surface only with real user funds, with no automated guard. **Highest priority.** *(Not #443-owned — pure realm/test work in `samcrew-deployer`.)*

**F2 — Indexer silently swallows event-schema drift.** *(indexer panel, confirmed)*
`backend/internal/indexer/dispatch.go`: `atoiSafe()` returns `0` on any parse failure (missing/renamed `price`/`fee`/`royalty`), and `applySale()` accepts any `via` (no enum check). A future realm event-format change → **silent** wrong volume/floor/points; zero-royalty (anti-wash signal) becomes indistinguishable from a parse failure.
**Fix:** validate `via ∈ {buy,offer,auction,sweep}`; make `atoiSafe` reject/log missing required fields + emit an operator alert. *(Backend — not #443-owned.)*

**F3 — Activation runbook + rollback are not written.** *(QA panel; rollback claim corrected)*
The go-live sequence is only implied across docs/scripts. Missing as a single ordered runbook: (a) **indexer must be tailing v3 from deploy-height *before* `RegisterMarket`** (else permanent event gap → wrong points/volume); (b) a written **rollback** using the **existing** levers — `memba_collections.UnregisterMarket(v3)` (revokes the moat → all v3 trades fail safe), `market_v3.Pause()`, `memba_collections.Pause()` — plus a **pre-signed multisig pause/unregister tx** staged before launch; (c) the 2-wallet E2E gate; (d) the allowlist + router wiring step (coordinated with #443). *(Docs + deploy scripts — not #443-owned.)*

### 🟠 High — economic & governance (mostly off-chain policy)

**F4 — Creator-controlled royalty farming.** *(economics panel; blast-radius verified contained)*
Royalty-weighted points assume the royalty *leaves* the trader's economic sphere. A **collection creator** can set `royaltyRecip` to a wallet they control (no `creator ≠ royaltyRecip` separation is enforced on-chain) and farm points across 2+ wallets, recovering their own royalty and paying only ~2% fee + gas. *Verified:* NFT trading points live in a **separate** ledger (`backend/internal/points`) from the XP/quest leaderboard — so the blast radius is the (future, non-binding) $MEMBA points, **not** XP. **Keep that separation.**
**Fix (off-chain):** cluster detection must specifically catch `royaltyRecip ∈ trading-cluster`; weight points by *royalty paid to an address outside the buyer/seller cluster*; publish the clawback policy + per-collection/per-wallet caps; never wire NFT volume into XP without the same anti-sybil. *(Backend points + docs.)*

**F5 — Mutable platform params, no timelock.** *(economics + security panels)*
`SetFeeRecipient` (both realms) and `SetMaxCreatorRoyaltyBPS` are single-step admin-mutable and affect in-flight collections. Mitigated by the 2-of-2 multisig but with no on-chain delay; `market_v3` fee-recipient is single-step vs. collections' 2-step admin transfer.
**Fix:** document key-holders + rotation; decide on a timelock / 2-step for fee-recipient; plan `platformAdmin → DAO executor` handoff. *(Realm change = next deploy / mainnet, not a test13 retrofit — see §8.)*

### 🟡 Medium — correctness, UX & chain-compat

**F6 — Compat docs stale; verify #5745 indexer parsing.** `GNO_CORE_COMPAT.md` (2026-04-07) and `GNO_CORE_BREAKING_CHANGES.md` (2026-03-30) don't track #5747/#5792/#5745. test13 grc721 emits **realm-qualified** collection IDs (#5745, *in* test13) — confirm the indexer + `nft_rpc` `collection_id` handling parse the qualified form (and the 100-char cap in `nft_rpc.go` is adequate). **Fix:** refresh both docs + add a chain-feature matrix (test13/master/gnoland1); add a parse test for qualified IDs. *(Docs + backend.)*

**F7 — Offer accept/cancel race.** `MinOfferLifetimeBlk = 10` (~20s) lets a buyer grief a seller's `AcceptOffer` with a last-moment `CancelOffer` (seller wastes gas; **no fund loss**). **Fix (optional):** lengthen the lifetime or forbid cancel inside an accept window; otherwise document as known UX. *(Realm/next-deploy or doc.)*

**F8 — XSS surface is being removed by #443.** The only `dangerouslySetInnerHTML` in NFT code is `NFTGallery.tsx:580` — a file **#443 deletes**. **Action:** confirm the Phase-2 replacements (`CollectionPublic`, `MarketplaceHub`) render on-chain strings as text / sanitized (the worktree map shows text + proxied images). *(#443-owned — coordinate, don't edit.)*

### 🟢 Low / forward-safety & informational

**F9 — Port grc721 #5792 (owner-gated `SetTokenMetadata`) for forward-safety.** The fork's `metadataNFT.SetTokenMetadata` lacks an owner check, **but it is unreachable** — `memba_collections` exposes no wrapper and mint uses owner-gated `SetTokenURI` (verified). Latent only. **Fix:** port the owner-gate to the fork for the *next* collections deploy/mainnet; **never** add a `SetTokenMetadata` wrapper without owner-gating. *(Source-only; can't retrofit the immutable deployed registry.)*

**F10 — `market_v3.splitProceeds` not overflow-safe.** Uses `price * FeeBPS` without `overflow.Mul64p` (collections + core use it). Safe within current `MaxPrice` bounds; inconsistent + fragile if bounds rise. **Fix:** use `overflow.Mul64p` for consistency (next deploy). *(Source.)*

**F11 — #5747 cross-realm `/p/` arithmetic.** **REFUTED** as a blocker. Only affects in-place mutation of `/p/`-declared *composite* types after a foreign-PkgID value-copy (e.g. `uint256.Uint{arr [4]uint64}`); `market_core.SplitProceeds` is scalar `int64` and safe before/after #5747, on all chains. **Corollary (keep):** keep `market_core` scalar-only; any *future* shared `/p/` math lib using composite types cross-realm would need a chain with #5747. Informational.

### Verified-correct (stated for confidence)
ABI alignment frontend↔realm **100%** (15 builders: names, positional args, `cur realm` prefix, `send` fields) · feature gate covers all NFT routes · chain-id + trusted-RPC enforced on broadcast · CEI + seller-last payouts · `RegisterMarket` moat sound (rogue realms can't `MarketTransfer`) · offer escrow refund-safe, no double-refund · Merkle allowlist domain-separated (0x00/0x01) · supply gated on `nextAutoTokenID` (burn never reopens) · per-token royalty precedence frozen · indexer idempotent (`UNIQUE(block,tx,idx)`) + reorg-safe (5-block) · v3 single-`Sale` dedup correct · SSRF-hardened image proxy (private-IP blocks, redirect re-validation, size cap) · points deterministic + self-deal-excluded.

---

## 5. Breaking-change & chain-compat ledger

| gno PR | What | In test13? | In gnoland1.1? | Memba impact | Action |
|---|---|---|---|---|---|
| **#5669** interrealm-v2 Phase 3 (IsCurrent ACLs) | realm capabilities | ✅ | ❌ | realms already ported; **mainnet blocked until chain upgrades** | Track gnoland1 upgrade (§8) |
| **#5745** realm-qualified collection IDs in events | event format | ✅ | ❌ | indexer must parse qualified IDs | Confirm parser + test (F6) |
| **#5747** remove N_Readonly taint / `/p/` arithmetic | gnovm | ❌ (master only) | ❌ | **none** for `SplitProceeds` (scalar) | Keep `market_core` scalar-only (F11) |
| **#5792** grc721 owner-gated `SetTokenMetadata` | grc721 | ❌ | ❌ | unreachable in collections | Port to fork for next deploy (F9) |
| **#5385** errors.Is/Unwrap/Join | stdlib | ❌ | ❌ | only matters if porting #5792 tests | none |

**Strategic gate:** gnoland1.1 (2026-04-01) predates #5669 → **all** Memba interrealm-v2 realms (DAO + NFT) are mainnet-blocked until a gnoland1 upgrade ≥ #5669. This is a chain-governance dependency, not a Memba code task.

---

## 6. Parallel-session conflict protocol (methodology)

A parallel session owns **PR #443** (`feat/nft-marketplace-phase2`, worktree `memba-nft-phase2`): MarketplaceHub, CollectionPublic, LegacyCollectionView, unified `TradeModal`, `nftHub.ts`, `useCollectionPublic`; it **deletes** the old per-action modals + `NFTGallery`/`CollectionDetail`; it **edits** `App.tsx` NFT routes + `config.ts` gate helpers. Accept-Offer + "My Items" are deferred to Phase 3.

**DO NOT EDIT (owned by #443):** `App.tsx` (NFT routes), `config.ts` (`isNftEnabled`/`isNftLaunchpadValid`), `components/nft/*`, `MarketplaceHub*`, `CollectionPublic*`, `LegacyCollectionView*`, `useCollectionPublic*`, `nftHub.ts`.

**Conflict-free surface for THIS plan:** on-chain realms (`samcrew-deployer/**` — untouched by #443), backend (`Memba/backend/**`), Creator Studio (`pages/studio/*`, `CreateCollectionLaunchpad`, `CreatorProfile`), `lib/{launchpad,grc721,nftMarketplaceV3,nftConfig,nftApi}.ts` (builders/reads — coordinate but low overlap), docs, tests.

**Rules:** branch per workstream off `main`; never commit on `main`; never touch the worktree; rebase before PR; land each WS as its own PR; for any frontend seam that overlaps #443 (allowlist/router), file an issue and coordinate rather than edit.

---

## 7. Implementation plan (AAA, phased, conflict-free)

Each workstream is an independent branch/PR. **WS-A → WS-B → WS-E are the go-live gate.** WS-C/D/F/G are hardening/forward.

### WS-A — On-chain settlement test hardening 🔴 *(gate)*
**Where:** `samcrew-deployer/projects/memba/realms/{memba_nft_market_v3,memba_collections,memba_market_core}` (no #443 overlap).
**Tasks (TDD):**
1. `market_v3 ↔ memba_collections` integration test: `RegisterMarket` → mint → list → **BuyNFT** → assert ownership moved + `seller/fee/royalty` payouts exact + `Sale` event fields.
2. `AcceptOffer` settlement from escrow (full split) + listing/offer removed.
3. `CancelOffer` + `ClaimExpiredOffer` refund-to-buyer tests (incl. re-call after deletion = no double-refund).
4. Conformance test: `market_v3.splitProceeds(p,r) == market_core.SplitProceeds(p,r)` across a value matrix (min/max/dust/clamp).
5. Negative/abort coverage for cross-realm calls (unregistered market rejected; paused-collection `MarketTransfer` rejected).
**Acceptance:** all green under `gno test ./...`; the "Task C5" comments replaced by real tests; payout invariant `fee+royalty+seller==price` asserted on the *settlement* path, not just the pure function.

### WS-B — Indexer robustness 🟠 *(gate)*
**Where:** `Memba/backend/internal/indexer`, `internal/service/nft_rpc.go`.
1. `via` enum validation in `applySale`; reject/quarantine unknown.
2. `atoiSafe` → required-field-aware: log + alert (via `/metrics` or error counter) on missing/garbled numeric attrs; never silently 0 a required field.
3. Confirm + test #5745 realm-qualified `collection_id` parsing; widen the `nft_rpc` length cap if needed.
4. Add NFT-specific signals on top of existing `/metrics`: sale-volume spike, failed-settlement counter, floor-recompute anomalies (tailer-lag already exists).
**Acceptance:** new unit tests for malformed events; an injected bad event is logged + counted, not silently absorbed.

### WS-E — Activation + rollback runbook 🟠 *(gate)*
**Where:** `Memba/docs/features/` + `samcrew-deployer` scripts.
1. Single ordered runbook: pre-flight → deploy-confirm → **indexer tailing v3 from deploy-height (verified)** → `RegisterMarket` (multisig) → indexer-caught-event check → frontend allowlist + router (coordinate #443) → **2-wallet E2E** (the 7-step money test) → flip `VITE_ENABLE_NFT`.
2. **Rollback section** using existing levers: `UnregisterMarket(v3)` / `market_v3.Pause()` / `memba_collections.Pause()`; **stage a pre-signed multisig pause/unregister tx** before launch; document the immutability of `memba_collections` (fix-forward = new path).
3. Verified-badge ops: SLA, revoke path (`SetCollectionMeta(...,"")`), appeal, key-holders.
**Acceptance:** a second engineer can execute go-live and abort from the doc alone.

### WS-C — grc721 / market_v3 forward-safety hygiene 🟢
**Where:** realm source (applies to *next* deploy / mainnet — cannot retrofit immutable test13 `memba_collections`).
1. Port grc721 #5792 owner-gate to the fork (`SetTokenMetadata(caller, …)`); keep the rule "no metadata-mutation wrapper without owner-gate".
2. `overflow.Mul64p` in `market_v3.splitProceeds` for consistency.
**Acceptance:** source matches upstream security posture; flagged in the realm-versions changelog for the next deploy.

### WS-D — Economic anti-farming & policy 🟡
**Where:** `Memba/backend/internal/points` + docs.
1. Cluster detection: flag/exclude sales where `royaltyRecip ∈ {buyer,seller} cluster`; weight by royalty-paid-outside-cluster.
2. Publish clawback policy + per-collection/per-wallet caps; surface "points are indicative, non-binding" in UI copy (coordinate #443 for placement).
3. Keep NFT points decoupled from XP leaderboard (add a regression note/test that NFT volume does not grant XP).
**Acceptance:** documented formula + a deterministic test that a creator-cluster wash yields ~0 net points.

### WS-F — Compat docs refresh 🟡
Update `GNO_CORE_COMPAT.md` + `GNO_CORE_BREAKING_CHANGES.md`; add the chain-feature matrix (§5) and the mainnet `#5669` gate to `MAINNET_PREPARATION.md`.

### WS-G — (Coordination only) v3 frontend wiring
Owned by #443 / Phase-3 router. This plan supplies the seams: add `memba_nft_market_v3` to `REALM_ALLOWLIST.test13`, route `source=v3 → market_v3`, surface the enforced-royalty + fee breakdown. **File an issue; do not edit #443 files.**

**Suggested sequence:** WS-A + WS-B + WS-E in parallel (the gate) → WS-D + WS-F → WS-C bundled with the next realm deploy → WS-G when #443 lands.

---

## 8. Go-live decision tree

```
Want v3 trading live on test13 with real funds?
  └─ WS-A green (settlement proven) ─ no ─▶ STOP. Do not RegisterMarket.
        └─ yes
            └─ WS-B green (indexer validated) + indexer tailing v3 from deploy-height? ─ no ─▶ STOP.
                  └─ yes
                      └─ WS-E runbook + pre-signed pause tx staged? ─ no ─▶ STOP.
                            └─ yes ─▶ RegisterMarket(v3) → 2-wallet E2E → allowlist+router (with #443) → flip flag.

Want NFT on gnoland1 mainnet?
  └─ gnoland1 upgraded to ≥ gno #5669 (interrealm-v2 Phase 3)? ─ no ─▶ BLOCKED (chain governance). 
        └─ yes ─▶ re-run this audit against mainnet VM + WS-C applied to the mainnet deploy.
```

---

## 9. Open questions for you

1. **Go-live appetite:** do we want v3 *trading* live on test13 now (drives WS-A/B/E urgency), or keep it design-locked until Phase-3/#443 lands and treat WS-A as pre-mainnet hardening?
2. **Farming policy (F4):** acceptable to rely on off-chain cluster detection + clawback for launch, or do you want an on-chain mitigation (e.g. ignore royalty when `royaltyRecip` equals the seller) before points accrue?
3. **Param governance (F5):** add a timelock / 2-step to `SetFeeRecipient` now, or defer to the `platformAdmin → DAO` handoff?
4. **Who runs WS-A?** This session can execute WS-A/B/E/F on conflict-free branches on your go-ahead — or you may want a dedicated session to avoid contention with the #443/other parallel sessions.

---

## 10. Risk register (post-verification)

| ID | Risk | Sev | Likelihood | Mitigation | Owner-surface |
|---|---|---|---|---|---|
| F1 | Settlement bug hits real funds (untested) | 🔴 High | Med (until tested) | WS-A | realms/tests |
| F2 | Silent indexer data corruption on schema drift | 🟠 High | Low-Med | WS-B | backend |
| F3 | Bungled/irreversible activation | 🟠 High | Med | WS-E + pre-signed pause | docs/scripts |
| F4 | Creator points farming | 🟠 High | Med | WS-D off-chain + caps | backend/policy |
| F5 | Param/fee redirection w/o delay | 🟠 Med | Low (multisig) | WS-C/E governance | realm/docs |
| F6 | #5745 parse mismatch | 🟡 Med | Low | WS-B test | backend |
| #5669 | Mainnet blocked | 🔴 (strategic) | Certain until upgrade | Track chain | governance |

---

## 11. Appendix — repo sync & ecosystem activity (2026-06-24)

**Sync:** core repos fetched; `Memba` main `71e1b9e` (clean bar untracked `.remember/`), `gnodaokit`/`tokenfactory`/`adena-wallet`/`gno-docs`/`gnolove` current; `gno` left on `chain/test13` pin (untracked samcrew realm staging present — not disturbed). `memba-nft-phase2` worktree (`feat/nft-marketplace-phase2`) **not touched**.

**Memba merged today (#469–#486):** routing crash fix, NFT-gate enforcement (#472), `/metrics` (#479), treasury/SSRF/OAuth/RPC hardening, anti-farm quests (#483/#486), valoper panel (#482). **Open:** #443 (NFT Phase 2), #487 (docs archival).

**samcrew-deployer (#21–#32, all merged):** interrealm-v2 port, commerce v2, NFT v2 → Phase-2 registry + market v3 + `market_core` + RegisterMarket-v3 script.

**Key addresses (test13):** market v3 `g1pucv5exvs0pxlfe39qlyu4pge47llcx78nx5nj` · admin multisig `g10kw7e55e9wc8j8v6904ck29dqwr9fm9u280juh` · collections/market paths under `gno.land/r/samcrew/`.

---
*Prepared read-only; all high-severity claims independently verified (3 sub-audit claims were corrected on verification — see §0/§4 F11). No code or git state changed.*
