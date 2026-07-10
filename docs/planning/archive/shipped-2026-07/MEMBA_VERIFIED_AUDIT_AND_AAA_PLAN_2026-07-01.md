# Memba — Verified Cross-Perspective Audit & AAA Implementation Plan

> **Document type:** Independent skeptical re-verification of the 2026-06-30 audit + a fresh audit of the last-4-day sprint, consolidated into one authoritative findings register and CTO-level delivery plan.
> **Date:** 2026-07-01 · **Repo state:** Memba `main` @ `9ff6595` (v7.2.0, merge of `feat/phase11-12-integration` #694) · satellites: `samcrew-deployer` @ `3bf336b`, `gnodaokit` @ `pr-64`, upstream `gno` @ `9e8df24a6`.
> **Method:** Four parallel domain re-verifications (Gno/codegen · backend/infra · frontend/marketplace · deployer/docs), each mandated to **confirm/refute every claim at source with current `file:line`** and to hunt for what the prior audit missed — plus a cross-repo upstream-gno breaking-change pass. Every P0/P1 below was read at source; overstated prior claims are called out explicitly.
> **Relationship to prior work:** This supersedes and corrects `MEMBA_CROSS_PERSPECTIVE_AUDIT_AND_AAA_IMPLEMENTATION_PLAN_2026-06-30.md` (DRAFT PR #695). That document is excellent and ~90% accurate; this one **verifies it, downgrades two overstated P0s, and adds the sprint-introduced defects it predates or missed.**

---

## 0. How to read this

- **§1** — the verdict, in one screen.
- **§2** — the trust check: what the 06-30 audit got right, **overstated**, or got **wrong** (this is the skeptical core the sprint demanded).
- **§3** — **NEW defects introduced/missed in the last 4 days** (the code you said you don't trust).
- **§4** — consolidated & re-prioritized findings register (live vs latent).
- **§5** — upstream Gno breaking-change exposure.
- **§6–§9** — the AAA plan: waves, sequencing, quality gates, kickoff.

Difficulty is expressed as **blast radius / invasiveness / risk**, not calendar time (house style).

---

## 1. Executive summary & verdict

**Your instinct was correct: the last-4-day sprint introduced real defects, and it shipped demo-grade code into a money surface.** But the picture is more nuanced than the 06-30 audit implies — two of its headline P0s are **overstated** (the deployed realms are actually correct), while the genuinely dangerous problems are in the **new unified-marketplace frontend and two just-added realms**, which that audit predates or under-weights.

**The single most important truth about the current state:**

> The **deployed on-chain realms on test13 are in good shape** (interrealm-v2 migration is coherent; `escrow_v2` is correct and even guards against double-refund; the fund-moving realms follow CEI and access control). **The danger has moved up-stack into the new frontend marketplace and two brand-new realms that are wired but wrong.**

**What is actually broken from the sprint (verified at source):**

1. **Unified marketplace lanes ship ungated** — `UnifiedMarketplace.tsx` (routed at `App.tsx:264` `marketplace/*`) renders all Services/Tokens/Agents tabs and routes **unconditionally**; the intended `getLiveLanes()`/`isLaneLive()` gate (`lib/marketplace/lanes.ts`) is imported only by a *different, superseded* `MarketplaceHub.tsx`. Direct-URL reachable regardless of `VITE_ENABLE_*`. This is the exact "ungated route" class the code comments say was already fixed once. **[HIGH]**
2. **`HireServiceModal` builds a guaranteed-revert money transaction** — it targets `gno.land/r/samcrew/memba_escrow_v1` (`HireServiceModal.tsx:11`) with `send:""` while that realm's `CreateContract` panics unless exactly one ugnot is attached. Every "Sign Escrow Tx" reverts on-chain after the user signs (gas burned, confusing failure). `ServiceLane` renders hardcoded `MOCK_SERVICES` with fake addresses. **[HIGH]**
3. **A new `contracts/memba_escrow_v1/escrow.gno` (added Jun 29 in `fc195cf`) cannot deploy on test13** — it is written against the *old* pre-interrealm-v2 stdlib (`runtime.OriginCaller()`, `banker.OriginSend()`, `NewBanker(...)` with no `cur` arg, no `cur realm` params) and uses non-deterministic `time.Now()`. This is the identical bug class that bricked the client templates (#621). **[HIGH — latent-on-deploy]**
4. **`memba_token_otc_v1` (new, `samcrew-deployer`) traps buyer overpayment forever** — `Fill()` accepts any payment `>= cost` but routes exactly `cost`; the excess is never refunded and there is **no withdraw/sweep** function. It **deploys unconditionally** via `deploy.sh`. Plus an int64 overflow in `cost = qty * unitPrice`. **[HIGH]**
5. **`DeployAgentModal` is a fake transaction** — `setTimeout(1500)` then `onSuccess()`, broadcasting nothing, behind a real GNOT "Total Cost" UI. **[MED — deceptive]**
6. **The Phase 11/12 merge *introduced* the DAO board/channel desync** — `fc195cf` replaced a harmless `// TODO` stub with a live `parent.IsMember()` call the generated DAO never exports (won't compile/link). **[MED — latent-on-deploy]**
7. **CI regressed to ~20 min** — `playwright.config.ts:13` `workers: process.env.CI ? 1 : undefined` reverted the #599 `workers→2` optimization; E2E is single-worker again (13.2 min, the whole matrix floor). **[MED — DX/cost]**
8. **`ActivationModal` bypasses the guarded broadcaster** (`adena.DoContract` directly — no RPC-trust/chain-id/confirmation guard); **hardcoded fake marketplace stats**; **react-hooks compiler lint suite globally disabled** (`eslint.config.js:23-29`, masks exactly the class of bug in the chain-id finding). **[MED/LOW]**

**What the 06-30 audit OVERSTATED (verified false or lower-severity):**

- **Escrow double-refund is NOT a live P0.** The deployed `escrow_v2` uses `MsRefunded` (not `MsPending`) and has an explicit double-refund guard (`escrow_v2/escrow.gno:453,465`). The buggy `MsPending` logic exists only in the frontend `generateEscrowCode` template — which is **called only from tests**, never wired to a deploy path. It is latent template debt, not realm insolvency.
- **The offers stub is gated.** `memba_nft_offers_v1` is **not** in any `REALM_ALLOWLIST` (`config.ts:216-245`), so `isRealmValidOn` gates its modals. Latent-on-deploy, not live-exploitable.
- Several frontend claims were imprecise (`LegacyCollectionView` `$1` sanitization is actually correct; GnoloveMilestone escapes HTML first; the "grc20 second ABCI stack UTF-8 corruption" is in `account.ts`, not a separate grc20 stack).

**Top-line verdict (CTO lens):** The bleeding is **not** in the deployed realms — it is in the **unfinished marketplace UI shipped as if live** and **two new realms that are wired-but-wrong**. Priority order changes accordingly: **(A) contain the demo-grade marketplace behind real gates and remove the fake/reverting flows; (B) fix or delete the two new broken realms before any `deploy.sh` run; (C) fix the token-OTC overpay trap; (D) then execute the (still-valid) backend-integrity and codegen-hardening waves from the 06-30 plan.** Freeze net-new marketplace lanes until they are gated, real, and tested.

---

## 2. Trust check — verification verdicts on the 2026-06-30 audit

Every item read at source on `main` @ `9ff6595`. Line numbers are **current** (several drifted from the prior audit).

### 2.1 CONFIRMED at source (findings stand)

| Prior ID | Finding | Current evidence |
|---|---|---|
| BE-1 | `MultisigInfo` has no membership check → any authed user reads any multisig's pubkeys + member list | `multisig_rpc.go:163-213` (only `authenticate` @167; contrast `GetTransaction` JOIN on `joined=TRUE`) |
| BE-2 | Multisig sig verification is **log-only** in prod | `tx_rpc.go:337-349` (reject only `if EnforceMultisigSigVerify()`); `fly.toml` holds the flag off |
| BE-3 | `CompleteTransaction` stores client `final_hash` unverified | `tx_rpc.go:365-427` (only `sigCount<threshold` check). *Severity note: `final_hash` is display/dedup metadata, not an authz primitive — lower impact than "accepts client hash" implies.* |
| BE-4 | `off_chain`/default quests auto-grant XP | `quest_verify.go:143-146` (`default: return nil`) |
| BE-6 | `/metrics` public unless `METRICS_BEARER` set (not set in `fly.toml`) | `main.go:446-458` |
| BE-7 | Hardcoded default quest-admin when `QUEST_ADMIN_ADDRESSES` unset | `quest_rpc.go:818-820` |
| Cond-P0 | `MEMBA_ALLOW_UNSIGNED_AUTH=1` → empty+invalid sigs accepted | `crypto.go:372-422` — **fail-closed by default; flag unset in prod (safe posture)** |
| CHN-4 | `executeAddMember` skips `assertRole` (unlike `executeAssignRole`) | `daoTemplate.ts:560-564` vs `:595` |
| CHN-5 / R2 | DAO `VoteOnProposal` finalizes **inline on a single qualifying vote**; asymmetric reject threshold | `daoTemplate.ts:455-460` |
| R2-GEN-A | Sanitizer `clampInt`/`isValidPercentage` are **dead code**; `threshold`/`quorum` interpolated raw; `threshold=0` ⇒ all pass | `templates/sanitizer.ts:129,136` (used only in tests); `daoTemplate.ts:238-239` |
| R2-GEN-A | Agent **comment-injection** via raw `config.name` in a `//` comment | `agentTemplate.ts:56` (`safeName` used for the string constant @104 but not the comment) |
| R2-GEN-B/C | Board `parent.IsMember()` unexported by DAO; channel keeps a separate member tree seeded with deployer only; wizard ships `_board`, plugin ships `_channels`; Render pagination mismatch | `boardTemplate.ts:77,290`; `channelTemplate.ts:222,232,559`; `CreateDAO.tsx:258`; `DeployPluginModal.tsx:53`; `daoTemplate.ts:277,337` vs `dao/proposals.ts:115,185` |
| R2-CHN-E | Chain-id guard silently disabled after in-wallet network switch | **Real, but in `grc20.ts`, not `useAdena.ts`:** `changedNetwork` calls `setWalletRpcContext(url,trusted)` with **2 args** (`useAdena.ts:396`) → `_walletChainId` reset to `null` (`grc20.ts:86`); guard `if (_walletChainId && …)` short-circuits (`grc20.ts:156`) |
| R2-CHN-G | `fetchAccountInfo` returns `{0,0}` on transport error → multisig sign-doc `sequence:0` risk | `account.ts:46-48` |
| FE-1 | Full server-signed auth token in `localStorage` | `useAuth.ts:14-22` (backend re-validates every call; stolen-token-until-expiry tradeoff) |
| INF-1 | 6 unpinned release-critical tools (`@latest`/`@master`) incl. `setup-flyctl@master` in the deploy path | `deploy-backend.yml:56`; `ci.yml:56,59`; `codeql.yml:29`; `gno-test.yml:39`; `deploy-backend.yml:41` |
| INF-2 | "Security" badge → `codeql.yml` runs **gosec only**; no CodeQL JS/TS anywhere | `codeql.yml:12-32`; `README.md:6` |
| INF-5 | Doc drift: four different test counts; `docs/API.md` documents **12 of 38** proto RPCs; `AGENTIC.md` omits dao-analyst | README (3200+/1628) vs ROADMAP (2399) vs DISCLAIMER (1777+); `api/memba/v1/memba.proto` |

### 2.2 OVERSTATED — downgrade

| Prior claim | Reality (verified) | Corrected severity |
|---|---|---|
| **R2-CHN-A** "Escrow double-refund; `escrow_v2` live on test13 → realm insolvency" **(P0)** | Deployed `escrow_v2` sets `MsRefunded` on dispute refund and **explicitly guards** cancel against double-refund (`escrow_v2/escrow.gno:393,453,465`). The `MsPending` double-refund exists only in `generateEscrowCode` (`escrowTemplate.ts:392,441`), which is **called only from tests** — never wired to a deploy path. | **P3 latent** (template↔deployed drift), **not a live P0** |
| **CHN-1** "Offers `AcceptFloorOffer` strands buyer funds" **(P0)** | The stub is genuinely broken (removes offer + emits event, no transfer, **no buyer refund**), but `memba_nft_offers_v1` is **absent from every `REALM_ALLOWLIST`** (`config.ts:216-245`) → `isRealmValidOn` gates the modals. | **P2 latent-on-deploy** (quarantine, don't ship) |
| **FE-3** "`LegacyCollectionView` unescaped `$1` before DOMPurify" | The regex `$1` wrapping runs **inside** `DOMPurify.sanitize(...)`; SEC-05 comment documents the deliberate ordering fix. | **Refuted** for that file |
| **FE-3** "GnoloveMilestone live XSS" | `renderMarkdown` HTML-escapes all text via `escapeHtml` first; source is GitHub API. | **Defense-in-depth gap**, not an open sink |
| **R2-CHN-D** "grc20 second ABCI stack uses `atob` → UTF-8 corruption" | The failover decoder (`rpcFallback.ts:113-114`) is UTF-8-correct via byte reconstruction. The genuinely fragile raw `atob`+`JSON.parse` is in `account.ts:39` (part of the `{0,0}` finding). | **Imprecise attribution**; real issue is `account.ts` |

### 2.3 REFUTED — remove

| Prior/assumed claim | Reality |
|---|---|
| "**Deploy Frontend** action risks pushing to prod on `main` (bypassing `netlify.toml`)" | The `deploy` job is **hard-disabled** (`deploy-frontend.yml:86` `if: ${{ false }}`, with an explanatory comment). Only the CI-gate job runs; prod deploys via `netlify.toml` native Git integration. **No prod risk from this workflow.** |
| "`SetMaxOpenConns(1)` breaks Litestream WAL backup" | Litestream uses its own separate read connection; the app pool size is irrelevant. Non-issue. |
| "Litestream is backup-only → data loss on fresh volume" | Restore-on-boot **is** wired (`start.sh:6-12` restores from replica when the DB is absent). |

---

## 3. NEW findings from the last-4-day sprint (the untrusted work)

These are **not** in the 06-30 audit (it predates or missed them). All verified at source.

### 3.1 Frontend / marketplace (`main` @ `9ff6595`)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **NEW-FE-1** | **HIGH** | **Unified marketplace lanes are un-gated.** `UnifiedMarketplace.tsx` renders all tabs + routes unconditionally; `getLiveLanes()`/`isLaneLive()` (`lib/marketplace/lanes.ts`) are imported only by the *superseded* `MarketplaceHub.tsx`. `App.tsx:264` routes `marketplace/*` → `UnifiedMarketplace` with no gate → `/marketplace/services|tokens|agents` reachable by direct URL regardless of `VITE_ENABLE_*`. | `App.tsx:264`; `UnifiedMarketplace.tsx:60-97`; `pages/MarketplaceHub.tsx` (uses gate, not routed) |
| **NEW-FE-2** | **HIGH** | **`HireServiceModal` builds a guaranteed-revert tx.** Targets `memba_escrow_v1` with `buildCreateContractMsg` hard-coding `send:""`; on-chain `CreateContract` panics unless exactly one ugnot is sent. `ServiceLane` uses hardcoded `MOCK_SERVICES` with fake addresses (`g1samouraicoop`, `g1frontenddev`). | `HireServiceModal.tsx:11`; `marketplace/builders.ts:29-39`; `contracts/memba_escrow_v1/escrow.gno:36-40`; `ServiceLane.tsx:8-39` |
| **NEW-FE-3** | **MED** | **`DeployAgentModal` is a fake transaction** — `setTimeout(1500)` → `onSuccess()`, broadcasts nothing, behind a real GNOT "Total Cost" + "Purchase Credits" UI. (The *real* credit path, `CreditSection.tsx`, is correctly fail-closed behind `AGENT_CREDITS_ENABLED` and uses `doContractBroadcast` — only the modal is a mock.) | `DeployAgentModal.tsx:42-45` |
| **NEW-FE-4** | **MED** | **`ActivationModal` bypasses `doContractBroadcast`** — calls `adena.DoContract(...)` directly (no RPC-trust / chain-id / A6 confirmation guard). Low value (1-ugnot self-send) but signs on an untrusted/wrong-chain RPC. | `ActivationModal.tsx:35` |
| **NEW-FE-5** | **LOW** | **Hardcoded fake marketplace stats** ("24.5k 24h Vol", "1,402 Active Listings") shown as live data. | `UnifiedMarketplace.tsx:42-51` |
| **NEW-FE-6** | **LOW** | **`VITE_ENABLE_TOKENS`/`VITE_ENABLE_AGENTS` are undocumented** (absent from `.env.example`) and **not in `SAFETY_GATED_FLAGS`**, despite gating money lanes with incomplete on-chain enforcement. `safeFlags` gates only `VITE_ENABLE_TREASURY_SPEND` + `VITE_ENABLE_AGENT_CREDITS`. | `.env.example`; `safeFlags.ts:17-18` |
| **NEW-FE-7** | **LOW** | **react-hooks compiler lint family globally disabled** ("temporarily", `dc97c17`) — masks the effect/state class that produced NEW-FE/CHN chain-id desync. | `eslint.config.js:23-29` |

### 3.2 New realms (won't-deploy / fund-trap)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **NEW-CHN-1** | **HIGH (latent-on-deploy)** | **`contracts/memba_escrow_v1/escrow.gno` cannot deploy on test13** — old stdlib: `runtime.OriginCaller()` (L34/73/109), `banker.OriginSend()` (L35), `banker.NewBanker(...)` no `cur` arg (L85/121), no `cur realm` params; non-deterministic `time.Now()` (L56). Same class as #621. Also: dead `"disputed"` status with no code path; no `seller != buyer`/non-empty validation. Its test mocks the **old** API so it was never validated against the live chain. | `contracts/memba_escrow_v1/escrow.gno` |
| **NEW-CHN-2** | **HIGH** | **`memba_token_otc_v1.Fill()` traps buyer overpayment forever** — accepts payment `>= cost`, routes exactly `cost` (fee + proceeds), never refunds excess; **no withdraw/sweep** in the realm. Deploys **unconditionally** via `deploy.sh:155`. | `samcrew-deployer .../memba_token_otc_v1/otc.gno:170-190` |
| **NEW-CHN-3** | **MED** | **`memba_token_otc_v1` int64 overflow** — `cost = qty * listing.UnitPrice` (L156) with no overflow guard; `ListTokens` only checks `>0`. A huge `UnitPrice`×`qty` overflows `cost` small/negative and breaks the payment floor check. (Realm vendors `onbloc/uint256` — use it.) | `otc.gno:156,51-55` |
| **NEW-CHN-4** | **MED (latent)** | **Phase 11/12 merge introduced the board desync** — `fc195cf` replaced a harmless `// TODO` stub with a live `import parent` + `parent.IsMember(addr)` the DAO never exports. Board+DAO won't compile/link. | `boardTemplate.ts:77,290` (added in `fc195cf`) |
| **NEW-CHN-5** | **LOW** | **OTC unbounded getters** — `GetListings()`/`GetListingsCSV()` full-tree O(N) (the code comment even flags it); gas ceiling / DoS. | `otc.gno:226-252` |

> **Positives on the OTC realm (correctly done):** CEI (state before coin send), admin/seller access control, `expectedUnitPrice` slippage guard, fee clamp→`DefaultFeeBPS` fallback, dust-fill guard, fee-on-transfer delta check, `checkErr` on transfers. It is a **narrow overpay/overflow fix**, not a rewrite.

### 3.3 Infra / release / backend (sprint)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **NEW-INF-1** | **MED** | **CI regressed to ~20 min** — `playwright.config.ts:13` `workers: CI ? 1 : undefined` reverted #599; E2E single-worker = 13.2 min = the whole matrix floor. The other Phase-0 wins (E2E/Lighthouse on Node-22 only) survive. | `playwright.config.ts:13`; recent `gh run` durations |
| **NEW-INF-2** | **MED** | **Litestream WAL-checkpoint race** — the app runs `PRAGMA wal_checkpoint(PASSIVE)` every 5 min and `TRUNCATE` on shutdown (`main.go:282-313`) *alongside* Litestream, which manages the WAL itself; an app-driven `TRUNCATE` can truncate frames before Litestream's final replication pass. Also: restore only triggers when the DB file is **absent** (not empty/corrupt), no `PRAGMA integrity_check` post-restore, and the old same-volume `VACUUM INTO` backup still runs (`main.go:138`, `BACKUP_INTERVAL=24h`) — redundant + still on the vulnerable volume. **No validated restore drill.** | `backend/litestream.yml`, `start.sh:6-12`, `main.go:138,282-313` |
| **NEW-INF-3** | **LOW** | `govulncheck`/`golangci-lint` reverted to `@latest` CLI in `ci.yml` (commit `8641ac1`) — inconsistent with the **pinned** cron (`govulncheck.yml:27` `@v1.3.0`). Go-version state is otherwise coherent (single `go-version-file` source; `go 1.25.11`). Minor `GOTOOLCHAIN` footgun for local devs on older Go. | `ci.yml:56,59` |
| **NEW-INF-4** | **LOW** | **5 deprecated pre-interrealm-v2 realms** (`escrow/`, `nft_market/`, `memba_dao_candidature/`, `memba_dao_channels/`, `gnobuilders_badges/`) are only doc-flagged (`DEPRECATED.md`) + gated behind `DEPLOY_DEFERRED=true`; `deploy.sh --deferred` would try to compile them and fail. Delete the deploy block, not just the doc. | `samcrew-deployer/projects/memba/deploy.sh:239` |
| **NEW-DOC-1** | **LOW** | No **v7.2.0 signoff report** (the `docs/reports/v7.1-phaseN-signoff.md` convention exists but wasn't continued); ROADMAP still lists Litestream as an *unmerged* "Next Priority" branch though `#692` is merged to `main` → ROADMAP stale. | `docs/reports/`; `ROADMAP.md:23` |

---

## 4. Consolidated & re-prioritized findings register

Severity reflects **live-vs-latent reality** after verification. **P0** = live fund-loss/auth-bypass/RCE · **P1** = high (latent-fund/injection/integrity) · **P2** = medium · **P3** = hygiene.

**Live / near-term (fix first):**
- **P1** NEW-CHN-2 OTC overpay trap (deploys unconditionally) · NEW-CHN-3 OTC overflow
- **P1** NEW-FE-1 ungated marketplace lanes · NEW-FE-2 revert-guaranteed HireService · NEW-FE-3 fake DeployAgent tx
- **P1** BE-1 MultisigInfo authz · BE-2 sig-verify log-only · BE-4 quest XP self-grant
- **P1** R2-GEN-A dead clamps + comment-injection + raw `threshold=0` (codegen fail-open)
- **P1** R2-CHN-E chain-id guard bypass · R2-CHN-G `fetchAccountInfo {0,0}`

**Latent-on-deploy (block the deploy paths, then fix):**
- **P1** NEW-CHN-1 `memba_escrow_v1` non-deployable · NEW-CHN-4 board desync
- **P2** CHN-1 offers stub (gated) · CHN-5/CHN-4 DAO voting/role · R2-CHN-B Render-as-ABI
- **P3** R2-CHN-A escrow-template double-refund (test-only, drift)

**Backend/infra hardening:**
- **P2** BE-3 completion-hash · BE-6 public `/metrics` · BE-7 hardcoded quest admin · NEW-INF-2 Litestream WAL race
- **P2** INF-1 unpinned deploy tooling · INF-2 no JS/TS SAST · NEW-INF-1 CI regression

**Hygiene / docs / DX:**
- **P3** INF-5 doc drift (test counts, API.md 12/38, AGENTIC.md) · NEW-DOC-1 no v7.2.0 signoff · NEW-INF-4 deprecated-realm deploy footgun · NEW-FE-5/6/7 fake stats / undocumented flags / disabled lint · FE-1 localStorage token · GNO_CORE breaking-change tracker stale (§5)

---

## 5. Upstream Gno breaking-change exposure

Recent `gno` master activity relevant to Memba (verified in the `gno` repo):

| Upstream | Nature | Memba exposure |
|---|---|---|
| **#5858** (Jun 25) `chain.emit` **hard-caps attr values → panic** instead of silent truncation | **State-breaking** | **Narrow, forward-looking.** Deployed realms emit via the migrated `chain.Emit`. The only realistically **user-controlled, unbounded** emitted value is `agent_registry` `AgentRegistered` → `"name"` (endpoint/version/pricing are length- or enum-capped). `collections.SetCollectionMeta` emits arbitrary `"value"` but is `assertPlatformAdmin`-gated. Reviews/candidature/token-OTC/feedback emit only bounded IDs/addresses. **Risk materializes on the next network running post-#5858 gno (mainnet / next testnet), not on current test13.** Action: cap emitted string lengths at the realm boundary before any mainnet redeploy. |
| **#5857** (Jun 25) `MaxEventAttrLen` 1024→4096 | Config | Raises the cap; pairs with #5858. |
| **#5385** `errors.Unwrap/Is/Join` added | Additive | None. |
| **#4951 / #5848** out-of-gas error UX | Non-breaking | None. |
| interrealm-v2 (`chain/runtime/unsafe`, `NewBanker(+cur)`, `cross(cur)`) | Already landed | **Deployed realms + `samcrew-deployer` are migrated and coherent.** Residual: the 5 deprecated v1 realms (NEW-INF-4) and the new `memba_escrow_v1` (NEW-CHN-1) are still on the old API. |

**Process finding:** `docs/planning/GNO_CORE_BREAKING_CHANGES.md` is **stale** (dated 2026-03-30 / v2.21.0; repo is v7.2.0). It tracks only boards2/govdao PRs and does **not** cover #5857/#5858 or reflect the completed interrealm-v2 migration. The team's upstream-tracking has fallen behind — re-baseline it (or fold into `GNO_CORE_COMPAT.md`) and add an event-attr row.

---

## 6. The AAA implementation plan

**Governing principle (revised):** *Contain the demo-grade marketplace and the wired-but-wrong realms first, then execute the (valid) backend-integrity and codegen-hardening waves.* Waves are **dependency-ordered, not time-boxed**. Wave 0 is a hard gate: no marketplace lane flips live and no `deploy.sh` runs until it closes.

### Wave 0 — Contain the sprint damage (release gate)

> Blast radius: 3 frontend components + 2 realms + 1 deploy script + 2 CI configs. Invasiveness: surgical. Risk: low. Nothing here adds features.

| Task | Addresses | Concrete change | Acceptance |
|---|---|---|---|
| **W0.1 Gate the unified marketplace** | NEW-FE-1 | Route `marketplace/*` through the `getLiveLanes()`/`isLaneLive()` gate (or delete the ungated `UnifiedMarketplace` in favor of the gated `MarketplaceHub`); each lane tab/route renders a `ComingSoonGate` when its `VITE_ENABLE_*` flag is off or its realm is not allowlisted. | E2E: direct-nav to `/marketplace/services|tokens|agents` with flags off → gated, not the live lane; unit test asserts `getLiveLanes()` is the single source. |
| **W0.2 Remove fake/reverting money flows** | NEW-FE-2, NEW-FE-3, NEW-FE-5 | Delete `MOCK_SERVICES` + fake stats; make `HireServiceModal` target the real escrow path and attach exact `send`, or hide the CTA until the services realm is real; replace `DeployAgentModal`'s `setTimeout` with the real `doContractBroadcast` path (reuse `CreditSection`) or hide it behind its flag. | No user-signable action can revert-by-construction; no hardcoded market data renders; a test asserts every marketplace "sign" builds a non-empty `send` where the realm requires coins. |
| **W0.3 Quarantine/fix the two broken realms** | NEW-CHN-1, NEW-CHN-4 | Either migrate `memba_escrow_v1` to interrealm-v2 (`unsafe.OriginSend`, `NewBanker(+cur)`, `cur realm` params, `runtime.ChainHeight` for time) **or** delete it and point services at deployed `escrow_v2`. Fix the board template to export `IsMember()` from the DAO (or drop `parent.IsMember`). | `templates.compile.test.ts` (made authoritative in W1) compiles both; no realm in `contracts/` uses old-stdlib symbols (grep gate). |
| **W0.4 Fix the OTC overpay trap + overflow** | NEW-CHN-2, NEW-CHN-3 | In `memba_token_otc_v1.Fill()`, refund `payment - cost` to the buyer (or require exact-coin and panic otherwise); guard `cost = qty*unitPrice` with checked/`uint256` math and clamp `unitPrice`/`amount` on list. **Do this before any `deploy.sh` run** (it deploys unconditionally). | New `otc_test.gno`: fund-conservation (Σ payouts + refund == Σ deposits); overpay refunded; overflow rejected. |
| **W0.5 Backend integrity batch** | BE-1, BE-2, BE-4 | Add the joined-membership check to `MultisigInfo`; enforce `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` **after** a one-time log-metric check that legitimate mismatch ≈ 0 (see the `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` brick warning — verify msg/fee shapes + golden A3 test first); change the `off_chain` quest default from auto-accept to proof/attestation-gated. | Non-member `MultisigInfo` → `PermissionDenied`; invalid sig rejected when enforced; off-chain quest without proof → no XP. Each with a rejection test. |
| **W0.6 Boot guard + secrets posture** | Cond-P0, BE-6, BE-7 | Refuse to boot if `FLY_APP_NAME` set and `MEMBA_ALLOW_UNSIGNED_AUTH=1`; set `METRICS_BEARER`; require `QUEST_ADMIN_ADDRESSES` in prod (no baked default). | Server exits on misconfig; `/metrics` 401 without bearer; no admin fallback in prod. |

**W0 DoD:** all tasks merged with tests; a **v7.2.x signoff report** (continuing the `docs/reports/` convention) recording the pre-enforce `multisig_sig_verify` mismatch metric and the OTC fund-conservation proof.

### Wave 1 — Codegen fail-closed + authoritative compile gate + governance

> Blast radius: `*Template.ts` generators + CI. Invasiveness: moderate (touches generated Gno semantics). Risk: medium (immutable-on-deploy).

- **W1.1 Fail-closed codegen** (R2-GEN-A): every generator calls `clampInt`/`isValidPercentage`/`isValidGnoAddress`/`sanitizeString` at the top and **throws** on invalid input; use `safeName` in comments (kills agent injection); reject `threshold=0`/`NaN`/negative/overflow. Add the `fast-check` property tests (dep already present, unused): ∀ valid ⇒ compiles, ∀ invalid ⇒ throws.
- **W1.2 Authoritative compile gate** (R2-GEN-D): install `gno` in the main CI image; forbid `templates.compile.test.ts` self-skip; replace fake `extract-contracts.ts` stubs with real generator output; lint DAO+board as one workspace so cross-realm errors (NEW-CHN-4) are caught.
- **W1.3 DAO governance hardening** (CHN-4, CHN-5): apply `assertRole` in `executeAddMember`; add a `MinVotingBlocks` floor (or explicit `Finalize()` post-period) so a single early vote can't lock the outcome; make the reject threshold symmetric and document ABSTAIN/quorum semantics; add `*_test.gno` proving each.
- **W1.4 Render pagination + structured reads** (R2-GEN-C, R2-CHN-B): unify pagination on `?page=N` clickable links; add versioned JSON exports (`APIVersion()`, `GetProposalsJSON`, `GetMembersJSON`) and have the frontend prefer them, treating `Render()` markdown as display-only (GRC721 already does this right — standardize on it).
- **W1.5 Companion-realm unification** (R2-GEN-B): pick one model (channels — the hardened, deployed path); migrate CreateDAO off `boardTemplate`; export `IsMember(addr) bool` and cross-call, or seed channel members from wizard config. Deprecate `boardTemplate`.
- **W1.6 Escrow template ↔ deployed parity** (R2-CHN-A drift, CHN-2): reconcile `escrowTemplate.ts` (double-refund `MsPending` logic) with the correct deployed `escrow_v2` (`MsRefunded` + guard); add a parity check so "fixed in template" == "matches on-chain".

**W1 DoD:** codegen is fail-closed + fuzzed; the compile gate is authoritative and non-skippable; every fund/governance Gno path has a test asserting fund-conservation + access control.

### Wave 2 — Frontend/backend hardening

- **W2.1 One guarded broadcaster + chain-id resync** (R2-CHN-E, NEW-FE-4): route *all* writes (DAO/board/plugin deploy, activation, multisig broadcast) through `doContractBroadcast`; fix `changedNetwork` to re-sync `_walletChainId` (pass the 3rd `chainId` arg). Test: post-network-switch wrong-chain sign is blocked.
- **W2.2 Account/sequence + error-aware ABCI** (R2-CHN-G, R2-CHN-D): `fetchAccountInfo` fails loud on transport error (never silent `{0,0}`); inspect `ResponseBase.Error` so "not deployed" ≠ "empty" ≠ "RPC down"; network-scope chain-derived caches.
- **W2.3 Backend** (BE-3, NEW-INF-2): reconcile `CompleteTransaction` hash against the chain (or store `verified=false`); **decide the Litestream/app-checkpoint ownership** — let Litestream own the WAL, drop the app's `TRUNCATE`-on-shutdown, add `integrity_check` post-restore + restore-on-empty, retire the redundant same-volume backup; **run a documented restore drill** (RPO/RTO).
- **W2.4 Money-path UI tests + multisig safety parity** (FE-6, R2-UX-A): add Vitest coverage for `ProposeTransaction`/`TransactionView`/`MultisigView`; bring multisig propose/sign/broadcast up to DAO-vote confirmation rigor (review card, full recipient, network indicator).

### Wave 3 — CI/supply-chain/SAST + docs truth

- **W3.1 Restore the CI win + pin tooling** (NEW-INF-1, INF-1, NEW-INF-3): set `playwright workers: 2` in CI; SHA-pin `setup-flyctl`; pin `govulncheck`/`golangci-lint`/`gno`/`gosec` consistently (reconcile `ci.yml` with the pinned cron).
- **W3.2 Real SAST** (INF-2): add CodeQL JS/TS; make the README "Security" badge truthful.
- **W3.3 Docs truth** (INF-5, NEW-DOC-1, §5): single CI-derived test count surfaced in README; regenerate `docs/API.md` from the 38-RPC proto; add dao-analyst to `AGENTIC.md`; re-baseline `GNO_CORE_BREAKING_CHANGES.md` (add #5857/#5858, interrealm-v2 done); write the v7.2.x signoff.
- **W3.4 Deploy hygiene** (NEW-INF-4): delete the `--deferred` deploy block for the 5 deprecated realms (don't just doc-flag).

### Wave 4 — Structural debt & product/UX/observability (continuous, non-gating)

Carry forward the 06-30 plan's Waves 4–6 where still valid: decompose god-files + drive down `any` and re-enable the disabled react-hooks lint (NEW-FE-7) behind tests; coordinate polling via React Query + Page-Visibility pause; route hot reads through the cached backend proxy; wire `ErrorBoundary → Sentry` + money-path chain-error logging + RPC/DB metrics; 4-mode IA (Wallet/Govern/Launch/Explore); accessibility to real AA (re-enable the axe rules). None gate Wave 0–3.

---

## 7. Sequencing

```
W0 (contain sprint damage) ── HARD GATE. Nothing ships live / no deploy.sh until closed.
   W0.1/W0.2 marketplace containment · W0.3 broken realms · W0.4 OTC · W0.5/W0.6 backend
        │
        ▼
W1 (fail-closed codegen + authoritative compile gate + governance) ◄ unblocks safe realm deploys
        │
W2 (guarded broadcaster · account/ABCI · backend · money-UI tests)  ‖ parallel with W1
        │
W3 (restore CI win · pin · SAST · docs truth)  ── cheap, high-leverage; W3.1 can go first
        │
W4 (structural/UX/observability)  ── continuous, non-gating
```

**Recommended first actions on approval:** W3.1 (restore `workers:2` + pin tooling — makes every later run fast and reproducible), then W0.1–W0.4 (contain the marketplace + fix the two realms + OTC), then the W0.5/W0.6 backend batch. **Freeze rule:** no marketplace lane flips live and no `deploy.sh` runs until W0 closes and the authoritative compile gate (W1.2) is green.

---

## 8. Quality gates / Definition of Done (every wave)

1. **Tested at the right layer** — fund logic has a Gno test asserting fund-conservation + access control; backend auth has a rejection test; money-path UI has a unit test. No fix lands on assertion alone.
2. **No user-signable action can revert-by-construction or broadcast nothing** — every "sign" builds a valid message against a deployed realm, attaching exact coins where required.
3. **Every route/lane behind a money flow is gated** by a flag *and* realm-allowlist check, verified by E2E direct-nav.
4. **Reproducible CI** — pinned tooling; the gate that would have caught the bug class now exists (authoritative compile gate, parity check, ungated-route E2E).
5. **No new immutable surface without a `realm-versions.json` entry** (deployer SHA + toolchain), and no realm in `contracts/` using old-stdlib symbols.
6. **Docs match code** — one test count, proto-derived API docs, current breaking-change tracker.
7. **Signoff artifact** per wave (goal vs outcome, PRs, metrics, residual risk) in `docs/reports/`.

---

## 9. Appendix — verification log (what was confirmed at source vs reported)

- **Deployed `escrow_v2` is NOT double-refund-vulnerable** — read `escrow_v2/escrow.gno:374-480` directly: `ResolveDispute`→`MsRefunded` (393), `CancelContract` guards terminal milestones (453,465). The buggy `MsPending` path is `escrowTemplate.ts:392,441`, whose generator `generateEscrowCode` is called **only** from `escrowTemplate.test.ts` + `templates.compile.test.ts` (no app deploy caller).
- **Offers stub gated** — `memba_nft_offers_v1` absent from `config.ts:216-245` allowlist.
- **Deploy-frontend prod risk refuted** — `deploy-frontend.yml:86` `if: ${{ false }}`.
- **CI regression cause** — `playwright.config.ts:13` `workers: CI ? 1 : undefined`.
- **OTC overpay** — `otc.gno:170-190` routes exactly `cost`, no refund/sweep; deploy path `deploy.sh:155`.
- **`memba_escrow_v1` old-stdlib** — `runtime.OriginCaller()`/`banker.OriginSend()`/`NewBanker` no-`cur`/`time.Now()`.
- **Board desync introduced by `fc195cf`** — `boardTemplate.ts:77,290`.
- **Upstream #5858 emit hard-cap** — read `gno` commit `036f7eb54`; Memba exposure = `agent_registry` `AgentRegistered` `"name"`.
- All backend/BE-* and INF-* items re-read at the cited `file:line` on `main` @ `9ff6595`.

*Prepared 2026-07-01 as an independent skeptical re-verification (four parallel domain audits + cross-repo upstream-gno pass), correcting and extending the 2026-06-30 cross-perspective audit. Effort is described in blast-radius/invasiveness/risk terms so the plan can be executed by autonomous agents or humans without re-baselining.*
