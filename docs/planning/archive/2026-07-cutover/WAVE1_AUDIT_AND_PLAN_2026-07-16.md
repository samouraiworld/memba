# Memba Feature Completion Program — WAVE 1: Mainnet-blocker money-path features
### DAO / Governance · Token & OTC Trading · Reviews & Reputation
### Deep multi-expert audits → super-detailed plans → CTO review · 2026-07-16

> **This is Wave 1 of the scaled program** (pilot = NFT Marketplace, `MARKETPLACE_PILOT_AUDIT_AND_PLAN_2026-07-15.md`). Same shape per feature: full ~22-expert roster deep audit → adversarial verification of every P0/P1 → super-detailed phased plan → independent CTO review. **Batch selection:** the three clean money-path/trust mainnet-blockers that don't collide with the live concurrent session (Feed moderation is hot; Auth/signature paths are off-limits per SESSION_SYNC — **Feed, Points, Auth deferred to Wave 2**).

## Part A — Shared context (all three features)

**Ecosystem:** `gno` master `f99caf537` (2026-07-13); all `/Gno` repos pulled. The **`avl.Get` 2→1 break** (PR #5314/#5644 — `Get` now returns a single `any`, existence via new `Has()`) is the dominant, **program-wide mainnet-compile blocker** — it hit **all three** features and is **untracked in MAINNET_READINESS** everywhere. Only test13's pinned chain avl masks it.

**Inherited global constraints (from the pilot, applied verbatim to every task below):**
- **Cross-repo repo-map:** realms live in **`samcrew-deployer`**, frontend/backend in **`Memba`** — two PR streams, two CI systems. Hard ordering: realm PR merged → deployed → verified live on the target chain → *then* the dependent Memba flag/frontend PR.
- **The one coordinated immutable realm cut** + a **Phase-1 API-surface freeze** (enumerate every entrypoint the whole feature will ever call before the irreversible cut — a getter forgotten at the cut is a permanent gap).
- **CI reality:** the mainnet-parity gate = **repoint the existing `p0-fund-guard-gate` `GNO_REF`** (not a new job), with the **`p/nt/uassert/v0` re-vendor prerequisite** (it doesn't preprocess at gno head), and it must compile the **test** closure too.
- **Per-task cadence:** TDD (red-first, positive-control on every `ok`-gated auth/money branch) → self-verify → **changelog + docs + a MAINNET_READINESS gate row** → adversarial (default-to-refuted) phase-boundary review panel. Owner-gated tasks tagged **⟨OWNER⟩**.
- **Verify the RIGHT admin key:** the drain/admin key `g1x7k4628` is **falsely commented "multisig"** in multiple realms while the fee-spine `market_config` calls it single-key — confirmed again in **all three** features this wave. Always verify the on-chain key type, never the comment.

## Part B — Program-level findings (what the three audits share)

Three independent 20–22-expert rosters, **259 verified P0/P1 findings, only 2 refuted across all three** — the audits are evidence-grounded, not speculative. Five patterns recur across every money-path feature and are best fixed **once, program-wide**:

| # | Cross-cutting pattern | DAO | Trading | Reviews | Fix once |
|---|---|:--:|:--:|:--:|---|
| **X1** | `avl.Get` 2→1 mainnet-compile break, untracked | ✅ (+gnodaokit) | ✅ (4 realms) | ✅ (4 realms) | One coordinated avl cut (vendor `p/samcrew/avl`) **extended to cover the DAO+Trading+Reviews realm sets**, not just the NFT stack; one MAINNET_READINESS gate; one CI leg |
| **X2** | Money-path flags **not** in `SAFETY_GATED_FLAGS` | — | ✅ TOKENS/SERVICES | ✅ REVIEWS/APP_REVIEWS | One `safeFlags.ts` PR adding all of them (+ MARKETPLACE_V2 from the pilot) |
| **X3** | Realm allowlist **fail-open** on gnoland1 | ✅ | ✅ | ✅ | One `isRealmValidOn` fail-closed fix (pilot §0.4) |
| **X4** | `g1x7k4628` single-key admin **falsely commented "multisig"** on money/trust authority | ✅ (root DAO) | ✅ (escrow/agent) | ✅ (moderator) | One key-hygiene sweep: verify on-chain, correct every false comment, repoint to real multisig, least-privilege split |
| **X5** | **Fabricated/placeholder data shipped as live** | ✅ false "governance vote" copy | ✅ Services seed catalogue, MEMBATEST | ✅ ungated sybil star-averages, fake "✓ verified" | Delete/gate every demo-tell before its flag can flip (grep-guards) |

> **⚠️ Dedup correction (§E.3):** only **X1 (vendored `p/samcrew/avl` + shared CI leg), X2 (`safeFlags.ts`), X3 (`isRealmValidOn`)** are genuine single shared PRs. **X4 splits into X4a** (shared comment-correction + on-chain key-type verification — one PR) and **X4b** (per-realm key *repoints* — each rides that realm's own immutable cut + owner-gate, **not** one PR). **X5** is a per-feature checklist (3 separate PRs). And there is **no single "immutable cut"** — there are **4+ independent per-realm cuts** (pilot NFT / DAO + a *forked* gnodaokit / Trading / Reviews) sharing only the avl package, one MAINNET_READINESS section, and one CI job. **The GNO_REF repoint is one atomic program-wide flag-day** — no feature can green its CI leg alone; all gated realms migrate first, then one named owner flips the ref. **A program-level owner of the shared artifacts must be named.**

### ⛓ Cross-feature dependencies (⚠️ REVISED by the CTO review — see §E.2)
> The framing below was **corrected by all three DAO lenses + the coherence pass.** Read it with **§E.2**, which is authoritative.

**The DAO executor is unbuilt (`DA-P0-1`, verified)** — `memba_dao` exposes only the stock 6 basedao governance resources; **no banker, no treasury-spend, no admin-accept action.** But my original conclusion that this **blocks mainnet** is **over-drawn**: the fee spine (`memba_market_config`) is **already owned by the real 2-of-2 multisig `g10kw7e55` with treasury=multisig from init**, and admin handoffs are **2-step (recoverable)** — so **multisig custody is a valid launch terminal state**, and the executor is a **post-launch decentralization milestone, NOT a launch blocker.** The *only* irreversible vector is the **1-step `SetFeeRecipient`/`SetTreasury`** setters (never point them at the executor-less DAO realm). **The genuine hard predecessors are cheap:** the G0.3 comment/guard fix + the X4 key repoints — NOT the XL executor. **The actually-critical program gate** is the **pilot marketplace immutable cut** (§E.2/E.3), which is the shared chokepoint for Reviews and must fold in `SaleSeedSealed()` before it freezes.

### Wave-1 verdicts at a glance
- **DAO / Governance** — the tested product is the GovDAO explorer; `MembaDAO` itself is a **deployed shell that can't do its one job** (own treasury/admin). Executor unbuilt, write-path ABI mismatched, membership dead-ends, false "governance vote" copy. `channels_v2` ACL critical is **fixed**. **Split into two tracks (§E.2):** a small launch-critical slice (G0 stop-the-bleed + candidature avl/ledger + a `VITE_ENABLE_DAO` kill-switch) and a **post-launch** executor/membership/gnodaokit-fork track that runs in parallel with — not ahead of — Trading.
- **Token & OTC Trading** — **cores genuinely sound** (atomic no-custody OTC, real escrow state machine, verified guards); failures are integration/coherence: avl break, wrong-key custody admin, `escrow_v3` off the DAO fee spine, OTC approves the wrong spender (List/Fill revert), Services ships a fake catalogue, custody paths near-untested. Highest fund-risk feature.
- **Reviews & Reputation** — a review *widget*, not a reputation system: **zero purchase-gating → sybil-farmable** star-averages, 4 artifacts for one feature with the live surface on the un-hardened v1, moderator = the drain key. **Dark in prod**, so all pre-launch.

---

## Part C — Feature audits & plans

## Feature 1 — DAO / Governance

**Roster:** 20/21 experts reporting (one hit the structured-output retry cap) · 162 findings · **85 P0/P1 verified (75 CONFIRMED, 8 nuance, 2 refuted).** This is the **root-of-trust** feature — every other feature's mainnet admin/fee handoff terminates here.

### D.C — Audit synthesis (deduped)

**Verdict:** the functional, tested "DAO governance" product is the generic explorer over the **external GovDAO + user-created template DAOs** — **not `MembaDAO` itself.** The flagship `memba_dao` realm is a **deployed shell that cannot perform the one job it exists for**: own the treasury and admin keys of the other realms. Prior **`channels_v2` CRITICAL ACL gaps are genuinely fixed** (good — that historical critical is closed), but the governance **"DAO trap" (single-member lock-in, no working onboarding, broken write path) is open.**

**P0 root issues (deduped):**

- **DA-P0-1 · The DAO executor is UNBUILT — `memba_dao` cannot own treasury or admin of any realm** (DAOTREAS-01; **the program-level blocker**). `memba_dao` constructs `basedao.New` with only the stock 6 resources (EditProfile, ChangeDAOImplementation, Add/Remove Member, Assign/Unassign Role) — **no `ExecuteLambda`, no banker, no treasury-spend, no admin-accept action.** So the marketplace/trading/reviews plans that say "hand admin to the DAO executor" **have no receiving end.** *Fix: build a banker-aware executor DAO (roadmap PR0 Option A) registering explicit action types for (a) accepting external-realm admin/ownership handoffs and (b) bounded treasury spends. **XL, and it gates every other feature's mainnet handoff.***
- **DA-P0-2 · "DAO trap": handing admin/fees to the `memba_dao` realm today = irreversible loss** (DAOTREAS-02, verified as genuine P0 on the fee path). `SetFeeRecipient` is **1-step** (`governance.gno:101`, no reject of the DAO realm address); ~6 realms carry `"platformAdmin -> memba_dao executor on mainnet"` comments (collections, market, appstore, points). Transferring to the realm that has no executor sends custody nowhere, unrecoverable. *Fix: rewrite the ~6 comments to "transfer to the fee-spine MULTISIG, never the memba_dao realm — the DAO has no executor yet"; add a ceremony guard that rejects the memba_dao realm address as a handoff target until DA-P0-1 ships.*
- **DA-P0-3 · avl.Get 2→1 breaks the whole DAO stack AND its gnodaokit dependency** (11 experts). `candidature_v2/v3` + `channels_v2` = ~53–89 two-value sites, **and** `gnodaokit` (`basedao`/`daokit`/`daocond`) uses it too — and gnodaokit is **quarantined on gno master**. Some broken sites are auth guards. Untracked. *Fix (bigger than other features): vendor a byte-frozen `p/samcrew/avl` repointed in **both** the DAO realms **and a forked gnodaokit**, OR migrate every site + re-pin gnodaokit to the migrated basedao; add to MAINNET_READINESS + mainnet-parity CI.*
- **DA-P0-4 · `memba_dao` governance write-path is non-operable in-product** (CTO-2/PO). Frontend builders call `VoteOnProposal`/`ExecuteProposal`/`Propose(title,desc,category)`/`ProposeAddMember` (`builders.ts:61/73/87/130`) — **none exist** on the realm, which exports `Propose(req)`/`Vote(id,vote)`/`Execute(id)`. Reading proposals works; **writing fails on-chain.** *Fix: build basedao-native propose/vote/execute builders + a real membership path.*
- **DA-P0-5 · No candidate→member path; approval is single-admin, not a vote** (PO/DAOGOV). `candidature_v3.MarkApproved` only flips status + refunds the deposit; `memba_dao` exports no `AddMember`/`ProposeAddMember` (`buildAddMemberMsg` used only in tests). Membership **dead-ends at "approved."** Approval is gated by an **owner-managed admin allowlist, not DAO votes.** *Fix: wire approved-candidate → `ProposeAddMember` → member; source channel/candidature membership from the DAO member set.*
- **DA-P0-6 · Root-of-trust admin is a single hot key mislabeled "multisig" (1 member @ 66% = 100% quorum)** (FSE3-2, same precedent as every other feature). `memba_dao.gno:44` seeds one founding member `g1x7k4628` as admin+dev, commented "samcrew-core-test1 multisig"; three contradictory labels (`memba_dao.gno:44`, `membaDAO.ts:20`, `realms.manifest:65`). *Fix: replace with the real multisig, seat >1 signer, reconcile the labels against the on-chain key.*
- **DA-P0-7 · `candidature_v2` (unguarded fund-drain, no IsUserCall) still wired into the frontend allowlist** (`config.ts:226`). *Must never appear in the mainnet deploy set; drop from the allowlist once legacy deposits are withdrawn.*

**Must-not-ship demo-tells (trust-copy — 3 verified false affordances):**
1. **CandidaturePage:** "submitted to a DAO governance vote (66% approval threshold)" — but `candidature_v3` approves via a **single admin's `MarkApproved`, NO vote.**
2. **TreasuryProposal toast:** "Requires DAO vote to execute" — the proposal is **text-only (`ActionType 'none'`), execution moves zero funds.**
3. **ShowcaseBoard** presents `memba_dao` with Propose/Vote/Execute buttons that **call functions the realm doesn't export** → broken action.

**P1 clusters (63 P1 → 7 workstreams):**
1. **ACL / centralization** — `channels_v2` header claims "flag→threshold→auto-hide→DAO vote→remove" but `RemoveThread`/`RemoveReply`/`UnhideThread` are **unilateral admin** (no proposal/vote exists); membership+moderation centralized in one owner key.
2. **Cosmetic channel types** — readonly/announcements channels are **member-writable on-chain** (WriteRoles hardcoded regardless of type).
3. **Engine sprawl** — two governance engines (gnodaokit basedao vs homegrown `daoTemplate`) behind one 3-format parser; `daoTemplate` has **no banker** → template treasury spends can never execute (gated off).
4. **Three disjoint membership stores** — basedao members, candidature admin allowlist, channels members tree — glued by manual owner ops.
5. **Governance mechanism gaps** — no timelock/execution delay, voting-power/quorum design, veto/guardian; upgrade governance via `ChangeDAOImplementation` is a self-brick risk.
6. **AI analyst** — trust/metering/cost concerns on the DAO analyst agent surface.
7. **UI** — `${var}15` hex-alpha-append on `var()` colors produces **invalid colors** (currently shipping); light/dark parity gaps; no `memba_dao` e2e.

### D.D — Plan (DAO / Governance → complete, functional, mainnet-ready)

> Inherits the pilot's global constraints (D.0–D.2). **⚠️ Re-scoped by §E.2:** this feature splits into a **launch-critical slice** (G0 + a new `VITE_ENABLE_DAO` kill-switch + candidature avl/ledger) that is small and genuinely first, and a **post-launch decentralization track** (G1 executor / G2 membership / G3 gnodaokit fork) that runs **in parallel with or after** the other features — NOT ahead of the higher-fund-risk Trading feature. Owner-gated tasks tagged **⟨OWNER⟩**.

**Phase G0 — Stop-the-bleed / stop the false affordances (S/M, no realm work)**
- **[G0.1]** Fix the 3 demo-tells: correct CandidaturePage "governance vote" copy → "reviewed by an admin"; TreasuryProposal toast → truthful (no funds move); hide/disable the `memba_dao` Propose/Vote/Execute buttons that call non-existent functions. Grep-guard against the false-vote strings.
- **[G0.2]** Drop `candidature_v2` (unguarded fund-drain) from the frontend allowlist (`config.ts:226`); confirm no live deposits stranded first.
- **[G0.3]** Rewrite the ~6 `"-> memba_dao executor"` handoff comments across collections/market/appstore/points to **"fee-spine MULTISIG, never the DAO realm (no executor yet)"** — prevents a catastrophic mis-handoff during any *other* feature's ceremony.
- **[G0.4]** Fix the `${var}15` hex-alpha-on-var color idiom (invalid colors, shipping now).

**Phase G1 — The executor (the program-level unblock) ⟨OWNER⟩**
- **[G1.1] ⟨OWNER⟩ Decide the canonical engine:** gnodaokit basedao (recommended) vs homegrown `daoTemplate`; retire the loser + the 3-format parser. basedao is the tested root; `daoTemplate` has no banker.
- **[G1.2]** Build **`memba_dao_v2`**: a banker-aware executor registering explicit, human-readable action types for **(a) accepting external-realm admin/ownership handoffs** (the `AcceptOwnership`/`AcceptPlatformAdmin` counterparties already exist on collections/market) and **(b) bounded treasury spends**, each threaded through propose→vote→execute with a **timelock**. *XL. This is the keystone — nothing else's mainnet handoff is real until this exists.*
- **[G1.3]** basedao-native frontend builders (`Propose(req)`/`Vote(id,vote)`/`Execute(id)`) replacing the mismatched ABI; a real proposal-construction UI for admin-accept + treasury-spend actions.
- **[G1.4]** Immutable API-surface freeze for `memba_dao_v2` (pilot blocker #1): every action type + getter the program will ever call, landed in one cut.

**Phase G2 — Membership pipeline (make the DAO able to grow) ⟨OWNER⟩**
- **[G2.1]** Wire approved-candidate → `ProposeAddMember` → member; source `channels_v2` + candidature membership from the DAO member set (kill the 3-store divergence).
- **[G2.2] ⟨OWNER⟩** Seat >1 signer / replace the single founding key with the real multisig; resolve the 3 contradictory "multisig" labels against the on-chain key. Fixes the single-member lock-in "DAO trap."
- **[G2.3]** Make candidature approval an actual DAO action (or honestly relabel it "admin review") to match the (corrected) UI copy.

**Phase G3 — avl + gnodaokit fork (mainnet compile) ⟨OWNER-deploy⟩**
- **[G3.1]** Vendor `p/samcrew/avl` (or migrate) across the DAO realms **AND a forked gnodaokit** (basedao/daokit/daocond); re-pin gnodaokit to the migrated basedao; positive-control tests on every `ok`-gated auth branch; add to MAINNET_READINESS + mainnet-parity CI. *Larger than other features because of the quarantined dependency.*

**Phase G4 — ACL correctness + moderation truth (realm work, in the cut)**
- **[G4.1]** Enforce channel-type write rules on-chain (readonly/announcements must reject member writes — today cosmetic).
- **[G4.2]** Make moderation match its advertised model: either implement the "flag→threshold→DAO-vote→remove" path or correct the header to "admin moderation"; route `RemoveThread`/`RemoveReply` through governance where claimed.
- **[G4.3]** Governance mechanism hardening: timelock/execution delay on executor actions, quorum/threshold review, guardian/veto, and a self-brick guard on `ChangeDAOImplementation`.

**Phase G5 — Tests + mainnet ceremony ⟨OWNER⟩**
- **[G5.1]** `memba_dao_v2` executor tests (propose→vote→execute for admin-accept + bounded spend + timelock); ACL enforcement tests; candidate→member e2e; wire into CI.
- **[G5.2] ⟨OWNER⟩** Mainnet ceremony: deploy `memba_dao_v2` with executor live → **only then** run the *other* features' admin/fee handoffs into it (cross-feature dependency-ordered runbook).

**DAO go-live gate:** executor built + write-path ABI fixed + candidate→member wired + multisig seated + avl+gnodaokit compile on mainnet + ACL enforced + false-vote copy fixed → *then* the DAO can receive handoffs and be presented as operable governance.

> **⛓ Program dependency (corrected — §E.2):** the executor is a predecessor **only for optional DAO *ownership*** of fees/admin, **not** for the other features reaching mainnet — those launch keyed to the **fee-spine multisig** (a valid terminal state). The real hard predecessor is the cheap **G0.3 comment/guard fix + X4 key repoints**. Point `SetFeeRecipient`/`SetTreasury` at the **multisig, never the executor-less DAO realm** (1-step = irreversible).


---

## Feature 2 — Token & OTC Trading (fungible tokens · OTC swaps · escrow custody · agent credits)

**Roster:** 22 experts reporting · 176 findings · **83 P0/P1 verified (77 CONFIRMED, 6 nuance, 0 refuted).** This is the **highest fund-risk feature after the NFT marketplace** — real custody lives in `escrow_v3` and `agent_registry_v2`.

### T.C — Audit synthesis (deduped)

**Verdict — the good news first (independently verified, not taken on faith):** the **settlement cores are genuinely sound.** `memba_token_otc_v2` uses **allowance-based atomic settlement with NO standing custody** — so it has *no escrow-loses-funds class*; the "no custody" hero claim is accurate (CEI + exact-OriginSend + IsUserCall + int64-overflow + fee-on-transfer guards all present). `escrow_v3` has a careful milestone/dispute/timeout state machine. The `#920–922` IsUserCall fund-drain guards and `#856` int64 overflow guard are present and verified, and the **deploy-time fail-closed gate correctly fences the 4 unguarded legacy realms** (`token_otc_v1`, `escrow` v1/v2, `agent_registry` v1) out of prod. The failures below are **integration / coherence / mainnet**, not the core money math.

**P0 root issues (25 P0 dedupe to 8):**

- **TR-P0-1 · avl.Get 2→1 fail-compiles all 4 canonical realms — and they are OUTSIDE the pilot's avl-cut scope** (13 experts). ~30–31 two-value sites across `tokenfactory_v2` (3), `memba_token_otc_v2` (3), `escrow_v3` (2), `agent_registry_v2` (~22), + `memba_market_config` (1). **Some `ok`-branches gate authorization/dedup** (agent_registry `RemoveAgent`, dedup) — a mechanical migration can silently weaken them. Untracked in MAINNET_READINESS. *Fix: extend the pilot's coordinated avl cut to cover this realm set (not just the NFT stack); vendor `p/samcrew/avl` or migrate + positive-control tests on every ok-gated branch; add these realms to the mainnet-parity CI leg.*
- **TR-P0-2 · Custody realms run on the single-key `g1x7k4628` admin, falsely commented "multisig"** (CSO-01, same precedent as marketplace §2.5 / reviews RV-P0-5). `escrow_v3/escrow.gno:46-47` hardcodes `g1x7k4628` as **both `AdminAddress` and `FeeRecipient`** ("// samcrew-core-test1 multisig", "// Samourai Coop multisig"); `agent_registry_v2:63` same — while `market_config.gno:24-31` explicitly documents that key as **single-key + "pre-existing governance gap."** *Fix: verify the on-chain key type; repoint admin+feeRecipient to the DAO/multisig **before** any mainnet funds; correct the false comments; hard mainnet gate.*
- **TR-P0-3 · `escrow_v3` bypasses the DAO fee spine — hardcoded 2% to the wrong key, no setter** (CTO-2). Services fees don't read `memba_market_config`'s service lane (which OTC/NFT honor) and there's **no treasury setter** → on an immutable realm, Services platform fees permanently miss the DAO treasury with no correction short of redeploy. *Fix: read `market_config.GetFeeBPS(serviceLane)` + route to `GetTreasury()`, or add a governed setter — must land in the immutable cut.*
- **TR-P0-4 · OTC List/Fill money path is broken: frontend approves the realm PATH string as GRC20 spender; the realm checks allowance against the realm ADDRESS** (PT1-02, verifier's "strongest finding"). `buildApproveMsg(..., MEMBA_DAO.tokenOtcPath, ...)` at `TokenTradeModal.tsx:131` + `tokenOtcApi.ts:16` approve `gno.land/r/samcrew/memba_token_otc_v2` (a path), but the realm checks the derived **address** → **both List and Fill revert.** The lane is dead on arrival. *Fix: resolve `EngineAddress()` and approve/allowance-check against the realm address; test asserting spender == derived address.*
- **TR-P0-5 · Services lane ships FABRICATED data under a working-escrow promise** (fabricated-data, 4 experts). `ServiceLaneV2` renders the `foundingSupply.seed` catalogue as if live, under a hero promising "working escrow," while `HireServiceModal` **fails closed** (its comment still cites the dead `escrow_v1`). The functional `escrow_v3` `CreateContract→FundMilestone→Release/Dispute` flow + message builders (`lib/escrowTemplate.ts`, `builders.ts`) exist but **nothing in the UI consumes them.** *Must-not-ship: a live Services tab that dead-ends on Hire over a fake catalogue. Fix: wire the real flow OR ship an honest empty state — never the seed.*
- **TR-P0-6 · The v2 cutover lane (`TokenLaneV2`) is non-transactable + `MEMBATEST` placeholder** (PT1-01). The v2 token lane is **browse-only** (no buy/list/fill CTA); the only trade UI (`TokenTradeModal`) is wired solely into the **legacy** `pages/TokenLane.tsx` with the hardcoded `symbol:'MEMBATEST'`. *Fix: build the v2 trade surface before flipping `MARKETPLACE_V2` with Tokens live; delete MEMBATEST.*
- **TR-P0-7 · Money-path flags not safety-gated + allowlist fail-open on gnoland1** (FSE3-01/02). `VITE_ENABLE_TOKENS/SERVICES/MARKETPLACE_V2` **absent from `SAFETY_GATED_FLAGS`** (only TREASURY_SPEND + AGENT_CREDITS gated); `isRealmValidOn` fail-opens on any non-test13 network. A dashboard flip ships an unenforced money path with a green build. *Fix: same as pilot §0.2/0.4 — add the flags; fail-closed allowlist for prod networks.*
- **TR-P0-8 · Custody paths have near-zero behavioral tests** (QA-1/2/3). `escrow_v3`'s **8 fund-moving entrypoints have only 2 IsUserCall guard tests** (no lifecycle/balance-delta tests); `agent_registry_v2` credit ledger is untested — the **v1→v2 migration silently dropped the entire funded-deposit suite**; `otc_v2` `Fill` swap body is **completely unexercised** (its one test exits at the guard before the listing lookup). *Fix: behavioral suites driving full lifecycles with `IssueCoins`+`SetOriginSend`, asserting realm-balance/recipient deltas; wire into CI.*

**P1 clusters (58 P1 → 7 workstreams):**
1. **No solvency getters** — `escrow_v3`/`agent_registry_v2` (pooled custody) expose no `TotalLiabilities()`/`RealmAddress()`, so the mandatory pre/post-deploy solvency reconciliation can only balance-check. *Must be in the immutable API-surface freeze.*
2. **OTC decimals ignored** — frontend labels whole-token over base-unit amounts → **misstates order size by 10^decimals** on a live money path; list flow can dead-end on stale allowance.
3. **Deployed-state SSOT wrong** — `realm-versions.json` doesn't record the 3 canonical successors (`escrow_v3`, `agent_registry_v2`, `token_otc_v2`) → ambiguous provenance for fund realms.
4. **OTC listings unbounded + no liveness filter** — `GetListings`/CSV iterate the whole tree O(N) with no cap/expiry; stale/unfillable listings render as live and revert on fill.
5. **Agent-credit trust asymmetry** — `UseCredit` is creator/admin-only → a depositor's prepaid GNOT is drawn down at the creator's discretion with no on-chain proof-of-service. (Lane dark + owner-gated, but a model gap before mainnet.)
6. **Pause coverage** — no test proving `pauser` blocks every money entrypoint on both custody realms.
7. **CI/toolchain** — vendored-dep-closure OTC gate exists (a good pattern) but the custody suites aren't in it; `uassert`-at-head prerequisite applies.

### T.D — Plan (Token & OTC Trading → complete, functional, mainnet-ready)

> Inherits the pilot's global constraints (D.0–D.2) verbatim. Because the cores are sound, this plan is **less "fix the math," more "make ONE coherent lane per family actually reachable, safe-keyed, and mainnet-compilable."** Owner-gated tasks tagged **⟨OWNER⟩**.

**Phase T0 — Stop-the-bleed (S/M, no realm work)**
- **[T0.1]** Add `VITE_ENABLE_TOKENS`, `VITE_ENABLE_SERVICES`, `VITE_ENABLE_MARKETPLACE_V2` to `SAFETY_GATED_FLAGS`; force `VITE_ENABLE_SERVICES=false` (committed `true` in root `.env`). *TDD via `safeFlags.test.ts`.*
- **[T0.2]** Replace the fabricated `ServiceLaneV2` seed catalogue with an **honest empty/"coming soon" state** (or hide the lane) until the real `escrow_v3` flow is wired — grep-guard so the seed array can't render live.
- **[T0.3]** Fail-closed `isRealmValidOn` for production networks (shared fix with pilot §0.4 and Reviews R0.2 — do once).
- **[T0.4]** Delete the `MEMBATEST` hardcode from the legacy `TokenLane.tsx`.

**Phase T1 — Canonicalization + immutable API-surface freeze ⟨OWNER⟩**
- **[T1.1] ⟨OWNER⟩** Pick **ONE canonical realm per family** for mainnet: `tokenfactory_v2`, `memba_token_otc_v2`, `escrow_v3`, `agent_registry_v2`; retire v1/v2 legacy from the deploy set (keep the fail-closed gate as backstop). Record in `realm-versions.json`.
- **[T1.2] Immutable API-surface freeze** (pilot blocker #1): enumerate every entrypoint the whole feature needs — `EngineAddress()`, `TotalLiabilities()`/`RealmAddress()` solvency getters on both custody realms, a governed fee-treasury setter on `escrow_v3`, any listing/liveness getters — and land them **all in the single cut**.
- **[T1.3]** Extend the pilot's coordinated **avl cut to this realm set** (TR-P0-1): vendor `p/samcrew/avl` or migrate ~31 sites, with positive-control tests on every `ok`-gated auth/dedup branch (agent_registry `RemoveAgent`, OTC dedup); add these realms to MAINNET_READINESS + the mainnet-parity CI leg (reuse `p0-fund-guard-gate`; mind the `uassert`-at-head prerequisite).

**Phase T2 — Fee-spine + key hygiene (in the immutable cut) ⟨OWNER-deploy⟩**
- **[T2.1]** `escrow_v3` reads `market_config` service-lane fee + routes to `GetTreasury()` (TR-P0-3) — kills the hardcoded-2%-to-wrong-key defect.
- **[T2.2] ⟨OWNER⟩** Repoint `escrow_v3` + `agent_registry_v2` `AdminAddress`/`FeeRecipient` off single-key `g1x7k4628` to the DAO/multisig; verify on-chain key type; correct the false "multisig" comments; **hard mainnet gate: `feeRecipient == GetTreasury()` and admin == multisig before any mainnet funds** (TR-P0-2). *Coordinate with the DAO feature's executor-handoff (Feature 1).*
- **[T2.3]** Solvency: implement `TotalLiabilities()` on both pooled realms; add the pre/post-deploy numerical reconciliation to MAINNET_READINESS §3; add an **on-chain solvency invariant assertion** (Σ liabilities ≤ realm balance) inside `agent_registry_v2`.

**Phase T3 — Make the lanes actually transactable (FE/BE, parallelizable)**
- **[T3.1]** Fix OTC approve/allowance to target `EngineAddress()` not the path (TR-P0-4) — unblocks List+Fill; e2e asserting a full list→fill→proceeds cycle.
- **[T3.2]** Handle token **decimals** end-to-end (TR-P0-2 P1): base-unit math + correct labels; block the stale-allowance dead-end.
- **[T3.3]** Build the v2 token trade surface (`TokenLaneV2` buy/list CTA → `TokenTradeModal`/trade panel) (TR-P0-6).
- **[T3.4]** Wire the real Services flow: `HireServiceModal` → `escrow_v3` `CreateContract→FundMilestone`, `ServiceLaneV2` reads live contracts; retire the stale `escrow_v1` premise (TR-P0-5). *Owner-gated: needs a services listing/discovery source — escrow_v3 only stores contracts once created, so a listing realm or off-chain directory is a **product decision**.*

**Phase T4 — Test the custody paths (blocking for mainnet funds)**
- **[T4.1]** `escrow_v3` behavioral suite: full milestone/dispute/timeout lifecycle, balance-delta asserts, `ClaimRefund`/`ClaimDisputeTimeout`.
- **[T4.2]** `agent_registry_v2` credit-ledger suite (port the dropped v1 aaa1 suite to v2 semantics): credited balances, `UseCredit` credit→earnings deltas, `RefundCredits`/`WithdrawEarnings` payouts, `RemoveAgent` at cap.
- **[T4.3]** `otc_v2` `Fill` full-swap test (seed token → list → full + partial fill; buyer/seller/treasury deltas).
- **[T4.4]** Pause-coverage test across every money entrypoint on both custody realms; wire all into CI.

**Phase T5 — Product completeness + mainnet ceremony ⟨OWNER⟩**
- **[T5.1]** OTC listing expiry + liveness filter + bounded pagination (kills the O(N) stale book).
- **[T5.2] ⟨OWNER⟩** Agent-credit trust model: decide proof-of-service / escrowed-release for `UseCredit` before de-gating `AGENT_CREDITS` (currently creator draws depositor funds at will).
- **[T5.3] ⟨OWNER⟩** Mainnet ceremony (dependency-ordered runbook per pilot §E3 #17): custody realms deploy with solvency getters live + reconciliation passing + admin/fee repointed → then flags.

**Trading go-live gate:** avl fixed on the canonical set + admin/fee off single-key + `escrow_v3` on the DAO fee spine + solvency getters + OTC approve-address fixed + custody suites green + flags safety-gated + Services honest → *then* de-gate per lane.


---

## Feature 3 — Reviews & Reputation

**Roster:** 21 experts reporting · 166 findings · **91 P0/P1 verified (85 CONFIRMED, 6 nuance, 0 refuted).** Feature is **dark in prod** (both `VITE_ENABLE_REVIEWS` and `VITE_ENABLE_APP_REVIEWS` default false) — so every issue below is a **pre-launch gap, not a live incident**. That containment is the one saving grace.

### R.C — Audit synthesis (deduped)

**Verdict:** a functionally rich *open social-review engine* (post/edit/delete/react/comment/flag, block-height→date resolution, username join, optimistic post, DoS-hardened v2/core stores) — but **the single thing that makes a review a *trust signal* is unbuilt**. It is a review widget, not a reputation system, and it cannot compile at the mainnet cut.

**P0 root issues (91 P0/P1 dedupe to 5):**

- **RV-P0-1 · avl.Get 2→1 fail-compiles all four reviews realms** (13 experts converged). 22 two-value `v, ok := t.Get()` sites across `memba_reviews_v1` (7), `memba_reviews_v2` (8), `memba_reviews_core_v1/store.gno` (7); `appstore_reviews_v1` consumes core. None vendor avl; **untracked in MAINNET_READINESS**. Same program-wide blocker as marketplace/pilot §A1. *Fix: fold into the program avl remediation (vendor `p/samcrew/avl` or migrate call sites) on the **canonical path only**, + a reviews row in MAINNET_READINESS + a mainnet-parity CI leg. Note the **test files also use two-value Get**, so the CI leg must compile the test closure too.*
- **RV-P0-2 · Zero purchase/interaction gating + no self-review guard → reputation fully forgeable/sybil-farmable** (12 experts). Every `PostReview` (v1:209, v2:235, core:267, appstore:48) validates only `subject!="" / rating 1..5 / body length` — **no `HasPurchased` check, no `caller!=subject` check**. `React()` blocks self-reactions but `PostReview` does not. The gate primitive **exists and works** (`memba_nft_market_v3_2/sales_index.gno:68 HasPurchased`) but **no reviews realm calls it** — the pilot's Phase 4.1 `memba_marketplace_reviews` consumer realm does not exist. One-review-per-(subject,author) is the only limiter, trivially defeated with N wallets. **This is the feature's entire premise, missing.**
- **RV-P0-3 · Four artifacts for one feature; the live surface runs the un-hardened v1** (CTO/PO). `v1` (wired + un-hardened, carries the RV read-DoS), `v2` (DoS-hardened but **orphaned** — `explicit` in the manifest, absent from allowlist/frontend/realm-versions), `core_v1` (the real engine, only appstore uses it), `appstore` (thin wrapper). Frontend `reviewsPath` defaults to v1 (`config.ts:245/575`). The manifest itself warns deploying v2 alongside would "stand up an empty parallel board." **No single canonical realm chosen; no v1→v2 migration/repoint ceremony.**
- **RV-P0-4 · SeedSale unsealed backdoor makes even a purchase-gate forgeable** (shared with marketplace §2.4). `saleSeedSealed` is false on fresh deploy; owner-only `SeedSale` can fabricate `HasPurchased` until `FinalizeSaleSeed` latches it; **no exported `SaleSeedSealed()` getter** for a consumer realm to assert. *Reviews Phase 4.1 hard-depends on the seal.*
- **RV-P0-5 · Moderator takedown key = the hardcoded shared `g1x7k4628` drain key, code-commented "multisig," solo-signable** (CSO/SC2/FSE2/REVMOD). `ModeratorAddress` const in v1:34 / v2:34 / appstore:29 (and hardcoded again in `ReviewCard.tsx:36`) is the same address that is `AdminAddress`/`FeeRecipient` across ~24 realms — the exact **false-"multisig"-comment precedent** the marketplace CSO caught. No setter, no rotation, no global pause. Least-privilege violation: moderation authority == fee/drain authority.

**P1 clusters (66 P1 → 8 workstreams):**
1. **Fail-open on mainnet** — `isReviewsValid()` defined but **zero callers**; no `isAppReviewsValid`; surfaces gate on env-flag only; `VITE_ENABLE_REVIEWS/APP_REVIEWS` **not in `SAFETY_GATED_FLAGS`**; `REALM_ALLOWLIST` fail-open on gnoland1.
2. **Two different averages on one page** — section header computes client-side from the first ≤20 reviews (no pagination), hero uses on-chain O(1) `GetSubjectSummaryJSON`; + false-precision integer `"X.0"` rounding.
3. **Unaccountable moderation** — `HideReview` silently lowers the public average (`applySubjectStat(-1,-rating)`) with **no reason code, category, appeal, or audit trail**; `GetFlaggedJSON` (built "for the mod dashboard") has **zero frontend consumers** → flags go to a black hole.
4. **Open non-consensual subject namespace** — review *any* bare address/realm, no opt-in, no owner notification, no right-to-reply; permanent + unerasable.
5. **Misleading "✓ verified" checkmark** (`ReviewCard.tsx:277`) — only means "author has an on-chain username," reads as verified-buyer.
6. **App Store reviews have no gating primitive at all** — no install/interaction analog to HasPurchased → pure vanity/sybil metric.
7. **CI gaps** — the appstore realm's strong negative tests (non-moderator rejected, author-guard) **run in no CI leg** (dead coverage); no reviews realm in the mainnet-parity gate.
8. **Perf** — `fetchSummaries` is an N+1 across cards (no realm-side batch getter, deferred).

### R.D — Plan (Reviews → complete, functional, mainnet-ready)

> Inherits the pilot's global constraints verbatim (D.0–D.2): cross-repo repo-map (realms in `samcrew-deployer`, FE/BE in `Memba`; realm PR merged→deployed→verified live → *then* the Memba flag PR), the per-task cadence (TDD → self-verify → changelog/docs/MAINNET_READINESS row → adversarial phase-boundary review), and the **one coordinated immutable realm cut** discipline. Owner-gated tasks tagged **⟨OWNER⟩**.

**Phase R0 — Stop-the-bleed / keep-dark (S, no realm work)**
- **[R0.1]** Add `VITE_ENABLE_REVIEWS` + `VITE_ENABLE_APP_REVIEWS` to `SAFETY_GATED_FLAGS` (`safeFlags.ts`) so a prod build **fails closed** if either is flipped true before the trust gate exists. *TDD via `safeFlags.test.ts`.*
- **[R0.2]** Wire the already-defined `isReviewsValid()` + add `isAppReviewsValid()` into **every** reviews surface (Profile, ValidatorProfile, Validators, AppStore) mirroring `lib/marketplace/router.ts:80`; keep gnoland1 allowlist entry absent until a mainnet realm exists (so it fail-closes, not fail-opens).
- **[R0.3]** Remove the misleading "✓ verified" checkmark (or relabel to "has username") until reviews are actually gated — a fabricated trust cue. Grep-guard: build fails if the verified-badge renders on an ungated path.

**Phase R1 — Canonical-realm decision + API-surface freeze ⟨OWNER⟩**
- **[R1.1] ⟨OWNER⟩ Choose ONE canonical architecture:** `core_v1` engine + **one thin gated wrapper** (`memba_marketplace_reviews`, the Phase-4.1 consumer), retire the `v1`/`v2` monoliths from the mainnet deploy set. Recommendation: **promote `core_v1` as the engine, build the gated wrapper on top, delete v1/v2 monoliths** — v2's DoS-hardening (RV counters, flaggedIDs GC) must be confirmed present in `core_v1` first.
- **[R1.2] Immutable API-surface freeze** (pilot blocker #1 applied here): enumerate every realm entrypoint the whole feature will call — gated `PostReview`, `SaleSeedSealed()` getter on the market, batch summary getter, `SetModerator`/pause, subject-owner right-to-reply — and land them **all in the single cut**. Anything omitted = permanent gap.
- **[R1.3]** Fold reviews realms into the **program avl remediation** (canonical path only) + add the reviews row to MAINNET_READINESS + extend the mainnet-parity CI leg (§Staff-review: reuse `p0-fund-guard-gate`, compile the **test** closure too, mind the `uassert`-at-head prerequisite).

**Phase R2 — The trust gate (the feature's premise) ⟨OWNER-deploy⟩**
- **[R2.1]** Build `memba_marketplace_reviews`: `PostReview` **panics unless `HasPurchased(caller, subjectSeller)`** (primitive at `sales_index.gno:68`) **and `caller != subject`**; for non-commerce subjects (validators/apps) require the analogous verified-interaction proof (valoper self-attest / app-install analog — **P0 gap for App Store reviews**, R2.1b).
- **[R2.2]** Hard-depend on **[RV-P0-4]**: add `SaleSeedSealed()` getter to the market (must be in the market's immutable cut — coordinate with the marketplace pilot's Phase-1/2 freeze), and make the Phase-R2 review gate assert `saleSeedSealed==true` before reputation is trusted.
- **[R2.3]** Positive-control tests (Staff-review rule): realm test that `PostReview` **panics without HasPurchased** and **panics on self-review**; a build/e2e that the write-form shows an "Only buyers can review" gated empty state.
- **[R2.4] Frontend gate:** `HasPurchased` read + gated write-form state in `ReviewsSection.tsx` (today the form is always visible for any connected wallet).

**Phase R3 — Moderation done right ⟨OWNER⟩**
- **[R3.1] ⟨OWNER⟩** Replace the hardcoded `g1x7k4628` `ModeratorAddress` with a **dedicated least-privilege moderator multisig distinct from the fee/drain key**; verify the **actual on-chain k-of-n** (don't trust the comment); fix the false "multisig" comment; add a 2-step `SetModerator` + global `Paused` flag on write entrypoints. *Same fix-class as marketplace §2.5 (#8).*
- **[R3.2]** Make Hide **accountable**: require a reason-code + content-category arg, emit it, add an on-chain appeal/relist path, and consider governance review for takedowns that move a subject's aggregate score.
- **[R3.3]** Wire the moderator queue: consume `GetFlaggedJSON` in a moderator dashboard so flags are actioned, not black-holed. (Coordinate with the concurrent Feed-moderation lane's console patterns.)
- **[R3.4]** Consent/defamation: block bare-address subjects or require subject opt-in + right-to-reply; PII/illegal-content policy for immutable on-chain reviews.

**Phase R4 — Product completeness + correctness (parallelizable FE/BE)**
- **[R4.1]** Drive the section-header average from on-chain `GetSubjectSummaryJSON` (match the hero) + add pagination/"Load more"; fix the false-precision integer average (derive float from `sum`/`count`).
- **[R4.2]** Reviews product depth vs AAA bar: seller response, helpful votes, sort/filter, verified-purchase badge (now truthful post-R2), edit history, report. 
- **[R4.3]** Batch summary getter on the canonical realm (kill the `fetchSummaries` N+1) — must be in the R1.2 freeze.
- **[R4.4]** CI: add the appstore realm's negative tests to a live CI leg; add reviews to the mainnet-parity gate.

**Phase R5 — Migration + mainnet ceremony ⟨OWNER⟩**
- **[R5.1] ⟨OWNER⟩** v1→canonical repoint ceremony: v2/canonical starts empty (history doesn't carry over) — decide whether to migrate or start fresh; repoint `config.ts`, allowlist, `realm-versions.json`; retire the `mergeReviewsByAuthor` bridge.
- **[R5.2] ⟨OWNER⟩** Mainnet deploy ceremony (dependency-ordered, per pilot §E3 #17 runbook): reviews realm depends on the **market realm's HasPurchased + SaleSeedSealed being live first** → explicit cross-feature ordering.

**Reviews go-live gate:** avl fixed + canonical realm chosen + `PostReview` purchase-gated & self-review-guarded + SeedSale sealed + moderator key correct & least-privilege + flags safety-gated → *then* flip `VITE_ENABLE_REVIEWS`.


---

## Part E — CTO review of the Wave-1 plans (AAA SWE standards)

**10 independent senior reviews** — CTO, Staff-Engineer, and Security/CSO **per feature** (9) plus a **cross-feature coherence** pass (1). Every reviewer **spot-verified load-bearing claims against real source**: **~100 code claims checked, essentially all HELD** (the notable refutation was in the *plan*, not the audit — see E.2). **All 10 verdicts: APPROVE_WITH_CHANGES.** Totals: **2 blocker, 33 major, 20 minor** revisions.

### E.1 — Verdicts & AAA scorecards
| Feature | CTO | Staff | Security | (median scorecard: grounding / sequencing / testability) |
|---|---|---|---|---|
| DAO / Governance | AWC | AWC | AWC | grounding **5** · sequencing **3** · testability **3–4** |
| Token & OTC Trading | AWC | AWC | AWC | grounding **5** · sequencing **3** · testability **3** |
| Reviews & Reputation | AWC | AWC | AWC | grounding **5** · sequencing **3** · testability **4** |
| **Cross-feature coherence** | — | — | — | APPROVE_WITH_CHANGES · grounding **5** · sequencing **3** |

**Grounding scored 5 across the board** — the audits are exceptionally well-evidenced. **Sequencing scored 3 everywhere** — the plans' *ordering* was the consistent weak point, which E.2/E.3 fix.

### E.2 — The headline correction (my own framing was wrong)
I claimed **"DAO sequenced FIRST because the executor is a hard predecessor for every feature's mainnet handoff."** All three DAO lenses + the coherence pass **refuted this against code:**
- `memba_market_config` admin/treasury is **already the real 2-of-2 multisig `g10kw7e55`** (treasury=multisig at init, `config.gno:26`).
- Admin/ownership handoffs are **2-step** (`Transfer*/Accept*`) → transferring to the executor-less DAO just sits **pending, recoverable — no loss.**
- **Only** the **1-step `SetFeeRecipient`/`SetTreasury`** setters are irreversible.

**Therefore:** multisig custody is a **valid mainnet terminal state**, and the **XL executor + gnodaokit fork are a post-launch decentralization track, not a launch blocker.** Sequencing them ahead of the **highest-fund-risk feature (Trading)** mis-prioritized scarce eng time. **The genuine hard predecessors are cheap** (the G0.3 comment/guard fix + the X4 key repoints). **The actually-critical program gate is the pilot marketplace immutable cut** (E.3 #1). *This is exactly the kind of error the review exists to catch — and it did.*

### E.3 — Program-level revisions (amend Part A/B; authoritative)
1. **[major] The pilot marketplace cut is the real critical gate — and its freeze omits `SaleSeedSealed()`.** The pilot's immutable `memba_nft_market_v3_2` is the shared chokepoint for Reviews' trust gate (needs `HasPurchased` ✓ **and** `SaleSeedSealed()` — verified absent). The pilot is "delivered, PENDING owner review," so **its cut could freeze before Reviews' need is folded in → permanent strand.** → **Elevate to a program BLOCKING gate:** the pilot `[1.0]` freeze must not execute until it enumerates **every** Wave-1 feature's market-side read (add `SaleSeedSealed()` now; re-confirm `HasPurchased`/`PurchaseCount`/`GetProceeds`). Add a "downstream API needs" sign-off owned by a program architect. **Also require the market admin be repointed to multisig BEFORE `FinalizeSaleSeed`**, so the seeded `HasPurchased` set isn't fabricable by the single `g1x7k4628` key.
2. **[major] X4/X5 are NOT single dedup-able PRs.** Split **X4a** (shared comment-correction + on-chain key-type verification — one PR) from **X4b** (per-realm key *repoints* — each rides its realm's own immutable cut + owner-gate). **X5** = 3 separate per-feature demo-tell PRs. Only **X1/X2/X3** are genuine single shared PRs. *(Applied to the Part B table.)*
3. **[major] There is no single "immutable cut" — there are 4+.** Pilot NFT stack / DAO + a **forked gnodaokit** (quarantined `pr-64`) / Trading's canonical realms / Reviews' canonical path. Shared only: the vendored **`p/samcrew/avl`** package, one MAINNET_READINESS avl section, one CI job. **`memba_market_config` is cut once by the pilot** — Trading merely consumes it (don't double-count/re-cut). Make **vendor-vs-migrate a single program-level owner decision**, not restated per feature.
4. **[major] The `GNO_REF` repoint is one atomic program-wide flag-day.** `p0-fund-guard-gate` runs one shared `GNO_REF` (`f3d5a5d13`, pre-avl) over **all** gated realms (candidature_v3, agent_registry_v2, escrow_v3, reviews_v2/core_v1, appstore_v3, feed_v2 + 8 uassert suites). Repointing it **breaks the gate for everyone at once** unless every realm is avl-migrated first. → Add a **non-gating "compile at gno head" leg** for incremental per-feature verification; **one named owner** flips the ref last; **re-vet the `uassert` overlay** at the new ref. **Name a program-level owner** of the shared artifacts (avl package, `safeFlags.ts`, `isRealmValidOn`, the CI job).
5. **[major] G0.3 handoff-comment scope undercounted 2–3×.** Not "~6 across 4 families" — **15+ sites across 9 deployed realms** (appstore v1/v2/v3, arcade_leaderboard_v1, collections, market_config, nft_market_v3_2, points_v1, points_migration_v1), **6 of them in features NOT in Wave 1** (Points is LIVE in prod) → coordinate with those owners / the live concurrent session. Make a **repo-wide grep-guard the source of truth**; prioritize the **1-step `SetFeeRecipient` loss vector**, not the benign 2-step admin path; the "ceremony guard" must be a **deploy-script/runbook precheck** (can't live in already-deployed immutable realms).

### E.4 — Per-feature required revisions & disposition (all Accepted)
**DAO** — *(B=blocker, M=major, m=minor)*
- **[M] Split scope per E.2** (launch-critical slice vs post-launch executor track). *Applied to D.D intro.*
- **[M] Add a `VITE_ENABLE_DAO` kill-switch** + add to `SAFETY_GATED_FLAGS` + gate `/dao`+`/candidature` on `isRealmValid` — **the DAO is the only feature that reaches mainnet ungated**, and `/candidature` is a **live deposit money-path**. → **new G0 task.**
- **[M] G0.2 as written strands the 2 legacy `candidature_v2` deposits** (dropping v2 from the test13 allowlist removes their only Withdraw path). → keep v2 **test13-allowlisted Withdraw-only** (verify `IsPaused()`) until deposits drain; only exclude it from the **mainnet deploy set**.
- **[M] G1.2 executor must NOT register a raw `ExecuteLambda`** (the primitive exists in gnodaokit) — only **allowlisted typed actions** (per-target `AcceptOwnership`, bounded banker send with recipient allowlist + amount cap).
- **[M] `ChangeDAOImplementation` is a latent 1-of-1 drain backdoor** (arbitrary `MigrateFn`, no timelock), not just self-brick → near-unanimous threshold + timelock + guardian + pre-registered migration target; close **before** any value/admin reaches the DAO.
- **[M] memba_dao CI needs a forked-gnodaokit dep-closure leg** (not the self-contained pattern); add `memba_dao_v2` to the "every realm classified" list; the `GNO_REF` bump is program-atomic (E.3 #4).
- **[m]** Retarget the irreversibility guard onto **1-step `SetFeeRecipient`** (admin path is 2-step/safe); **seat multiple *distinct* DAO members** (one multisig member is still 1-of-1 at the governance layer) + add a `RemoveMember` last-member floor; reconcile `realm-versions.json` (still records v2, not the canonical v3); relabel `channels_v2` read-gating as **UI-convenience-only** (on-chain `Render` has no caller identity); gate the G1.4 freeze on a **green mainnet-gno compile** of the forked closure, not just enumeration.

**Trading**
- **[B] escrow_v3 pause is a CODE gap, not a test gap** — `assertNotPaused()` is **absent from the permissionless `ClaimRefund`/`ClaimDisputeTimeout` and admin `ResolveDispute`**, contradicting its own docstring, so the kill-switch **can't stop fund egress during an incident**. → the pause-policy decision + code fix must land **IN the immutable cut (T2)**; T4.4 only *verifies* it.
- **[B] The T1.2 freeze omits the getters its own T2.2 gate + T2.3 monitor need** — `escrow_v3`/`agent_registry_v2` expose no `AdminAddress()`/`FeeRecipient()`/`RealmAddress()`/`TotalLiabilities()`. On an irreversible cut, "a getter forgotten = permanent gap." → add them to the cut (or state the gate checks deploy-time source constants off-chain).
- **[M] escrow_v3 admin/fee are compile-time `const` with no setter** → the fee-spine + key fix ships as a **new `escrow_v4`** (not an in-place patch) with a **2-step `TransferAdmin/AcceptAdmin`**; target the **multisig, never the DAO realm**.
- **[M] `tokenfactory_v2` (canonical fee-minting realm) has ZERO tests** + sits in the continue-on-error CI block → add a behavioral suite (T4.5) + move to the gating leg.
- **[M] Author the custody test suites FIRST** (against the pinned ref) as the pre-migration oracle, then re-run at gno head post-avl — "green at BOTH refs" **gates the avl cut** (don't migrate before the regression net exists).
- **[M] T2.3 on-chain solvency assert = a freeze-funds footgun** → expose `TotalLiabilities()`/`RealmAddress()` getters for **off-chain** reconciliation; never a hard panic gating a withdrawal.
- **[m]** `EngineAddress()` already exists → the **OTC approve-address fix (T3.1) is FE-only, move to T0** (unblocks List/Fill with no redeploy); promote the **Services build-or-descope** to a T1-era ⟨OWNER⟩ decision **before** the freeze; missed risks to fold in: OTC **phantom-liquidity/over-listing** (uncommitted-allowance double-listing), the **avl nil-vs-zero trap on int64 getters** (`faucetCooldowns` height 0, `GetCredits/Usage/Earnings`), the **backend never calls `UseCredit`** (deposit-once = free unlimited PRO — bind credited addr to the authed caller + meter), and `escrow_v3`'s fee-fix adds a `market_config` import → **init-ordering + avl-closure** dependency.

**Reviews**
- **[M] The trust gate covers nothing that ships** — `HasPurchased` gates marketplace-seller reviews, but the 3 wired surfaces are **validator / profile / app** (no seller surface exists). → **scope Wave-1 reviews to marketplace-seller subjects only** (build that surface); keep validator/profile/app reviews **DARK** until per-class verified-interaction primitives exist. **Per-flag** go-live gate.
- **[M] App Store reviews have NO gating primitive at all** → `VITE_ENABLE_APP_REVIEWS` stays dark until an app-install analog is built into the app realm's cut; make R2.1b its own ⟨OWNER⟩ phase (note App Store is a **live** page — higher-consequence than a fully-dark one).
- **[M] The reputation/React path is separately sybil-farmable** (Σ likes−dislikes, cross-wallet; `React` blocks only same-address self-reaction) → gate React/reputation or **drop the rep chip from money-path surfaces**; the go-live gate must include it, not just `PostReview`.
- **[M] `SaleSeedSealed()` cross-dependency** → elevated to the pilot's freeze as a blocking item (E.3 #1); reviews R2 can't start until the market cut is verified live with **both** `HasPurchased` and `SaleSeedSealed()`.
- **[m]** Moderator key type is **genuinely contested** (repo self-contradicts single-key vs 2-of-2) → on-chain k-of-n verification is a **hard prerequisite** gating R3.1's fix shape (drop "solo-signable" as established); CI: reviews_v2/core are **already gated** (repoint, not add), `appstore_reviews_v1` needs a **dep-closure leg**, and the **uassert caveat does NOT apply** to reviews (they use `revive()`); fix the **Hide→repost→Unhide double-count** invariant in the canonical engine's cut; sync/remove the **frontend `ReviewCard.tsx:36` moderator hardcode**; decide **history migration** (promoting the empty `core_v1` zeroes displayed validator/profile reputation) **before** the cut; state the **immutable-unerasable-content** limitation for bare-address subjects.

### E.5 — Net result
The **spine of all three plans survived independent verification** (grounding 5/5; ~100 claims HELD). The revisions are **sequencing, scoping, and CI-mechanism corrections, not re-architectures** — and one is a genuine correction to *my* critical-path call (E.2). With E.2–E.4 applied, the corrected shape is:
- **Program-first:** land X1/X2/X3 (the true shared PRs) + the pilot-cut API-surface gate (with `SaleSeedSealed()`) + name a shared-artifact owner.
- **Trading is the highest-urgency feature** (real custody) — not gated behind the DAO.
- **DAO** does a small launch-critical slice now; its executor is a **parallel post-launch track**.
- **Reviews** ships **marketplace-seller-only**, everything else stays dark until its gate primitive exists.

**Residual OWNER decisions (gates, not mine):** canonical-engine choices (DAO basedao-vs-daoTemplate, one escrow/otc/reviews realm each); vendor-vs-migrate avl; the DAO executor's action-type allowlist + `ChangeDAOImplementation` threshold/timelock; Services build-vs-descope; agent-credit proof-of-service model; the multisig-before-seal ordering on the market; and every deploy/ceremony gate. **Wave 2 (Feed, Points, Auth)** remains queued behind the live Feed-moderation lane.

---
### Appendix — provenance
- Ecosystem scan: `gno` master `f99caf537`; all `/Gno` repos pulled 2026-07-16.
- Audits (background workflows): DAO `wljqw5o8o` (20/21 experts, 85 P0/P1), Trading `wz16vkibg` (22, 83), Reviews `wjvelckod` (21, 91) — **259 verified P0/P1, 2 refuted.**
- CTO review `whl2oj0r0` — 10 lenses, ~100 code claims spot-checked. Raw digests + journals under the session scratchpad.
