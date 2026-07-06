# Memba Long-Term Roadmap & Implementation Plan — Program "Compound"

**Date:** 2026-07-03 · **Status:** PROPOSED (awaiting owner sign-off) · **Supersedes:** `MEMBA_VERIFIED_AUDIT_AND_AAA_PLAN_2026-07-01.md` §6.4+ forward-looking sections (Waves 0–4 of that plan are DELIVERED as of PR #732; this document is the successor program and owns Waves 5+).

**Baseline at time of writing (updated 2026-07-03 evening):** Memba `main` = `6311ac2` — the day closed with #734 (A3 golden parity: flip now metric-gated), #736 (NetworkSync first-visit reload fixed, e2e `workers: 2` restored → O-5 closed), and #737 (react-hooks ratchet 56→52 → O-9 in motion) all merged. samcrew-deployer `main` = `31f7597` (W3.4, #55). Upstream gno = `dfe49509f` — no breaking changes for test13 realms since go-live. 12 realms live-verified on test13 (2026-06-28). 0 open Dependabot alerts. Lane C's per-signature-verified work remains active in its worktree.

**Review provenance.** This plan was hardened by five independent expert review passes before submission — security/fund-safety, Gno/realm engineering, frontend/UX/product, infra/CI/ops, and product strategy — each verified against the live codebases (not just this document). Their material findings are folded in throughout and the two discovered code-level issues are tracked as O-13/O-14 in §1.2.

**Guiding thesis.** Memba's identity is **multisig / DAO / governance on Gno**. Everything that strengthens that identity — stability, discoverability, marketplace-as-treasury-utility, governance-driven moderation — ships direct. Everything that could dilute it — DEX, app store, playground — gets a time-boxed spike and an explicit go/no-go, never open-ended engineering. With one tech lead + two parallel Claude sessions, the enemy is WIP sprawl: every wave has exactly two lanes and a hard exit gate.

---

## Table of contents

- [Part 1 — Current-state audit (2026-07-03)](#part-1)
- [Part 2 — Wishlist scoring & prioritization rationale](#part-2)
- [Part 3 — Wave plan (W5–W9), per-item execution detail](#part-3)
- [Part 4 — Architecture annexes (Feed, Explorer, App Store, AMM)](#part-4)
- [Part 5 — Process-by-design (standing rules)](#part-5)
- [Appendix A — Owner (user) action checklist](#appendix-a)
- [Appendix B — Spike document template](#appendix-b)
- [Appendix C — Parallel-session sync protocol](#appendix-c)

---

<a name="part-1"></a>
## Part 1 — Current-state audit (fresh, 2026-07-03)

### 1.1 What is healthy

| Area | Evidence |
|---|---|
| Waves 0–4 remediation | #696–#732 merged; final review `docs/reports/v7.2.x-final-review-2026-07-03.md` |
| Deploy pipeline | deployer W3.4: `--deferred` path deleted (hard-fail); `verify-client-templates` fail-closed (`REQUIRE_GNO=1`); escrow parity script with 7 invariants incl. contract-level dispute freeze |
| Chain deps | gnodaokit pinned `pr-64` (test13-ported); tokenfactory_v2 live (never redeploy); upstream gno in sync, no test13-breaking commits Jun 16 → Jul 3 |
| Security posture | CodeQL JS/TS + Go live; gosec/govulncheck/golangci/flyctl pinned; prod unsigned-auth enforcing; 0 Dependabot alerts |
| Test base | ~705 frontend test files, 64 backend Go test files, 27 Playwright specs; CI required checks green |

### 1.2 Open items carried into this program

| # | Item | Severity | Disposition |
|---|---|---|---|
| O-1 | **A3/BE-2 multisig enforcement flip** (`MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1`) | CRITICAL | **Code-side RESOLVED 2026-07-03 — #734 merged** (`10a8a96`: golden sign-byte parity for the frontend's stored multisig shapes + boot-sweep mismatch counter, readout documented in OPS_RUNBOOK §2.1). Remaining step is **owner-only and metric-gated**: flip when the boot sweep reads `mismatch=0` on recent rows (rollback = unset the var; unset IS log-only). The flip going live is the **hard entry gate for Wave 8** (Appendix A U-3). This program still never touches auth/sig paths. |
| O-2 | Per-signature verified flag (proto + migration 018 + UI) | HIGH | Externally owned (Lane C, branch `fix/per-signature-verified-flag`). Reference only. |
| O-3 | **Litestream restore drill never executed** — OPS_RUNBOOK §4.7 RPO/RTO placeholders | HIGH (ops) | Owner action (Appendix A). Prerequisite for Wave 8. |
| O-4 | `METRICS_BEARER` / `QUEST_ADMIN_ADDRESSES` unset in prod | HIGH (ops) | Owner action (Appendix A). Prerequisite for W6.5 metrics work. |
| O-5 | Playwright `workers: 1` in CI (~5 min/run tax) | MED | **CLOSED 2026-07-03 — #736 MERGED** (`077e050`): root cause was NetworkSync reloading on every first visit; fixed (reload only on real network change, decision-table tests added) and `workers: 2` restored. W5.4 reduces to its DoD verification (3 consecutive green CI runs); Lane B starts at W5.5. |
| O-6 | NFT v3.1 RegisterMarket state ambiguity: Memba `safeFlags.ts` (2026-06-27) says engine "deployed, registered, and verified on test13"; deployer branch `feat/nft-register-market-v3` is still unmerged | MED (truth) | W5.5 — **reconcile**, don't assume: qeval the registration on-chain; if registered, merge/close the deployer branch and log in `realm-versions.json`; if not, run the ceremony (owner co-signs). |
| O-7 | `docs/planning/GNO_CORE_BREAKING_CHANGES.md` currency | MED | **Correction:** #730 (W3.3) had already re-baselined it (event-attr rows, interrealm-v2 marked complete) before this program's audit ran — the "stale since 2026-03-30" finding was outdated. **W5.6 (done) adds the remaining gap:** the Jun 16 → Jul 3 upstream sweep (NewBanker `IsCurrent()` caller-drain rule, `realm.Sub` availability, AddPackage production-file strictness) with SHAs fact-checked against the gno repo. |
| O-8 | Quest verifiers ~40% stubbed; badges never minted (`gnobuilders_badges_v2` TotalSupply=0) | MED | W8.3. |
| O-9 | react-hooks ratchet: 56 `set-state-in-effect` warnings → 0 → flip rule to `error` | LOW | Ratchet lane (continuous). **In motion: #737 MERGED 2026-07-03 (56→52, src/hooks, +440 lines of pinning tests).** |
| O-10 | W4 remainder: god-file decomposition + `any` reduction; Sentry + RPC/DB metrics; 4-mode IA; a11y AA (re-enable axe) | MED | IA + Sentry/metrics = W6; god-files/`any`/a11y = Ratchet lane. |
| O-11 | Legacy realm deploy-block cleanup fully done (deployer #55) | — | CLOSED (verified). |
| O-12 | `VITE_ENABLE_NFT` missing from `.env.example` | — | CLOSED (present at `.env.example:36`; removed from SAFETY_GATED_FLAGS 2026-06-27 with rationale comment). |
| O-13 | **`agent_registry.DepositCredits` reads `unsafe.OriginSend()` without an `IsUserCall()` guard** (`agent_registry.gno:202–217`) — an ephemeral `maketx run` realm can deposit coins that become permanently unrecoverable. Currently harmless in practice because the credits UI is flag-gated off, but the deployed realm is exposed. | HIGH (latent fund loss) | **W8.1 prerequisite:** hardened `agent_registry` (guard added, adversarial test) deployed as a new version BEFORE `VITE_ENABLE_AGENT_CREDITS` de-gates. Found in the security review pass of this plan. |
| O-14 | No DAO v1→v2 migration story for the banker rollout — `memba_dao` v1 (live since 06-16) has no banker; a v2 template alone leaves v1 DAOs as zombies with stuck deposits | HIGH (governance/funds) | W8.1 PR0 (migration pattern decision — see W8.1). |

### 1.3 Fund-safety gates (unchanged, restated)

- `VITE_ENABLE_TREASURY_SPEND` — **stays in `SAFETY_GATED_FLAGS`**. The DAO template has **no banker**: enabling spend UI today would invite deposits that are permanently unrecoverable. De-gate criteria in W8.1.
- `VITE_ENABLE_AGENT_CREDITS` — stays gated until the agent-credits e2e in W8.1 passes.
- Build-time enforcement: `assertSafeFlags` fails any prod build with a gated flag set, from any env source including the Netlify dashboard.

---

<a name="part-2"></a>
## Part 2 — Wishlist scoring & prioritization rationale

Impact = contribution to Memba's positioning (multisig/DAO first; testnet demo quality second; mainnet prep third). Effort: S<1d, M=1–3d, L=1–2wk, XL=multi-week. Risk includes fund safety.

| # | Item | Impact | Effort | Risk | Blockers / deps | Verdict |
|---|---|---|---|---|---|---|
| F-7 | Adena stability (account-change listener, reconnect, idle handling) | HIGH — every flow passes through the wallet | S | Low | none | **P0 · W5.1 ship-direct** |
| F-8 | Directory: Packages tab first; fix "Source not available" (gnoweb endpoint config + fallback) | HIGH — broken source views on an explorer-identity product | M | Low | none | **P0/P1 · W5.2** |
| F-6 | Validator review stars + hover comments | MED — visible polish; realm already live | S–M | Low | batch summary fetch design | **P1 · W5.3 quick win** |
| — | Playwright workers>1 | MED — compounding CI-velocity win | S–M | Low | identify flaky specs | **P1 · W5.4** |
| F-5 | Changelogs auto-updated | MED alone; HIGH in the compounding loop | S–M | Low | none | **P1 · W6.1** |
| F-12 | SEO (per-route meta, sitemap, robots, JSON-LD) | HIGH long-term — SPA is invisible today | M | Low | 4-mode IA first (stable URLs) | **P1 · W6.3** |
| F-11 | Blog + 3 articles | MED–HIGH — content fuels SEO | S infra + M content | Low | W6.1 + W6.3 | **P1 · W6.4** |
| — | 4-mode IA (Wallet/Govern/Launch/Explore) | HIGH — the nav IS the positioning statement | M–L | Med (URL churn) | before SEO meta hardens | **P1 · W6.2** |
| — | Sentry + RPC/DB metrics | MED–HIGH — no blind mainnet prep | M | Low | O-4 owner action | **P1 · W6.5** |
| F-1 | Marketplace finish/polish (inventory UI, buy/offer UX, AgentLane) | HIGH — treasury-utility story; v3.1 live | L (sliced) | Med | OTC-enforcement branch in flight — coordinate | **P1 · W7.1** |
| F-3 | Social feed `/feed` + DAO moderation board (+ audio) | HIGH — moderation board is a governance showcase | M per slice / L total | Med (abuse, content policy) | channels_v2 patterns; new realm | **P1 slice 1 · W7.2; moderation W8.2; audio P3** |
| F-13 | Testnet activity bot (tx / NFT sales / volume) | MED — makes demos alive | M | Med (key handling) | live marketplace paths | **P2 · W7.3** |
| — | Fund-safety program (banker → TREASURY_SPEND → AGENT_CREDITS) | CRITICAL for identity | L | **HIGH — unrecoverable deposits if flipped early** | HARD GATE: O-1 flip + O-3 drill | **P1 importance · W8.1 by dependency** |
| F-10 | Gnoweb-like "Memba Explorer" | MED–HIGH — natural Directory extension; seeds exist | L | Low | W5.2 first | **P2 · W9 spike → likely build** |
| F-4 | App Store for Gno dApps/games (paid listings) | MED — differentiator, zero seed; "paid" = money path | XL | Med–High | fund-safety for the fee path | **P3 · W9 spike (build-small candidate)** |
| F-9 | Gno Playground | LOW–MED — duplicates play.gno.land | L–XL | Low | — | **P3 · W9 disposition doc; default: link out** |
| F-2 | DEX & AMM (PancakeSwap-like) + Morpho-like lending | Strategic bet, weak identity fit today; competing Gnoswap solo on testnet is a strategy risk | XL | **HIGH (funds, AMM math, oracle-less lending)** | fund-safety program complete; spike data | **P3 · W9 AMM P0 spike decides; lending DEFERRED indefinitely** |

**Prioritization rationale (explicit):**

1. **Stability before growth.** Adena disconnects and broken Directory source views degrade 100% of sessions; nothing built on top matters until they're fixed. → Wave 5.
2. **The compounding loop ships as one wave.** Changelog automation feeds the blog, the blog feeds SEO, SEO makes every later feature discoverable. Splitting them across months wastes the compounding. → Wave 6, with IA first so SEO never indexes URLs that immediately churn.
3. **Money-paths are calendar-gated, not wish-gated.** Anything touching funds (treasury spend, agent credits, paid listings, AMM) sits strictly behind: enforcement flip live + restore drill passed + fund-recovery e2e on a throwaway realm. That mechanically lands them in Wave 8+, regardless of desirability.
4. **Spike-first for the XL bets.** DEX, app store, explorer, playground each get a fixed-cost spike producing a go/no-go doc. Defaults going in: explorer = likely go; app store = build-small, curated, unpaid-first; playground = no-build (link out to play.gno.land); AMM = data decides; lending = no (no honest oracle on a testnet).
5. **Solo-maintainer math.** Two sessions ≈ two lanes. Each wave = Lane A + Lane B + a background ratchet. Anything that would create a third concurrent workstream is queued, not started.

---

<a name="part-3"></a>
## Part 3 — Wave plan

**Lane model.** Lane A = frontend/product session. Lane B = backend/realm/infra session. **Lane C = the parallel session that owns multisig auth/sig work (#734, per-sig verified flag) — this program never edits those paths.** Ratchet lane = standalone, independently mergeable PRs (god-file decomposition, `any` reduction, react-hooks warning burn-down, a11y) attached to whichever session has slack.

**Wave exit gate (identical for every wave):** all lane PRs merged via owner approval · frontend `npm run build` + backend `go build ./... && go vet ./...` green · full Playwright suite green on the **Node-22 CI leg** (the leg that runs E2E; required-check names are exact-match in branch protection) · `CHANGELOG.md` + memory updated · wave retro appended to this doc. No Wave N+1 PRs opened before the Wave N gate passes (spikes exempt — they produce docs, not code).

### Wave 5 — Stabilize & Unblock (P0/P1, ~1 week)

**W5.1 Adena stability** *(Lane A)*
- Ground truth (review-verified): `Adena.On("changedNetwork")` is already wired in `useAdena.ts:389–436` (fail-closed RPC trust re-validation) and `On("changedAccount")` in `Layout.tsx:210–224` (auth/disconnect cleanup); silent reconnect exists. So this is a **diagnosis + hardening** task, not listener discovery.
- PR1: instrument and diagnose the actual disconnect triggers (wallet lock/unlock, extension service-worker sleep, tab restore, network switch race) — add lightweight session-event logging behind dev flag; reproduce the "frequent disconnect" report.
- PR2: harden the identified paths — idle/stale-connection recovery, retry-on-lock-wake, a single non-spammy toast on hard disconnect; never leave a stale address rendered.
- PR3: hook state-machine unit tests (switch account, lock/unlock, network change, tab sleep).
- **Lane C coordination:** `useAdena.ts` is split-ownership — connection/account-change logic is Lane A; the signing-call paths (`SignMultisigTransaction`) are Lane C. Register in SESSION_SYNC before touching.
- **DoD:** the reproduced disconnect scenarios recover without manual reconnect; account switch updates UI ≤1s; no stale-address multisig proposal possible. **Verify:** manual matrix + unit tests. **Flag:** none. **Docs:** ARCHITECTURE.md wallet section + CHANGELOG.

**W5.2 Directory fixes** *(Lane A)*
- PR1: tab order — Packages first (owner directive: it is the most-filled tab today; current order is DAOs → Tokens → Packages → …, `Directory.tsx:30–38`), then DAOs, Realms, Tokens, Users, GovDAO, Leaderboard. Revisit once DAO count catches up.
- PR2: gnoweb endpoint made env-configurable with an ordered fallback host list per network; remove any deprecated `*.test-13.gnoland.network` references; graceful "source unavailable" state with a retry button; harden `gnowebSource.ts` parsing (tolerate markup changes, fail per-file not per-realm).
- PR3: Playwright spec asserting Source + Info render for 5 known-good test13 realms.
- **DoD:** zero "Source code not available"/"Source metadata not available" for known-good realms. **Verify:** e2e spec. **Flag:** none. **Docs:** endpoint table in `GNO_CORE_COMPAT.md`.

**W5.3 Validator review stars** *(Lane A)*
- Ground truth: `fetchSummary()` (`lib/reviews.ts:189–197`) is one qeval per validator — fine for a first ship (lazy/viewport-scoped fetch), but a 50-row table means 50 calls.
- PR1: star column in `Validators.tsx` (widen table per owner's note) with lazy per-row summary fetch (visible rows only, cached).
- PR2: hover card with the 2–3 most recent review comments (reuse `ReviewsSection` primitives).
- PR3 (optional, only if latency is visible): add a batched `GetSummariesJSON([addrs])` entrypoint to the reviews realm — **realm change ⇒ deployer PR + owner deploy**; do NOT block PR1/2 on it.
- **DoD:** stars render for visible rows without jank; hover shows comments. **Flag:** existing `VITE_ENABLE_REVIEWS`. **Docs:** CHANGELOG.

**W5.4 Playwright parallelism** *(Lane B)*
- Prior art (review-verified): **PR #599 already attempted `workers: 2`** — live-RPC specs (validators/dao/directory/gnolove) were serialized because parallel workers double-load the public test13 RPC; it was still rolled back because first-attempt pass-rate regressed. The config comment sets the rollback threshold: ">5pp first-attempt regression".
- PR1: measure the **post-#599 residual flake** (3× local full-suite runs at workers=2; capture which specs regress and why — RPC rate-limiting vs state bleed).
- PR2: fix the residual causes (mock/live split, per-spec RPC budget, or dedicated serial project) and re-enable `workers: 2`; record wall-time delta.
- **DoD:** 3 consecutive green CI runs at workers>1 with first-attempt pass-rate within 5pp of the workers=1 baseline. **Docs:** E2E_TEST.md. This is the **first Lane B item** — every later wave inherits the CI-velocity win.
- **Status (2026-07-03): #736 MERGED** — root cause fixed (NetworkSync first-visit reload; reload now only on real network change) and `workers: 2` restored. This item is reduced to the DoD verification (3 consecutive green runs on main).

**W5.5 NFT v3.1 registration reconcile** *(Lane B)*
- Query on-chain (qeval `memba_collections` market registration). If registered: update `realm-versions.json`, close/merge deployer branch `feat/nft-register-market-v3`, log in DEPLOYMENT_RUNBOOK. If not: prepare ceremony dry-run; **owner executes**.
- **DoD:** on-chain state, deployer branch, and docs all agree.

**W5.6 GNO_CORE_BREAKING_CHANGES refresh** *(Lane B, filler)*
- Re-baseline: NewBanker `IsCurrent()` requirement (Jun 26), `realm.Sub()` introduction, AddPackage production-file strictness, event-attr changes; cross-link `GNO_CORE_COMPAT.md`.

**Owner checklist for this wave: Appendix A items U-1..U-4.**

### Wave 6 — Identity & Discoverability (P1, ~1.5–2 weeks)

Ordering rule: **W6.2 IA merges before W6.3 SEO meta; W6.3 before the W6.4 announcement article.**

**W6.1 Changelog automation** *(Lane B)*
- PR1: **define the parse contract first** — current `CHANGELOG.md` has no front-matter or category markers; add a minimal convention (`<!-- categories: memba, network, gno-core -->` under each `## [vX.Y.Z] — date` heading, or `### [tag] Title` sections) and normalize existing entries in the same PR.
- PR2: build-time loader parsing root `CHANGELOG.md` (and `changelogs/*.md` history) into typed entries against that contract, with a parser unit test on the real file; delete the hardcoded `ENTRIES` array in `frontend/src/pages/Changelogs.tsx`.
- PR3: CI check — PRs touching `frontend/`/`backend/` must add a CHANGELOG entry (skippable via label `no-changelog`). **The check name must be coordinated with branch protection (owner edits the required-checks list — exact-name matching, same constraint as the pnpm-workspaces job).** Backfill entries for any W5 PRs that predate the gate.
- **DoD:** adding a CHANGELOG line appears on `/changelogs` with zero code changes; parser test green on the live file. **Docs:** CONTRIBUTING changelog policy.

**W6.2 4-mode IA** *(Lane A)*
- Scope honesty: the app uses legacy `<BrowserRouter>` + JSX `<Routes>` on react-router 7 — the IA work is **route regrouping in JSX, NOT a data-router migration** (a previous data-router attempt was a documented dead end; do not reopen it here). URL stability comes from naming discipline, not router architecture.
- PR1: nav shell + route grouping (no page moves yet); PR2–4: one mode per PR (Wallet / Govern / Launch+Explore) with redirects from all old URLs; PR5: nav e2e.
- **DoD:** every old URL redirects; zero orphan pages; `navManifest.ts` stays the single source of truth. **Docs:** DESIGN_SYSTEM nav section.

**W6.3 SEO** *(Lane A after IA; Netlify plumbing Lane B)*
- PR1: per-route `<title>`/meta/OG via a route-meta map + a small helmet-style util (generalize the gnolove `PageMeta` pattern app-wide).
- PR2: `sitemap.xml` + `robots.txt` at build — **hybrid strategy**: static entries from `navManifest.ts` (~18 top-level routes) + top-N dynamic entities (DAOs, tokens, validators) fetched from the backend at build time; exclude deep parameterized routes.
- PR3: JSON-LD (Organization, SoftwareApplication, BreadcrumbList) on key routes; evaluate Netlify prerendering for crawler UAs — a pure SPA's meta is only reliably read by Google's second-wave rendering, so record the prerender decision explicitly (it determines how fast W7 features become discoverable).
- **DoD:** Lighthouse SEO ≥95 on 5 key routes; sitemap validates; OG cards render in link previews. **Docs:** new `docs/features/SEO.md`.

**W6.4 Blog** *(Lane A — overlaps into W7, see gate note)*
- PR1: `/blog` list + article routes reusing the W6.1 markdown loader (`frontend/content/blog/`); PR2–4: one article each — gno core activities/news, Memba vision, Memba features — **drafted by sessions, approved by owner before merge** (voice-sensitive); PR5: RSS feed.
- **Compounding rule:** article 1 (Memba features — the discovery hook) must be live **before W7.1 closes**, so the SEO/content loop is running when the marketplace/feed ship; articles 2–3 may finish during W7.
- **DoD:** 3 articles live, in sitemap, OG cards correct.

**W6.5 Sentry + metrics** *(Lane B)*
- Ground truth (review-verified): the frontend Sentry SDK is **already shipped** — `Sentry.init()` in `main.tsx` (DSN-conditional), ErrorBoundaries call `captureException`, vite uploads sourcemaps. PR1 is therefore a verification/extension pass (coverage of money-path errors, release tagging), not an integration.
- PR2: backend RPC/DB duration histograms on `/metrics` — **hard-blocked on U-2** (`METRICS_BEARER` set in prod; today unset ⇒ endpoint would be publicly scrapable). Do not open PR2 until U-2 is done.
- PR3: alert-threshold doc in OPS_RUNBOOK.
- **DoD:** a thrown test error appears in Sentry with release tag; `/metrics` returns histograms in prod, bearer-protected.

### Wave 7 — Marketplace & Social v1 (P1/P2, ~2 weeks)

**Pre-W7 money-path readiness check (visibility gate, not a freeze):** W7 ships **no new deposit paths** — W7.1 marketplace polish is read-only UX over already-live lanes, and W7.2 feed moves no funds. Before W7 starts, the owner confirms the W8 gate trajectory (U-1 drill scheduled/done, U-3 flip status via #734). If neither has moved, W7 still proceeds (it's fund-safe by construction) but W8 formally slips and the W9 spikes are pulled earlier. Blog article 1 (W6.4) must be live before W7.1 closes.

**W7.1 Marketplace polish slices** *(Lane A)*
- Coordination rule: the in-flight OTC-enforcement branch (`feature/phase11-otc-enforcement`) merges first, or Lane A rebases on it.
- PR1: inventory management ("my listings": cancel/edit/delist). PR2: buy/offer UX polish + empty/error/loading states across lanes. PR3: AgentLane — de-stub with real registry reads, or remove the placeholder outright (no fake UI). PR4: e2e full lifecycle list→buy→inventory.
- **DoD:** complete NFT lifecycle from UI without console usage. **Flags:** existing marketplace flags only.

**W7.2 Feed slice 1 (realm P0 + UI MVP)** *(Lane B realm/backend, Lane A UI)* — architecture in Part 4.1
- PR1 (deployer): `memba_feed_v1` realm template + adversarial test battery (b-series convention) — post/reply/repost/follow/flag, render windows, rate limits.
- PR2 (backend): indexer dispatcher (`PostCreated/Reposted/Followed/Flagged/ModAction`) + `feed_rpc.go` (home timeline, profile timeline, thread).
- PR3 (frontend): `/feed` route behind **`VITE_ENABLE_FEED`** (ordinary flag — no funds; add to `.env.example`): timeline, composer with optimistic insert + reconcile, flag button.
- PR4: e2e post/flag spec against test13.
- **DoD:** post, reply, flag round-trip on test13; rate-limit errors surfaced gracefully. **Deploy:** owner-executed via deployer once the compile gate + smoke probes pass. Audio/media = W8+ (Part 4.1 P2).

**W7.3 Activity bot** *(Lane B)*
- PR1: Go bot (`backend/cmd/activitybot`) with scenario config (transfers, listings, buys, feed posts), `--dry-run`, and **explicit safety constants**: `MaxTransfersPerDay` (~100), `MaxGasPerTx`, `MaxBotBalance` (faucet-scale; refund excess), kill-switch `ACTIVITYBOT_ENABLED` (bot exits cleanly after the in-flight tx, never mid-batch panic).
- Key SOP: keypair generated fresh for test13, stored only in `flyctl secrets` (`ACTIVITYBOT_PRIVKEY`); public address logged at startup; rotation = kill job → new keypair → new secret (monthly or post-incident). Never in the repo, never reused.
- PR2: runbook — **Fly has no declarative cron in `fly.toml`**; schedule via `fly machines run` or a GitHub Actions `schedule:` job calling a trigger, or plain manual runs. Explicitly testnet-only.
- **DoD:** 24h run produces visible activity, zero errors, bot wallet holds only faucet funds, kill switch verified.

### Wave 8 — Money-path & Fund Safety (hard-gated, ~2 weeks)

**HARD ENTRY GATE:** A3 enforcement flip live in prod (#734 merged — flip is now the metric-gated owner action U-3: boot sweep `mismatch=0` → set the var per `MULTISIG_ENFORCE_RUNBOOK.md`) **and** first restore drill logged (U-1). If the gate isn't met, Wave 9 spikes run early instead — money-path work is never started "optimistically."

**W8.1 Fund-safety program** *(Lane B)*
- PR0 (decision doc): **DAO v1→v2 migration pattern** — the live `memba_dao` v1 has no banker; a v2 template alone strands v1 DAOs. Recommended: Option A — deploy `memba_dao_v2` as a new realm path; v1 instances become read-only governance archives with a documented one-time membership handoff ceremony (owner co-signs); `realm-versions.json` marks v1 "feature-frozen, superseded for fund-aware DAOs". Alternative (Option B): add a governance-voted `MigrateTreasury` proposal type to v1. Owner picks in PR0 review.
- PR1 (deployer): banker support in the DAO template as a **new realm version** (never redeploy tokenfactory_v2; never mutate deployed realms) + parity/adversarial tests. **Banker checklist (applies to every banker-using realm in this program — DAO v2, app store, wugnot fallback):** `NewBanker(RealmSend/…)` must be constructed with `cur` (`IsCurrent()==true`), never `cur.Previous()` — the upstream caller-drain fix (`7cb5a01e9`) makes the wrong shape a drain vulnerability; OTC (`otc.gno:194`) is the correct in-house precedent.
- PR2 (deployer): **hardened `agent_registry`** — add the missing `IsUserCall()` guard before `unsafe.OriginSend()` in `DepositCredits` (O-13) + adversarial test (ephemeral-realm deposit must panic); deploy as new version; frontend repointed.
- PR3: treasury-spend proposal type UI (behind the still-gated flag).
- PR4: e2e on a throwaway DAO on test13 — deposit → propose spend → execute → verify balances.
- PR5: remove `VITE_ENABLE_TREASURY_SPEND` from `SAFETY_GATED_FLAGS` (with the dated rationale comment, matching the NFT precedent) + enable.
- PR6: same pattern for `VITE_ENABLE_AGENT_CREDITS` — **only after PR2's hardened registry is live** + credits deposit/use/refund e2e.
- **DoD:** funds deposited into a fresh DAO are provably withdrawable via proposal *before* any flag flips; ephemeral-realm deposit attack test passes (panics). **Docs:** MULTISIG_ENFORCE_RUNBOOK cross-ref; PROGRESSIVE_DECENTRALIZATION update.

**W8.2 Moderation board** *(Lane A)* — architecture in Part 4.1
- PR1: flagged-content queue page reading feed/channels flags. PR2: daokit `moderator` role-gated actions (hide/restore/ban) with every action `chain.Emit`-audited. PR3: public audit-log view + short published moderation policy.
- **DoD:** flag → queue → action → audit round-trip on test13.

**W8.3 Quests & badges closeout** *(Lane B)*
- PR1–2: implement the top stubbed verifiers (prioritize by quest visibility). PR3: badge mint ceremony prep; **owner executes** per `BADGE_MINT_RUNBOOK.md`.
- **DoD:** leaderboard reflects real verifications; first badges minted on-chain.

### Wave 8.5 — Mainnet readiness track (parallel, owner-led, non-blocking)

Runs alongside W8–W9; sessions produce docs/tooling, the owner runs the external motions:
- **Migration story:** testnet→mainnet runbook — what carries over (DAO state, XP/badges, NFTs, listings), what resets, and the cutoff/announce plan (session-drafted, W9 close).
- **Validator relations:** Memba's validator features (table, reviews, hacker mode) as the wedge — outreach list + onboarding one-pager (owner).
- **Revenue/treasury:** fee-lane revenue dashboard (indexer already sees every fee event — small `revenue_rpc` + page or an ops query doc); owner sets the treasury fee policy per lane (U-8).
- **Regulatory scan:** one-page jurisdiction posture memo (external counsel input; owner).
- **Growth loop (ratchet, W6–W7):** landing/OG polish rides W6.3; announce pipeline = changelog→blog→RSS (W6); a "first 100 users" motion defined by the owner (U-10) — direct outreach to Gno builder community, quests as the on-ramp.

### Wave 9 — Platform Bets (spike week + one build, ~2 weeks)

Week 1 — four spike docs in `docs/planning/spikes/` (template: Appendix B), owner decides go/no-go per spike. **Each spike carries explicit GO/KILL thresholds — "data decides" is a decision rule, not a deferral:**

| Spike | Box | GO threshold | KILL threshold |
|---|---|---|---|
| `SPIKE_GNOWEB_EXPLORER.md` | 2d | qfile/qfuncs proxy extension works read-only; median render <2s on test13 | proxy allowlist can't stay read-only-safe, or source parsing needs per-realm hacks |
| `SPIKE_APP_STORE.md` | 1d + 1 afternoon fee-path P0 | fee→treasury verified on test13 incl. `IsUserCall` guard + treasury-misconfig handling + concurrent-registration check; ≥5 plausible launch listings identified | fee path needs custody/escrow to be safe, or <5 real dApps exist to list |
| `SPIKE_AMM_P0.md` | 3–4d — one hardcoded pair on test13 | measured swap gas ≤ Gnoswap comparable; wugnot usable (confirmed present upstream: `r/gnoland/wugnot`) or trivial fallback; allowance UX ≤2 approvals per LP add | gas ≥ Gnoswap with no UX win — do not ship a slower me-too DEX; deepen the gnoswap plugin instead |
| `SPIKE_PLAYGROUND_DISPOSITION.md` | 0.5d (disposition memo only — the ~1wk figure in 4.2 is the *build* scope if reversed) | n/a — default NO-BUILD | n/a |

**AMM strategic framing (owner call U-6a, before the spike):** decide whether the AMM is a core identity pillar (then the spike measures *how*, and P1 proceeds even at gas parity if the UX/integration story wins) or an option (then the KILL threshold above is binding). The spike is a shipping decision, not an exploration.

Week 2 — build the single highest-value "go" as the main lanes (predicted: Memba Explorer). If it finishes early, the App Store P0 fee-path afternoon may run as a Ratchet-lane item; everything else becomes a Wave 10+ candidate or is formally closed with a dated decision note.

---

<a name="part-4"></a>
## Part 4 — Architecture annexes

Grounding constraints that shape all four designs:

- **Custody patterns are already proven in-house.** grc20 custody = approve/`TransferFrom` pull pattern (battle-tested in `memba_token_otc_v1`). ugnot custody = realm banker, and upstream `NewBanker` now rejects `BankerTypeOriginSend` unless the call is a direct user call — **any entrypoint pulling origin-sent GNOT must be user-called, never reached through a router hop**.
- **`realm.Sub()` is in upstream master but NOT on test13** (the chain predates the freeze-critical merges; it lands at the next network upgrade window). Treated as a future refactor lever (per-pair/per-listing derived addresses), never a dependency.
- **The fee spine is the integration contract.** `memba_market_config` (non-failing `GetFeeBPS(lane)` / `GetTreasury()`, `MaxFeeBPS=500` enforced on write, `DefaultFeeBPS=200` for unknown lanes) already serves lanes `nft/service/token`. **The config realm deliberately has NO `Pause()`** — a paused fee spine would brick every engine; pausing lives in the engines themselves (OTC pattern). New systems add **lanes**, never new fee plumbing.
- **Realms cannot deploy realms** (addpkg is tx-level; no CREATE2 analog). Every "factory" is a **singleton realm with an internal registry** — exactly the tokenfactory_v2 shape.
- **Backend already has the hard parts:** event-driven indexer (poller → tailer → dispatch → reorg-safe sqlite) and an IPFS proxy/serve pair. New systems add dispatchers + RPC handlers, not new infrastructure.

### 4.1 Social feed `/feed` — BUILD (best value/risk of the four)

**New realm `r/samcrew/memba_feed_v1` — not channels_v2.** channels_v2 is DAO-scoped (roles via `parent.IsMember`), capped (20 channels / 500 threads), ACL-rendered for a members-only board; a global feed inverts every assumption (open write, unbounded authors, follow graph). What we port **verbatim** is its hardening: render-DoS discipline (never iterate monotonic counters; maintain live indexes; paginate fixed windows), flag→threshold→auto-hide, length caps, author-only edit/delete.

- **State:** `posts` avl (zero-padded id → `Post{author, body ≤1000, mediaCIDs ≤4, repostOf, replyTo, blockH, flagCount, hidden, deleted}`); `byAuthor` live index; `follows` avl (`follower:followee`) + counters; monotonic `nextPostID`.
- **Anti-spam:** per-address block cooldown (last-post-height map; stricter for young accounts); body/media caps; optional hold-≥X-MEMBA-to-post knob, default off.
- **Moderation (two tiers), with named anti-abuse constants** (tuned via governance post-deploy): (1) community `FlagPost` — `MinAccountAgeForFlag` (blocks), `FlagThreshold` for auto-hide (channels_v2 uses 3; the feed should start higher, ~5, because open-write invites brigading), one flag per addr per post, per-day flag budget per address (blunts coordinated flag-brigades); (2) **moderation board** — feed realm checks a daokit `moderator` role (gnodaokit `MembersStore.HasRole` — verified available on pr-64) for `ModDelete/BanAuthor/Unhide`; bans feed-local, reversible, and **expiring** (`BanExpiryBlocks`) so ban-griefing is bounded; every mod action `chain.Emit`s for public audit. Extract `p/samcrew/modboard` in the deployer so feed + app store share audited moderation code.
- **Media:** on-chain stores IPFS CIDs only. New backend `PinMedia` RPC in front of the existing IPFS proxy — size cap ~5 MB per CID (enforced server-side), MIME allowlist `image/*` (excluding `image/svg+xml`), `audio/mpeg`, `audio/ogg`; **Content-Type validated on serve, HTML/SVG rejected** (script-in-media defense); per-account daily quota via existing ratelimit; login-challenge auth. **Frontend must load all media through the same-origin backend serve path — never direct `ipfs://` or gateway URLs in markup** (CSP `media-src 'self'` covers the proxy; raw IPFS links would silently fail). Audio via native `<audio>`; zero CSP changes.
- **Render:** canonical bounded pages (`""` latest window, `page/K`, `user/addr/K`, `post/ID`) for gnoweb visibility — but the app reads from the indexer.
- **Backend:** dispatcher for feed events → sqlite (`posts`, `follows`, `mod_actions`); `feed_rpc.go` timelines. **Fan-in on read** (one SQL join for the home timeline) — fan-out-on-write at Memba's scale is architecture cosplay. XP hooks feed the existing points engine + `memba_quest_attestation_v1` ("first post", "10 followers").
- **Flags:** `VITE_ENABLE_FEED` — ordinary flag (no funds). Future tipping = separate SAFETY_GATED flag + fee-spine lane `"feed"`.
- **Phases:** P0 (2d): minimal post+render realm + one dispatcher + raw timeline RPC — kills the two real risks (render-bound correctness under churn; event→sqlite latency for optimistic UX). P1 (1–1.5wk): follows/reposts/flags/rate-limits/full battery + feed MVP (= W7.2). P2 (1wk): media+audio, moderation board, XP (= W8.2 adjacency). P3: tipping, token-gate knob.

### 4.2 Gnoweb-like "Memba Explorer" — BUILD · sandboxed runner — NO-BUILD

**Effort honesty first:** a real sandboxed gno executor (jailed gnovm container, CPU/mem/time limits, no egress, quotas, abuse handling, patching tail) is 2–3 ops-heavy weeks competing with play.gno.land, which exists, is maintained upstream, and is free. Clearest no-build in this document.

What we build instead (~1 week total):
1. **Universal realm viewer `/gno/*`** (3–4d): catch-all route rendering ANY realm path — **Render** tab (existing queryRender proxy), **Source** tab (generalize `SourceCodeView` + `gnowebSource.ts` via `vm/qfile` package listing), **Docs** tab (doc comments extracted client-side), **Functions** tab (`vm/qfuncs` signatures + a call-builder for `qeval`-able pure reads). One URL scheme, dark mode, mobile, deep links — every realm-path string in the app becomes a link. Doubles as the App Store's "read the contract you're about to use" trust tab.
2. **Editor + read console** (3–4d): Monaco with Go grammar (good enough for gno initially); console executes `qeval`/`qrender` against live test13 through the existing proxy — genuinely useful for realm developers, zero execution risk (ABCI read path only).
3. **Execution** (1d): "Run this" → play.gno.land with code pre-filled (share-link format); new-tab + clipboard handoff if framing is blocked.

Backend caveat: extend the render-proxy allowlist to `qfile`/`qfuncs` — a small reviewed change, **read-only paths only**. Flag: `VITE_ENABLE_EXPLORER`, ordinary.

### 4.3 App Store — BUILD SMALL (curated; defer game embedding)

**Realm `r/samcrew/memba_appstore_v1`:** `Listing{id, pkgPath (unique key), name, tagline, descr, category, iconCID, screenshotCIDs ≤6, appURL, versions[], publisher, status(pending/live/delisted), flagCount}`.
- **Paid listing (the only money path):** flat ugnot fee sent with `RegisterApp`; the banker immediately forwards to `memba_market_config.GetTreasury()` — nothing custodied. Valid under the OriginSend/IsUserCall constraint because users call `RegisterApp` directly — **and the realm must enforce it**: explicit `IsUserCall()` guard before reading `OriginSend` (the exact guard `agent_registry` was missing, O-13), `NewBanker` built with `cur`, and a defined behavior for a mis-set treasury (panic-and-refund, never silently custody). Fee-path verification checklist (spike): guard present · single register → treasury receives fee · zero/misconfigured treasury path · 5 concurrent registrations all land · invariant "sum(fees collected) == sum(RegisterApp fee args)". `VITE_ENABLE_APPSTORE` sits in `SAFETY_GATED_FLAGS` **only until** this checklist passes on test13, then de-gates — the rest is read-only.
- **Curation:** launch curated-only (listings start `pending`; daokit `curator` role flips `live`) — first impressions matter for a store. Community flagging identical to the feed; share `p/samcrew/modboard` if extracted.
- **Reviews/stars:** reuse the `memba_reviews_v1` subject-key pattern with an `"app"` namespace — no new review machinery.
- **Frontend:** new **`/apps`** page (AppStorePage + AppDetail) — a store is a merchandised surface, not a Directory tab. Cheap cross-links both ways: RealmsTab rows get an "on App Store" chip; AppDetail links to the Explorer source view.
- **Games embedding, honestly:** embedding arbitrary third-party frontends = `frame-src` allowlisting + sandboxed iframes + a wallet-phishing surface (an app rendered inside Memba asking Adena for signatures *looks endorsed*). Phase 1 is **"Open app ↗" new-tab only** with an interstitial ("leaving Memba — verify the realm path"). Pure-Render realm apps are embeddable safely today via the existing proxy — feature them as a category. An iframe program (sandbox without `allow-same-origin`, curator-vetted origins, static allowlist-fed CSP) is a deliberate Phase-3 decision, not a default.
- **Phases:** P0 (1d): RegisterApp fee→treasury on test13 (verifies the banker path end-to-end). P1 (1wk): full realm + tests + indexer dispatcher + `/apps` MVP + reviews reuse. P2 (3–4d): media pipeline reuse, categories/featured, Directory cross-links, "list an app" quest.

### 4.4 DEX/AMM — SPIKE-GATED BUILD · Morpho-like lending — DEFER indefinitely

**Shape is forced, and that's good news:** gno has no runtime realm deployment ⇒ no pair-per-realm factory ⇒ **singleton constant-product realm `r/samcrew/memba_amm_v1`**. The singleton is also the honest performance story: Gnoswap splits pool/position/router/staker across realms and pays interrealm crossing per hop (and concentrated-liquidity math is ~an order of magnitude more gas than x·y=k); Memba's swap is one realm call and two `TransferFrom`s.

- **State:** `pairs` avl keyed `"SYM0:SYM1:feeTier"` (sorted) → `Pair{reserve0, reserve1, lpToken (runtime-minted grc20 per pair — the tokenfactory_v2 pattern), feeBPS, price cumulatives, lastBlockTS}`. LP tokens registered with `grc20reg` in P2 ⇒ transferable/composable ecosystem-wide — a real differentiator vs internal-only shares.
- **Custody:** grc20↔grc20 **only**. GNOT enters via a wrapper — `r/gnoland/wugnot` exists in upstream examples (verify deployed on test13 in the spike); fallback: minimal `r/samcrew/memba_wugnot_v1` whose only banker use is its own deposit/withdraw (guarded per the OTC/wugnot precedent). Consequence: **the AMM makes zero native-coin banker calls** — swaps, LP mint/burn, and the protocol-fee skim are all grc20 operations; the only banker code in the system lives inside the ~50-line wrapper. Frontend composes wrap+swap as two msgs in one tx (multi-msg via Adena already in use).
- **Pair creation is a decision, not a default:** permissionless `NewPair` invites junk-pair state bloat. Start **permissioned** (admin/multisig creates pairs) or permissionless-with-cost (pair-creation fee + per-creator cap); record the choice and rationale in the spike.
- **Fees:** per-pair tier from allowlist {30, 100, 300} bps; protocol cut read per-swap from `memba_market_config.GetFeeBPS("amm")` and **skimmed to treasury immediately per swap as a grc20 transfer** — no kLast/deferred-protocol-mint accounting (the single most bug-prone part of Uniswap v2; skip it). Adversarial tests must verify the skim amount on every swap shape (direct + 2-hop).
- **Routing:** 2-hop (A→WGNOT→B) is one realm call `SwapPath(cur, path)` iterating internal pairs; client-side pathfinding over **indexer-mirrored reserves** gives zero-roundtrip quotes/price-impact (vs the current gnoswap plugin's queryRender+regex per view). Slippage via `minOut` enforced in-realm.
- **Safety:** every mutating entrypoint takes `cur realm`, resolves caller via `cur.Previous()`, checks allowances before mutating reserves, asserts `k' ≥ k` with overflow-guarded int64 (cap reserves ≪ 2^62). `Pause()` + `PausePair(key)`; admin = the 2-of-2 multisig with two-step transfer. **If any banker is ever constructed anywhere in this program (wugnot fallback, DAO v2, app store): `NewBanker` takes `cur` (`IsCurrent()==true`), never `cur.Previous()` — the wrong shape is a caller-drain vulnerability (upstream fix `7cb5a01e9`; OTC `otc.gno:194` is the correct precedent).** TWAP cumulative accumulators exposed but **documented as manipulable-for-lunch-money on a faucet-liquidity testnet** — plumbing for later, never a safety input.
- **Honest perf claim:** fewer interrealm crossings + client-side quoting + one integrated "Token" surface (OTC for illiquid, AMM for liquid, same fee spine). Never claim VM-level speed — it's the same VM.
- **Deployer:** template dir + adversarial b-series tests; new `samcrew-amm-parity.sh` (template swap-math ↔ deployed qeval fixtures, modeled on the escrow parity script); `--defi-v1` deploy flag mirroring `--commerce-v2`.
- **Flags:** `VITE_ENABLE_AMM` in `SAFETY_GATED_FLAGS` **from the first commit**; de-gate checklist: adversarial tests green, parity green, multisig admin verified, protocol-fee skim verified on-chain, pause drill executed.
- **Phases:** **P0 spike (3–4d, W9)**: one hardcoded pair, deposit/swap/withdraw behind the flag — answers wugnot availability on test13, measured gas vs a Gnoswap swap, allowance UX friction, PrivateLedger runtime-minting behavior. **P1 (1.5–2wk):** multi-pair singleton, LP grc20, fee lane, pause matrix, invariant fuzz, indexer + RPC. **P2 (1–1.5wk):** routing, TWAP, grc20reg LP registration, `/swap` page (promote from DAO plugin; keep the existing gnoswap plugin as-is — it reads *their* realms). **P3 — lending: NO.** Isolated Morpho-like markets need an honest oracle; a testnet has none (TWAP manipulable, admin prices = trusted toy). Building liquidation machinery against a fake oracle produces false confidence, not de-risking. Revisit at mainnet economics; keep only the accumulators as feedstock.

---

<a name="part-5"></a>
## Part 5 — Process-by-design (standing rules)

### 5.1 Per-PR protocol (every PR, no exceptions)
1. Branch from **fresh** `main` (`git fetch` first). Never commit or push to `main`. Work in a dedicated worktree; `cd` into it before committing.
2. Local compile gates before push: `npm run build` (frontend; `tsc --noEmit` is a no-op in this repo) · `go build ./... && go vet ./...` when backend touched · deployer `make verify-client-templates` when realm templates touched.
3. Tests: unit for touched code; Playwright spec added/updated for user-visible changes; full e2e before merge-request on risky PRs (lesson: run the FULL relevant e2e when changing page DOM).
4. Self code-review pass; fix findings before flagging ready.
5. **No merge without explicit owner approval.** A session never merges its own PR.
6. **No AI attribution** in commits, PR bodies, tags, or release notes.
7. PR description lists: flags touched · docs updated · CHANGELOG yes/no · lane (A/B/C/Ratchet).

### 5.2 Parallel-session coordination
- Sync file: `docs/planning/SESSION_SYNC.md`. Append on session start ("Lane B, W5, taking playwright flake — touching e2e config + CI yaml") and on stop. Read it before the first edit, and re-read before touching any **single-writer file**: `api/` + generated code, `.env.example`, `CHANGELOG.md`, shared hooks, CI yaml.
- **Lane C is externally owned — explicit off-limits list** (#734 merged 2026-07-03; the per-signature-verified work is still active, so the list stands until Lane C declares done in SESSION_SYNC): `backend/internal/auth/**` (all) · signature RPC handlers in `backend/internal/service/tx_rpc.go` (non-sig handlers are fair game) · signature/verified fields in `api/memba/v1/memba.proto` + regenerated code · the signing-call paths in `useAdena.ts` (`SignMultisigTransaction`) — the connection/account-change logic in the same file belongs to Lane A (W5.1); register the split in SESSION_SYNC before either side edits. If a roadmap PR would collide, it waits.
- Rebase over merge for lane branches; single-writer conflicts resolved by whichever session registered first.
- Frequent activity checks: `git fetch && git log --all --since="12 hours ago" --oneline` + `gh pr list` at session start and before opening any PR.

### 5.3 Standing safety rules (verbatim)
1. Never commit/push to `main`; PRs only; owner approves every merge (admin-merge only on owner instruction).
2. No AI attribution anywhere in git history.
3. Gated flags stay OFF until their de-gate section passes: `VITE_ENABLE_TREASURY_SPEND` (W8.1), `VITE_ENABLE_AGENT_CREDITS` (W8.1), `VITE_ENABLE_AMM` (4.4), `VITE_ENABLE_APPSTORE` (until fee path verified). `VITE_ENABLE_FEED` / `VITE_ENABLE_EXPLORER` are ordinary flags (no funds).
4. **Never redeploy `tokenfactory_v2`.** New realm versions only; record in `realm-versions.json`.
5. gnodaokit pinned to **pr-64** for test13; any bump is its own PR with compat notes.
6. All on-chain ceremonies (market registration, badge mint, banker deploy, AMM deploy) are **owner-executed** via samcrew-deployer; sessions prepare + dry-run only.
7. Money-path features require: enforcement flip live · restore drill passed within 90 days · fund-recovery e2e on a throwaway realm.
8. Prod frontend deploys via **Netlify native (`netlify.toml`) only** — never `deploy-frontend.yml` (it carries an explicit `if: ${{ false }}` hard-disable; keep it). Bot keys are throwaway, never reused, never in the repo. Do not flip `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` outside the runbook.
9. **Flag-gate integrity:** any PR that touches `safeFlags.ts` or the `assertSafeFlags` wiring in `vite.config.ts` must say so explicitly in its description with the rationale (gate added / gate removed + de-gate evidence / bugfix); a PR touching both files at once gets extra scrutiny — that combination is the only way a gated flag can silently reach prod.
10. **New-flag checklist** (every `VITE_ENABLE_*` introduced by this program): add to `frontend/.env.example` with safe default · add to `SAFETY_GATED_FLAGS` if any money path (AMM, APPSTORE) · wire through `navManifest.ts` if nav-visible · document the de-gate criteria in this doc.

### 5.4 Docs, memory, changelog cadence
- `CHANGELOG.md`: every user-visible PR adds its entry in the same PR (CI-enforced after W6.1).
- Memory/session docs: updated at wave gates minimum; immediately on any flag default, endpoint, or runbook change.
- Wave retro appended to this document at each gate: shipped / slipped / gate evidence links.
- This doc is the single source of truth for Waves 5+; `ROADMAP.md` points here.

---

<a name="appendix-a"></a>
## Appendix A — Owner action checklist

**U-1 and U-3 are the program's single points of failure** — if they slip, Wave 8 slips wholesale (the gate is hard). They are front-loaded to the first days of W5, not queued behind session work.

| # | Action | Why | When |
|---|---|---|---|
| U-1 | Run the first Litestream restore drill (OPS_RUNBOOK §4.7) and fill the RPO/RTO MEASURE placeholders | Untested backups = no backups; **Wave 8 hard-gate input** | **W5, first days** |
| U-2 | `flyctl secrets set METRICS_BEARER=…` and `QUEST_ADMIN_ADDRESSES=…` in prod | `/metrics` publicly scrapable while unset; hard-blocks W6.5 PR2 | W5 |
| U-3 | Enforcement flip (`MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1`) — **#734 is merged, so this is now purely metric-gated**: watch the boot-sweep readout (OPS_RUNBOOK §2.1) and flip once it reads `mismatch=0` on recent rows; rollback = unset | **Wave 8 hard-gate input** | **NOW unblocked — first days of W5** |
| U-4 | Co-execute W5.5 registration reconcile outcome (ceremony if needed) | On-chain truth | W5 |
| U-5 | Approve the 3 blog articles before merge — **article 1 before W7.1 closes** | Voice-sensitive; closes the discovery loop for the W7 launches | W6→W7 |
| U-6 | Go/no-go decisions on the four W9 spikes | Strategy calls | W9 |
| U-6a | **AMM strategic framing:** core identity pillar (build even at gas parity if the UX story wins) vs. option (KILL threshold binding) | Determines how the AMM spike data is read | before W9 spikes |
| U-7 | Badge mint ceremony (`BADGE_MINT_RUNBOOK.md`) | First badges on-chain | W8 |
| U-8 | Set the treasury fee policy per lane (nft/service/token/amm/appstore bps) + confirm the revenue view (W8.5) | Fee spine exists; the business model on top is an owner call | by W8 gate |
| U-9 | Branch-protection edit: add the W6.1 changelog check (exact name) to required checks | CI gate is inert until required | W6 |
| U-10 | Define the "first 100 users" motion (outreach / content / quests on-ramp) | Shipping to a ghost town wastes W7 | end of W6 |

<a name="appendix-b"></a>
## Appendix B — Spike document template

```markdown
# SPIKE_<NAME>.md
Date / box (days) / author session
1. Question the spike answers (one sentence)
2. What was built/measured (throwaway code lives on a spike/* branch, never merged)
3. Data (gas numbers, latency, UX friction — measured, not guessed)
4. Risks killed / risks discovered
5. GO threshold / KILL threshold (declared BEFORE the spike runs — from the Wave 9 table)
6. Recommendation: GO / NO-GO / DEFER + what Wave N+1 would look like (PR slices, effort)
7. Owner decision + date (filled after review)
```

<a name="appendix-c"></a>
## Appendix C — Parallel-session sync protocol (seed for SESSION_SYNC.md)

```markdown
# SESSION_SYNC — append-only; newest on top
Format: <UTC time> · <lane> · <wave/item> · START|STOP · files/areas being touched · branch
Single-writer files (register before touching): api/** + generated, .env.example, CHANGELOG.md, CI yaml, shared hooks.
Lane C OFF-LIMITS while active (external: #734 / per-sig-verified):
  - backend/internal/auth/** (all)
  - backend/internal/service/tx_rpc.go — signature RPC handlers only
  - api/memba/v1/memba.proto — signature/verified fields + regenerated code
  - frontend/src/hooks/useAdena.ts — signing-call paths (SignMultisigTransaction);
    connection/account-change logic is Lane A (register the split here first)
```

---

*Wave retros are appended below this line as gates pass.*

## Wave 5 retro — session-side complete 2026-07-03 (gate pending owner items)

**Shipped (all four-gate merged):** W5.1 #740 (Adena: localStorage session flag + locked-wallet visibility retry + walletDebug ring buffer — root cause was the per-tab sessionStorage flag, not missing listeners) · W5.2 #738 (Directory source via `vm/qfile` — root cause was gnoweb's absent CORS headers, unfixable by host config; Packages-first default) · W5.3 #739 (validator review stars + hover comments; in-flight dedup + error-path tests added on review) · W5.4 verified (#736 root-caused the flake to NetworkSync's first-visit reload; 4 consecutive green main runs at workers:2) · W5.5 closed read-only (v3.1 registration verified on-chain; stale deployer branch deleted; O-6 was an artifact) · W5.6 #741 (upstream sweep, SHAs fact-checked — exploration dates were PR dates, corrected).

**Slipped:** nothing. **Found by gates:** prod-bundle dynamic-env trap (twice, independently), react-refresh export rule, the "In progress" mislabel class.

**Gate remainder (owner):** U-1 restore drill · U-2 prod secrets · U-3 metric-gated enforcement flip. The gate formally closes when these land; nothing in W6+ session work depends on them except where marked.

## Wave 6 progress — as of 2026-07-04

- **W6.1 PR1+PR2 ✅ #742** (changelog automation, parse contract, real-file tripwire). **PR3 blocked on U-9.**
- **W6.2 ✅ CLOSED at PR1 #743** (4-mode manifest-driven nav; live marketplace un-buried). **PR2–5 (URL-mode restructuring): SKIPPED — decision 2026-07-04** under the owner's delegated trust: the nav sections deliver the positioning; URL churn would spend redirect complexity and SEO continuity for near-zero gain. Reopen only if a future IA change forces URL moves anyway.
- **W6.3 ✅ COMPLETE** — #744 per-route meta · #745 sitemap/robots · #746 JSON-LD + prerender decision (NOT adopted; triggers in `docs/features/SEO.md`).
- **W6.4 ✅** — #748 merged under the owner's delegated trust (article 1); articles 2–3 in this closure PR. **W6.5 PR1 ✅ #750** (root-boundary + tx-broadcast Sentry capture); PR2 blocked on U-2. **W6.1 PR3 blocked on U-9.** With those two owner unlocks pending as carry-overs, **the Wave 6 gate is otherwise PASSED (2026-07-04).**

## Wave 7 retro — session-side complete + feed turned ON 2026-07-04 → verified 2026-07-06

**Shipped (all four-gate merged, Jul 4):**
- **W7.2 feed P0 ✅ #753** — social feed backend: proto +3 Feed RPCs (NOT sig/verified fields), buf regen, migration `018_feed.sql`, `feed_tailer`/`feed_dispatch` in `internal/indexer`, `feed_rpc.go`, `main.go` wiring behind `FEED_WATCHED_REALMS` (no-op until set — safe on prod). Deployer realm **`memba_feed_v1` ✅ #56**; deep-review orphan-index-leak-on-`UnhidePost` guard **✅ deployer #57** (fixed in the realm source *before* deploy).
- **W7.2 feed P1 ✅ #754** — `/feed` UI behind `VITE_ENABLE_FEED` (off by default), `FeedGate` coming-soon state, optimistic compose→reconcile.
- **W7.1 marketplace ✅ #755** — "My Listings" surface (own active listings across NFT v3.1 + Token OTC, one-click cancel, `allSettled`-resilient, optimistic self-correcting removal). **Caught + fixed:** the token-OTC lane's builders emitted Amino type `"vm/msg/call"`, which the shared broadcast path rejects (`"vm/MsgCall"` only) — every token list/cancel/fill would have thrown before reaching the wallet; the lane was gated off so it was never exercised. Round-trip test added through `toAdenaMessages`.
- **W7.3 activity bot ✅ #756** — testnet-only `cmd/activitybot` (never holds a key in Go; emits/execs `gnokey`; kill-switch `ACTIVITYBOT_ENABLED`, per-run/rolling-daily caps, clean-exit-on-error). Runbook `backend/docs/ACTIVITYBOT_RUNBOOK.md`. Not wired into any service.
- **Hardening ✅ #757** — 4-angle deep review (feed 5-layer realm→indexer→sqlite→RPC→UI contract, broadcast-builder/flag audit, adversarial security, docs): came back clean on correctness; **added `feed.test.ts`** pinning the Amino wire contract for all five feed builders (the exact coverage gap that let the OTC wrong-type ship) + badge-mint round-trips; made activity-bot success-path state-save failure loud.
- **Guard ✅ #758** — My Listings NFT delist routed through `routeNftV3()` so it passes the same `isRealmValid(NFT_MARKETPLACE_V3_PATH)` allowlist every other v3 write-site uses (broadcast layer doesn't check engine paths — that guard is the invariant).
- **UX polish ✅ #759** (owner-requested) — Feed under Home in nav; Leaderboard + Extensions to the utility tail by Feedback; marketplace/services/NFT terminal-header hero (no fabricated metrics); blog editorial redesign; **validator-reviews subject fix** — the table queried each row's *signing* address, but reviews key to the *operator* address once a valoper registers; now resolves to that canonical subject (signing addr merged as alias) so every reviewed validator shows ratings.
- **Docs ✅ #760 / #761** — post-Wave-7 `OWNER_UNLOCKS_2026-07-04.md` (step-by-step feed turn-on + Wave-8 gates); feed-deploy command corrected to the `REALM=` filter. Deployer tooling **✅ #58** (`REALM=` single-realm deploy filter — pins `memba_feed_v1` so a bare `make deploy` can't co-deploy the fund-moving `memba_token_otc_v1`) and **✅ #59** (post-deploy verification honors `REALM=`).

**Feed turn-on (OWNER_UNLOCKS §A) — status 2026-07-06:**
- **A.1 realm ✅ LIVE** — `memba_feed_v1` deployed to test13 via 2-of-2 multisig (zooma + adena-zxxma); `qrender` confirms it renders (`Live posts: 0`). Holds no funds (no banker) — plain addpkg, no fee-path risk.
- **A.2 indexer ✅ (owner)** — `FEED_WATCHED_REALMS` set on `memba-backend`; deployed backend (`3acde5e`, includes #753) runs the feed tailer.
- **A.3 UI flag — set, VERIFY propagation** — `VITE_ENABLE_FEED=true` set in Netlify; confirm the native (`netlify.toml`) redeploy shipped and `/feed` renders the timeline (not the gate) before calling the feed launch done. *(This is the one open Wave-7 gate checkbox.)*

**Slipped:** nothing. **Found by gates/review:** the OTC Amino wrong-type (caught by the My Listings path + closed with a wire-contract test); the feed orphan-index leak (caught by 5-layer review, fixed pre-deploy); coverage gap on newest builders (closed with `feed.test.ts`).

**Gate:** session-side **COMPLETE**; W7 ships **no new deposit paths** (fund-safe by construction). Gate closes on the A.3 verification above. W7 did **not** consume the Wave-8 unlocks — those remain the sole blockers below.

---

## Current gate status — 2026-07-06 (single-glance)

**Baseline:** Memba `main` = `1f8986b` (#761) · samcrew-deployer `main` = `84083a6` (#59) · gnodaokit `pr-64` · upstream gno `master` = `dfe49509f` (**no breaking changes for test13 realms** — local ↔ origin in sync on all tracked branches; the only updated gno branches are unrelated feature branches). **0 open PRs, clean trees** on both repos.

**Active parallel sessions (do not touch their files):**
- `fix/chunk-error-auto-recovery` (worktree `memba-wt-mime`) — LIVE, uncommitted: `ErrorBoundary.tsx`, `main.tsx`, `staleChunk.ts` (+test), plus dirty `CHANGELOG.md` / `SESSION_SYNC.md`. Chunk-error auto-recovery (W6.5-adjacent). Off-limits.
- `fix/per-signature-verified-flag` (worktree `memba-wt-sig-verified`, **Lane C / O-2**) — proto + `018_sig_verified.sql` + `tx_rpc.go` + ProgressBar/TransactionView. Signature/auth paths — Lane C off-limits by standing rule.

**Owner unlocks — the only levers before more code can land:**

| Unlock | What | Gates | Status |
|---|---|---|---|
| **U-1** | First Litestream restore drill → `OPS_RUNBOOK §4.7` (fill RPO/RTO) | **Wave 8 (hard)** | ⏳ PENDING |
| **U-3** | Flip `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` when boot-sweep reads `mismatch=0` (O-1 code done #734) — **USER-ONLY, metric-gated** | **Wave 8 (hard)** | ⏳ PENDING |
| **U-2** | Set `METRICS_BEARER` + `QUEST_ADMIN_ADDRESSES` (O-4) | W6.5 PR2 + closes `/metrics` scrape hole | ⏳ PENDING |
| **U-9** | Add `Changelog entry` to `main` required checks | Makes W6.1 gate binding | ⏳ PENDING |
| **A.3** | Verify `VITE_ENABLE_FEED` Netlify redeploy propagated | Closes W7 feed launch | ⏳ VERIFY |
| **U-6a / U-8 / U-10** | AMM framing · per-lane fee bps · "first 100 users" motion | Frame W8/W9 (no deadline) | 💬 decisions |

**Open items rollup:** O-1 (→U-3) · O-2 (Lane C, external) · O-3 (→U-1) · O-4 (→U-2) · O-8 quests/badges (→W8.3) · **O-13** `agent_registry.DepositCredits` missing `IsUserCall()` guard before `unsafe.OriginSend()` (→**W8.1 PR2**, must redeploy hardened before `VITE_ENABLE_AGENT_CREDITS` de-gates) · **O-14** DAO v1→v2 migration story absent (→**W8.1 PR0** decision). **Closed:** O-5, O-6, O-7, O-11, O-12. **Ratchet lane (continuous):** O-9 react-hooks 52→0 · O-10 god-files / `any` / a11y AA.

**Next actionable, in order:**
1. **Verify A.3** (feed UI live on prod) → close the Wave-7 gate. *(session-verifiable once redeploy confirmed)*
2. **U-2 + U-9** — small independent owner actions; U-2 unblocks W6.5 PR2 (backend Sentry) as the next session-side PR.
3. **U-1 + U-3** — the two Wave-8 hard-gate unlocks. Until BOTH land, no money-path (W8) code starts; if they stall, pull the **Wave-9 spikes** (explorer / app-store / AMM / playground — docs only, no code gate) forward instead of starting W8 optimistically.
4. On the W8 gate passing: **W8.1 PR0** (owner picks DAO v1→v2 Option A vs B) → banker-as-new-version + **O-13** hardened `agent_registry` → treasury-spend UI → e2e → de-gate flips.

