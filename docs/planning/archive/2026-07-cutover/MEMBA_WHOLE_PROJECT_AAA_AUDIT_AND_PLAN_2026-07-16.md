# Memba — Whole-Project Deep Audit → AAA Implementation Plan → CTO Review

**Date:** 2026-07-16 · **Owner:** zxxma · **Status:** DRAFT for owner review · **No code changed; no PR merged.**
**Method:** parallel 24-persona expert audit (9 clustered lenses, adversarially cross-checked) → synthesis → fresh independent CTO panel review (Part E).
**Roster (24 personas across 9 lenses):** CTO (synthesis) · CSO · Black-Hat Team · Sr Smart-Contract hacker · Gno Core Team · Sr Gno core eng · Sr GnoVM eng · Manfred Touron (Head of Eng, gno.land) · Jae Kwon (founder, gno.land) · Sr Fullstack eng · 2 Sr Blockchain-Validator experts · Sr DevRel · UX/UI expert · 2 Desktop users · 2 Mobile users · DeFi user · DAO user · DAO founder · 2 non-tech gno.land users · 2 Sr OSS contributors. Plus a Test/CI coverage lens.

> **How to read this.** **Part A** = ecosystem pull + breaking-change scan (done once, applies to everything). **Part B** = whole-project current-state ground truth. **Part C** = the synthesized, adversarially-verified 24-persona audit. **Part D** = the super-detailed, world-standard implementation plan (with review/cross-check/changelog/doc gates baked into every step). **Part E** = an independent CTO panel's red-team of Part D, folded back in. If you approve the *shape* and *sequencing* of Parts C–D, this becomes the governing program to "complete & functional → mainnet."

> **Relationship to existing docs.** This supersedes nothing already merged; it consolidates and program-orders the open threads in `MEMBA_ROADMAP_COMPOUND_2026-07.md` (Waves 8+), the `MARKETPLACE_PILOT_AUDIT_AND_PLAN_2026-07-15.md` (marketplace is one feature under this program), `MAINNET_PREPARATION.md`, and `GNO_CORE_BREAKING_CHANGES.md`. The single biggest structural recommendation (Part C / D-Track-4) is to **extend the existing `samcrew-deployer/projects/memba/MAINNET_READINESS.md` (212 lines)** — the CTO panel confirmed it already tracks NF-2 solvency, the owner deploy-ceremony checklist, the treasury-repoint parity assertion, the RPC-failover chain-id recheck, and auth hardening; it is simply **missing the avl gate** and the other new mainnet-cut gno gates. The anti-goal is a *second, competing* readiness doc.

---

## Part A — Ecosystem pull & breaking-change scan (all repos, done once)

**Pulled 2026-07-16.** All clean tracking repos under `/Gno` fast-forwarded. `gno` core advanced to HEAD **`9bfc0a4bb`** — past the last Memba breaking-change sweep (`aacc2be88`, Jul-11). Memba main @ `95a2e0c4`, 0 open PRs, clean, all CI green. Backend is a standalone Go service that talks to gno **only via RPC** (no gno Go-module imports), so upstream-gno churn can affect only (a) realm *source* (in `samcrew-deployer`) and (b) frontend gno-rpc/signing paths.

### Breaking-change register vs gno HEAD `9bfc0a4bb` (extends the Jul-11 sweep)

| # | Sev | Change (PR) | Verified impact on Memba | Verdict |
|---|-----|-------------|--------------------------|---------|
| **A1** | 🔴 **mainnet-cut blocker** | `p/nt/avl/v0.Get` simplified to a single `any` return (upstream `tree.gno:58`) | Memba realms call the **two-value** `v, ok := t.Get()` form at **~407 non-test sites across 37 realm dirs / 42 files**; `p/nt/avl/v0` is **unvendored** (deployer `deps/` has no avl). Compiles on **test13's pinned avl only**. `memba_collections` (immutable, holds every collection's grc721 ledger) and the forked `grc721` both import it. **3.7× bigger than the "~110" earlier estimate.** | **CONFIRMED — the master gate.** |
| **A2** | 🟢 **de-risked** | secp256k1 removed for validators (#5949) | **Validators-only** — touches valopers/valset/`ValidatorParams`, not tx-sig verify. Memba runs no validators; its secp256k1 Adena **user** auth is unaffected; validator-address rendering is algorithm-agnostic (`validators.ts`, `realmAddress.ts`). | **No action.** |
| **A3** | 🟢 **de-risked** | `NewBanker` IsCurrent fix + `realm.Sub(subpath)` (#5890) | Every Memba `NewBanker(RealmSend, cur)` passes `cur` (IsCurrent=true) → the security fix does **not** break them. Bonus: **`cur.Sub()` is the missing identity primitive for the unbuilt DAO-executor handoff** (see C/D-Track-3). | **No break; an opportunity.** |
| **A4** | 🟠 **new at-cut** | Deploy-gas metering at AddPackage/Run (#5892) | `PreprocessGasPerByte`=1250/source-byte, charged **up front** before execution. Large realms + the 2-of-2 deploy ceremony must budget gas-wanted or deploys revert; strip `_test.gno` from mempackage. | **CONFIRMED — budget it.** |
| **A5** | 🟠 **hardens A1** | Consensus-deterministic type-check (#5891 prod/test blob split, #5893 deterministic verdict) | The type-check verdict is now consensus state → A1 goes from "might not compile" to **"deterministically rejected at AddPackage across all validators."** | **CONFIRMED.** |
| **A6** | 🟡 re-validate | Type-check strictenings: embedded-type identity (#5739), blank `_` decls (#5920), cross-pkg method qualification (#5932) | No concrete Memba break found by grep, but exactly the class of latent surprise that only surfaces at a consensus AddPackage. | `[re-validate under pinned VM]` |
| **A7** | 🟠 **in-cut** | `chain.emit` attribute caps (#5857 `bad8ef660`, #5858 `036f7eb54`) | **LOCATED — both ancestors of HEAD** (the Jul-11 sweep used too high a lower bound). `MaxEventAttrLen` 1024→**4096 B**; event type + each attr key + each attr value are each capped, and **exceeding now PANICS the tx** (was silent truncation). Memba emits heavily → any `std.Emit` with user-controlled content >4096 B (feed bodies, long descriptions) **panics on mainnet**. | Cap user-controlled emitted strings at the realm boundary; targeted grep of emit values under the pinned VM. |
| **A8** | 🟠 | grc20reg max slug length (#5911) | `$MEMBA` / tokenfactory registration must comply — verify in the tokens cut. | Verify at cut. |

**Program-wide implication:** A1 is a hard gate for **every stateful realm**, not just the marketplace. The whole mainnet cut is paced by the **immutable `memba_collections`** ledger realm.

---

## Part B — Whole-project current-state ground truth

**What Memba is today:** a standalone Gno multisig & DAO wallet that has grown into a social/commerce super-app on gno.land — React 19/Vite SPA on Netlify (auto-deploys prod on merge), Go/ConnectRPC backend on Fly (auto-deploys prod on merge), SQLite + off-volume Litestream, an on-chain indexer, 40 realms on **test13** (prod default) via 2-of-2 multisig `samcrew-core-test1`.

**Feature status matrix (verified this audit):**

| Surface | Live state | Realm(s) | Notes |
|---------|-----------|----------|-------|
| **Feed v2** | **LIVE prod** (`VITE_ENABLE_FEED`) | `memba_feed_v1` (deployed) / `_v2` (source; ceremony pending) | Distribution shipped for Jul-20. **A parallel session is active on moderation RPCs** (`api/**`, `feed_moderation_rpc.go`) — off-limits to writes. |
| **BARRICADE arcade** | **LIVE prod** (`/game/barricade`) | `memba_arcade_leaderboard_v1` | On-chain certify live; attester keyed. |
| **Reputation / Points** | Built, **hard-off** (`POINTS_FEATURE_DEFERRED=true`, flipped back today #959) | `memba_points_v1` (live, 1 holder, inert) | Forward-only; **no redeem/spend/sink** (DD-9). |
| **NFT / Marketplace** | Live on test13; **trading gated off** (`VITE_ENABLE_NFT=false`) | `memba_nft_market_v3_2` (active), `_v3_1`/`_v2`/`nft_market` (prior), `memba_collections`, `memba_market_core_v2`, `memba_market_config` | Deployed engines are fund-safe; **the offers *family* is the dirty corner** (C-P0-2). |
| **App Store** | Live (`VITE_ENABLE_APPSTORE*`) | `memba_appstore_v3` + reviews | Self-service submit behind flag. |
| **DAO** | Live governance (member/role/profile) | `memba_dao`, `memba_dao_candidature_v3`, `memba_dao_channels_v2` | **Cannot execute economic actions** (C-P0-4). |
| **Token / OTC** | Live | `tokenfactory_v2`, `memba_token_otc_v2` | **$MEMBA has no on-chain supply cap** (DD-8). |
| **Reviews, Agents, Quests, Validators, Blog** | Live / partial / gated | various | Validators feature confirmed sound (VAL-2/3/4). |

**The "complete & functional" horizon = the mainnet (gnoland1/betanet) cut**, entirely owner-gated. gnoland1 is live but transfer-locked and predates interrealm-v2 Phase 3 (no Memba realm can deploy there yet). The Compound program parks money-paths behind Wave 8 (hard-gated on U-1 restore drill + U-3 multisig-enforce flip).

**Immediate calendar pressure:** the **Jul-20 ICO traffic wave (~4 days out)**. The external sale is `sale.gno.land`; Memba ships an announcement popup (confirmed clean). The wave brings **newcomer + mobile volume** to a prod app whose first-impression surfaces have gaps (C-P0-6) and whose backend has an availability bug the wave itself can trip (C-P0-5).

---

## Part C — Synthesized 24-persona audit (adversarially verified)

**Method.** 9 role-clustered lenses read the real realm / frontend / backend code and filed evidence-cited findings; each lens cross-checked the others' established findings (default-to-skeptical), and several briefing assumptions were **refuted** with code (a healthy signal the audit isn't just confirming its own priors). Convergent findings (flagged by ≥2 independent lenses) are the highest-confidence.

### C.0 — Verdict (one paragraph)

Memba is **serious, disciplined Gno engineering wrapped around a centralized product spine**, and it is **production-sound for fund safety on its live surfaces today** — the deployed money engines (escrow_v3, otc_v2, candidature_v3, appstore_v3, the real NFT offers engine, SeedSale) are genuinely hard targets that a red-team bounced off of, the auth layer is mature and fail-closed, and the backend's recovery architecture is better than its reputation. **But it is not "complete & functional," and it cannot reach mainnet as-is.** One ecosystem break (`avl.Get` 2→1) will be **deterministically rejected at AddPackage** on any post-#5314 mainnet, and it hides inside the *immutable* collections ledger; several **live surfaces present fabricated or un-governable data as chain truth** (an always-mock offer panel wired to an undeployed, non-compiling stub, a "10M supply" that exists only in a config file, a "DAO-owned fee spine" the DAO literally cannot reach); the **DAO-executor handoff the realms advertise is not merely unbuilt but currently *unfinishable***; the **admin-custody model is one contested key** whose type the codebase contradicts itself about; and the surfaces a **newcomer/mobile** user hits first (the forced activation modal, the 6 shared money-path modals) are visibly broken on a phone — four days before a public spotlight. None of these is a live fund-loss today; several are trust, availability, and mainnet-compile risks that compound under the Jul-20 wave and block the cut.

### C.1 — Convergent findings (flagged by ≥2 independent lenses = highest confidence)

| Rank | Finding | Lenses | Sev |
|------|---------|--------|-----|
| 1 | **`avl.Get` 2→1 mainnet compile/type-check block** — ~407 sites, 37 realms, unvendored, immutable `memba_collections`; deterministically rejected post-#5893. Tracked only in a feature doc. | GnoVM, Gno-lead(L1), Test/CI, (marketplace pilot) | **P0** |
| 2 | **Fabricated on-chain data + dishonest/broken offer surface** — `FloorOffersList` calls `mockFetchFloorOffers()` *unconditionally* (no flag) and wires live "Accept"/"Make Offer" CTAs to `memba_nft_offers_v1`. That realm's `AcceptFloorOffer` *would* burn the buyer's escrow, **but the realm is undeployed AND uncompilable under the current interrealm-v2 stdlib** (removed `std.GetBanker`/`GetOrigPkgAddr`/`GetOrigCaller` + `p/demo/avl`) — so flipping `VITE_ENABLE_NFT` today ships **fabricated bidders + a broken CTA against a nonexistent realm**, a live *trust* violation, **not a live drain**. Fund-loss is *latent* (only if the stub is ever ported-and-redeployed). `VITE_ENABLE_NFT` was removed from the build safety gate → one Netlify toggle exposes the dishonest surface. | Black-hat(OFF-1), DeFi/DAO(DD-5), CSO(CSO-5), Gno-lead(L2), Fullstack(FI-4), adversarial-CTO | **P0 (trust)** |
| 3 | **Custody = one contested key, type unresolved** — `g1x7k4628…` is sole admin of memba_collections/all NFT markets/escrow_v3/appstore *and* the sole MembaDAO member; the repo calls it both a "2-of-2 multisig" and a "single-key governance gap"; it name-collides with the *actual* fee-spine multisig `g10kw7e55…`. | CSO(CSO-1/2/6), DeFi/DAO(DD-3), Gno-lead(L5) | **P0** |
| 4 | **DAO executor unbuilt (blocked today, finishable via governance)** — 0 action handlers registered across all 43 realms; the 2-step `AcceptAdmin` handoff needs `PreviousRealm()==memba_dao`, and no handler calls out → the ~10 advertised handoffs cannot complete **today**. *(CTO-panel nuance: the fix is missing app code, not a missing VM primitive — daokit already threads a live `rlm realm` and profile handlers already cross-call in prod; the DAO can even self-upgrade via `ChangeDAOImplementation` to add the handler. See T3.2.)* | DeFi/DAO(DD-1/2), Gno-lead(L4) | **P0** |
| 5 | **Unauthenticated NFT media-cache OOM on a 512 MB single-machine VM** — LRU bounded by entry-count (256) not bytes (~7.7 GB worst case); shares the box with RPC serving + both indexers → an OOM (or the ICO wave itself) is a **total outage**. | CSO(CSO-3), Fullstack(FI-3) | **P0** |
| 6 | **Newcomer/mobile first-impression broken** — the forced activation modal (`ActivationModal.css`) uses **undefined CSS vars → transparent card** for every faucet-funded newcomer; the shared `.trade-modal` shell (6 money-path modals) has **no `@media`/`max-height`** → Confirm CTA below the fold on a phone. Both fixes already exist elsewhere in the tree. | UX/Users(UX-1/2), (DevRel, non-tech) | **P0 (pre-Jul-20)** |
| 7 | **`VITE_ENABLE_NFT` removed from `SAFETY_GATED_FLAGS`** conflates the earned/safe trading engine with the fabricated/fund-losing offers surface under one flag with zero build-time protection. | Black-hat, Fullstack(FI-4), CSO | **P1 (amplifier of #2)** |

### C.2 — Distinct P0 root issues (deduped)

- **P0-1 avl mainnet-compat (A1/rank 1)** — *the* pacing gate; immutable ledger.
- **P0-2 fabricated-data + dishonest/broken offer family (rank 2 + #7)** — a live *trust* violation a flag flip away; the fund-loss is *latent* (target realm undeployed + non-compiling), realized only if ported-and-redeployed.
- **P0-3 custody/governance-root contradiction (rank 3 + rank 4)** — one key, unverified type; the DAO that supposedly governs it is a 1-member rubber stamp that *can't reach* what it governs.
- **P0-4 media-cache OOM (rank 5)** — the one live availability risk the Jul-20 wave itself trips.
- **P0-5 newcomer/mobile broken front door (rank 6)** — conversion/trust risk at the spotlight.
- **P0-6 backend RPC failover hardcodes test13, no chain-id recheck (FI-1)** — mainnet would silently serve test13 state as truth.
- **P0-7 $MEMBA has no on-chain supply cap (DD-8)** — "10M" is a frontend constant; disclosure/cap needed before a $20/token sale.

### C.3 — P1 clusters (→ workstreams in Part D)

- **Mainnet-cut gno gates:** pin a target VM commit (L6); enumerate genesis deps (`r/demo/profile`, `p/samcrew/*`, `p/nt/*`) and confirm each on the target (L7); budget deploy-gas #5892 (A4); locate + verify emit-caps #5857/#5858 (A7); standardize `cur.IsCurrent()` gating (L10); quarantine v1 holdouts (`memba_nft_offers_v1` fully pre-cur GV-5, plus `escrow`/`nft_market`/`candidature` v1 dirs GV-6).
- **Fund-safety / custody:** NF-2 solvency getters (`TotalLiabilities`/`RealmAddress`) missing on escrow_v3/candidature_v3/agent_registry_v2 (CSO-4); treasury/feeRecipient repoint to fee-spine multisig (CSO-6); immutable single-key admin on v3_1/v2 (keep test13-only, CSO-7); `p0-fund-guard-gate` structural gaps — per-file guard-test existence check + auto-enroll new custody realms (CSO-8); `UseCredit` trust-me deduction bound/voucher (OFF-3); `ListNFT` ownership+approval check (OFF-2).
- **Economics / trust integrity:** three disconnected fee dials → pick one canonical path (DD-4); $MEMBA supply cap/disclosure (DD-8); Points has no redeem/spend/sink — scope it or stop calling it an economic primitive (DD-9); wire the already-built `GetSalesByBuyer` into a PnL/portfolio view (DD-6); `VerifiedBadge` "published criteria" copy has no backing doc (UX-11).
- **Decentralization honesty:** single indexer no-failover — ship a "run-your-own indexer" path + client fallback to direct ABCI (L3); fix the DAO sole-member address (DD-3); `CreateDAO` "Treasury" preset generates zero custody code (DD-7); disclose the off-chain feed blocklist + keep the on-chain feed independently queryable (L8); publish a candid **Trust & Centralization** page (L5).
- **Frontend / UX / a11y:** consolidate to one token family (`--color-k-*`) + lint-enforce (779 hex across 59 files, 3 live families — FI-7/UX-6); a11y gate can't see modals, excludes mobile, disables `color-contrast` — add a modal-open pass + a ratcheted contrast check (UX-3); split `VITE_ENABLE_NFT` into trade vs offers flags (FI-4); replace `alert()` wallet-gates with `ErrorToast` (UX-7).
- **Infra / observability:** set `METRICS_BEARER` now — `/metrics` is 503 in prod and nothing is scraped (FI-2); wire backend Sentry (transitive-only today, OPS_RUNBOOK points on-call at an empty dashboard — FI-2); parameterize RPC fallback per chain-id (FI-1/FI-5); run the Litestream restore drill (U-1, architecture sound, drill unrun — FI-6); flip `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` at `mismatch=0` (U-3, CSO-9); set `QUEST_ADMIN_ADDRESSES` (CSO-12).
- **Test/CI:** raise the backend coverage floor (20% hard/50% soft is thin for money paths); cover `multisig_rpc.go::CreateOrJoinMultisig` (untested anywhere), `tx_rpc.go`, `github_oauth.go`; add `contracts/memba_nft_offers_v1` test *only if* it survives the delete; put the changelog + split E2E jobs into branch-protection required checks.
- **Docs / DevRel:** **extend** the existing **`MAINNET_READINESS.md` SSOT** with the missing gno gates (L11 — the file exists, 212 lines; do not create a second); mark `UX_UNTRANSACTED_WALLET_ONBOARDING.md` shipped + sweep `docs/planning/*` for the same drift (UX-4); refresh the stale `ROADMAP.md` status/counts, auto-generate from CI (UX-5); add a plain-language README hook above the jargon wall (UX-8); backfill Feed/arcade/Points blog posts before Jul-20 (UX-9); archive the workspace-root `NEXT_SESSION_PROMPT_*`/`SESSION_PLAN_*` debris.

### C.4 — What MUST NOT ship / must be corrected before anything else (trust-critical)

1. **Delete `Memba/contracts/memba_nft_offers_v1/`** (fund-burning stub) and remove/disable the floor-offer CTA (OFF-1/DD-5).
2. **Restore `VITE_ENABLE_NFT` to `SAFETY_GATED_FLAGS`** (or split it) so no single toggle exposes the fabricated/fund-losing surface (FI-4).
3. **Correct the false `collection.gno:39-40` "2-of-2 multisig" comment** and the MembaDAO sole-member address to reflect on-chain reality (CSO-1/DD-3).
4. **Stop presenting fabricated data as chain truth** — the `FloorOffersList` mock, the "10M supply" constant, the "published criteria" badge copy, the "Treasury" DAO preset, and any "DAO-governed" label the DAO can't reach.

### C.5 — What is SOUND (verified; do NOT re-litigate — this is the quality floor to preserve)

- **Auth:** ADR-036 chain-id rebinding closed (MEMBA-2026-001); unsigned-auth fail-closed by default; session-subaccount rejection; token integrity (#951); ED25519_SEED boot-blocks; no client-side secret exposure; `/metrics` + feed-moderation fail **closed** in prod; media/SSRF well-defended (DNS-rebind TOCTOU, per-hop redirect revalidation); CORS tight.
- **Deployed money engines:** escrow_v3, otc_v2, candidature_v3, appstore_v3, the *real* `memba_nft_market_v3_2` offers engine, SeedSale (seal-latch) — all `IsUserCall`-guarded, CEI/state-before-send, overflow-guarded, anti-squat-capped, with permissionless stranded-fund valves. The F1 fund-drain class is closed + CI-gated.
- **Backend resilience:** DB pool 1→4 + WAL + busy_timeout; Litestream **off-volume** S3 + boot integrity-check/auto-restore (same-volume risk retired); indexer cursors DB-persisted + single-block reorg-safe; #955/#956 unbounded-read fixes real; no non-context DB calls.
- **Frontend:** nav/route manifest is a true SSOT; chunk-load recovery (cross-browser incl. WebKit); valoper pagination reads all pages; dual-RPC strategy deliberate and correct; honest empty states (not fabricated).
- **Gno discipline:** versioned-realm migration ceremony (`realm-versions.json`, sealed seeds, two-step ownership, market wind-downs) is **best-in-ecosystem**; interrealm-v2 template compile-gate in CI. #5949 and #5890 confirmed non-breaking.

---

## Part D — Super-detailed AAA implementation plan (→ complete, functional, mainnet-ready)

### D.0 — Global constraints (every task inherits these, verbatim)

- **Never commit on `main`/`master`.** Branch (`feat/…`,`fix/…`,`chore/…`,`docs/…`) → PR. `cd` into the correct checkout before `git commit` (the enforce-git-rules hook checks the Bash cwd's branch). **Zero Claude attribution** in commits/PRs/tags (one concise "why" line, no trailers).
- **TDD every PR:** failing test → run-red → minimal impl → run-green → commit. Frontend: `node ./node_modules/.bin/vitest run <file>` one at a time; `npm run build` (**`tsc --noEmit` is a no-op**); lint gate `eslint . --max-warnings=55` (verify `npm run lint; echo $?`, changed files → 0 warnings). Realms: `gno test .` with sibling `*_guard_test.gno` import set (`testing`+`chain`+`testutils/v0` — **never uassert**, it breaks the pinned-v2 p0 gate). Backend: `go build ./... && go test ./...`.
- **Flag-gated, dark-shippable, one focused PR each.** User-visible change → `CHANGELOG.md` entry under `[Unreleased]` (keep the `### Title (date)` parse contract); test/docs/refactor → `no-changelog` label.
- **Parallel-session safety is Step 0** of every session: `git fetch` + git-movement HOT-check (SESSION_SYNC is advisory); register a lane before touching a single-writer file (`api/**`, `CHANGELOG.md`, `.env.example`, CI yaml, shared hooks); **the Feed v2 moderation lane (`api/**` proto, `feed_moderation_rpc.go`) is currently held by a parallel session — treat as off-limits.**
- **No realm redeploys, flag flips, migrations, secrets, or mainnet actions autonomously** — those are the owner-gated §D.6 checklist. Realm *source* edits are fine; putting them on-chain is a ceremony.
- **Prod deploys are owner-gated:** merging `frontend/**` → Netlify auto-deploys; `backend/**` → Fly auto-deploys. The auto-mode guard **blocks a deploy-triggering merge from a generic instruction** — each needs an explicit per-PR go (AskUserQuestion), verified on prod after.

### D.1 — The per-step cadence (the "frequent reviews + changelog + docs" ritual)

Every task step runs: **(1)** re-read the cited file (line numbers drift — locate by pattern), **(2)** write the failing test, **(3)** minimal impl, **(4)** run-green + lint + build, **(5)** self-review with a CTO-lens diff read, **(6)** changelog/docs entry, **(7)** one focused PR, **(8)** independent review before merge, **(9)** the merge gate (D.7). Money-path and realm changes carry an **owner-eyes-before-merge** exception even when green.

### D.2 — Branch / rollout strategy

Frontend/config/docs tracks land as normal flag-gated PRs. Realm-source tracks land **source-only** in `samcrew-deployer` (reaching chain is an owner ceremony via a **new versioned realm path** — a live path can't be redeployed in place). The mainnet cut is a single, rehearsed, multisig ceremony gated on the `MAINNET_READINESS.md` SSOT going all-green.

### D.3 — Tracks & phases

The plan is **7 tracks**. Track 0 is calendar-urgent (pre-Jul-20, live-prod-safe, no realm deploys). Tracks 1–4 are the mainnet-cut critical path. Tracks 5–6 are completeness/decentralization. Dependencies in D.4.

---

#### **Track 0 — Jul-20 pre-wave hardening** *(this week · frontend/config/docs only · NO realm deploy · highest urgency)*

Everything here is a live-prod risk or first-impression risk the traffic wave stresses, and each is a small, flag/CSS/config-scoped change.

- **T0.1 — Byte-budget the NFT media caches (CSO-3/FI-3).** Convert the two LRUs in `backend/internal/service/ipfs_serve.go` from entry-count-bounded (256) to **byte-bounded** with a combined ceiling sized for the 512 MB VM (e.g. 128–192 MB). Test: fill with N large distinct CIDs, assert total bytes never exceed the ceiling and eviction is byte-accounted. *(Backend → Fly deploy = owner-gated merge.)* **[S]**
- **T0.2 — Set `METRICS_BEARER` + confirm a scrape target (FI-2).** Owner config action (zero code) so `memba_indexer_lag_blocks`/panic counters/DB stats are visible during the wave. Pair: decide backend-Sentry (wire it, or correct OPS_RUNBOOK to stop pointing on-call at an empty dashboard). **[S, owner]**
- **T0.3 — Neutralize the fabricated-offer family (OFF-1/DD-5/CSO-5).** Delete `Memba/contracts/memba_nft_offers_v1/`; delete-or-hard-gate `FloorOffersList.tsx` (calls `mockFetchFloorOffers()` unconditionally), its Accept wiring in `CollectionPublic.tsx`, **and `MakeFloorOfferModal.tsx` / the "Make Collection Offer" button (`CollectionPublic.tsx:178`)** — the adversarial reviewer confirmed *both* the Make and Accept CTAs target the nonexistent realm. Framing: this is a **trust/UX fix (fabricated bidders + dead CTAs)**, not an active-drain fix — the target realm can't compile (verified), so no funds move today. Test: the collection page renders an **honest empty state**, no fake bidders, no offer CTA. **[S]**
- **T0.4 — Re-gate `VITE_ENABLE_NFT` / split the flag (FI-4).** Restore `VITE_ENABLE_NFT` to `SAFETY_GATED_FLAGS` in `frontend/src/lib/safeFlags.ts`, **or** split into `VITE_ENABLE_NFT_TRADE` (ungated, earned) + `VITE_ENABLE_NFT_OFFERS` (gated). Test: `assertSafeFlags()` fails the build if the offers surface is force-enabled. **[S/M]**
- **T0.5 — Fix the mobile money-path modal shell (UX-1).** Port the existing `tx-confirmation.css` `max-height: calc(100dvh - 32px); overflow-y:auto;` block onto `.trade-modal` — one CSS change fixes all 6 consumers (Trade/Make/AcceptFloorOffer/TokenTrade/HireService/DeployAgent). Test: an e2e/visual check at 375px asserts the Confirm CTA is reachable. **[S]**
- **T0.6 — Fix the forced activation modal (UX-2).** Rewrite `ActivationModal.css` onto the real `--color-k-*` tokens (the orphaned `--surface-*`/`--text-primary`/`--accent-rgb` family is defined nowhere). Add a **stylelint no-undefined-custom-property** rule so this can't recur. Test: computed background/border are non-transparent. **[S-M]**
- **T0.7 — $MEMBA supply honesty (DD-8).** ⚠️ **CTO-panel correction:** an on-chain `MaxSupply` cap is **effectively infeasible for the already-issued $MEMBA** — `tokenfactory_v2.Mint` (`tokenfactory.gno:226`) has no cap, and adding one needs a **new versioned contract + token re-issue/migration** (a live path can't be redeployed in place, per D.2). So the *pre-sale* answer is **disclosure-only**: publicly document who holds the mint admin key + the supply commitment, and make the external `sale.gno.land` trust boundary explicit in-app. Minimum for Jul-20: **remove the implication** that the frontend "10M" constant is protocol-enforced. An on-chain cap is available only to a *new* token instance (a future decision, not a Jul-20 lever). **[S — disclosure/copy]**
- **T0.8 — README plain-language hook + blog backfill (UX-8/9).** A 3-sentence "what is Memba" above the jargon wall; 2-3 short blog posts for Feed v2 / arcade / Points before the spotlight. **[S]**
- **T0.9 — `alert()` → `ErrorToast` on the two wallet-gate call sites (UX-7).** `ServiceLane.tsx`, `TokenLane.tsx`. **[XS]**
- **T0.10 — Minimal legal surface (Terms + Privacy) — CTO-panel MISS (M-1/S1).** No ToS/Privacy exists anywhere in the repo (grep-confirmed by two reviewers), yet Memba onboards newcomers/EU users, runs GitHub OAuth (PII) + analytics, writes user handles/content **irreversibly on-chain**, and fronts a real-money external sale. Publish a minimal Terms + Privacy page (pairs naturally with the T1.3 Trust & Centralization page) covering data handling, on-chain irreversibility, and the off-chain moderation blocklist. Not a code risk; a real reputational/compliance gap at a public spotlight. **[S — legal/owner input]**
- **T0.11 — Verify wave-facing endpoints are rate-limited (S4).** `rateLimitMiddleware("nft", 60/min)` already wraps `/api/nft/image` + `/api/nft/metadata` (adversarial reviewer confirmed) — but confirm `/api/render` and other unauthenticated wave surfaces are also enrolled, and note the limiter alone does **not** blunt the media-cache OOM (256 entries reachable in ~4.3 min from one IP), so T0.1 is still required. **[XS — verify/enroll]**

**Track 0 done-criteria:** the wave-facing surfaces are transactable on a phone, the first-time modal renders correctly, the fabricated/fund-losing surface can't ship via a toggle, the media cache can't OOM the box, and prod is observable. *(T0.1/T0.2 are owner-gated deploys/config; the rest are gate-mergeable frontend/docs.)*

---

#### **Track 1 — Trust integrity: "honest or empty" as a tested invariant** *(systemic; the finding that would most embarrass a chain-flagship)*

- **T1.1 — Read-path fabrication sweep.** Enumerate every frontend/indexer read model that can render an on-chain-looking value; assert (with tests) that each renders an **empty state** when the chain has none, never synthesized data. The codebase already has the right instinct (`service/token_launches.go` "omit rather than fabricate") — enforce it everywhere. Kills: `FloorOffersList` mock (done in T0.3), any other mock-as-truth. **[M]**
- **T1.2 — Correct trust copy to match reality.** `VerifiedBadge` "published criteria" → publish the criteria doc or soften the copy (UX-11); the `CreateDAO` "Treasury" preset → build real custody or drop the label (DD-7); every "DAO-governed" string the DAO can't reach → correct until Track-3 wires it. **[S-M]**
- **T1.3 — Publish a candid Trust & Centralization page (L5/L8).** Who holds the keys and what they can do; the single-indexer centralization; the off-chain feed blocklist + that the on-chain `memba_feed_v2` remains independently gnoweb-queryable. Honesty over theater before the spotlight. **[S]**

---

#### **Track 2 — The avl mainnet-compat cut (the master blocker)** *(realm-source; paces the whole mainnet cut)*

- **T2.1 — Decide remediation (owner decision).** ⚠️ **CTO-panel scope correction:** the break is **not** confined to the memba realms tree — the `p/samcrew/{basedao,daokit,daocond}` closure (deployed by the *separate* gnodaokit ceremony) **also** imports two-value `p/nt/avl/v0` (~18+ more sites across 3 packages: `basedao/members.gno` ×13, `daokit/resources.gno` etc.) and will be deterministically rejected at *its own* AddPackage, blocking `memba_dao` transitively. So the true surface is **~407 memba-realm sites (42 files) + ~18 gnodaokit sites (3 genesis packages, second repo)**.
  - **Option A (recommended for the cut):** vendor the **whole avl module** (`tree`+`node`+`pager`+`rotree` — `tokenfactory_v2` uses pager/rotree) as `p/samcrew/avl/v0`; rewrite the import path in the 42 memba files/54 imports **and** re-point the `p/samcrew/{basedao,daokit,daocond}` closure + forked `grc721` onto it. The fork keeps package name `avl` + all exported identifiers, so `avl.Tree`/`avl.NewTree()`/`avl.Tree{}` all resolve → **zero call-site changes**. Permanent fork. **The fork's own source must pass the pinned-VM consensus type-check, and `p/samcrew/avl` must be published on-chain BEFORE any dependent (collections, grc721, tokenfactory, the daokit closure)** — an explicit publish-ordering gate (add to the SSOT, T4.1).
  - **Option B (post-cut cleanup):** migrate the ~407+~18 sites to the idiomatic single-traversal `v, ok := t.Get(k).(T)` (type assertion — upstream-recommended; Memba stores concrete non-nil values, so this is safe at nearly every site — **not** the naive `Has()+Get()` 2× traversal). No fork; large mechanical diff + a per-site "legitimately-nil" re-audit.
  - **Both leave the IsCurrent/PreviousRealm auth gate untouched.** "A now (minimal, auditable diff on the *immutable* ledger), B later" is the recommended call. **[L]**
- **T2.2 — Pin a mainnet-candidate VM commit (L6) + type-check dry-run gate (A5). ⟶ do this BEFORE/IN-LOCKSTEP WITH T2.1** (S3: you cannot confirm the avl remediation compiles without the pinned VM stood up first). Because the type-check verdict is now consensus (#5891/#5893), run a full-manifest consensus type-check against the pinned VM — the single gate that catches A1, A5, A6 at once and validates A4 gas budgeting. **Named non-avl re-validate target (A6/#5739):** the forked **grc721 embedded types** (`grc721_metadata.gno` `*BasicNFT`, `igrc721_metadata.gno` embedded interface) — exactly the embedded-type-identity class #5739 touches. Bump CI `GNO_PIN` to the pinned commit. **Exit criterion:** the T2.1 fix passes this full-manifest dry-run **before any real collection is minted**. **[M]**
- **T2.3 — Quarantine v1 holdouts (GV-5/6).** Confirm `memba_nft_offers_v1` (fully pre-cur) and the superseded `escrow`/`nft_market`/`memba_dao_candidature` v1 dirs (single-arg `NewBanker`) are excluded from the mainnet manifest; delete or clearly mark them so a whole-tree v2 build is clean. **[S]**
- **T2.4 — Deploy-gas budgeting (A4).** Add per-realm gas-wanted budgeting to the deployer's mainnet ceremony (`PreprocessGasPerByte`=1250/byte, up front); confirm the `addpkg` mempackage strips `_test.gno`. **[S]**
- **T2.5 — Locate + verify emit-caps #5857/#5858 (A7).** Find the change (outside the Jul-11→HEAD window), verify Memba's heavy `std.Emit` usage against the pinned VM, cap user-controlled emitted strings at the realm boundary. **[S-M]**

---

#### **Track 3 — Custody, fund-safety & the DAO executor** *(the mainnet fund-holding prerequisites)*

- **T3.1 — Resolve + harden custody (CSO-1/2/6, DD-3).** **Verify the on-chain key type of `g1x7k4628…`** (fast); correct the false `collection.gno` comment; fix the MembaDAO sole-member to the real multisig; make **admin→k-of-n-multisig/DAO-executor a hard blocking mainnet gate** (2-step `TransferPlatformAdmin`/`Accept` + per-market `TransferOwnership`/`Accept`) with a treasury-repoint **parity assertion** (`GetTreasury()==memba_market_config.GetTreasury()` and `feeRecipient==GetTreasury()`) before any mainnet `RegisterApp`/`CreateCollection`. Timelock `RegisterMarket`/`ForceSetCollectionAdmin`. **[M]**
- **T3.2 — Build the DAO executor (L4/DD-1/DD-2).** ⚠️ **CTO-panel correction to the premise:** the handoff is **finishable today** — it does **not** need the #5890 `cur.Sub()` primitive, and it is **not** "permanently stuck." `daokit` already threads a live `rlm realm` to handlers (`daokit/actions.gno:25-27`, `daokit.gno:91`, `memba_dao.gno:86-87`), and the `basedao` profile handlers **already** make authenticated cross-realm calls in prod — so a registered handler can call `target.AcceptAdmin(cross(rlm))` presenting **`memba_dao`'s own realm identity** as `PreviousRealm()`, exactly what DD-2 requires. The true root cause is **missing application code** (no admin-transfer handler was ever registered), not a missing VM primitive. And since `ChangeDAOImplementation` is a registered default action, the DAO can even **self-upgrade via governance** to add the handler. So:
  - Write and register a **narrowly-scoped `ActionHandler`** in `memba_dao` (buildable on the current `basedao.New()` resource model — `daokit.NewActionHandler`, no basedao change), gated to an **allowlist of (target-realm, function)** pairs, so a passed proposal calls `AcceptAdmin`/`AcceptOwnership`/`SetFeeBPS` on an allowlisted target via `memba_dao`'s identity.
  - **Timelock mechanics (corrected):** `daokit.Core.Execute` runs a proposal in one shot (sets `Status=Executed` immediately), so the delay **cannot** live inside the handler — model it as **enqueue-in-handler (admin transfer + unlock height into `memba_dao` state) + a delayed second public entrypoint** that performs the `cross`-call after the delay. Pure realm code, no basedao change.
  - `cur.Sub()` (A3) is an **optional treasury-hygiene refinement** (distinct per-sub-DAO custody address), not a prerequisite — don't hinge T3.2 on the pinned VM having #5890.
  - Demonstrate ONE handoff end-to-end on test13 before claiming the capability anywhere. **[L]**
- **T3.3 — NF-2 solvency getters (CSO-4).** Add bounded `TotalLiabilities()`/`RealmAddress()` to `escrow_v3`, `memba_dao_candidature_v3`, `agent_registry_v2` (model: `memba_nft_market_v3_2/getters.gno` running accumulator; **no full-tree scan** — gas/DoS). Match the sibling `*_guard_test.gno` import set. Make the pre/post-deploy solvency snapshot a hard ceremony gate. **[M]**
- **T3.4 — `ListNFT` ownership+approval check (OFF-2).** One precondition (`OwnerOf==seller && IsApprovedForAll(seller, market)`) kills listing-squatting, phantom-cap-DoS, and fake-floor. **[S/M]**
- **T3.5 — Bound `UseCredit` (OFF-3).** Per-window deduction cap or a user-signed usage voucher (nonce) the realm verifies, so an agent creator can't drain a deposit; document the trust assumption in the UI. **[M]**
- **T3.6 — Fee/treasury canonicalization across ALL money lanes (DD-4 + CTO-panel M-4).** Pick ONE settlement path per asset class: retire v2, repoint `MEMBA_DAO.nftMarketPath` to v3_2 (`isNftMarketV3Valid()` already exists), wire `primaryFeeBPS`'s `feeRecipient` to the spine treasury, **and fold in the `memba_appstore_v3` fee lane** (SSOT §4 flags its treasury inits to the single-key admin until repointed — F-1) so *every* money lane converges on the fee-spine, not just marketplace — or explicitly document each divergence. **[S-M]**
- **T3.7 — `p0-fund-guard-gate` structural fixes (CSO-8).** Add a per-file existence assertion for each `*_guard_test.gno` on the self-contained leg; auto-enroll any realm reading `OriginSend()` into the P0 gate (fail if a new custody realm isn't listed). **[S]**

---

#### **Track 4 — Mainnet-readiness SSOT & ceremony** *(the single gate list + infra)*

- **T4.1 — EXTEND + reconcile the existing `MAINNET_READINESS.md` SSOT (L11 — CTO-panel B1).** ⚠️ The file **already exists** (`samcrew-deployer/projects/memba/MAINNET_READINESS.md`, 212 lines) and already tracks: NF-2 solvency (§3 = **T3.3**), the owner deploy-ceremony checklist — `chain_id`/gas/one-realm-at-a-time/dep-preflight/NF-2 snapshot (§4 = **T4.3/T4.4**), the treasury-repoint parity assertion (§4 = **T3.1**), the RPC-failover chain-id recheck (§5 = **T4.2/FI-1**), and `cur.IsCurrent/Previous` auth hardening (§6 = L10). So **do NOT create a second doc** — *extend* this one and **cross-reference the tasks it already tracks so nothing is double-done.** Add only the genuinely-missing gates: avl + the gnodaokit closure (T2.1), the **publish+type-check-the-avl-fork ordering gate**, pinned-VM commit (T2.2), deploy-gas (T2.4), emit-caps (T2.5/A7), custody-type-verify + DAO-executor (T3.1/T3.2), fee canonicalization incl. appstore (T3.6), key-model disclosure (T1.3), legal/ToS (T0.10). Fold in the marketplace-pilot + Compound Wave-8 gates. **Make it the merge gate for the mainnet cut.** **[M]**
- **T4.2 — Backend RPC failover chain-id safety (FI-1/FI-5).** Parameterize `rpc_resilient.go`'s fallback list by `GNO_CHAIN_ID` (mirror the frontend's per-network `fallbackRpcUrls`), or boot-assert no test13 host is in a mainnet build; re-assert chain-id after any RPC failover. **[S]**
- **T4.3 — Genesis-dep enumeration (L7).** Enumerate every off-realm dependency (`r/demo/profile`, `r/demo/defi/grc20reg`, all `p/samcrew/*` forks incl. the new `p/samcrew/avl`, `p/nt/*`); confirm each exists / is deployable at the target VM commit on gnoland1. ⚠️ **CTO-panel caveat:** `r/demo/profile` is **namespace-gated** — `basedao.New()` panics without `GetProfileString`, and samcrew almost certainly **cannot self-deploy `r/demo/*`** on gnoland1. Either confirm `r/demo/profile` is a gnoland1 **genesis** realm, or **redirect the import to a samcrew-owned profile realm** (the deployer already hints at this via `deps/demo/profile` + the `r/samcrew/_deps/demo/profile` redirect in `memba_dao.gno`) and re-verify the basedao wiring. Note the deploy script already hard-checks `r/demo/profile` + gnodaokit (SSOT §4), so the *net-new* work here is the `p/samcrew/*`/`p/nt/*` + avl-fork enumeration — smaller than "M". **[S-M]**
- **T4.4 — Owner ceremony inputs (surface, don't execute):** U-1 Litestream restore drill (FI-6 — architecture sound, drill unrun); U-3 `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` at `mismatch=0` (CSO-9); `QUEST_ADMIN_ADDRESSES` (CSO-12); gnoland1 `chain_id` vs live `/status`; `gas_fee`/min-gas-price from the launch spec; deploy the guarded realms one-at-a-time via `REALM=`. **[owner]**

---

#### **Track 5 — Decentralization & resilience** *(post-cut; closes the "web2 app with a chain backend" gap)*

- **T5.1 — Indexer resilience / run-your-own path (L3).** Ship a documented "run-your-own-indexer" path and a client fallback to **direct ABCI/gnoweb** for canonical data, so the chain — not Fly — is the trust root the UI can always fall back to. Multi-backend is the longer arc (Compound "v8.x"); the client-fallback is nearer-term. **[L]**
- **T5.2 — Points economic primitive (DD-9), IF revived.** Scope a `Redeem`/`Claim` action + a sink before promising "reputation as an economic primitive"; wire vetted awarders only after per-source anti-sybil audit. Otherwise keep it a leaderboard and say so. **[M, owner-gated]**
- **T5.3 — Fork convergence / upstreaming (L9).** Where a `p/samcrew/*` fork exists only for version-pinning, converge on canonical gno at the cut; where it adds real value (settlement core, hardened grc721 guard), upstream it. **[M, opportunistic]**

---

#### **Track 6 — Completeness & polish** *(quality bar; parallelizable, mostly gate-mergeable)*

- **T6.1 — Design-system consolidation (FI-7/UX-6).** Converge on `--color-k-*`; stylelint `custom-property-pattern` + no-undefined-var; publish the `k-*` class reference in `DESIGN_SYSTEM.md`. Area-by-area sweep of the 779 hex occurrences. **[M]**
- **T6.2 — a11y gate coverage (UX-3).** Add a pass with `ActivationModal`/`TradeModal` forced open; un-disable `color-contrast` behind a ratcheted count; add mobile once the layout scaffold lands. **[M]**
- **T6.3 — PnL/portfolio view (DD-6).** Wire the already-built `GetSalesByBuyer`/`PurchaseCount` into a portfolio/PnL surface. **[M]**
- **T6.4 — Test-coverage lifts (Test/CI).** Cover `multisig_rpc.go::CreateOrJoinMultisig` (untested anywhere), `tx_rpc.go`, `github_oauth.go`; raise the backend floor above 20%/50% for money paths; put the changelog + split E2E jobs into branch-protection required checks (owner). **[M]**
- **T6.5 — Docs hygiene (UX-4/5, L11).** Mark `UX_UNTRANSACTED_WALLET_ONBOARDING.md` shipped + sweep `docs/planning/*` for the same drift; auto-generate the `ROADMAP.md` status/counts from CI; archive the workspace-root `NEXT_SESSION_PROMPT_*`/`SESSION_PLAN_*` debris. **[S-M]**
- **T6.6 — Validator identity self-serve (VAL-4), gnoland1 "coming soon" state (VAL-5).** Low priority; a self-serve moniker-claim flow post-mainnet; set `gnoland1.realmsDeployed=false` for honest empty-state until the cut. **[S]**

### D.4 — Sequencing & dependencies

```
NOW → Jul-20:  Track 0 (all)  ── owner-gated: T0.1 deploy, T0.2 config, T0.7 disclosure
                     │
Post-wave:     Track 1 (honest-or-empty)  ← depends on T0.3/T0.4
                     │
Mainnet cut:   Track 2 (avl) ──▶ Track 3 (custody/executor/fund-safety) ──▶ Track 4 (SSOT + ceremony)
               (T2.2 pin-VM FIRST → validates T2.1 avl fix; publish p/samcrew/avl BEFORE any dependent;
                memba_collections is immutable → avl MUST precede any collections deploy)
                     │                         │
                     └── T3.2 DAO executor buildable TODAY on memba_dao's own identity (A3 cur.Sub optional),
                     │       unblocks T3.1 handoff gate + fee governance
                     │
Post-cut:      Track 5 (decentralization/resilience)   Track 6 (completeness — parallel, mostly gate-mergeable)
```

**Hard ordering:** avl (T2.1) before any mainnet stateful-realm deploy; custody resolution (T3.1) + DAO executor (T3.2) before handing any admin to the DAO; the `MAINNET_READINESS.md` SSOT (T4.1) all-green before the ceremony. Compound Wave-8's U-1/U-3 remain hard entry gates.

### D.5 — Risk register (top)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| avl fix touches the immutable `memba_collections` and a bug ships permanently | Med | Critical | Option A (import-rewrite, zero call-site change) + full pinned-VM type-check dry-run + deploy dry-run **before** any real collection is minted (T2.2). **Rollback checkpoint:** if the pinned-VM dry-run fails late, Option A (permanent fork) and Option B (~425-site migration) have very different revert costs — name the go/no-go decision point at T2.2 dry-run before committing to on-chain publish. |
| A *second, competing* MAINNET_READINESS doc is created, fragmenting the gate list | Med (the plan originally said "create") | Med | T4.1 corrected to **extend** the existing 212-line SSOT + cross-reference already-tracked tasks (T3.1/T3.3/T4.2/T4.3); no new doc. |
| avl fork (`p/samcrew/avl`) published out of order → a dependent deploy fails | Low | High | Explicit publish-ordering gate: `p/samcrew/avl` (whole module) on-chain + type-checked **before** collections/grc721/tokenfactory/daokit-closure (T2.1/T4.1 SSOT checkbox). |
| A Jul-20 toggle exposes the fabricated/fund-losing offer surface | Med (one env flip) | High | T0.3 delete + T0.4 re-gate ship **before** the wave; the flag can't force-enable the surface after. |
| Media-cache OOM during the wave takes down the whole box | Med | High | T0.1 byte-budget + interim VM RAM bump; single-process compounding acknowledged (FI-3). |
| DAO executor built wrong → a governance action calls an unintended realm | Low | Critical | Allowlist (target,function) pairs + timelock + one end-to-end test13 demo before any mainnet use (T3.2). |
| Parallel session collision on feed/proto | Med | Med | Feed moderation lane off-limits; git-movement HOT-check + lane registration Step 0 (D.0). |
| Mainnet fork moves again before the cut | High | Med | Pin the target VM commit (T2.2); re-run the full sweep against *that* commit, not a range. |

### D.6 — Owner-gated action checklist (surface only — the plan executes none of these)

Deploys/flags/keys/funds/migrations: T0.1 media-cache backend deploy · T0.2 `METRICS_BEARER` + scrape target · T0.7 $MEMBA supply commitment + tokenfactory admin disclosure · the avl remediation decision (T2.1) · the pinned mainnet VM commit (T2.2) · every realm-source→chain ceremony (new versioned paths, 2-of-2 multisig) · custody→multisig handoff (T3.1) · U-1 restore drill · U-3 enforce flip · `QUEST_ADMIN_ADDRESSES` · `VITE_ENABLE_ICO_ANNOUNCEMENT` for the sale window · v3.1 escrow unregister (~Jul-17) · rotate `LIGHTHOUSE_API_KEY` if it equals the old client-exposed key.

### D.7 — The merge gate (this session's authority, restated)

A PR merges **only** when ALL hold: (1) deeply reviewed + CTO-lens diff verification; (2) all tests pass locally; (3) branch up-to-date with base; (4) no conflicts; (5) CI **all green** — including the specific required checks, `mergeable ≠ green`; (6) **no live contention** on the PR's files (re-check git movement — the feed session is active); (7) it is **not** a MERGE-HOLD / owner-gated deploy PR (those need an explicit per-PR go); (8) peer/independent review. Money-path + realm PRs carry an **owner-eyes-before-merge** exception even when green. **Owner comments suspend autonomy.** *(This session produced no PRs — the authority is moot until Track work begins.)*

---

## Part E — Independent CTO panel review of this plan

Three **fresh** reviewers (none of whom wrote Parts C–D) red-teamed the plan against AAA SWE standards, spot-verifying every load-bearing claim against real code: **(1) a CTO plan-integrity reviewer** (completeness, sequencing, testability, risk, actionability), **(2) a Senior Gno-core/GnoVM engineer** (avl remediation, DAO-executor primitive, type-check gate, gas/emit-caps), **(3) an adversarial findings red-team** (do the P0s hold in code, severity calibration, what both audit *and* plan missed). All revisions below are **folded into Parts A–D above** and recorded here as the authoritative amendment.

### E.1 — Consensus verdict: **APPROVE-WITH-CHANGES**

The plan is a genuinely strong, evidence-grounded program: the sequencing instinct is right (avl correctly paces the cut; Track 0 is legitimately realm-deploy-free and Jul-20-safe; the honest-or-empty, custody, and DAO-executor tracks target real convergent findings verified in code). It does **not** need a rework. It could not be signed off *as originally written* because its headline structural recommendation rested on a false premise and it mis-framed two technical items — all now corrected.

**AAA scorecard (reviewer 1):** Completeness 4 · Sequencing 4 · Testability 4 · **Risk coverage 3 (weakest)** · Actionability 4. Weakest dimension driven by the (now-fixed) competing-SSOT blindness and the (now-added) absence of legal/compliance coverage for a public money launch.

### E.2 — Verification: every load-bearing P0 HELD against direct code inspection

The adversarial reviewer independently re-verified in source: avl unvendored + ~398–407 two-value sites (✓), `.trade-modal` zero `@media`/`max-height` shared by exactly 6 modals (✓ — and `.k-modal-glass` is *also* undefined, worse than cited), `ActivationModal.css` orphaned tokens + undismissable (✓), media-cache entry-count-bounded ~7.7 GB (✓), the custody contradiction (✓ — a *newer* comment correcting an *older* one, never propagated — more damning than "stale"), DAO-executor 0 handlers (✓). **No P0 collapsed under scrutiny.**

### E.3 — Required revisions & disposition (authoritative — amends A–D)

| # | Revision | Source | Disposition |
|---|----------|--------|-------------|
| **R1** | **`MAINNET_READINESS.md` already exists (212 lines)** and tracks NF-2/ceremony/treasury-parity/RPC-chain-id/auth-hardening. "Create it" was factually wrong. | Reviewer 1 (B1, blocking) | **FIXED** — T4.1/L11/intro/C.3 reframed to **"extend + reconcile"**; risk row added. |
| **R2** | **On-chain $MEMBA cap is infeasible for the issued token** (needs new instance + migration); pre-sale answer is **disclosure-only**. | Reviewer 1 (B2, blocking) | **FIXED** — T0.7 rewritten. |
| **R3** | **avl scope under-counted** — misses the `p/samcrew/{basedao,daokit,daocond}` closure (~18+ sites, 3 packages, separate ceremony); the fork is the whole avl *module*; publish-ordering is a hard gate. | Reviewer 2 (technical, blocking) | **FIXED** — T2.1 expanded; publish-order gate added to T2.1/T4.1 + risk register. |
| **R4** | **DAO-executor is finishable TODAY** on `memba_dao`'s own identity (daokit threads `rlm realm`; profile handlers already cross-call in prod). `cur.Sub()` is optional, not required. Timelock can't be in-handler (one-shot execute) → enqueue + delayed second entrypoint. | Reviewer 2 (technical) + Reviewer 1 (S2) | **FIXED** — T3.2 rewritten; C.1 rank-4 + D.4 nuanced. |
| **R5** | **C-P0-2 over-claimed as a live fund-drain** — the offers stub is undeployed **and uncompilable** (removed `std.GetBanker`/`GetOrigPkgAddr`/`GetOrigCaller` + `p/demo/avl`) → it's a **trust/UX** risk, not an active drain. Add `MakeFloorOfferModal` to T0.3 scope. | Reviewer 3 (adversarial, over-claim) | **FIXED** — C.0/C.1 rank-2/C.2/T0.3 downgraded + rescoped. |
| **R6** | **emit-caps #5857/#5858 LOCATED** (both ancestors of HEAD): 4096 B/field, now **panics** (was silent truncation) → user-controlled emits can panic on mainnet. | Reviewer 2 (technical) | **FIXED** — A7 register row updated; T2.5 unchanged (instinct was right). |
| **R7** | **Legal/ToS/Privacy/GDPR entirely missing** — no lens owned it; real gap for a public EU-facing money launch. | Reviewer 1 (S1) + Reviewer 3 (M-1) | **FIXED** — added T0.10. |
| **R8** | **Sequencing:** pin the VM (T2.2) **before/lockstep** the avl fix (T2.1); pinned-VM dry-run is the explicit avl exit gate; add an avl rollback checkpoint. | Reviewer 1 (S3) | **FIXED** — T2.2 reordered + exit criterion; risk row added. |
| **R9** | **Rate-limiting** on wave endpoints unverified (media routes *are* limited at 60/min; `/api/render` maybe not; limiter ≠ OOM protection). | Reviewer 1 (S4) + Reviewer 3 | **FIXED** — added T0.11. |
| **R10** | **grc721 embedded types** are the concrete #5739 re-validate target; **`r/demo/profile` is namespace-gated** (genesis-only on gnoland1 or redirect to a samcrew profile realm); **appstore fee lane** folds into T3.6. | Reviewer 2 + Reviewer 1 (missed) | **FIXED** — T2.2, T4.3, T3.6 updated. |

### E.4 — Confirmed non-gaps (recorded so they aren't re-opened next cycle)

- **App Store** correctly excluded from NF-2 solvency getters — `appstore.gno` forwards the listing fee to the treasury in the same call, holds no custody (adversarial M-3). *(Its fee-**routing** still folds into T3.6 — a different concern.)*
- **Reviews realm** (`memba_reviews_*`) correctly out of **fund-safety** — pure content/rating, no `Banker`/`OriginSend` (adversarial M-4). It **is** in **Track-2 avl scope** (it imports avl) — the ~407-site sweep already covers it.
- **IBC/USDC** — no bridge/custody in Memba; the only USDC reference is a read-only gnoswap price quote (adversarial M-2). Out of scope.
- **Option B** is more tractable than first stated — the idiomatic type-assertion `v, ok := t.Get(k).(T)` is single-traversal (Reviewer 2). "A now, B later" stands.

### E.5 — Net result

With R1–R10 folded in, the plan is a **sound governing program to "complete & functional → mainnet."** Its diagnoses are evidence-grounded and independently re-verified; its sequencing is correct (avl paces the cut, Track 0 is Jul-20-safe, custody + executor gate the fund-holding cut); and its one factual error (the SSOT) and two technical mis-framings (avl closure scope, `cur.Sub()` dependency) are corrected. The residual judgment calls left explicitly to the **owner**: the avl remediation choice (Option A vs B), the pinned mainnet VM commit, the $MEMBA supply disclosure, and every on-chain ceremony (§D.6).

---

## Part F — This session's deliverable status & merge authority

- **No code was written and no PR was merged.** Memba is at `95a2e0c4`, **0 open PRs**, clean — so the session's conditional merge authority (D.7) never engaged; it is moot until Track work begins and produces a PR. When it does, the D.7 gate + the active-feed-session contention check apply.
- **Parallel-session note:** a peer session holds the Feed v2 moderation lane (`api/**` proto, `feed_moderation_rpc.go`). This audit was read-only and touched none of it. The one file this session created is this planning doc — no collision.
- **Owner next step:** review Parts C–D (and the E dispositions). If you approve the *shape* and Track sequencing, this becomes the governing program; Track 0 is the do-first, Jul-20-scoped slice.
