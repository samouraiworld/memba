# Memba — Unified Implementation Plan + Production-Risk Certification
### Expert-recommended · one governing program · 2026-07-16

> **What this is.** You asked the experts to recommend the *best* implementation plan across the two audit efforts and to **make sure there is no risk for production.** This document is that recommendation: **8 senior lenses → one synthesized roadmap → a 3-lens adversarial production-risk red-team** (default-to-unsafe). It unifies our per-feature work (Marketplace pilot + Wave-1: DAO/Trading/Reviews) with the concurrent session's whole-project 24-persona audit, which we reconciled and cross-validated.

---

## The one governing decision (unanimous)
**Run ONE program, not two.** The whole-project audit's track spine **is the order**; the per-feature plans are the **depth** that lives inside the avl and custody tracks. **Sequence by blast radius, not by feature** — because every merge to `main` is an **unstaged production deploy** (Netlify frontend / Fly single-512 MB backend), the entire avl/custody/executor/fee mainnet cut is done as **zero-deploy realm-source work in `samcrew-deployer`** and only becomes prod-risk at the **owner-run 2-of-2 ceremony**. **`MAINNET_READINESS.md` (the existing 212-line file) is the single SSOT — extend it, never fork a second.**

**Reconciled corrections adopted** (from the cross-validation): `offers_v1` is *uncompilable* → a **trust** violation, not a live drain (delete it; never port-and-redeploy); the **DAO executor is finishable now** (missing app code, not a VM primitive) and is a **post-launch parallel track** — **Trading custody is the highest fund-risk critical path, not the DAO**; fold in the newer breaking changes **emit-caps #5857/#5858** (>4096 B now *panics*), **deploy-gas #5892**, **deterministic type-check #5893**.

---

## Executive summary
Memba is **serious, fund-safe Gno engineering around a centralized product spine** — production-sound on its live surfaces today, but **not "complete" and not mainnet-cuttable as-is**. The plan is a strict topological chain paced by a **pinned target-VM commit** and the **immutable `memba_collections` ledger**, with a **pre-Jul-20 trust+availability slice** up front (all frontend/config except one owner-gated backend deploy) and the **owner-gated ceremony** at the end. `gnoland1` is transfer-locked + pre-interrealm-v2-phase-3, so **mainnet is the owner-gated horizon, not a near-term merge.**

---

## Do-this-week: the pre-Jul-20 slice (consensus first actions)
The ICO wave is ~4 days out (newcomer + mobile volume). These are the highest-value, lowest-risk items — and **the concurrent session has already started executing them** (PR #961 = the `.trade-modal` mobile fix; #960 = deploy error UX). Coordinate, don't duplicate.
1. **Delete `contracts/memba_nft_offers_v1/`** + neutralize the fabricated `FloorOffers` surface (`mockFetchFloorOffers` → `g1fakebuyer01/02/03`, rendered unconditionally) to an honest empty state + a **grep-guard** — the unanimous #1 trust fix; frontend-only.
2. **SPLIT `VITE_ENABLE_NFT`** → `NFT_TRADE` (ungated = the earned live v3_2 lane) + `NFT_OFFERS` (gated) and add `TOKENS/SERVICES/MARKETPLACE_V2/REVIEWS/APP_REVIEWS/DAO` to `SAFETY_GATED_FLAGS` — **⚠️ see Certification #1/#2 before touching this** (dashboard hazard).
3. **Byte-budget the two 256-entry `ipfs_serve.go` LRUs** (~128–192 MB ceiling) + `GOMEMLIMIT` + a cache-bytes gauge; **land + load-test ≥48 h before Jul-20** — the one outage the wave itself can trip on the 512 MB box.
4. **Fix the newcomer/mobile front door**: `ActivationModal.css` onto real `--color-k-*` tokens (+ a stylelint no-undefined-custom-property rule); the `.trade-modal` `max-height/dvh` block (one change fixes all 6 money-path modals at 375px — *the other session's #961*).
5. **Owner sets `METRICS_BEARER`** + a scrape target + a memory alert (zero code) so the wave is observable; **run the Litestream restore drill** to a scratch path.
6. **Coordination substrate**: name the single shared-artifact **steward**; a lane registry + git-movement HOT-check as Step-0; MAINNET_READINESS.md as the single SSOT.
7. **In parallel (source-only, zero prod risk)**: pin the exact target-VM commit; vendor the whole `p/samcrew/avl` module (Option A) + fork gnodaokit; stand up the non-gating pinned-VM compile leg; author the custody behavioral oracles **before** any avl diff.

---

## Phase-0 prod-env audit — EXECUTED 2026-07-16 (results + hardened procedure)
> This ran the red-team's mandated Phase-2 precondition. It **changed the risk model** — the finding is *worse* than the certification assumed, and it corrects three cert items.

**Verified flag-resolution mechanism (prod):** `memba.samourai.app` = Netlify site **`memba-multisig`** (`3dc5ccf9-…`), **built from git `main` on merge** (`npm run build` → `tsc -b && vite build`, base `frontend`, publishes `main`→production, `stop_builds:false`). Vite `envDir:'..'` loads flags via `loadEnv(mode,'..','VITE_')` + `process.env`; **every reader is `=== "true"` → unset means DARK** (`config.ts:649–703`). `assertSafeFlags` runs at build over `{...process.env, ...loadEnv}` on the production context (`vite.config.ts:24–25`) — so a safety-gated flag that resolves `true` in the injected env **throws the prod build**.

**THE FINDING — the live flags are held in a store the CLI cannot enumerate.** I checked every source; the `VITE_ENABLE_*` flags are in **none of them**: git-committed `.env`/`.env.production` (none — `.env.example` isn't Vite-loaded; `.env.e2e*` are e2e-mode only), `netlify.toml` (only `NODE_VERSION` + `VITE_GNO_CHAIN_ID=test13`), the Netlify **new** contextual env API (`env:list`/`env:get` prod = **0 vars**), the **legacy** `build_settings.env` (**1 non-flag var**), and local root `.env` (**gitignored** → not on Netlify's build, and doesn't even set `FEED`). Since the code defaults every flag OFF, the live surfaces can only be lit by an env store the site-scoped CLI (`env:list`) can't read. **RESOLVED via `netlify api getEnvVars --data '{account_id:"samourai-tech-crew", site_id:…}'`** — the account/team store holds 29 vars including all flags. `env:list` was blind to them because they're **account/team-scoped**, not site-scoped. **So the prod flag config lives in the team env store — un-versioned, and invisible to the standard `env:list` path (only the raw `getEnvVars` account call surfaces it).**

**Actual resolved PRODUCTION flag values (2026-07-16):**
| ON (`=true`) | OFF (`=false`) | UNSET → dark (code default) |
|---|---|---|
| NFT, FEED, APPSTORE, **APP_REVIEWS**, **REVIEWS**, ICO_ANNOUNCEMENT, BARRICADE, BARRICADE_CERTIFY, GAME, SPACE_INVADERS, EXPLORER, ONCHAIN_BLOG, ANALYST, TEAMS, POINTS¹ | MARKETPLACE, SERVICES | MARKETPLACE_V2, TOKENS, AGENTS, REACTIONS, TREASURY_SPEND, AGENT_CREDITS, DAO, NFT_TRADE, NFT_OFFERS |

¹POINTS=true in the store but **hard-off in code** (`POINTS_FEATURE_DEFERRED=true`), so dark regardless.

**⚠️ TWO MATERIAL CORRECTIONS to the audits (from ground truth):**
- **`NFT=true` in prod** — the whole-project matrix said "NFT trading gated off (`=false`)." **Wrong: NFT is LIVE**, so the fabricated `FloorOffers` surface is live *now* → the concurrent session's **#963 (remove fabricated offers) is correctly urgent**, and Cert #1's "dashboard holds NFT=true" is **confirmed**.
- **`REVIEWS=true` AND `APP_REVIEWS=true` in prod** — the Reviews Wave-1 plan repeatedly claimed Reviews is **"DARK in prod, containment holds, all pre-launch."** **FALSE.** The **ungated, sybil-farmable reviews surface is LIVE in production** (validator/profile/App-Store) — a **live trust issue**, not a pre-launch gap. Elevate: either flip `REVIEWS`/`APP_REVIEWS` **false** in the team store now (darkens the ungated surface — an owner call, a live-surface change) OR expedite the purchase-gate; and remove the fake "✓ verified" badge regardless.

**Phase-2 gating risk, per flag (now exact — a flag `true` in prod THROWS the build if added to `SAFETY_GATED_FLAGS`):**
| Flag → gate | Prod value | Adding to gate as-is | Action |
|---|---|---|---|
| `NFT` | **true** | ❌ freezes prod builds | **SPLIT**: reader honors `NFT_TRADE \|\| NFT`; gate `NFT_OFFERS` only (never plain `NFT`) |
| `SERVICES` | false | ✅ safe | add to gate |
| `MARKETPLACE_V2` | unset→false | ✅ safe | add to gate |
| `TOKENS` | unset→false | ✅ safe | add to gate |
| `REVIEWS` | **true (LIVE)** | ❌ freezes builds | owner flips false in team store first (darkens live ungated reviews), verify prod deploy-preview, then gate |
| `APP_REVIEWS` | **true (LIVE)** | ❌ freezes builds | owner flips false first, then gate |
| `DAO` | no flag (live) | n/a | introducing+gating a `DAO` flag **darkens the currently-live DAO surface** — owner decision |

**Corrections to the certification (verified against real config):**
- **Cert #2 — doubly wrong artifact.** Root `.env` is **gitignored** *and* not the real lever; the flags live in the opaque team/legacy Netlify store, not any committed file. **Phase-2 flag changes cannot be PR-atomic.** The only reliable check is empirical: a **production-context Netlify deploy-preview build with `assertSafeFlags` green**, because we cannot statically enumerate the dashboard.
- **Cert #3 — de-escalated.** Backend `GNO_CHAIN_ID` **is set** = `test-13` (hyphen) in `fly.toml` (+ `MEMBA_ACCEPTED_CHAIN_IDS='test-13'`) → no "brick-on-unset". The **`test-13` vs frontend `test13` mismatch + RPC-blip crash-loop** risks remain — keep the fix (warn-only unless a definitive mismatch within a bounded timeout; never gate boot on RPC reachability; run after `ListenAndServe`).
- **Cert #4 — confirmed.** `RPC_FALLBACK_URLS` is **not set** in `fly.toml` → prod relies on the hardcoded `defaultTest13Fallbacks`; do not drop them "when unset".

**Hardened Phase-0 procedure (the audit result → the runbook):**
1. **Owner reads the Netlify UI** for `memba-multisig` → *Site configuration → Environment variables*, checking **Team-shared ("Samouraï Coop") scope + "All contexts"** (the CLI only sees site-level new-store vars, which are empty). Record, per flag entering `SAFETY_GATED_FLAGS`, its **resolved production value**.
2. Because the store is CLI-opaque, the **load-bearing verification is a production-context deploy-preview** (not a static value dump): any PR that adds a flag to `SAFETY_GATED_FLAGS` must first show a **green prod-context deploy-preview**.

**Hardened Phase-2 procedure (supersedes the "flip in the same PR" wording):**
- **NFT split:** the new reader honors **both** flags — `VITE_ENABLE_NFT_TRADE === 'true' || VITE_ENABLE_NFT === 'true'` — so the live env keeps working with **zero dashboard change** (removes the orphan-darking hazard entirely). Set `NFT_TRADE`'s committed default false. De-gate only in Phase 11 after the buy loop is rebuilt on `GetListingsPage` + integer pricing.
- **Gated-flag additions:** the owner sets any soon-to-be-gated flag **false in the Netlify store first**, confirmed by a **green prod-context deploy-preview**, *then* the PR (which updates `safeFlags.ts` **and** `safeFlags.test.ts`'s exact `toEqual([...])` in the same commit) merges. **Never within 48 h of Jul-20** without that green preview.

---

## The 12-phase roadmap (sequenced by blast radius)
| Phase | Goal | Prod-risk | Deploys? |
|---|---|:--:|---|
| **0** Coordination bootstrap | single steward + lane map + prod-env audit + one-program reconciliation | none | no |
| **1** Pre-Jul-20 trust + mobile front door | delete offers stub, honest empty states, `ActivationModal`/`.trade-modal`, OTC approve-address, false-copy fixes | low | Netlify (FE) |
| **2** safeFlags split + fail-closed allowlist | split `VITE_ENABLE_NFT`; gate the unfinished flags; `isRealmValidOn` fail-closed | low | Netlify (FE) |
| **3** Availability + observability | byte-budget media cache + `GOMEMLIMIT`; `METRICS_BEARER`; restore drill; rate-limit audit | **medium** | Fly (BE) |
| **4** Trust-integrity sweep + observability finish | honest-or-empty as a tested invariant; Trust page; backend Sentry + boot chain-id assert | low | Fly (BE) |
| **5** Mainnet-cut foundation | pin VM; vendor `p/samcrew/avl` + fork gnodaokit; non-gating CI leg; extend SSOT; quarantine v1 holdouts | none | **no (source-only)** |
| **6** Custody oracles at the pre-avl ref | full-lifecycle balance-delta suites + pause-coverage + drain-gate invariant + tokenfactory first tests + avl equivalence/fuzz | none | no |
| **7** Immutable API-surface FREEZE | enumerate every read/write incl. `SaleSeedSealed()` + NF-2 solvency getters; sealing order | none | no |
| **8** avl cut + custody/fee/executor hardening | repoint imports; `escrow_v4` pause+2-step-admin+fee-spine; ListNFT ownership; bounded UseCredit; emit-cap clamps; DAO executor (parallel) | none | no (source) |
| **9** X4a key-hygiene + RPC chain-id + atomic GNO_REF flag-day | verify `g1x7k4628` on-chain; correct false "multisig" comments; RPC chain-id; one owner flips the shared gate last | low | CI + Fly (BE) |
| **10** OWNER-GATED mainnet ceremony | drive SSOT all-green; one rehearsed dependency-ordered 2-of-2 cut | **high** | **chain (owner)** |
| **11** Post-cut decentralization + completeness | prove executor on test13; Reviews purchase-gate; make Token/OTC/Services transactable; indexer run-your-own; design-system + coverage | low | mixed |

*(Full per-phase steps + gates are preserved in the panel digest; the load-bearing details are inlined in the Certification and Owner-decisions below.)*

**Critical-path chain (the mainnet cut):** pin VM → vendor avl + fork gnodaokit → custody oracles green at pre-avl ref → **API-surface freeze (must fold in `SaleSeedSealed()`)** → avl cut + `escrow_v4` hardening → key-hygiene + **atomic GNO_REF flag-day** → owner ceremony. Trading custody rides the cut **ahead of** the DAO executor (a parallel post-launch track).

---

## Production-safe checklist (every step must pass — merge = prod deploy)
- **Blast radius declared per PR**: `frontend/**` = Netlify prod on merge · `backend/**` = Fly prod (rolling, 1× 512 MB + volume) · realm-source in `samcrew-deployer` = **NO auto-deploy** (chain publish is a separate 2-of-2 ceremony) · docs/tests/CI = no prod surface. **Never conflate realm-source-merged with realm-deployed.**
- **CI all-green incl. `assertSafeFlags`** — the prod build must fail closed if any `SAFETY_GATED_FLAG` resolves `true`; the assertion is TDD'd both directions before it's load-bearing.
- **Dark-by-default**: any new money/trust capability behind a default-off flag that is **also** in `SAFETY_GATED_FLAGS`; `VITE_ENABLE_NFT` is **split**, never wholesale re-gated.
- **Migrations ≥ 026** (025 is taken by feed_flags #957), forward-only, additive/reversible, never rename an existing file, **never touch feed/feed_flags tables** (concurrent Lane B).
- **No autonomous money-path merge**: money-path flag flip, key repoint, config flip, or realm→chain publish is an **explicit owner per-PR go**.
- **Lane discipline**: git-movement HOT-check + lane register before editing any single-writer file (`safeFlags.ts`, `.env`, CI yaml, `cmd/memba/main.go`) and again immediately before merge; `api/**` proto + `feed_moderation*.go` (concurrent) and Auth/signature (Lane C) are **OFF-LIMITS**; `samcrew-deployer` = worktrees only.
- **Every deleted demo-tell carries a CI grep/DOM guard** (`g1fakebuyer`, `mockFetchFloorOffers`, `MEMBATEST`, the ServiceLaneV2 seed, the false "governance vote" string, the verified badge on ungated paths).
- **Backend Fly deploys are ROLLING only** — never `flyctl --strategy immediate` on this single-machine+volume app; owner per-PR go; prod-verified after; **one in-flight prod deploy per surface** across both sessions.
- **Realm work stays source-only until the ceremony**: the pinned-VM full-manifest **consensus type-check dry-run** (deterministic AddPackage reject post-#5893) is green **before** any collection is minted; `p/samcrew/avl` published + type-checked **before** any dependent; emit-caps ≤ 4096 B and deploy-gas (`_test.gno` stripped) satisfied per realm.
- **Irreversible-setter guard**: 1-step `SetFeeRecipient`/`SetTreasury` target the real fee-spine multisig `g10kw7e55` **only**, never the executor-less `memba_dao` realm; a deploy-script precheck rejects the DAO address as a handoff target until the executor is demoed on test13.

---

## ⚠️ PRODUCTION-RISK CERTIFICATION — **PROD-SAFE-WITH-FIXES**
All three red-team lenses (default-to-unsafe): **no phase must be dropped**, but the following steps are **UNSAFE as worded** and are **hard blockers** until fixed. **Root cause behind #1–#2 (fix once):** the **Netlify production dashboard is un-versioned owner-only config** and the roadmap wrongly treats flag changes as PR-atomic. Make **every dashboard env change an explicit *ordered owner precondition*, verified via a production-context deploy-preview build**, never "in the same PR."

| # | Unsafe step (as worded) | Concrete prod break | Required fix (blocker) |
|---|---|---|---|
| **1** | Phase 2 — split `VITE_ENABLE_NFT` → `_TRADE`/`_OFFERS` | The live lane is dark/lit **only** via the dashboard override. Renaming the reader **orphans** it → the merge either **darks the entire earned live NFT surface** (reads `undefined→false`) or **arms a known-unsafe buy path** (float-round-trip price vs the realm's exact-`OriginSend` panic; 50-row truncating render) straight to the wave. | New reader honors **both** flags (`_TRADE \|\| legacy VITE_ENABLE_NFT`) so the live env keeps working with **zero dashboard change**, OR owner sets `_TRADE=true` in the dashboard + verifies on a deploy-preview **before** the rename merges. Add a 375px e2e asserting the live surface **stays as-is**. De-gate only in Phase 11 after the buy loop is rebuilt on `GetListingsPage` + integer pricing. |
| **2** | Phase 2 — add flags to `SAFETY_GATED_FLAGS` "flip false in this same PR" | `assertSafeFlags` reads the **merged** env (committed + **dashboard**). A PR can't touch the dashboard; if any newly-gated flag is `true` there, the **next Netlify prod build THROWS → all deploys freeze during Jul-20** (site stays up; no hotfix can ship). **Correction:** root `.env` is **gitignored** — it never reaches prod, so "flip `.env`" targets the wrong artifact. | Make the dashboard flip an **ordered owner precondition** (from the Phase-0 audit of *resolved* prod values), confirmed via a **production-context deploy-preview** green, **then** merge. Update `safeFlags.test.ts`'s exact `toEqual([...])` in the same PR. Never within 48 h of Jul-20 without the green preview. |
| **3** | Phase 4 — fail-closed **boot chain-id assertion** in `main.go` | Puts an outbound RPC round-trip on the boot path of the single 512 MB box and **contradicts `main.go`'s "never boot-block on config" invariant**. Unset/mismatched `GNO_CHAIN_ID` (prod uses `test-13` *with hyphen*; frontend `test13`) or a **transient RPC blip during rolling deploy** → `os.Exit(1)` → **crash-loop → total backend outage**, worst-case mid-wave. | **Warn-only when `GNO_CHAIN_ID` is unset**; hard-fail **only on a definitive mismatch within a short bounded timeout**; **RPC reachability must never gate boot**; run **after** `ListenAndServe`; **verify the live env string first**. Confirm `GNO_CHAIN_ID` is actually set in the Fly env before shipping. |
| **4** | Phase 9 — parameterize `rpc_resilient.go` "drop the hardcoded test13 default when unset" | `fly.toml` doesn't set `RPC_FALLBACK_URLS`, so prod relies on the **hardcoded** `defaultTest13Fallbacks`. Dropping it "when unset" leaves prod with **zero fallback nodes** → a single primary-RPC blip fails reads that survive today. | Set `RPC_FALLBACK_URLS` (or a chain-id-keyed default map that **still contains** the test13 backups) in the **same** change, **before** removing the default; test a non-empty fallback resolves; **never reduce the prod node set**. |
| **5** | Phase 3 — media-cache "stream-through objects >2 MB" | The naive stream path **bypasses `serveEntry()`'s XSS defense** (`safeImageContentType` downgrade + `nosniff`) → a >2 MB `text/html`/`svg` object echoed with an executable content-type → **XSS on the api origin** (live unauthenticated proxy). | Stream-through **must re-apply** `safeImageContentType` + `nosniff` + `Content-Disposition:inline` + the 15 MB `LimitReader`; test a >2 MB html/svg serves as `application/octet-stream`. |
| **6** | Phase 3 — `GOMEMLIMIT` in `fly.toml` | If conflated with the **cache byte-budget (~128–192 MB)** and set that low on the 512 MB box → **GC thrash** (CPU/latency) under the wave — degrading the availability the change protects. | `GOMEMLIMIT` = **whole-process headroom (~400–430 MB)**, not the cache budget. Byte-accounting + synthetic-load RSS test on a scratch instance before merge; rolling only; ≥48 h pre-wave; interim 512→1024 MB bump if it slips. |
| **7** | Phase 4 — `main.go` Sentry/boot edits vs the concurrent feed session | Both sessions editing `main.go` route wiring → merge conflict or a botched resolve dropping a feed-moderation route / mis-wrapping auth middleware (Lane C off-limits). | **Serialize**: land the feed session's `main.go` first, then **rebase** (not just a HOT-check); keep the Phase-4 diff surgically away from the feed route, auth middleware, and `SweepMultisigSigVerify`; one in-flight `main.go` PR at a time. |
| **8** | Phase 7/11 — freeze scope vs deferred completion | Much completion work (real offer→accept, escrow_v4 wiring, PnL) is deferred to **Phase 11, after** the immutable cut. Any getter it needs but not enumerated at the Phase-7 freeze is a **permanent strand** — a compile-green dry-run does **not** catch a *missing* getter. | Bind the Phase-7 "downstream API needs sign-off" to the **union of every entrypoint any post-cut phase will call** (offer-depth read, `GetProceeds`, `GetSalesByBuyer`, provenance, batch summary, `SaleSeedSealed`, NF-2 getters). Anything uncertain ships as its **own later sibling-realm deploy**, never an assumed getter. |
| **9** | Phase 9 — atomic `GNO_REF` flag-day | The shared gate covers **feed_v2**, which the **live concurrent feed session rides** → a premature flip reds the gate for everyone = program-wide **merge stall** (not a prod outage; revertible in one commit). | The "every gated realm migrated first" precondition must **explicitly enumerate the feed session's realms + the 8 uassert suites**, green on the non-gating leg, with a HOT-check + **direct coordination with the concurrent session** immediately before the flip; one owner flips last. |

**Genuinely prod-safe as sequenced (red-team could find no break path):** Phase 0 (docs/process); Phase 1 (frontend-only, dark/gated surfaces); Phases 5–8 & 10 realm-source track (no auto-deploy; `p0-fund-guard-gate` `GNO_REF` deliberately **not** repointed until the flag-day; #5893 dry-run is the load-bearing consensus gate); the on-chain **irreversibility** lens found **no prod-breaking irreversible path** (immutable `memba_collections` is written only in the owner-gated ceremony behind the freeze + dry-run; Option-A vendoring is zero-call-site-change; the 1-step fee setter is triple-guarded). **No new DB migration appears in any sequenced step** — the migration hazard class doesn't arise (flag it if later backend work adds one).

---

## Dissents (panel disagreement → call made)
- **`VITE_ENABLE_NFT`**: split (7 lenses) vs wholesale re-gate (CSO "or split"). → **SPLIT** (wholesale re-gate is a footgun; see Cert #1).
- **`offers_v1` a "live drain"?** CSO said escrow-losing; Gno-core + reconciliation → **uncompilable, undeployed = trust violation, not a live drain**. Delete both; hard rule "never port-and-redeploy."
- **Trading vs DAO executor critical path** → **Trading custody first** (highest fund-risk); the DAO gets a launch-critical stop-the-bleed slice (false-copy + `VITE_ENABLE_DAO` kill-switch + candidature avl); executor is **post-launch, demoed on test13 before claimed**.
- **avl Option A vs B** → **A now** (whole-module vendor, zero call-site change on the immutable ledger), B as post-cut cleanup; ~407 sites (range 337–447 is an owner-review item).
- **Migration numbering** → **≥ 026** (025 taken by #957).
- **Media-cache timing** → land + load-test **≥48 h before Jul-20**, ship early this week, interim 512→1024 MB bump as insurance.
- **`main.go` edits** → post-front-door (Phase 4), each behind a HOT-check + rebase-on-feed-first + tightly-scoped PR.

---

## Owner decisions (the plan executes none of these)
1. **Name the single program steward** of the shared artifacts (`p/samcrew/avl`, `safeFlags.ts`, `isRealmValidOn`, the `p0-fund-guard-gate` `GNO_REF` job, `MAINNET_READINESS.md`, the pilot-marketplace cut) + endorse the one-program reconciliation.
2. **avl remediation shape**: Option A (recommended) vs B.
3. **Pin the exact mainnet-candidate gno VM commit** (not a range).
4. **Confirm the `VITE_ENABLE_NFT` split shape** + that the Netlify dashboard values are handled as ordered preconditions (Cert #1/#2).
5. **Pre-Jul-20 backend go**: media-cache byte-budget Fly deploy (rolling) + interim RAM bump; set `METRICS_BEARER` + `QUEST_ADMIN_ADDRESSES`.
6. **Sign off the immutable API-surface freeze contents** (incl. `SaleSeedSealed()` + NF-2 getters) **before** the pilot cut.
7. **Ground-truth `g1x7k4628` on-chain** (single key vs k-of-n); confirm fee setters target `g10kw7e55` only; decide `ForceSetCollectionAdmin` fate.
8. **$MEMBA**: disclosure-only for Jul-20 (on-chain cap needs a new instance + migration); publish mint-admin key + supply commitment; make the `sale.gno.land` trust boundary explicit.
9. **DAO executor typed-action allowlist** (no raw `ExecuteLambda`) + `ChangeDAOImplementation` threshold/timelock/guardian — close **before** any value/admin reaches the DAO.
10. **Canonical realm per family** (Trading `escrow_v4`/`otc_v2`/`agent_registry_v2`; Reviews `core_v1` + one gated wrapper; DAO basedao vs daoTemplate); Services build-vs-descope; agent-credit proof-of-service before de-gating `AGENT_CREDITS`.
11. **Timing + named owner of the atomic `GNO_REF` flag-day**; U-1 restore drill; U-3 `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` (USER-only, metric-gated at mismatch=0); `VITE_ENABLE_ICO_ANNOUNCEMENT`; every realm→chain ceremony + X4b repoint.
12. **Repo-admin**: make the Changelog gate + split E2E jobs **required** branch-protection checks; set the backend money-path coverage-floor ratchet.

---

### Grounding caveat & verify-before-execute
The **8 panel lenses and 3 prior audits read the real code**; the **synthesis + red-team agents were macOS-TCC-blocked** from the local `~/Desktop` tree and grounded against **GitHub `main` (SHA `94466198`) — which *is* the prod-deployed tree** — plus the file:line-quoted session digests. This is correct ground truth for a prod red-team, but a few **line-level facts must be re-verified against the live files before executing**, most importantly: **whether the backend Fly env actually sets `GNO_CHAIN_ID`** (decisive for Cert #3), the **live Netlify dashboard resolved values** for every flag entering `SAFETY_GATED_FLAGS` (Cert #1/#2 — the Phase-0 audit), and the exact `p/nt/avl` site count (337–447).

---
### Provenance
- Reconciled inputs: `MARKETPLACE_PILOT_AUDIT_AND_PLAN_2026-07-15.md`, `WAVE1_AUDIT_AND_PLAN_2026-07-16.md`, `MEMBA_WHOLE_PROJECT_AAA_AUDIT_AND_PLAN_2026-07-16.md`.
- Panel workflow `wfoiboxl4` — 8 recommendation lenses + synthesis + 3-lens prod-risk red-team (12 agents). Digest in the session scratchpad.
