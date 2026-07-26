# Memba Feature Completion Program — PILOT: NFT Marketplace
### Deep multi-expert audit → super-detailed implementation plan → CTO review

**Date:** 2026-07-15 · **Owner:** zxxma · **Status:** DRAFT for owner review (pilot of a per-feature program)
**Pilot feature:** NFT Marketplace (chosen as the pilot — money-path, avl-affected, mainnet-critical, richest surface)
**Roster:** full 22-expert panel (CTO, PO, UI, UX, Gno Core ×3, Smart Contract ×2, QA, CSO, FSE ×3, Product Tester ×3, + 5 NFT feature experts)

> **How to read this document.** Part A is the ecosystem pull + breaking-change scan (applies to *all* features, done once).
> Part B is the marketplace current-state ground truth. Part C is the synthesized, adversarially-verified 22-expert
> audit. Part D is the super-detailed implementation plan (with review/cross-check/changelog/doc gates baked into every
> step). Part E is the CTO review of that plan. If you approve the *shape* of Parts C–E, I replicate this exact structure
> across the remaining ~15 features.

---

## Part A — Ecosystem pull & breaking-change scan (all repos, done once)

**Pulled 2026-07-15.** All clean tracking repos under `/Gno` fast-forwarded. Key cores confirmed current:
`gno` @ `f99caf537` (2026-07-13, 0 behind), `adena-wallet` v1.20.0, `samcrew-deployer`, `gnodaokit`, `gnolove`.
Skipped (dirty / no-upstream / pinned): `Memba` (moved during this session `feat/feed-thread-reply-paging` → **`feat/feed-flags-projection`** `29866649` — a **concurrent Claude session is likely active** per the git-movement heuristic; realm audit is unaffected as realms live in `samcrew-deployer`), `gnodaokit` (`pr-64`), `tokenfactory`/`gno-lz-oapp` (pinned `test13-deploy`), plus local-only spikes.

### Breaking-change register (gno master `f99caf537`)

| # | Sev | Change (PR) | Verified impact on Memba |
|---|-----|-------------|--------------------------|
| A1 | 🔴 **mainnet-cut blocker** | `p/nt/avl/v0.Get` simplified to return a single `any` instead of `(value, exists bool)` (#5314, #5644) | Memba realms import `p/nt/avl/v0` (50×) and call the **two-value** `v, ok := t.Get(...)` form in **~394 sites**; avl is **not vendored**. Compiles/runs on **test13 only** (pinned chain avl). **Will not compile against a mainnet that ships post-#5314 avl.** Fix = migrate call sites to `Has()` + single-value `Get`, or pin/vendor a two-value avl. |
| A2 | 🟠 | secp256k1 removed for validators (#5949) | Validator/valoper onboarding must be ed25519 — verify in the Validators feature audit. |
| A3 | 🟠 | grc20reg enforces max slug length (#5911) | `$MEMBA` / tokenfactory registration must comply — verify in the Tokens feature audit. |
| A4 | 🟡 | gnovm tightenings: blank `_` func decls type-checked (#5920), embedded type identity (#5739), `typedRuntimeError` (#5732), cross-pkg method qualification in interface errors (#5932) | Recompile risk at the mainnet cut — each feature's Gno-Core lens must attempt a lint/build against latest gno. |
| A5 | 🟢 clean | pkg-path last-elem must match pkg name (#5048) | **Verified: 0/93 marketplace realm files mismatch.** Not a blocker. |
| A6 | 🟢 note | adena v1.20.0: broadcast tx-hash returned as base64 (#870), deposits to Session Account addresses blocked (#874) | Frontend integration check — flagged into the Trader-persona and FSE lenses. |
| A7 | 🟢 stable | gnodaokit (Jun-03 interrealm-v2 port), gnolove (Jun-05) | No action. |

**Program-wide implication:** A1 is a hard gate for **every** money-path realm, not just the marketplace. The per-feature
plans must each carry an explicit "avl mainnet-compat" task until A1 is resolved globally.

---

## Part B — Marketplace: current-state ground truth

- **Unified/NFT Marketplace is LIVE in prod** (`VITE_ENABLE_MARKETPLACE=true`); **v1 lanes are canonical.**
- A full **v2 dark rearchitecture** (unified lane engine, `MarketCard`, adapters, founding-supply seed) is merged behind
  `VITE_ENABLE_MARKETPLACE_V2` (default **off**, `.env.e2e` only) and **deliberately PARKED** (decision 2026-07-11). The
  E.1–E.4 rearchitecture (mobile trade sheet, AllInPrice/interstitial/copymint, item-level browse) stays open. Treat the
  `*V2*` tree as frozen except for a deliberate cutover.
- **Realms LIVE on test13** via 2-of-2 multisig `samcrew-core-test1`. **Mainnet deploy pending** = the "complete & functional" horizon.
- **Realm cluster:** `memba_nft_market_v3_2` (active engine), `_v3_1`/`_v2`/`nft_market` (prior), `memba_market_core_v2`
  (fee/DAO split), `memba_market_config`, `memba_nft_v2`, `grc721`, `memba_collections`.
- **Prior deep audit (2026-07-08)** open items to re-adjudicate: P0-A reputation not wired to marketplace · P0-B mobile
  funnel broken · P0-C hollow cold-start · P0-D four design systems · P0-E fee-only-at-GMV-0 · P1s (no unified discovery,
  data-layer fragility, four front doors + ~1,320 lines dead code, trust-at-sign).

---

## Part C — Synthesized 22-expert audit (adversarially verified)

**Method.** 22 role-specific experts read the real realm/frontend/backend code and filed 164 findings; every P0/P1 was re-checked by an independent skeptic against the cited files (default-to-refuted). **68 CONFIRMED, 11 NEEDS-NUANCE, 1 REFUTED** → the audit is evidence-grounded, not speculative. After dedup: **21 P0 + 47 P1** stand (many P0s are the *same* avl issue seen from different lenses).

### C.0 — Verdict (one paragraph)
The marketplace is **functionally live on test13** with a genuinely sound settlement core (CEI ordering, escrow-liabilities ledger, exact fee/royalty split, the OriginSend fund-drain class already closed, mature SSRF-guarded media proxies). But it is **not "complete & functional," and it cannot reach mainnet as-is.** One ecosystem break (`avl.Get` 2→1) hard-blocks the entire realm stack from compiling on mainnet; several **live surfaces show fabricated or false data** (fake collection-offer bidders, a fund-losing offer CTA to an undeployed realm, real artwork never rendering, a "coming soon" Services tab, provenance/verification claims with no backing); the **offer→accept funnel is broken end-to-end**; the **primary-mint revenue line is unreachable**; and the trust/reputation remedy the prior audit prioritized shipped **only into the parked v2 tree**, so it's dark in prod.

### C.1 — Convergent findings (flagged by ≥2 lenses = highest confidence)

| Rank | Finding | Lenses | Sev |
|------|---------|--------|-----|
| 1 | **`avl.Get` 2→1 mainnet compile break** — 8 realms import unvendored `p/nt/avl/v0`; ~38 non-test (112 incl. tests) two-value `v,ok:=t.Get()` sites; **not tracked in `MAINNET_READINESS.md`.** Compiles on test13's pinned avl only. `memba_collections` is **irreversible** → cannot be patched after deploy. | **18** (CTO,PO,UX,GNO1-3,SC1-2,QA,FSE2-3,PT1-3,NFTM,NFTT,NFTC,NFTL,ECON) | **P0** |
| 2 | **Fabricated collection-offer surface on the live page** — `FloorOffersList` renders hardcoded `g1fakebuyer01/02/03` as "Executable Depth"; "Make Collection Offer" CTA + Make/Accept modals broadcast fund-bearing txs to `gno.land/r/samcrew/memba_nft_offers_v1`, **which does not exist** (the only extant stub *loses buyer escrow*). | NFTM, NFTT, (PO/UX trust) | **P0** |
| 3 | **Real NFT artwork never renders** — tokenURI is a metadata-JSON by the platform's own convention, but `NFTMedia` feeds it straight to `/api/nft/image`, which downgrades JSON → every correctly-minted token (incl. Genesis) shows a fallback blockie. | NFTL, PT3, (PT2 creator) | **P0** |
| 4 | **Offer→Accept broken end-to-end** — realm requires a live listing to accept; both trade pages only allow offers on *unlisted* tokens and never pass the offer price/`isListed` into the auto-list bundle → every accept reverts, buyer funds stranded in escrow. | UX-8, PT1, NFTT | **P1** |
| 5 | **Trust-at-sign is a bare `g1…` seller** — reputation/verified/identity wiring exists but only in the parked v2 tree; live `TradeModal` shows a raw address. Prior audit **P0-A remains OPEN in prod.** | PO, UX, PT3, NFTT | **P1** |
| 6 | **`ListNFT` has no ownership/approval check** — anyone can post phantom/counterfeit listings for tokens they don't own → fake-floor manipulation + DoS on the 1000-listing cap. | SC2, CSO | **P1** |
| 7 | **Single-key admin holds the drain key** — `memba_collections` `platformAdmin`/`pauser`/`feeRecipient` = one hot key gating `RegisterMarket` (drain) + `ForceSetCollectionAdmin` (break-glass); multisig handoff only "optional" in the checklist. | CSO, (GNO3 fees) | **P1** |
| 8 | **Two engines / two fee rates / two treasuries under "one unified marketplace"** — genesis trades → v2 (2.5% → deploy multisig); launchpad → v3_2 (2.0% → fee-treasury multisig). DAO `SetFeeBPS` governs only v3. | CTO, GNO3, ECON | **P1** |

### C.2 — Distinct P0 (deduped to 4 root issues)
- **P0-1 avl mainnet-compat** (rank 1 above) — *the* gate.
- **P0-2 fabricated collection-offer surface** (rank 2) — trust violation + fund-loss stub.
- **P0-3 artwork never renders** (rank 3) — the marketplace looks broken/placeholder.
- **P0-4 mobile trade modal dead-ends** — `TradeModal.css` has zero `@media`/`max-height`; on a phone the Confirm/List CTA sits below the fold with no scroll → **not transactable on mobile** (marketplace is in mobile nav). *(UX-1)*

### C.3 — P1 clusters (47 findings → 9 workstreams)
- **Architecture/SSOT:** two live engines (CTO-2); `MAINNET_READINESS` verifies the wrong engine (CTO-3); `VITE_ENABLE_MARKETPLACE_V2` absent from `SAFETY_GATED_FLAGS` → one Netlify flip ships hollow v2 (CTO-4); realm-validity gate **fail-open on `gnoland1`** (FSE3-2); dual fee regime (GNO3-03); fee-spine mislabels its own treasury multisig (GNO3-02).
- **Contract security:** `ListNFT` no-ownership (SC2-2/CSO-3); minter-supplied unvalidated immutable `tokenURI`, no setter/remediation → stored-XSS + integrity (SC2-3/CSO-6); single-key drain admin (CSO-2); avl migration touches the auth gate itself → do deliberately (CSO-1); no `MaxPrice` on offers (SC1-2); **`SeedSale` unsealed** = forgeable-reputation backdoor (SC1-4/CSO-4).
- **Live funnel:** accept-offer reverts (UX-8/PT1-1/NFTT-04); dead "Connect wallet" text at point of purchase (UX-2); buy price read via 50-capped truncating scraper not the exact getter (FSE1-1); no read-your-writes after trade → stale reload (FSE1-2); buy signs a stale price, no last-look (NFTT-08); AcceptOffer needs a prerequisite listing — non-standard (NFTM-4).
- **Trust/provenance:** seller trust dark in prod (PO-3/UX-3); no provenance shown despite the headline chip, though `nft_ownership_history` is indexed (NFTL-2/PT3-3); portfolio drops listed/price + misleading "verified NFTs" copy (PT3-4).
- **Creator completeness:** no art/metadata upload pipeline (PT2-1/NFTC-01); Settings form silently zeroes `maxSupply`/`payDenom` (PT2-2); phase change wipes allowlist root (PT2-3); no earnings/proceeds getter or dashboard (NFTC-03).
- **Discovery/depth:** browse grid all blockies (PT3-1); no price-discovery at trade (NFTT-05); no PnL/portfolio though `GetSalesByBuyer` exists (NFTT-06); no sweep/batch/auctions (NFTT-07).
- **Design system:** undefined `--color-bg-secondary/-tertiary` → **transparent live cards** (UI-1); P0-D "four design systems" still open, `MarketCard` parked (UI-2).
- **Backend:** media cache byte-unbounded on a 512 MB VM → unauth OOM (FSE2-1); RPC failover defaults to **test13 nodes** → mainnet serves wrong-chain data (FSE2-2); unbounded list/portfolio queries (FSE2-3).
- **Economics:** `primaryFeeBPS` ships dormant (0) + split treasuries (ECON-1); points can't drive liquidity — no awarder, no sink, no unlock (ECON-2); royalty-weighted reward base pays 0 on zero-royalty cold-start lanes (ECON-3).
- **QA/CI:** live v3_2 engine has **no settlement integration test** (only targets v3_1) (QA-1); harness not in CI + bit-rotting toolchain (QA-2); no mainnet-avl CI leg — realm *and* tests use the 2-value form (QA-3).

### C.4 — What MUST NOT ship (demo-tells / trust violations — delete before anything)
Fake `g1fakebuyer0x` bid depth · "Make Collection Offer" CTA to a non-existent realm · Services "coming soon" tab (committed `.env` `SERVICES=true`) · "Auto-generated cover until you upload art" (no upload exists) · "Slug, symbol, and royalty are permanent" (royalty is admin-mutable) · "10% max royalty" UI while realm clamps to 7.5% · "On-chain provenance" chip with no provenance UI · "This user does not hold any verified NFTs" (no such filter) · `MEMBATEST` token placeholder · any mainnet realm compiled against test13-pinned avl.

---

## Part D — Super-detailed implementation plan (Marketplace → complete, functional, mainnet-ready)

### D.0 — Global constraints (every task inherits these, verbatim)
1. **Branch/PR only, never commit to `main`.** Feature branches `feat/mkt-*`; squash-merge via the gated policy (all gates green + CTO-lens diff verify + tests + up-to-date + e2e). Money-path / migration / deploy tasks are **owner-gated** (ask, don't autonomously merge).
2. **TDD.** Red test first (realm `*_test.gno`, `vitest`, or e2e), then implement to green. No feature/fix lands without a test that would have caught the defect.
3. **`samcrew-deployer` is a SHARED CHECKOUT** → worktrees only, never `git add -A`; `cd` into the worktree before `git commit`.
4. **Frontend truth:** `tsc --noEmit` is a no-op → verify with `npm run build`; run `npm run lint; echo $?` (CI ratchet `--max-warnings=55`). Vitest one file at a time via the bounded self-killing wrapper, never `npx`.
5. **Never flip a `SAFETY_GATED_FLAG` to `true` for a prod build.** Prod frontend deploy = Netlify native (`netlify.toml`), never `deploy-frontend.yml`.
6. **No hollow/mock/fabricated data on any surface that can render live.** No false capability copy.

### D.1 — The per-step cadence (the "frequent reviews + changelog + docs" ritual you asked for)
Every task `T#` closes with this **fixed exit ritual** (referenced, not repeated, below):
- **① Implement + test** (TDD, per D.0).
- **② Self-verify** with the named cross-lens (e.g. "SC + GNO Core re-read the diff"): for realm changes, `gno lint`/`gno test` against **both** test13-pinned and mainnet-pinned toolchains; for FE, `npm run build` + `lint` + targeted vitest/e2e; drive the actual UI for behavior (the `verify` discipline).
- **③ Changelog** entry (`frontend/content/blog` or `CHANGELOG`/session MD) + **docs update** (feature doc + `MAINNET_READINESS.md` gate row where relevant).
- **④ Peer/expert review gate** — a **deep cross-perspective review** at each *phase* boundary (a 3–5 lens mini-panel re-audits the phase's diffs adversarially before the phase is declared done); PR review before merge.
- **⑤ Exit criteria** met + gate row flipped green.

**Cadence rhythm:** deep review checkpoints at **every phase boundary** (not just at the end) + a lightweight cross-lens diff review on **every money-path or realm PR**. Changelog + docs updated **per task**, not per phase.

### D.2 — Branch / rollout strategy
- **Realm changes** (Phases 1–2, 5-realm, 6-engine) ride **one coordinated `feat/mkt-avl-and-hardening` realm cut** because the avl migration, the `ListNFT` ownership check, the admin handoff, and the `unsafe.PreviousRealm→cur` hardening all land in the **same fresh immutable mainnet path** (the engine is immutable; you get exactly one shot). Never mix into a hot-patch.
- **Frontend** ships incrementally behind existing flags; nothing user-visible flips on until its realm is verified live on the target chain (fix the fail-open gate first, FSE3-2).
- **Mainnet cutover** is a single owner-run ceremony gated on the full `MAINNET_READINESS` checklist (Phase 8).

### D.3 — Phases

> Legend per task: **[id]** description · *files* · **verify-lens** · effort. All tasks close with the D.1 ritual.
> **⚠️ Amended by the CTO review — see §E.3.** The independent 3-lens review (all APPROVE_WITH_CHANGES) surfaced 3 blocker-class structural fixes (immutable-realm API freeze, the uassert/CI-gate reality, verify-the-right-drain-key) and 8 major/minor refinements. **§E.3's dispositions are authoritative over the task text below where they differ** (notably: an added Phase-1 `[1.0]` API-surface freeze; `[4.4]` artwork + the CSS-token fix pulled earlier; `[2.5]` retargeted to the correct key; `[2.8]`/`[1.5]` re-scoped to existing CI machinery; a cross-repo repo-map). Read D.3 with §E.3.

#### Phase 0 — Stop-the-bleed: kill demo-tells & fail-open gates *(cheap, highest trust-leverage; do first)*
Goal: nothing fabricated or false can render live; no accidental hollow-surface ship. Exit: C.4 list empty; a build fails if a parked/hollow flag is on.
- **[0.1]** Delete `mockFetchFloorOffers` + hide `FloorOffersList`, the "Make Collection Offer" CTA, and Make/Accept-floor modals until a real engine exists (Phase 6). *`FloorOffersList.tsx`, `CollectionPublic.tsx:178/236`, `MakeFloorOfferModal.tsx`, `AcceptFloorOfferModal.tsx`* · **NFTM/CSO** · S
- **[0.2]** Add `VITE_ENABLE_MARKETPLACE_V2` (+ a `PARKED_FLAGS` list) to `assertSafeFlags` so a prod build with it on **fails closed**. *`safeFlags.ts`* · **FSE3/CTO** · S
- **[0.3]** Set `VITE_ENABLE_SERVICES=false` in committed root `.env` to match `.env.example`; add a build assertion that fails if a lane flag is true while its lane data source is a hardcoded empty array. *`Memba/.env`, `safeFlags.ts`* · **PO** · S
- **[0.4]** Add a `gnoland1` entry to `REALM_ALLOWLIST` and make unknown-network default **fail-closed**. *`config.ts:223/271`* · **FSE3/CSO** · S
- **[0.5]** Fix false copy (each with a test asserting the claim matches reality): art-upload promise, "permanent royalty", "10% max royalty" vs 7.5%, "on-chain provenance" chip (gate on Phase 4), portfolio "verified NFTs", remove/park `MEMBATEST`. *`CreateCollectionLaunchpad.tsx:275/293`, `UnifiedMarketplace.tsx:81`, `ProfileAssets.tsx:52`, `TokenLane.tsx:51`* · **PO/UX** · M
- **Phase-0 review gate:** PO + CSO + UX re-audit the diff for any remaining fabricated/hollow surface.

#### Phase 1 — Canonical engine + avl mainnet-compat *(the master blocker)*
Goal: exactly ONE market engine + ONE NFT-token realm compile against the mainnet-pinned gno toolchain, proven in CI. Exit: green `gno lint`/`gno test` of the full deploy closure against `gnoland1`-pinned gno; `MAINNET_READINESS` avl gate added + engine table corrected.
- **[1.1] Owner decision (gate):** `v3_2 + memba_collections` = sole mainnet SSOT; genesis collection migrated/re-homed off `memba_nft_market_v2`; v2/v3_1/`nft_market` excluded from the deploy set; delete the `default: v2` FE route + dead v2 builder path. *`tradeEngine.ts:60`, `nftConfig.ts`, `TradeModal.tsx`* · **CTO** · L · **owner-gated**
- **[1.2] Pin the mainnet gno toolchain** — identify the exact `gnoland1` gno release/commit and its `p/nt/avl/v0` API; record in `MAINNET_READINESS §4`. *`MAINNET_READINESS.md`* · **GNO1** · S · **owner-gated**
- **[1.3] avl strategy decision (gate):** **(a)** vendor a byte-frozen two-value avl at `p/samcrew/avl` and repoint imports (lowest-risk for the *irreversible* `memba_collections`; insulates from future avl churn) — **recommended**; or **(b)** mechanically migrate all sites to single-value `Get`+`Has()`/nil-check. *decision doc* · **GNO1+GNO2+SC1** · M · **owner-gated**
- **[1.4] Execute the avl cut** across `memba_market_config`, `memba_nft_market_v3_2`, `memba_collections`, `memba_nft_v2`, `grc721` (+ their `*_test.gno`) in **one coordinated change**; keep the avl-free `memba_market_core_v2` untouched (it's the reference). Re-verify every `ok`-branch that gates a value-exit (e.g. `ClaimExpiredOffer`, `isRegisteredMarket` drain gate — a dropped existence check turns the drain gate into an open door, per CSO-1). *5 realms* · **GNO1+GNO2+GNO3+SC1** · L
- **[1.5] CI mainnet-parity gate:** new job builds gno at the pinned mainnet ref and runs `gno lint`+`gno test` on the full deploy closure (`core_v2 + config + collections + nft_v2 + grc721 + v3_2`). Red until 1.4 lands, then a hard gate. *`.github/workflows/test.yml`* · **QA/GNO1** · M
- **[1.6]** Refresh `MAINNET_READINESS §1/§4`: verify **v3_2** (with the current OriginSend/`IsUserCall` callsite sweep + evidence), add the **avl gate row**, strike v2/v3_1 from the shippable narrative. *`MAINNET_READINESS.md`* · **CTO/CSO** · S
- **Phase-1 review gate:** 3× Gno-Core + SC re-audit the migrated realms adversarially (focus: any `ok`-branch semantics change on a money/auth path) + re-run the full realm test suite on the mainnet toolchain.

#### Phase 2 — Money-path & access-control hardening *(folded into the same immutable recut)*
Goal: the one immutable engine ships hardened; no phantom listings, no forgeable reputation, no single-key drain. Exit: solvency reconciliation green; settlement integration test on v3_2 in CI; admin on multisig.
- **[2.1]** `ListNFT` (+ AcceptOffer's listing precondition): require `nft.OwnerOf(col,tid)==seller` AND market approval at list time. *`market.gno:201`, `offers.gno:159`* · **SC2/CSO** · S
- **[2.2]** Add `MaxPrice` bound to `MakeOffer` to match the listing/split contract. *`offers.gno`* · **SC1** · S
- **[2.3]** `tokenURI` hardening: validate scheme/length at mint (allow `ipfs://`/`ar://`/`https://`, reject `data:`/`javascript:`); add an admin/creator-gated `SetTokenURI` wrapper (reveal + remediation); prefer per-collection `baseURI` for curated drops. *`memba_collections/mint.gno`, `grc721/basic_nft.gno`* · **SC2/CSO** · M
- **[2.4]** Make `FinalizeSaleSeed` (seal `SeedSale`) a **mandatory pre-mainnet gate** — an open seed forges verified-purchase reputation. *`sales_index.gno`, `MAINNET_READINESS.md`* · **SC1/CSO** · S
- **[2.5]** Admin → multisig/DAO handoff as a **hard gate**: 2-step `TransferPlatformAdmin/Accept` + market `TransferOwnership/Accept` + `SetFeeRecipient` → the confirmed 2-of-2 multisig / DAO executor; consider a timelock on `RegisterMarket`/`ForceSetCollectionAdmin`. Correct the `config.gno` treasury-multisig mislabel; verify `g10kw7e55…` is a live k-of-n multisig on-chain. *`collection.gno:41`, `governance.gno`, `market_config/config.gno:21`* · **CSO/GNO3** · M · **owner-gated**
- **[2.6]** `unsafe.PreviousRealm()` → `cur.IsCurrent()/cur.Previous()` on the money path (the forced recut is the moment to harden, per §6 policy). *v3_2 + collections* · **GNO1/SC1** · M
- **[2.7]** NF-2 solvency: confirm `TotalLiabilities()/RealmAddress()` wired into `samcrew-realm-solvency.sh`; capture pre/post-deploy reconciliation as a gate. *`getters.gno`, solvency script* · **SC1** · S
- **[2.8]** Settlement integration test **targeting v3_2** (fork/parametrize `nft_settlement_test.sh` off `-resolver`), asserting post-settlement `HasPurchased/PurchaseCount/GetSalesByBuyer`; wire into CI (PR-triggered on `realms/`). *`tests/integration/nft_settlement_test.sh`, CI* · **QA** · M
- **Phase-2 review gate:** CSO + 2× SC adversarial re-audit (fund-drain, auth, reputation-forgery) + solvency reconciliation dry-run.

#### Phase 3 — Fix the broken/hollow live funnels *(make it actually work)*
Goal: buy, list, and **offer→accept** all complete end-to-end, on desktop and phone, with correct post-trade state. Exit: e2e green for buy / list / offer-accept-on-unlisted / mobile.
- **[3.1]** Accept-offer: pass `best.amountUgnot` as the auto-list price + `isListed` into the accept modal on **both** `CollectionPublic` and `TokenDetail`; bundle `[SetApprovalForAll?, ListNFT@offerPrice, AcceptOffer]`; e2e for accept-on-unlisted. *`TradeModal.tsx:259`, `CollectionPublic.tsx:335/480`, `TokenDetail.tsx:149`* · **UX/PT-Trader** · M
- **[3.2]** Replace dead "Connect wallet" text with a real `connect()` CTA (reuse `MyListingsView` pattern), connect-then-continue preserving token context. *`CollectionPublic.tsx:299`, `TokenDetail.tsx:142`* · **UX** · S
- **[3.3]** Surface the existing public/allowlist mint forms on `CollectionPublic` when the phase is public/allowlist (reuse `MintSection` builders) → unlocks the primary user story **and** the `primaryFeeBPS` revenue line, no new realm work. *`CollectionPublic.tsx`, `MintSection.tsx`* · **PO** · M
- **[3.4]** Mobile trade sheet: `TradeModal.css` `@media ≤640px` → bottom-sheet, `max-height:90dvh + overflow-y:auto`, sticky always-reachable CTA, constrained thumbnail. *`TradeModal.css`* · **UX/UI** · M
- **[3.5]** Point the primary trade surface at the **exact structured getter** `GetListingsPage` (itoa price, full addr, paginated past 50), filtered by full `collectionID`; retire `parseMarketplaceRender` from the trade path. *`useCollectionPublic.ts`, `v3TokenGrid.ts`, `v3Reads.ts`* · **FSE1** · M
- **[3.6]** Read-your-writes: after broadcast, poll the authoritative getter until the state change (or block height passes) before clearing the modal; keep the grid mounted with `placeholderData` (no full-page spinner); optimistic-remove traded card. *`TradeModal.tsx`, `useCollectionPublic.ts`, `rpcFallback.ts`* · **FSE1** · M
- **[3.7]** Buy last-look: re-read the listing at confirm; "price changed — confirm again" instead of a doomed tx. *`TradeModal.tsx:167`* · **NFTT** · M
- **Phase-3 review gate:** UX + 2× Product-Tester (Trader/Collector) walk every funnel on desktop + 375px; FSE cross-check the read/write consistency diff.

#### Phase 4 — Trust, provenance & real media *(the P0-A remedy, on the LIVE surface)*
Goal: the buyer signs with identity + reputation + verification; provenance and real art are visible; the "on-chain provenance" chip becomes true. Exit: reputation gated on real purchases; provenance timeline live; artwork renders.
- **[4.1]** Purchase-gated reviews consumer realm — require `HasPurchased(buyer,seller)` before `PostReview` (primitive ready at `sales_index.gno:68`). *new realm `memba_marketplace_reviews`* · **SC1/PO** · L · **owner-gated (money-adjacent realm)**
- **[4.2]** Wire seller identity (`CopyableAddress` + handle) + `<ReputationBadge>` (purchase-gated) + `<VerifiedBadge>` (read from curation realm, never listing metadata) into the **LIVE** `TradeModal` + `CollectionPublic` seller row. *`TradeModal.tsx:367`* · **UX/PO** · M
- **[4.3]** `GetTokenProvenance` RPC over the already-indexed `nft_ownership_history` (mint→transfers→sales w/ block+price); render a provenance timeline + last-sale on `TokenDetail`; only then keep the provenance chip. *`backend/internal/service/*`, `dispatch.go`, `TokenDetail.tsx:172`* · **NFTL/FSE2** · M
- **[4.4]** Fix media: fetch `/api/nft/metadata?uri=` first, then render the inner `image` field; wire `HandleNFTMetadata` into `useCollectionPublic/TokenDetail`; test asserts a `.json` tokenURI resolves to real art. *`NFTMedia.tsx:56`, `nftApi.ts:118`* · **NFTL/FSE1** · M
- **[4.5]** Collection cover art on the discovery grid (interim: first-token uri per card; proper: `cover` meta key). *`NftLane.tsx:153`, `nftHub.ts`* · **UI/PT-Collector** · M
- **Phase-4 review gate:** CSO (verify reputation is truly purchase-gated, not gameable) + UX + Collector re-audit.

#### Phase 5 — Creator completeness
Goal: a non-technical creator can launch a real collection end-to-end. Exit: create→upload→mint→list→earn works; no silent data-loss footguns.
- **[5.1]** Art/metadata pipeline: wire the existing Lighthouse/`ImageUploader` proxy into the create form (collection cover) + a mint metadata-builder (image+traits → JSON → pin → prefilled `tokenURI`), with batch/CSV. *`CreateCollectionLaunchpad.tsx`, `MintSection.tsx`, `ipfs.ts`* · **NFTC/PT-Creator** · L
- **[5.2]** Fix `SettingsSection` data-loss: pass `col`, prepopulate from on-chain config, partial/sentinel updates (or split `SetPrice`), warn before lowering a cap. *`SettingsSection.tsx`, `StudioManage.tsx`, `config.gno:56`* · **PT-Creator** · M
- **[5.3]** Preserve allowlist root on phase change (realm: empty root = "keep"; or FE resends current root); fix the misleading comment. *`PhasesSection.tsx:70`, `config.gno:22`* · **PT-Creator** · M
- **[5.4]** Creator earnings: export `GetProceeds(id,denom)`; show accrued balance in `WithdrawSection` (disable at 0); backend royalty-income rollup + `CreatorProfile` earnings panel; royalty-edit UI (`SetRoyalty`/`SetTokenRoyalty`). *`mint.gno:21`, `WithdrawSection.tsx`, `CreatorProfile.tsx`* · **NFTC** · M
- **Phase-5 review gate:** 3× Product-Tester (Creator focus) launch a real collection cold; PO signs off on completeness.

#### Phase 6 — Marketplace depth, discovery & design system
Goal: competitive primitives + one coherent visual system. Exit: real collection offers or none; price-discovery + portfolio live; one card component.
- **[6.1]** Real collection-offer engine built into v3_2 (or a sibling reusing `SplitProceedsBPS` + `MarketTransfer` + the escrow ledger) with a real "match any token in collection" accept + `totalEscrowed` liabilities; real depth read endpoint; **then** re-enable the Phase-0-hidden UI. *engine + `nft_rpc.go`* · **NFTM/SC1** · L · **owner-gated (money-path)**
- **[6.2]** Price-discovery at trade: thread floor + last-sale + best-offer into `TradeModal`/`PriceBreakdown` (data already in scope). *`PriceBreakdown.tsx`, `TradeModal.tsx`* · **NFTT** · M
- **[6.3]** Portfolio/PnL: wire `GetSalesByBuyer` → cost basis, realized/unrealized PnL, mark-to-floor; render listed/price on `ProfileAssets`. *`ProfileAssets.tsx`, `sales_index.gno:80`* · **NFTT/PT-Collector** · L
- **[6.4]** Design system: define `--color-bg-secondary/-tertiary` aliases (or migrate to `--color-surface`) + CI grep-guard (fixes transparent live cards); unify on one `MarketCard`/`CardModel` across lanes/collection/creator/launchpad (promote `CreatorProfile` off the bullet list). *`tokens.css:38`, `MarketCard.*`, `NftLane.tsx`, `CreatorProfile.tsx:83`* · **UI** · L
- **[6.5]** (Defer-eligible to post-launch) sweep/batch-buy; server-side pagination on `ListNFTTokens/GetNFTPortfolio`; floor-feed resilience. *engine + `nft_rpc.go`* · **NFTM/FSE2** · L
- **Phase-6 review gate:** NFT feature panel (Marketplace/Trader/Collector) + UI re-audit against the OpenSea/Blur/Magic Eden bar.

#### Phase 7 — Economics
Goal: the platform captures revenue where volume exists and either closes the points→liquidity loop or stops claiming it. Exit: `primaryFeeBPS` set + one treasury + honest incentive framing.
- **[7.1]** Set a launch `primaryFeeBPS` (e.g. 250–500 bps, documented deploy value / DAO first act); repoint `memba_collections.feeRecipient` to the **same** canonical DAO treasury as `market_config.GetTreasury()`; add "GetTreasury parity" to the mainnet gate; fix the "DAO treasury" comment. *`collection.gno:48/61/63`, `market_config`, `MAINNET_READINESS.md`* · **ECON/GNO3** · S · **owner-gated (money routing)**
- **[7.2]** Decide the v2 genesis engine's fate (retire+re-home into `memba_collections`, or explicitly document + unify treasury) so there's one fee story. *`memba_nft_market_v2`* · **CTO/ECON** · L · **owner-gated**
- **[7.3]** Points→liquidity: ship ONE closed loop (vetted anti-sybil marketplace awarder into `memba_points_v1` **and** a concrete tier unlock — maker rebate / reduced `createFee` / featured priority) with a fee-weighted (or `min(fee,royalty)`) reward base so zero-royalty cold-start lanes aren't a dead zone — **or** keep points strictly non-binding reputation in the UI until the loop exists. *`points.go`, `memba_points_v1`* · **ECON** · L · **owner-gated**
- **Phase-7 review gate:** ECON + CSO (sybil) + PO.

#### Phase 8 — Backend hardening & mainnet cutover ceremony
Goal: the backend survives mainnet scale; the cut is a single gated ceremony. Exit: `MAINNET_READINESS` fully green; owner runs the ceremony.
- **[8.1]** Media cache: total-bytes budget on `lruCache` (~128–192 MB across both caches, evict-to-budget) + stream-through above ~2 MB + `GOMEMLIMIT` in `fly.toml`; test asserts bounded resident bytes. *`ipfs_serve.go:24/102`, `fly.toml`* · **FSE2/CSO** · M
- **[8.2]** RPC failover: drop the hardcoded test13 default (unset ⇒ fail-clean) or tag nodes with expected chain-id + assert `/status` chain_id before trusting a fallback; boot-time mainnet chain-id assertion. *`rpc_resilient.go:29`, `render_proxy.go`, `main.go`* · **FSE2/CSO** · S
- **[8.3]** Mainnet ceremony (owner-run): deploy the verified closure in dependency order, solvency reconciliation pre/post, treasury repoint + parity assertions, `FinalizeSaleSeed`, admin→multisig, then flip `VITE_ENABLE_NFT`/marketplace flags **only after** each realm verified live on `gnoland1`. *`MAINNET_READINESS.md`* · **CTO/CSO/owner** · L · **owner-gated**
- **Phase-8 review gate (final):** full CTO + CSO + Gno-Core sign-off against the mainnet checklist before the ceremony.

### D.4 — Sequencing & dependencies
`Phase 0 (now)` → `Phase 1 (blocks everything mainnet)` → `Phase 2 (same realm cut as 1)` → `Phases 3,4,5 (parallelizable frontend/creator once realms are stable)` → `Phase 6 (depth; 6.1/6.4 gate re-enabling Phase-0-hidden UI)` → `Phase 7 (economics, owner decisions)` → `Phase 8 (backend + ceremony)`. Phases 3–5 can run concurrently after Phase 1 lands; Phase 6.1 depends on Phase 2's escrow-ledger patterns.

### D.5 — Risk register (top)
| Risk | Mitigation |
|------|-----------|
| avl migration silently weakens an `ok`-gated auth/money branch (CSO-1) | Vendor-pin (option a) preferred; if migrating, 2× SC re-audit every `ok`-branch; full money-path test suite on mainnet toolchain (1.5). |
| `memba_collections` is irreversible — a wrong avl shape is permanent | Phase-1 gate compiles the exact source against the exact mainnet gno **before** the ceremony; no deploy without a green mainnet-parity CI run. |
| Re-enabling collection offers ships another fund-loss stub | Phase 6.1 reuses the audited v3_2 escrow-ledger + CEI; adversarial SC review; keep UI hidden (Phase 0) until the engine is real + tested. |
| Flag flip on mainnet renders hollow lanes (fail-open gate) | Phase 0.4 fail-closed `gnoland1` allowlist **before** any flag flips. |
| "Frequent reviews" become rubber-stamps | Phase-boundary panels are **adversarial** (skeptic prompt, default-to-refuted), mirroring this audit's verification pass that refuted only 1/80 — the method is load-bearing. |

---

## Part E — CTO review of the plan (AAA SWE standards)

Three independent senior lenses (CTO, Staff Engineer/process-testability, Security/CSO) read Part D and **spot-verified its code claims against the real source**. All three: **APPROVE_WITH_CHANGES.**

### E.1 — Verdicts & AAA scorecards (1–5)
| Lens | Verdict | Grounding | Sequencing | Testability/CI | Risk mgmt | Cadence | Completeness |
|------|---------|:--:|:--:|:--:|:--:|:--:|:--:|
| CTO | APPROVE_WITH_CHANGES | 5 | 3 | 4 | 4 | 5 | 5 |
| Staff Engineer | APPROVE_WITH_CHANGES | 4 | 3 | **2** | 3 | 4 | 4 |
| Security / CSO | APPROVE_WITH_CHANGES | 5 | 4 | 4 | 4 | 5 | 5 |

**Grounding:** the reviewers collectively spot-checked **34 concrete code claims — all held** (avl two-value form + single-value on `gno` master, `MARKETPLACE_V2` absent from safety gates, fake `g1fakebuyer` depth, the fund-losing offers stub, fail-open `gnoland1` gate, `ListNFT` no-ownership, `primaryFeeBPS=0`, the drain-gate two-value `Get`, etc.). The one claim that *failed* verification was inside the **plan** (`GetProceeds` scheduled after the immutable cut) — which is exactly the blocker below. Verdict on the audit→plan: **evidence-based, not speculative.**

### E.2 — Weakest dimension (why Testability scored 2)
The Staff lens found the plan's headline CI gate is **not yet achievable as written**: the existing `p0-fund-guard-gate` compiles the realm closure only via a **vendored-`uassert` overlay** (upstream `p/nt/uassert/v0` doesn't preprocess at `gno` head), and the settlement harness depends on the `-resolver` loader **removed by gno #5604** — both must be ported before the gate can turn green. And the plan's most dangerous change (avl migration on the irreversible drain-gated realm) was gated on *human review*, not a positive-control test — violating the plan's own TDD rule. All fixed in §E.3.

### E.3 — Required revisions & disposition (authoritative — amends D.3)
> **B = blocker, M = major, m = minor.** Every item is **Accepted**; disposition states how the plan is amended.

**Blockers**
1. **[B · immutable-realm API freeze]** The "one immutable cut" premise is violated by later phases adding on-chain entrypoints (`GetProceeds` [5.4], `MaxPrice` [2.2], `SetTokenURI` [2.3]) to realms that are append-only after Phase 1/2. → **New task `[1.0] Immutable realm API-surface freeze`**: before executing the cut (`[1.4]`), enumerate **every** realm read/write the whole program (Phases 3–7) will ever call — `GetProceeds`, `MaxPrice`, `SetTokenURI`, listing/offer getters, the reviews purchase-gate read, provenance reads — and land them **all in the single cut**. `[1.4]` is gated on the freeze being reviewed. Anything omitted is explicitly accepted as a permanent gap or scheduled as its own later realm deploy. *(All of `[2.2]/[2.3]/[5.4]`'s realm-side changes move **into** the Phase-1/2 cut; their frontend wiring stays in the later phase.)*
2. **[B · CI gate is unachievable as written]** The mainnet-avl parity gate re-triggers the `uassert`-at-gno-head break, and it already exists as `p0-fund-guard-gate` (not a new job). → **`[1.5]` rewritten**: *"repoint the existing `p0-fund-guard-gate` `GNO_REF` from `f3d5a5d13` to the pinned mainnet ref **after** `[1.4]` lands; it stays a hard gate."* **New prerequisite `[1.2b]`: port/re-vendor `p/nt/uassert/v0` (+ any `p/nt/*` test deps) for the mainnet ref**, extending the existing `ci/vendor/uassert` machinery, with its own exit criterion. Note added: Memba's `gno-test.yml` (pin `7b2888c3`) compiles **client templates only**, not the deployed realms — realm coverage lives entirely in `samcrew-deployer`.
3. **[B · TDD on the irreversible cut]** avl migration + auth changes verified only by human review can silently weaken an `ok`-gated drain branch (`isRegisteredMarket`) that a compile gate can't catch. → **New task `[1.4b] invariant regression suite`** as a **hard exit criterion** for the cut: positive-control `*_test.gno` that *fails* if any `ok`-gated auth/money branch is weakened — `RegisterMarket`/drain-gate rejects unregistered/unauthorized callers, solvency (`balance ≥ TotalLiabilities`), ownership, and `saleSeedSealed`. Built on the existing `governance_test.gno`/`transfer_test.gno`, wired as a hard gate.

**Majors**
4. **[M · SSOT decided twice]** `[1.1]` vs `[7.2]` contradict on one-engine-vs-two. → Reconcile at Phase 1: for the **mainnet cut the dual-engine/dual-fee problem is resolved by construction** — v2 is simply **not deployed to mainnet** (one engine, one config-governed fee). `[7.2]` re-scoped to **test13-only continuity** (retire the live test13 v2 engine + drain residual value). No "two fee stories" in the mainnet narrative.
5. **[M · new realms mis-classified as FE work]** `[4.1]` reviews realm and `[6.1]` collection-offer engine are separate 2-of-2 deploy ceremonies. → **Reclassified as gated realm-deploy events.** `[4.1]`'s realm read-primitives batch **into the Phase-1/2 cut** (avoids a third ceremony); its UI stays dark until the consumer realm deploys. `[6.1]` is a **sibling realm only** ("built into v3_2" dropped — impossible post-immutable-cut).
6. **[M · Phase 2.8 depends on a removed loader]** the settlement harness rides `-resolver` (removed by gno #5604). → **`[2.8]` split**: (a) port the harness to the gnodev native loader (named prerequisite); (b) parametrize for **v3_2** asserting post-settlement `HasPurchased`/`PurchaseCount`/`GetSalesByBuyer`; (c) wire into CI. QA-1 sharpened: v3_2 already has hard-gated *unit* coverage — the gap is the **node-driven, funds-moving integration** path.
7. **[M · cross-repo boundary]** all realm work lands in the **separate `samcrew-deployer` repo**; frontend/backend in **Memba** — two PR streams, two CI systems. → **D.2 gets a repo map + a hard ordering rule: realm PR merged → deployed → verified live on the target chain → *then* the dependent Memba flag/frontend PR.** The D.1 ritual applies in both repos.
8. **[M · verify the WRONG admin key]** `[2.5]` pointed the operator at `g10kw7e55` (the fee-spine, already the real multisig). The actual **drain key is `g1x7k4628`** (single-key, gates `RegisterMarket` + `ForceSetCollectionAdmin` + `createFee`/`feeRecipient`) — and **`collection.gno:39` falsely comments it *is* the 2-of-2 multisig** while `config.gno` calls it a single-key gap (**verified — a direct contradiction**). → **`[2.5]` retargeted to `g1x7k4628`**: verify its on-chain key type, **correct the false `collection.gno:39` comment**, and make the `g1x7k4628 → DAO/multisig` handoff a **hard blocking mainnet gate (not owner-optional)**.
9. **[M · live launch fees to a single key]** `createFee` (1 GNOT/launch) already routes to single-key `feeRecipient=g1x7k4628`, and the repoint was deferred to Phase 7. → **Pulled forward into `[2.5]`/Phase-8 ceremony**: `feeRecipient == market_config.GetTreasury()` is a **hard gate before any mainnet `CreateCollection`**; `primaryFeeBPS > 0` and the `[3.3]` mint-form surfacing are **forbidden until parity holds**.
10. **[M · tokenURI XSS at the wrong boundary]** mint-time realm validation can't sanitize already-minted (immutable) tokens. → **`[2.3]`/`[4.4]` amended**: the **primary** XSS control is a **render-side allowlist/sanitizer** (FE + backend media proxy — reject `data:`/`javascript:`, enforce `ipfs`/`ar`/`https`), sequenced no later than Phase 3/4, with mint-time realm validation as defense-in-depth. Test: a `data:`/`javascript:` tokenURI renders inert.

**Minors**
11. **[m · move stop-the-bleed fixes earlier]** → the **CSS-var alias fix** (transparent live cards, half of `[6.4]`) moves to **Phase 0**; the **artwork-renders fix `[4.4]`** moves to **Phase 3** (depends only on the backend metadata proxy, not the realm cut).
12. **[m · name the positive-control tests]** → exit artifacts named: `[2.4]` on-chain `saleSeedSealed==true` assertion; `[4.1]` realm test that `PostReview` panics without `HasPurchased`; `[5.2]` vitest config round-trip (form must not zero `maxSupply`/`payDenom`); `[6.1]` settlement escrow debit/credit assertion.
13. **[m · deletions need regression guards]** → `[0.1]`/`[0.3]` ship with a **grep/DOM CI guard** (build fails if any `g1fakebuyer` string or hardcoded-empty-lane render reappears) — turning "delete" into a durable invariant.
14. **[m · ForceSetCollectionAdmin break-glass]** "consider a timelock" is too weak for an any-collection-seizure power. → **Firm decision required in `[2.5]`: DAO-gate OR timelock OR omit from the mainnet cut**, recorded as a `MAINNET_READINESS` gate row + in the Phase-2 adversarial review scope.
15. **[m · reviews depend on the seal]** → `[4.1]` **explicitly depends on `[2.4]`** sealing `SeedSale`; the Phase-4 CSO gate asserts `saleSeedSealed==true` before reputation is trusted.
16. **[m · vendored avl must be proven equivalent]** → if option (a) is chosen in `[1.3]`, the vendored `p/samcrew/avl` must **compile under the mainnet gnovm AND pass an insert/get/remove/iterate equivalence+fuzz test vs the stdlib avl**, inside the `[1.5]` parity leg, before it's trusted on the irreversible realm.
17. **[m · ceremony runbook + abort criteria]** `[8.3]` was a single narrative task. → **Explicit reviewable runbook is a Phase-8 deliverable**: exact realm deploy order, multisig sequence numbers, per-step solvency checkpoints, and **abort/rollback criteria for a partial deploy** (what to do if realm N deploys but N+1 fails, given no in-place patch is possible).
18. **[m · pause-coverage test]** → add a test proving the `pauser` role blocks **every** money entrypoint on both v3_2 and `memba_collections` (a missed path is a silent gap on the immutable engine).
19. **[m · revenue-framing + toolchain-pin hygiene]** → `[3.3]`'s exit criterion corrected: it unlocks the **primary-mint *flow*, not revenue** (a zero-fee mint until `[7.1]` sets `primaryFeeBPS`). D.5 gains a note reconciling the **4 live gno pins** (Memba `7b2888c3`; deployer `v1.1.0`, `f3d5a5d13`; + mainnet ref) — the mainnet gate **replaces** `f3d5a5d13` on the fund-guard job rather than adding a 5th from-source build; and the bump must be verified not to break the currently-green v2 fund-guard tests via the same avl change. Plus a **test13 residual-escrow drain** note (v3_1 holds live open offers whose value-exits must stay callable before abandonment).

### E.4 — Net result
The **spine of the plan is sound and confirmed AAA-grounded** (34/34 claims held; the avl gate, the immutable-cut principle, Phase-0 fail-closed sequencing, and adversarial cadence all validated). The revisions are **scoping/specification fixes, not a re-architecture**: they (a) make the immutable cut *actually* one-shot by freezing the realm API surface, (b) make the #1 CI gate *actually* achievable (uassert + loader ports, reuse existing machinery), (c) point the operator at the *correct* drain key and fix a dangerous false code comment, and (d) pull three security/trust fixes earlier. With §E.3 applied, the plan meets the AAA bar.

**Residual OWNER decisions (gates, not mine to make):** canonical-engine + genesis re-home (`[1.1]`); avl vendor-vs-migrate (`[1.3]`); `ForceSetCollectionAdmin` fate (`#14`); `primaryFeeBPS` launch value + treasury unification (`[7.1]`); points→liquidity loop vs non-binding framing (`[7.3]`); and every deploy/ceremony gate.

---

### Appendix — provenance
- Ecosystem scan: `gno` master `f99caf537` (2026-07-13), all `/Gno` repos pulled 2026-07-15.
- Audit workflow `w1n8x8dte` — 22 experts + adversarial verify, 164 findings (68 CONFIRMED / 11 NEEDS-NUANCE / 1 REFUTED of 80 P0/P1), 4.46M tokens.
- CTO-review workflow `wb0vgecww` — 3 lenses, 34/34 code claims verified.
- Raw artifacts under the session scratchpad (`digest_p0p1.md`, `digest_experts.md`, `review_digest.md`) + workflow journals.
