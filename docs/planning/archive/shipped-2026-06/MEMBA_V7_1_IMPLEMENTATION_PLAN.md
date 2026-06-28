# Memba v7.1 — AAA SWE Implementation Plan (Rev2, two-panel-vetted)

> **Date:** 2026-05-11
> **Revision:** **Rev2** — incorporates **two** expert panel cross-checks (Rev0→Rev1: Architect, Security, Frontend, Backend, Gno-Onchain, DevOps; Rev1→Rev2: Release/SRE, QA, Tech Lead/EM, Compliance, Adversarial Red Team).
> **Audit trail:** [`MEMBA_V7_1_EXPERT_REVIEW.md`](MEMBA_V7_1_EXPERT_REVIEW.md) (Rev0→Rev1) and [`MEMBA_V7_1_EXPERT_REVIEW_REV2.md`](MEMBA_V7_1_EXPERT_REVIEW_REV2.md) (Rev1→Rev2).
> **PR triage runbook:** [`MEMBA_V7_1_PR_TRIAGE.md`](MEMBA_V7_1_PR_TRIAGE.md).
> **Predecessor:** [`MEMBA_V7_IMPLEMENTATION_PLAN.md`](MEMBA_V7_IMPLEMENTATION_PLAN.md) (Rev7 FINAL, 2026-04-20). Superseded for sprint scheduling.
> **Status (as of 2026-05-11):** **Phase 0 ✅ COMPLETE** — see [`docs/reports/v7.1-phase0-signoff.md`](../reports/v7.1-phase0-signoff.md). Phases 1–6 pending operator go-ahead.
> **Phase 0 outcome:** 15-PR backlog cleared, 14 advisories closed, 1 advisory filed (MEMBA-2026-001 AUTH-CHAINID-01), production audit-green. v6.0.2 + v6.0.3 deployed (`d37cd72` and `0696fcd`); workflow hotfix at `a4f6eb9`; 3 carry-over PRs merged (#314, #329, #330).
> **Scope (remaining):** ship channels_v3 (Phase 2), complete React Query migration (Phase 3), prep betanet rollout (Phase 5), cut v7.1 release (Phase 6).
> **Duration:** **~38 calendar days** total program (~3 calendar days consumed by Phase 0; ~35 remaining at ~1 FTE).

---

## Executive Summary (≤ 60 seconds)

Memba v6.0.0 (shipped 2026-04-16, 1,777+ tests green) is functionally healthy. The repo is **operationally locked**:

| Issue | Surface | Root cause |
|-------|---------|------------|
| `Backend (Go)` CI red | govulncheck on Go 1.25.9 stdlib | Fixed in **Go 1.25.10** (released 2026-05-07) |
| `Frontend (React)` CI red | `npm audit` flags Clerk ≤ 5.61.5 (critical), dompurify ≤ 3.3.3 (4 advisories) | Fixed in `@clerk/clerk-react@5.61.6` (+ `@clerk/shared@3.47.5` override) and `dompurify@3.4.2` |
| 15 open PRs blocked | Same CI signals | Phase 0 |
| **AUTH-CHAINID-01** (HIGH/HIGH) | `backend/internal/auth/crypto.go:324` builds ADR-036 signDoc with `"chain_id":""` → test12 signature is bit-identical valid on gnoland1 | Discovered in expert review; **promoted to Phase 0 hotfix** |
| Sentry source-map upload silently broken | `deploy-frontend.yml` never passes `SENTRY_AUTH_TOKEN` | Phase 0 |
| Fly deploy not rollback-safe | `min_machines_running=1` + volume → bluegreen **impossible**; no GHCR mirror | Phase 0 — rolling + image-snapshot |
| samcrew-deployer 5 commits unpushed | Includes channels events + escrow + agent/NFT/candidature/badges audit fixes | Phase 1 |
| Custody spec for emergency multisig EOA missing in `MAINNET_PREPARATION.md` | Required by channels v3 two-tier pause | Phase 1 hard prereq |
| CODEOWNERS = single `@zxxma` | R-12 SPOF | Phase 1 (reviewer consent gate) |

Rev2's Phase 0 **splits into two same-day PRs** (`PR0a` CI/SRE/auth + `PR0b` frontend deps/policy) to keep diff sizes reviewable. Bluegreen is dropped entirely (incompatible with this app's volume + single-machine setup); rolling deploy + per-release GHCR image snapshot is the rollback strategy. AUTH-CHAINID-01 fix ships **inside Phase 0** with a token-version field for graceful rotation. Custody, comms, reviewer consent, fund-key holder are all gated *before* Phase 0 kicks off.

---

## Table of Contents

1. [Current State Snapshot](#1-current-state-snapshot)
2. [PR #329 Verdict](#2-pr-329-verdict)
3. [Open PR Backlog (15 PRs)](#3-open-pr-backlog-15-prs)
4. [Phase 0 — Split (0a + 0b): CI Infra + Frontend Deps](#4-phase-0--split-0a--0b-ci-infra--frontend-deps-day-12)
5. [Phase 1 — Foundation, Custody, Reviewer Gate](#5-phase-1--foundation-custody-reviewer-gate-days-37)
6. [Phase 2 — channels_v3 on test12](#6-phase-2--channels_v3-on-test12-days-810)
7. [Phase 3 — React Query Migration](#7-phase-3--react-query-migration-days-1121)
8. [Phase 4 — Quality, Coverage, Observability](#8-phase-4--quality-coverage-observability-days-1426-overlaps)
9. [Phase 5 — Betanet (gnoland1) Deployment](#9-phase-5--betanet-gnoland1-deployment-days-2329)
10. [Phase 6 — Polish & v7.1.0 Release](#10-phase-6--polish--v710-release-days-2933)
11. [Cross-Repo Coordination](#11-cross-repo-coordination)
12. [Architecture Decision Records](#12-architecture-decision-records)
13. [Risk Register](#13-risk-register)
14. [Acceptance Criteria, DoD, SLO, Stop-Work Trigger](#14-acceptance-criteria-dod-slo-stop-work-trigger)
15. [Rollback Playbooks](#15-rollback-playbooks)
16. [Observability & Telemetry](#16-observability--telemetry)
17. [Test Plan](#17-test-plan)
18. [Sequencing, Critical Path, PTO Float](#18-sequencing-critical-path-pto-float)
19. [Open Questions for Approval (18 items)](#19-open-questions-for-approval-18-items)
20. [Appendices](#20-appendices)

---

## 1. Current State Snapshot

### 1.1 Code & releases

| Item | Value | Source |
|------|-------|--------|
| Latest tag on `main` | **v6.0.0** (2026-04-16) | `git log`, `CHANGELOG.md` |
| HEAD of `main` | `201ba03` (PR #313, gnolove report header) | `git log` |
| Active local branch | `fix/v6-error-messages-theme` (PR #314, +1 commit, CI-green awaiting review) | `git status` |
| Test counts | 1,628 frontend unit + 149 backend + 6 Gno realm + **175 Playwright** (page-render smoke only — no Adena/sign flows) | `frontend/e2e/*.spec.ts` inventory |
| Coverage gates | Backend hard ≥ 20 % / warn < 50 %. Frontend **no gate today** (artifact-only). | `.github/workflows/ci.yml` |
| Go toolchain | `1.25.9` in `ci.yml:26`, `deploy-backend.yml:26`, `go.mod:3`. `security.yml:34` **stale on 1.23**. `govulncheck.yml:24` + `codeql.yml:26` derive via `go-version-file`. `backend/Dockerfile:2` = `golang:1.25-alpine` (rolling) | grep |
| Sentry source-map upload | **Silently broken** — `vite.config.ts` reads `SENTRY_AUTH_TOKEN`, `deploy-frontend.yml` never injects it | Verified |
| Deploy strategy (Fly) | `min_machines_running=1`, `[[mounts]]` volume `memba_data`, no `[deploy]` block → **bluegreen impossible** | `backend/fly.toml` |
| `deploy-*.yml` concurrency | `cancel-in-progress: true` → cancels in-flight deploys mid-flip | grep workflows |
| CODEOWNERS | Single owner `@zxxma` for every path (SPOF) | `.github/CODEOWNERS` |
| Dependabot | Weekly, no grouping, no major-bump ignore | `.github/dependabot.yml` |
| AUTH-CHAINID-01 site | `backend/internal/auth/crypto.go:324` builds signDoc with literal `"chain_id":""` | Verified |
| `crypto_test.go` cross-chain coverage | **Zero** test cases — `grep chain crypto_test.go` returns 0 lines | Verified |
| `docs/SMOKE_CHECKLIST.md` | **Does not exist** | `find` |
| Custody section in `MAINNET_PREPARATION.md` | **Does not exist** | Read |
| `samourai.app` / `samourai.live` domain renewal | Unknown | TBD via Q18 |

### 1.2 Live network status (sample 2026-05-11; Phase 0 will refresh)

| Network | Chain ID | RPC | Status |
|---------|----------|-----|--------|
| Test 12 (Samourai) | `test12` | `rpc.testnet12.samourai.live` | 🟢 Live (verify in Phase 0) |
| Test 12 (public) | `test12` | community | 🔴 Was down 48 h+ in April |
| Betanet (Samourai) | `gnoland1` | `rpc.gnoland1.samourai.live` | 🟢 Live; transfer-lock unknown — probed in §5 |

### 1.3 Cross-repo state

| Repo | Branch | State | Concern |
|------|--------|-------|---------|
| `Memba` | `fix/v6-error-messages-theme` | up to date, PR #314 | None |
| `samcrew-deployer` | `fix/mainnet-security-audit-v3` | **5 commits unpushed**; contains channels events + escrow + agent/NFT/candidature/badges audit fixes that gnoland1 deploy requires. **Untested against current `main`** | **BLOCKS Phase 5** |
| `gnodaokit` | `fix/security-audit-v5-realm-fixes` | feature branch | **BLOCKS Phase 5** |
| `tokenfactory` | `main` | clean | None |
| `gno` upstream | `chain/test12` | `halt_height` (#5334), gnobr (#5410), **per-realm storage deposit (#5629 — byte-proportional)** | #5629 invalidates static gnoland1 deposit |
| `gnolove` | `main` | clean | None |
| `adena-wallet` | `main` | v1.19.0 multichain | Defensive note in §5.1.9b |

### 1.4 Predecessor plan + Rev1 deltas — what we keep, what we change in Rev2

| Element | v7 Rev7 | Rev1 | **Rev2 (this doc)** | Why |
|---------|---------|------|--------------------|-----|
| First sprint | Sprint 0: deployer + docs + chainHealth | Phase 0: monolithic CI Unblock | **Phase 0 SPLIT** (0a CI infra + AUTH + 0b frontend deps + policy) | Phase 0 PR too big to self-review |
| Auth chain replay | not flagged | Phase 1.9 (HIGH/HIGH risk riding 14 days) | **Phase 0a hotfix** (same Day 1) + token-version field for graceful rotation + advisory MEMBA-2026-001 | SRE + Adversarial findings |
| Rollback | "bluegreen + wait-timeout" | "bluegreen + wait-timeout" | **Rolling + GHCR image snapshot per release** | Bluegreen incompatible with volumes |
| CODEOWNERS | not addressed | "audit + add secondary reviewer" | **Reviewer consent confirmed in writing BEFORE Phase 0** (§19 Q16) | EM finding — paper-only otherwise |
| Custody for emergency EOA | not addressed | referenced but not written | **Phase 1 hard deliverable BEFORE Phase 2** | Compliance finding |
| Comms artifacts | scattered | end-of-plan | **Pre-recorded in Phase 0/1** | Cannot draft under stress |
| Float / PTO | none | none | **5-day reserve over 6 weeks** | EM finding — single-FTE realism |
| E2E gates for Phase 3 | aspirational | "Vote E2E / Multisig E2E" | **Downgraded to component-tests-with-mocked-sign-hook** until Phase 3.0 budgets Adena-mock | QA finding — specs don't exist |
| HSTS + DISCLAIMER + SECRETS expansions | Phase 6 polish | Phase 6 polish | **Phase 0/1** (deploy-path secrets), **Phase 6** (DISCLAIMER update) | SRE + Compliance — secrets are operational |
| Stop-work trigger | none | none | **Day 17 Phase-3 50%-or-drop-Phase-5 decision** | EM finding |
| AUTH-CHAINID-01 advisory | not addressed | not addressed | **MEMBA-2026-001 + Adena coordinated disclosure + embargo** | Compliance finding |
| Betanet go/no-go authority | implicit zxxma | implicit zxxma | **≥ 2 Samourai Coop principals sign `docs/reports/v7.1-betanet-gono.md`** | Compliance finding |

---

## 2. PR #329 Verdict

**TL;DR — Do not merge today. Phase 0 unblocks; rebase + merge takes < 60 s. Verify the author still has GitHub access before squashing (Adversarial finding).**

(Content unchanged from Rev1; see §3 for the merge sequence.)

---

## 3. Open PR Backlog (15 PRs)

See the dedicated triage runbook: [`MEMBA_V7_1_PR_TRIAGE.md`](MEMBA_V7_1_PR_TRIAGE.md). Summary:

* **10 trivial patch bumps** (Bucket A) → **folded into PR0b** (frontend) or PR0a (backend: #316/#318/#328) and **closed at merge with a comment.**
* **3 deferred** (Bucket B): PR #323 superseded (Phase 0b jumps to 5.61.6, not 5.61.5); #324 (ESLint 10 major), #325 (Vite 8 major) closed with v7.2 tracker issues.
* **2 human PRs** (Bucket C): PR #314 (zxxma) merged after review; PR #329 (davd-gzl rename) rebased + author-presence verified + merged.

**During v7.1**: `.github/dependabot.yml` sets `open-pull-requests-limit: 0` to **pause dependabot** for the duration of v7.1 phases (re-enable in Phase 6). Prevents the merge-bus reopen race.

---

## 4. Phase 0 — Split (0a + 0b): CI Infra + Frontend Deps (Day 1–2)

### 4.0 Pre-conditions (must be true before opening either PR)

1. **§19 Q16 answered**: secondary reviewer named *and* consented (written, in chat/email). Without consent, **DO NOT KICK OFF**.
2. **§19 Q17 answered**: deployer-key holder for Phase 5 funding identified + backup contact noted in `docs/comms/v7.1-fund-key-roster.md` (Phase 0 deliverable).
3. **§19 Q18 answered**: domain renewal for `samourai.app` + `samourai.live` confirmed with ≥ 30-day buffer.
4. Comms drafts authored as Phase 0 deliverables:
   - `docs/comms/v7.1-token-rotation.md` (used Day 1 — banner shown to users on auth-cookie invalidation)
   - `docs/comms/v7.1-channels-v3-cutover.md` (Phase 2)
   - `docs/comms/v7.1-betanet-launch.md` (Phase 5)
   - `docs/comms/v7.1-betanet-rollback.md` (rollback contingency)

### 4.1 Goals

* **CI green on `main`** with no `continue-on-error` / `|| true` shortcuts.
* **AUTH-CHAINID-01 fixed in production** before the 14-day window risk materialises.
* **Rollback path real** (rolling + GHCR mirror, not bluegreen).
* **Sentry source maps actually upload.**
* **Comms drafts banked.**

### 4.2 PR0a — CI Infrastructure, Auth Fix, Operational Safety (~4 h author, < 1 h review)

| ID | Action | Files | Verification |
|----|--------|-------|--------------|
| **a.1** | Go toolchain → **1.25.10** | `backend/go.mod`, `ci.yml:26`, `deploy-backend.yml:26`, `backend/Dockerfile:2` (pin `golang:1.25.10-alpine`) | `grep -RnE 'go(-version)? *: *.1.25' .github backend/go.mod backend/Dockerfile` returns only `1.25.10`. `govulncheck ./...` exits 0 locally. |
| **a.2** | `security.yml` → `go-version-file: backend/go.mod`. **Delete backend-audit job** (deduplicate vulncheck — keep ci.yml + govulncheck.yml). | `.github/workflows/security.yml` | grep returns only one place that runs govulncheck. |
| **a.3** | Pin `govulncheck` everywhere (no `@latest`) | `ci.yml:56`, `deploy-backend.yml:36`, `govulncheck.yml:27`. Use `golang.org/x/vuln/cmd/govulncheck@v1.1.4` (or current pinned). | All sites use the same version literal. |
| **a.4** | Pin `actions/checkout`, `actions/setup-go`, `actions/setup-node` to **commit SHA** — *defer per §19 Q11* in Rev2 (single follow-up PR for hygiene; not blocking) | — | Tracker issue filed |
| **a.5** | `deploy-backend.yml`: add `[deploy] strategy = "rolling"` in `fly.toml`. Add `--wait-timeout=300`. **Bluegreen is impossible** (volume + single-machine). | `backend/fly.toml`, `deploy-backend.yml` | flyctl deploy uses rolling explicitly |
| **a.6** | Flip `cancel-in-progress: false` on **both** `deploy-backend.yml` and `deploy-frontend.yml` (queue, not cancel) | both workflows | grep |
| **a.7** | **GHCR image mirror per release** — after `flyctl deploy`, tag the Fly image to GHCR (`docker pull` from Fly registry, `docker tag`, `docker push ghcr.io/samouraiworld/memba-backend:vX.Y.Z`). Document `flyctl image show` + GHCR pull as the actual rollback procedure. | new step in `deploy-backend.yml` | GHCR shows new image after deploy |
| **a.8** | Enable Fly volume snapshots: `fly volumes update memba_data --snapshot-retention 5`. Document restore drill in `docs/OPS_RUNBOOK.md` (Phase 0 deliverable). | manual + doc | `fly volumes snapshots list memba_data` returns ≥ 1 entry |
| **a.9** | Remove `\|\| true` from `deploy-frontend.yml:46` (silent audit forbidden) | `deploy-frontend.yml` | grep returns no audit-related hits |
| **a.10** | Wire `SENTRY_AUTH_TOKEN` into `deploy-frontend.yml` env + add an assertion step that source-map upload count > 0 | `deploy-frontend.yml` | Sentry "Releases" shows maps on next deploy |
| **a.11** | `frontend/Dockerfile`: bump default `VITE_GNO_CHAIN_ID` from `test11` to `test12` | `frontend/Dockerfile` | local docker build sets correct default |
| **a.12** | **AUTH-CHAINID-01 fix** with graceful token rotation: (a) inject real `ChainID` from request context into ADR-036 signDoc (`backend/internal/auth/crypto.go:324`); (b) add `chain_id` to auth-token cache key; (c) **add `tokenVersion` field**; accept old-format tokens for **24 h grace** then reject. Trigger banner via `docs/comms/v7.1-token-rotation.md` content. **Embargo PR description** for this section until v6.0.3 is in prod + Adena security contact ack. File advisory `docs/advisories/MEMBA-2026-001.md`. | `backend/internal/auth/crypto.go`, `backend/internal/auth/auth.go`, new `docs/advisories/MEMBA-2026-001.md` | `crypto_test.go` adds 4 table-driven cases: same-chain accept, cross-chain reject, missing-chain-id reject, malformed-chain-id reject. Also `FuzzMakeADR36SignDoc` Go fuzz target. |
| **a.13** | **HSTS header** in `netlify.toml`: `Strict-Transport-Security = "max-age=63072000; includeSubDomains; preload"` (one-line, zero blast radius). Defer CSP nonce to v7.2 (AD-09). | `netlify.toml` | curl response shows HSTS header |
| **a.14** | Tag **`v6.0.2`** (CI infra + AUTH fix). CHANGELOG entry. Deploy. Verify Sentry release shows source maps. | `CHANGELOG.md`, `git tag v6.0.2` | deploy verified at memba.samourai.app + Sentry maps present |

**PR0a acceptance (must hold before opening PR0b):**
- [ ] `gh pr checks` all SUCCESS.
- [ ] `govulncheck ./...` clean against `main`.
- [ ] AUTH-CHAINID-01 regression tests pass (4 table-driven cases + Go fuzz seed corpus).
- [ ] `v6.0.2` deployed; Sentry release shows source maps; GHCR mirror confirms image present.
- [ ] `flyctl releases rollback <prev-id>` dry-run succeeds (rolling deploy semantics).
- [ ] Token-rotation banner verified visible in staging-like flow.

### 4.3 PR0b — Frontend Deps, Overrides, Dep Policy, Dependabot Pause (~4 h author, < 1 h review)

| ID | Action | Files | Verification |
|----|--------|-------|--------------|
| **b.1** | `@clerk/clerk-react` → **`^5.61.6`** (NOT `@latest` — npm's `dist-tags.latest` is stale at 5.61.3). Add `package.json` `overrides`: `{ "@clerk/shared": "^3.47.5" }`. Also bump `@clerk/themes` to latest 2.x patch. | `frontend/package.json`, `package-lock.json` | `npm ls @clerk/shared` shows only ≥ 3.47.5. `npm audit --audit-level=high --omit=dev` Clerk-clean. |
| **b.2** | `dompurify` as direct dep `^3.4.2` + `overrides: { "dompurify": "^3.4.2" }` | `frontend/package.json`, `package-lock.json` | `npm ls dompurify` exactly one node at ≥ 3.4.2. |
| **b.3** | **Fold trivial Bucket-A patch bumps** (#315 sentry/react, #317 query-sync-storage-persister, #319 react-query-persist-client, #320 eslint-plugin-react-hooks, #322 typescript-eslint, #326 typescript, #327 react-query) into the same package.json edit. | `frontend/package.json`, `package-lock.json` | `npm ci` succeeds; `npm ls react @tanstack/react-query @sentry/react` shows single versions. |
| **b.4** | **Fold backend Bucket-A bumps** (#316 connectrpc, #318 cosmos-sdk, #328 sqlite) into `backend/go.mod` + `go.sum`. Run `backend/internal/auth` tests explicitly (cosmos-sdk regression check). | `backend/go.mod`, `backend/go.sum` | `go test ./...` green, especially `auth/` |
| **b.5** | Enable `actions/dependency-review-action@v4` on `pull_request` — blocks PRs introducing vulnerable deps. | new workflow or addition | Test PR with known-bad pin gets blocked |
| **b.6** | Author `docs/DEPENDENCY_POLICY.md` with: cadence, allowlist approval flow (max 14-day expiry — references §15.1), SLA (HIGH = 5 BD, CRITICAL = 48h), responsibility matrix, escalation path → `security@samourai.coop`, auto-merge rules for grouped patches, **Memba-specific exploitability notes for Clerk + dompurify** (no `has()`/`auth.protect()`/`createRouteMatcher` call sites; dompurify call sites use default config). | new `docs/DEPENDENCY_POLICY.md` | PR review |
| **b.7** | Update `.github/dependabot.yml`: groups (dev-deps, `@tanstack/*`, `@sentry/*`, `@clerk/*`, eslint family); **`ignore` major bumps**; **`open-pull-requests-limit: 0`** to pause during v7.1 (re-enabled in Phase 6). | `.github/dependabot.yml` | Next weekly cron produces 0 PRs |
| **b.8** | npm build defense-in-depth: `npm ci --ignore-scripts` on Netlify build (supply chain). | `netlify.toml` build cmd or Netlify env | Build succeeds without dep scripts |
| **b.9** | Local re-run: `npm run test` + `go test ./...` + `gno test ./...`. **OWASP DOMPurify regression test** (≥ 30 XSS vectors at 3 call sites: `NFTGallery.tsx:489`, `RealmDetailDrawer.tsx:164`, `SourceCodeView.tsx:116`). Cite each closed advisory GHSA ID in test names. | new `frontend/src/lib/sanitize.test.ts` | all green |
| **b.10** | Tag **`v6.0.3`** (frontend deps + policy). CHANGELOG. Deploy. Verify Sentry release. | — | Verified |
| **b.11** | Close Bucket A PRs (10) with comment + link; close Bucket B PRs (#323, #324, #325) + open 2 v7.2 tracker issues. | GitHub UI | `gh pr list --state open` shows only #314, #329 (plus any new) |
| **b.12** | Rebase + merge PR #314 (zxxma error-messages) — single review. | — | Merged |
| **b.13** | Rebase + merge PR #329 (rename) — **first verify author still has GitHub access** (`curl https://api.github.com/users/davd-gzl` returns valid profile) and re-ping for confirmation if any concern. | — | Merged |

**PR0b acceptance:**
- [ ] `npm audit --audit-level=high --omit=dev` exits 0 in CI.
- [ ] `npm ls @clerk/shared` shows only ≥ 3.47.5; `npm ls dompurify` exactly one node at ≥ 3.4.2 (**reviewer runs this against post-install lockfile, not pre-install**).
- [ ] OWASP DOMPurify regression test passes against all 3 call sites with all GHSA-cited vectors.
- [ ] `v6.0.3` deployed; Sentry release shows source maps; both v6.0.2 and v6.0.3 releases visible.
- [ ] Repo is at **0 open PRs** (or only fresh non-v7.1 PRs).

### 4.4 What Phase 0 explicitly does NOT do

* No `continue-on-error: true`, no `|| true`. Silent failure forbidden.
* No Clerk major (5 → 6).
* No Vite 8 / ESLint 10 (v7.2).
* No `toolchain` directive added to `go.mod`.
* No GitHub-Action-SHA pinning (v7.2 hygiene PR — Q11).
* No CSP nonce migration (v7.2 — AD-09).

---

## 5. Phase 1 — Foundation, Custody, Reviewer Gate (Days 3–7)

### 5.1 Steps

| ID | Action | Owner | Effort (± conf) |
|----|--------|-------|------------------|
| **1.1** | Push `samcrew-deployer:fix/mainnet-security-audit-v3`. **First test branch against current `samcrew-deployer:main`**; resolve conflicts. Open PR with all 5 commits' scope in description. **Reviewer ≠ author**. | zxxma + reviewer | **1.5 days** (high conf) |
| **1.1b** | `gnodaokit:fix/security-audit-v5-realm-fixes` — verify push status, open PR, merge + tag. | zxxma | 0.5 day (high conf) |
| **1.2** | Update `docs/planning/GNO_CORE_BREAKING_CHANGES.md`: `#5037`, `#5222` MERGED non-breaking; **`#5629` per-realm storage deposit (P0)**, `#5544` (P1 breaking), `#5511`, `#5546`, `#5307` tracking. | zxxma | 1 h (high conf) |
| **1.3** | Update 5 stale docs (`DEPLOYMENT_RUNBOOK.md`, `MAINNET_PREPARATION.md`, `ROADMAP.md`, `realm-versions.json`, `PROGRESSIVE_DECENTRALIZATION.md`). | zxxma | 2 h (high conf) |
| **1.4** | `chainHealth`: primary `test12-samourai`, fallback `test12-public`, `gnoland1` only when flagged. Monitor fallback usage in Sentry. | zxxma | 2 h (high conf) |
| **1.5** | gnoland1 transfer-lock probe (corrected path): `gnokey query params/bank:p:restricted_denoms -remote https://rpc.gnoland1.samourai.live:443` AND `params/auth:p:unrestricted_addrs`. Documents result. | zxxma | 30 min (high conf) |
| **1.6** | `.gitignore` SQLite WAL/SHM. | zxxma | 15 min |
| **1.7** | Refresh live-block table at top of plan. | zxxma | 15 min |
| **1.8** | **CODEOWNERS FIX** (after Q16 written consent in §4.0): add the named secondary reviewer for each path. Branch protection rules confirmed: required-status-checks include `Backend (Go)`, `Frontend (React · Node 22)`, `Proto (Buf)`, `Go Security Scan`, `Docker Build`. | zxxma | 30 min |
| **1.9b** | **AUTH-SESSION-REJECT-01** — defensive: backend rejects session-pubkey signatures (Adena 1.20+ multichain subaccount derivations). Must deploy to prod BEFORE next Adena release. Watch Adena release notes. | zxxma | 2 h (med conf) |
| **1.10** | Branch-protection screenshot in `docs/BRANCH_PROTECTION.md`. | zxxma | 15 min |
| **1.11** | **CUSTODY SPEC** (`MAINNET_PREPARATION.md` new "Custody" section): emergency multisig EOA signers (named roles, not people), M-of-N threshold, key storage medium (hardware wallet class + brand), geographic distribution, recovery sharded-seed location, signer-incapacitation procedure, rotation cadence (annual), dry-run schedule. **Required signoff by ≥ 2 Samourai Coop principals.** **Hard prerequisite for Phase 2.** | zxxma + 2 signers | **1 day** (med conf) |
| **1.12** | `SECRETS_ROTATION.md` expansion — add: `FLY_API_TOKEN`, `NETLIFY_AUTH_TOKEN`, `SENTRY_AUTH_TOKEN`, `SLACK_WEBHOOK_URL`, `OPENROUTER_API_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` ↔ `CLERK_SECRET_KEY` pairing rule, `ED25519_SEED_V{N}` versioning, admin multisig keys, GPG signing keys, DB master. Add top-level "Secret Coverage Matrix" table. | zxxma | 2 h (high conf) |
| **1.13** | `SECURITY.md` update: PGP fingerprint, GitHub Security Advisories enabled, "Resolved Advisories" table seeded with **MEMBA-2026-001 AUTH-CHAINID-01** (post-embargo), coordinated-disclosure protocol with Adena+Gno, embargo policy. | zxxma | 1 h |
| **1.14** | `docs/planning/V7_1_DOCS_INVENTORY.md` (master inventory of all docs created/updated in v7.1). | zxxma | 30 min |
| **1.15** | `docs/planning/V7_1_KT.md` (knowledge-transfer log; updated end-of-day). | zxxma | 15 min/day ongoing |

### 5.2 Acceptance criteria

- [ ] `samcrew-deployer:main` contains v3 audit fixes (verified by `git log`).
- [ ] `gnodaokit:main` contains v5 realm fixes (verified + tagged).
- [ ] Stale-doc grep returns 0 hits.
- [ ] chainHealth fallback live + monitored.
- [ ] Phase 5 gate: `restricted_denoms` result documented.
- [ ] CODEOWNERS has ≥ 2 reviewers per critical path (per Q16 confirmed consent).
- [ ] **Custody section in `MAINNET_PREPARATION.md` exists + signed by ≥ 2 principals.**
- [ ] AUTH-SESSION-REJECT-01 has a unit test; deployed in `v7.1.0-alpha` or `v6.0.4` if Adena 1.20 ships early.
- [ ] Branch-protection screenshot filed.
- [ ] DOCS_INVENTORY + KT files initialised.

---

## 6. Phase 2 — channels_v3 on test12 (Days 8–10)

**Gate (must hold before §6.1):** Custody section in `MAINNET_PREPARATION.md` exists + signed (Phase 1.11). Without it, the two-tier pause is theatre.

### 6.1 Why a v3

* Cross-realm caller hardening (per Gno expert: `PreviousRealm()` is correct for direct MsgCall; v3 prepares for cross-realm calls from membaDAO + candidature).
* Two-tier emergency pause (DAO **OR** emergency multisig EOA — per Phase 1.11 custody spec).
* Per-realm storage-deposit recalibration (Gno PR #5629).
* (Already in v2 audit branch:) events, role-string injection validator, threadLive AVL fix.

### 6.2 Steps

| ID | Action | Effort |
|----|--------|--------|
| **2.1** | Branch `feat/channels-v3`. Copy audit-hardened v2 → v3, bump `package` + `gno.mod`. | 30 min |
| **2.2** | Two-tier pause (DAO OR emergency EOA per custody spec). Audit-log: Sentry breadcrumb on every `Pause()` call. | 2 h |
| **2.3** | Cross-realm hardening: every function callable from `r/samcrew/memba_dao` or `r/samcrew/candidature` accepts explicit `caller address` arg OR uses `OriginCaller()`. | 2 h |
| **2.4** | Event-size verification: chain-emit caps `MaxEventPairs=64`, `MaxEventAttrLen=1024` bytes. Audit every `event.New(...)`. | 1 h |
| **2.5** | `gno test` + `gno lint` green. | 30 min |
| **2.6** | Per-realm storage deposit dry-run on test12: deploy with `--max-deposit 1ugnot` intentional underrun → read `_realmmeta_<path>` → set deposit `= 1.5 × measured`. | 1 h |
| **2.7** | Deploy via samcrew-deployer (verified idempotent on second run). | 1 h |
| **2.8** | On-chain verify: `Render`, ACL, **four pause scenarios** (DAO-allowed, EOA-allowed, random-EOA-denied, revoked-DAO-denied). | 1.5 h |
| **2.9** | Frontend: `channelsPath` → `_v3` in `config.ts`, run tests, push, deploy preview. `VITE_CHANNELS_REALM_VERSION` retained for runtime override. | 2 h |
| **2.10** | Manual smoke + **publish `docs/comms/v7.1-channels-v3-cutover.md` banner via in-app + Discord**. | 1 h |
| **2.11** | Document migration of any existing v2 threads on test12. | 30 min |

### 6.3 Acceptance criteria

- [ ] `r/samcrew/memba_dao_channels_v3` live on test12.
- [ ] All tests green after cutover.
- [ ] Four pause cases verified (negative + positive).
- [ ] Every `event.New` audited against caps.
- [ ] Storage-deposit methodology documented (Phase 5 reuses for gnoland1).
- [ ] Channels cutover banner fired.

### 6.4 Risks

| Risk | Mitigation |
|------|------------|
| v2 audit branch needs partial merge into v3 | Phase 1.1 lands first; v3 = clean copy of audit-hardened v2 |
| Deployer idempotency unverified | §2.7 explicit second-run test |
| Emergency EOA key custody | Per Phase 1.11 spec |
| Event-cap silently truncates | §2.4 audit |

---

## 7. Phase 3 — React Query Migration (Days 11–21)

### 7.1 Current state (Rev1 correction)

RQ already used **section-scoped** in `GnoloveLayout.tsx` (~18 `useQuery` in `hooks/gnolove/index.ts`). No app-root provider. §3.1 mounts one.

### 7.2 Approach

Page-by-page. Financial paths first. One PR per page. **E2E gates are mocked-sign-hook component tests, not real Adena E2E** — real E2E deferred to v7.2 (QA finding).

### 7.3 Steps

| ID | Action | Effort (± conf) | Tests |
|----|--------|------------------|-------|
| **3.0** | (Optional, dependent on Q-spike) Adena-mock fixture for real E2E. If skipped, downgrade all "E2E" gates to "component test with mocked sign hook." | **2 d (low conf)** | Adena mock fixture |
| **3.1** | Root `QueryClientProvider` in `App.tsx` via new `MembaQueryProvider.tsx`. Keep gnolove section-scoped client unchanged (**AD-11**). `queryKeys.ts`, `useGnoQuery`, `useGnoMutation`, `useGnoQueries`. Sentry breadcrumbs. | 1.5 d (high) | Helper unit tests |
| **3.2** | DAO read hooks. | 1 d (high) | Component tests |
| **3.3** | DAO mutations w/ optimistic update + explicit `invalidateQueries`. | 1 d (high) | **Component test with mocked sign hook** (E2E deferred to v7.2 unless 3.0 ships) |
| **3.4** | Multisig hooks. | 2 d (med) | **Component test with mocked sign hook** |
| **3.5** | Token hooks (cache key includes `chainId`). | 2 d (high) | Balance polling tests |
| **3.6** | Persister: `persistQueryClient({ buster: chainId })` (NOT `migrate` — that callback doesn't exist on RQ v5). Add `serialize` filter stripping Clerk session/token data. | 0.5 d (high) | Cache-bust **via MemoryPersister fixture** (deterministic) |
| **3.7** | Stale-time matrix: GNOT `15s` + `refetchInterval: 15000`, DAO members `5 min`, proposals `30s`, profile `15 min`. `refetchOnWindowFocus: false` globally. | 0.5 d (high) | Visible in defaults |
| **3.8** | Remove dead `useEffect` fetchers. | 0.5 d (high) | TS no-error |
| **3.9** | Profiler: render counts before/after. **Sentry event-quota check** before instrumentation rollout. | 0.5 d (med) | Numeric report attached to PR |
| **3.10** | Optional spike: `useSuspenseQuery` for gnolove section. | 0.5 d (low) | gnolove regression |

### 7.4 Acceptance criteria

- [ ] All financial paths route through RQ.
- [ ] Cache misses don't double-fetch.
- [ ] **Chain-switch evicts persisted store** — verified via MemoryPersister test (not network panel).
- [ ] Frontend coverage holds ≥ 56 % (target 62 % in Phase 4).
- [ ] No memory leak after 30-min idle (DevTools snapshot).
- [ ] Persisted cache never contains Clerk tokens (unit test on `serialize` filter).
- [ ] Bundle main < 600 KB. If exceeded, RQ moves into `vendor-data` manualChunk.

---

## 8. Phase 4 — Quality, Coverage, Observability (Days 14–26, overlaps Phase 3)

> Overlap rule: Phase 4 PRs must target untouched layers (backend `internal/service/*`, util tests, Gno realm tests) during Phase 3.

### 8.1 Coverage targets — critical-path manifest, not just numeric

| Layer | Aggregate target | Per-file critical path |
|-------|------------------|------------------------|
| Backend | 22 % → **40 %** (ci.yml:39 `20` → `40`; :43 `50` → `55`) | `internal/auth/*.go` ≥ **80 %**, `internal/service/{multisig,proposal,vote}_rpc.go` ≥ **70 %** |
| Frontend | 56 % → **62 %** (add hard gate to ci.yml — currently artifact-only) | `frontend/src/lib/{multisig,sign,broadcast}.ts` ≥ **80 %** |
| Gno | n/a | maintain green |

CI fails on **either** aggregate or critical-path manifest, whichever is stricter.

### 8.2 Observability deliverables

| Item | Phase |
|------|-------|
| Sentry release `memba@v7.1.0` (backend + frontend) | Phase 6 release |
| Backfill maps for `memba@v6.0.2` / `v6.0.3` if needed (Sentry release finalize check) | Phase 0 verification |
| Backend SBOM (`cyclonedx-gomod`) | Phase 4 |
| Frontend SBOM (existing) | already in `security.yml` |
| "Memba Health" dashboard: ConnectRPC error rate, ABCI P50/P95/P99, govulncheck status | Phase 4 |
| Alert: error rate > 1 % over 5 min → Slack webhook (`SLACK_WEBHOOK_URL`) | Phase 4 |
| Alert: `govulncheck.yml` regression → `peter-evans/create-issue-from-file@v5` + Slack | Phase 4 |
| RQ instrumentation: duration histogram + cache hit ratio (Sentry breadcrumbs) — **only after Sentry event-quota check** | Phase 3 |
| User-flow analytics — AD-14 decides PostHog vs Sentry Performance by Day 13 | Phase 4 |
| `gitleaks-action` secret scanning | Phase 4 |
| GitHub Dependabot alerts → Slack | Phase 4 |

### 8.3 Static quality

- [ ] `golangci-lint run` clean.
- [ ] `tsc --noEmit` 0.
- [ ] `npm run lint` 0.
- [ ] Bundle main < 600 KB. `rollup-plugin-visualizer` devDep + `npm run build:analyze`.
- [ ] `actions/dependency-review-action@v4` active.

### 8.4 PII boundary (carried)

- No plaintext addresses logged. `addr_hash = sha256(address)[:8]`.
- RQ persisted cache **MUST NOT** contain Clerk tokens (Phase 3.6 `serialize` + unit test).

---

## 9. Phase 5 — Betanet (gnoland1) Deployment (Days 23–29)

### 9.0 Change freeze

**24 h before §9.1 step 5.1 through 24 h after Phase 5.8 betanet activation: merge freeze.** Only hotfix branches accepted. Documented in `docs/OPS_RUNBOOK.md`.

### 9.−1 Betanet go/no-go signed decision

**Hard prereq:** `docs/reports/v7.1-betanet-gono.md` co-signed by ≥ 2 Samourai Coop principals, citing the channels_v3 30-day field-proven evidence on test12 (AD-13). Filed and committed.

### 9.1 Gates (ALL must pass)

1. Phase 1.5 transfer-lock probe returns `restricted_denoms = []` (or this realm's deployer in `unrestricted_addrs`).
2. `gnodaokit:main` contains v5 audit fixes (merged + tagged).
3. `samcrew-deployer:main` contains v3 audit fixes (Phase 1.1).
4. Phase 2.6 storage-deposit sizing applied to gnoland1 via test12 measurement.
5. channels_v2 state on gnoland1 snapshotted (if non-empty) + disposition documented.
6. Custody section in `MAINNET_PREPARATION.md` exists + signed (Phase 1.11).
7. Betanet go/no-go file co-signed (§9.−1).
8. **Pair-deploy:** zxxma + 1 other operator present for every chain-mutating TX (Adversarial finding — solo deploy at Day 25 fatigue is unsafe).

### 9.2 Steps

| ID | Action | Effort (± conf) |
|----|--------|------------------|
| **5.0** | gnoland1 pre-checks: channels_v2 state snapshot if non-empty; confirm all 8 gates. | 30 min (high) |
| **5.1** | Fund deployer key ~60 GNOT (Q17-named holder). Chain-height verification (`/status` advancing). | depends |
| **5.2** | `./samcrew-verify.sh betanet` — deployer balance, ACL, realm gaps. | 30 min |
| **5.3** | **Pair-deploy in PREFLIGHT order**: gnodaokit → tokenfactory → memba_dao → candidature → channels_v3 → badges. Per step: deposit-key balance check + `abci_query _realmmeta_<path>` as success oracle. | 4 h (med) |
| **5.4** | Frontend network support; `realm-versions.json` updated. | 1 h |
| **5.5** | Feature flag activation (Netlify env): `VITE_BETANET_FEATURES_ENABLED=true` ONLY after §5.8 (announcement first, then flip). | 30 min |
| **5.6** | Betanet smoke: connect (Adena 1.19+ multichain), propose, vote, exec, mint, transfer. | 2 h |
| **5.7** | `MAINNET_PREPARATION.md`: actual tx hashes, addresses, deposits, gas. | 30 min |
| **5.8** | **Comms FIRST**: publish `docs/comms/v7.1-betanet-launch.md` to Discord + in-app banner. Then §5.5 flag flip (order matters — Adversarial finding). | 1 h |

### 9.3 Gas config (gnoland1)

* Fee: 10 M ugnot.
* Wanted: **80 M baseline; re-measure** before deploy (Gno #5629 gas calibration).
* Deposit: **dynamic** per Phase 2.6 methodology.

### 9.4 Rollback — see §15.4.

---

## 10. Phase 6 — Polish & v7.1.0 Release (Days 29–33)

### 10.1 Change freeze

**24 h before tag → 24 h after deploy.** Only hotfix branches.

### 10.2 Items

| Item | Status target |
|------|---------------|
| CSP nonce strategy documented (Vite plugin + Netlify edge) | Documented; ship in v7.2 (AD-09) |
| HSTS shipped in Phase 0a — verify | Verified |
| Jargon audit of UI strings | Complete |
| `parserV2` (boards2 safe-funcs) | Optional |
| Full regression on test12 + (conditional) gnoland1 | Pass |
| Bundle < 600 KB, TS 0, lint 0, critical-path coverage manifest met | Pass |
| **GPG-signed tag** `v7.1.0`: `git tag -s v7.1.0`; publish maintainer fingerprints in `SECURITY.md` | Filed |
| **`docs/OPS_RUNBOOK.md`** complete: weekly dependabot triage, monthly govulncheck regression review, quarterly secret rotation, rollback drill cadence | Filed |
| **`DISCLAIMER.md`** updated for Phase 5: betanet pre-mainnet caveat, channels v3 emergency pause notice, multisig custody acknowledgement, jurisdictional disclaimer | Filed |
| Re-enable dependabot: `open-pull-requests-limit: 10` on frontend, `5` on backend (revert pause) | Filed |
| GitHub Actions SHA-pinning follow-up issue filed (D-03) | Filed |
| `CHANGELOG.md` v7.1.0 entry; deploy; verify; Sentry release `memba@v7.1.0` | Pass |
| **Cross-Perspective Review** filed at `docs/reports/v7.1-review.md` | Filed |

---

## 11. Cross-Repo Coordination

| Repo | Phase | Required |
|------|-------|----------|
| `samcrew-deployer` | 1.1, 2.7, 5.3 | v3 audit merged + idempotent deploy CLI verified + **branch tested against current `main` BEFORE PR** |
| `gnodaokit` | 1.1b, 5.3 | v5 realm fixes merged + tagged |
| `tokenfactory` | 5.3 | Redeploy for gnoland1 (PREFLIGHT step 2) |
| `gno` upstream | 1.2 (track) | #5629, #5544, #5511, #5546, #5307 — defensive notes only |
| `gnolove` | 0, 3 (reference) | No direct dep |
| `adena-wallet` | 5, future v8 | v1.19.0+ confirmed; **monitor for 1.20+ release** during Phase 1 |

---

## 12. Architecture Decision Records

| ID | Decision | Status | Introduced-at SHA (pinned at merge) |
|----|----------|--------|-------------------------------------|
| **AD-01a** | Phase 0 **split** into PR0a (CI infra + AUTH) + PR0b (frontend deps + policy), both same-day | Proposed | TBD |
| **AD-01b** | Bucket-A trivial bumps **folded** into PR0a/PR0b | Proposed | TBD |
| **AD-02** | Go `1.25.10`; Dockerfile pinned `golang:1.25.10-alpine` | Proposed | TBD |
| **AD-03** | Stay on Clerk 5.x; **pin `^5.61.6` explicitly (not `@latest` — stale dist-tag)** | Proposed | TBD |
| **AD-04** | dompurify **direct dep + overrides** (belt + braces) | Proposed | TBD |
| **AD-05** | Defer ESLint 10, Vite 8 to v7.2 with spike budgets | Proposed | TBD |
| **AD-06** | channels v3 suffix `_v3`; test12 keeps `_v2` live | Proposed | TBD |
| **AD-07** | RQ persister **buster: chainId**; gnolove section-scoped client kept separate | Proposed | TBD |
| **AD-08** | Betanet deploy gated on 8 prereqs (§9.1) | Proposed | TBD |
| **AD-09** | CSP nonce shipped in v7.2; HSTS in v7.1 (Phase 0a) | Proposed | TBD |
| **AD-10** | Observability is a release deliverable | Proposed | TBD |
| **AD-11** | Section-scoped RQ for gnolove + app-root RQ for core (two caches) | Proposed | TBD |
| **AD-12** | Dependabot `groups` + ignore-major; **pause via `open-pull-requests-limit: 0` during v7.1** | Proposed | TBD |
| **AD-13** | Betanet `_v2` only after `_v3` field-proven ≥ 30 days | Proposed | TBD |
| **AD-14** | User-flow analytics: decide PostHog vs Sentry Performance by Day 13 | Proposed | TBD |
| **AD-15** | One-time zxxma-self-merge for Phase 0 if no secondary reviewer confirmed; **otherwise BLOCKED** | Proposed | TBD |
| **AD-16** | **Rolling deploy + GHCR image snapshot per release** (NOT bluegreen — incompatible with volume + single-machine) | Proposed | TBD |
| **AD-17** | AUTH-CHAINID-01 fix uses **token-version field with 24h grace** to avoid forced re-login storm | Proposed | TBD |
| **AD-18** | All v7.1 release tags are **GPG-signed** | Proposed | TBD |
| **AD-19** | Phase 5 betanet deploys are **paired** (2 operators) | Proposed | TBD |
| **AD-20** | Pre-mainnet AUTH disclosure: **embargoed PR description until prod deploy + Adena ack** | Proposed | TBD |

---

## 13. Risk Register (Rev2)

| ID | Risk | L | I | Detection | Mitigation |
|----|------|---|---|-----------|------------|
| R-01 | Clerk 5.61.6 unavailable | LOW | HIGH | npm registry check | Confirmed published 2026-04-30; informational |
| R-02 | dompurify 3.4.2 breaks call sites | LOW | MED | OWASP regression suite | §4.3 b.9 corpus test |
| R-03 | Go 1.25.10 runtime regression | LOW | HIGH | race tests + integration | Rolling deploy + GHCR image rollback (AD-16) |
| R-04 | Dependabot pile-up | LOW | LOW | (paused during v7.1) | AD-12 groups + pause |
| R-05 | Channels v3 deploy reverts on test12 | LOW | MED | post-deploy `Render` | Idempotent deployer; `_v2` parallel; emergency EOA pause |
| R-06 | RQ stale data on multisig | MED | HIGH | E2E mocked sign + manual canary | Stale-time matrix; explicit `invalidateQueries` |
| R-07 | gnoland1 transfer-lock still on | MED | MED | §1.5 probe | Defer Phase 5; ship test12-only v7.1; §14 conditional DoD |
| R-08 | Public test12 RPC down | MED | LOW | chainHealth probe | Samourai sentry primary |
| R-09 | Sentry SM upload silently fails | RESOLVED in Phase 0a | — | Assertion step | a.10 |
| R-10 | Major-bump deferrals age | LOW | LOW | weekly dep watch (post-v7.1) | Spike budgets for v7.2 |
| R-11 | RQ cache shape change | MED | LOW | `buster: chainId` rotates | One-time eviction |
| R-12 | **Reviewer SPOF** | MED | MED | Q16 written consent gate | **HARD GATE — Phase 0 BLOCKED without confirmation** |
| R-13 | Cross-chain auth replay | MITIGATED in Phase 0a | — | crypto_test table-driven + Go fuzz | a.12 + AD-17 graceful rotation |
| R-14 | Adena 1.20+ session pubkey mismatch | MED | MED | release notes watch | Phase 1.9b — must deploy before Adena 1.20 |
| R-15 | Per-realm storage deposit underfunds | MED-HIGH | HIGH | test12 dry-deploy | Phase 2.6 sizing |
| R-16 | Dockerfile rolling-tag non-reproducible | LOW | MED | grep + reproducible build | Phase 0 pins `1.25.10-alpine` |
| R-17 | Phase 4/3 file conflicts | MED | LOW | PR review | Layer separation rule |
| R-18 | Deploy concurrency cancellation | LOW | LOW | concurrency: false | Phase 0a a.6 |
| **R-19** | Playwright E2E hits live test12; outage breaks CI | HIGH | LOW | CI fail rate | MSW mock layer (§17.4) |
| **R-20** | Domain renewal lapses (`samourai.app`/`samourai.live`) | LOW | CRITICAL | calendar | Q18 autopay + 30-day buffer |
| **R-21** | Fly release image GC'd before rollback need | MED | HIGH | release list | GHCR mirror (AD-16) |
| **R-22** | Adena 1.20+ ships before AUTH-SESSION-REJECT-01 deploys to prod | MED | MED | Adena watch | Phase 0/1 priority |
| **R-23** | npm `@clerk/clerk-react@latest` is stale 5.61.3 — careless re-pin reverts | HIGH | HIGH | `npm dist-tag ls` | Explicit `^5.61.6` + dependabot ignore + DEPENDENCY_POLICY note |
| **R-24** | Sentry release finalized w/o maps — cannot retro-attach | MED | LOW | release view | New release names per tag (v6.0.2, v6.0.3) |
| **R-25** | samcrew-deployer 5 commits don't merge cleanly to its main | MED | MED | pre-PR conflict check | +0.5d to Phase 1.1 |
| **R-26** | Phase 0 PR triggers both deploys simultaneously | LOW-MED | MED | workflow timeline | Split PR0a/PR0b ensures sequential |
| **R-27** | Dependabot reopens new PRs during merge bus | (MITIGATED) | — | — | Paused via `open-pull-requests-limit: 0` |
| **R-28** | Custody spec missed → channels v3 ships without pause oversight | (MITIGATED) | — | Phase 1.11 hard gate | Hard prereq for Phase 2 |
| **R-29** | Single-operator typo on chain-mutating gnoland1 deploy at Day 25 fatigue | MED | HIGH | logs after-the-fact | Pair-deploy (AD-19); change freeze (§9.0) |
| **R-30** | AUTH-CHAINID-01 disclosure leaks to ecosystem before Adena coordinated | LOW | HIGH | PR description embargo | AD-20 embargo until prod + Adena ack |

---

## 14. Acceptance Criteria, DoD, SLO, Stop-Work Trigger

### 14.1 v7.1.0 Definition-of-Done

A v7.1 release is **DONE** when ALL of:

- [ ] CI green on `main` continuously for ≥ 5 calendar days AND last 5 merged PRs were green at merge time.
- [ ] All §3 PRs disposed (merged / closed with rationale).
- [ ] All Phase 0–6 acceptance checkboxes ticked.
- [ ] `govulncheck` zero findings on `main`.
- [ ] `npm audit --audit-level=high --omit=dev` zero findings.
- [ ] Backend ≥ 40 % aggregate AND critical-path manifest met. Frontend ≥ 62 % aggregate AND critical-path manifest met.
- [ ] Channels v3 live on test12; frontend routes v3 by default; **all 4 pause cases verified**.
- [ ] React Query is sole data layer for GNOT balance, multisig list+detail, DAO proposals, votes, token balances. Cache-busts on chainId switch (deterministic test).
- [ ] Sentry shows **`memba@v6.0.2`, `v6.0.3`, `v7.1.0`** releases with source maps.
- [ ] AUTH-CHAINID-01 shipped (Phase 0a) AND regression suite passes (4 table-driven + Go fuzz).
- [ ] AUTH-SESSION-REJECT-01 shipped AND unit-tested.
- [ ] Advisory `MEMBA-2026-001` filed; Adena coordinated disclosure complete.
- [ ] Custody section in `MAINNET_PREPARATION.md` signed by ≥ 2 Samourai Coop principals.
- [ ] `v7.1.0` is **GPG-signed**.
- [ ] DISCLAIMER.md updated for betanet + channels v3 + multisig custody.
- [ ] `docs/OPS_RUNBOOK.md` complete; SECRETS_ROTATION coverage matrix complete.
- [ ] Conditional: if Phase 5 shipped, betanet smoke pass required + `docs/reports/v7.1-betanet-gono.md` co-signed. If Phase 5 deferred, `docs/reports/v7.1-betanet-deferral.md` filed with rationale.
- [ ] Cross-Perspective Review filed.

### 14.2 SLO (operational definition of "broken")

For `memba.samourai.app`:

| Signal | Target |
|--------|--------|
| Error rate (per Sentry, all surfaces) | < 1 % over rolling 5 min |
| `/health` HTTP 200 | > 99.5 % over 24 h |
| Login flow (connect wallet → main app) success | > 99 % |
| Deploy MTTR (incident detection → rollback complete) | < 10 min |

Breach in any → page zxxma + change freeze + post-mortem.

### 14.3 Stop-work trigger

**Day 17 check**: if Phase 3 ≤ 50% of acceptance criteria met, **drop Phase 5 to test12-only** decision is recorded in `docs/reports/v7.1-scope-decision.md`. Decision owners: zxxma + secondary reviewer (per Q16).

### 14.4 Post-release ops (in `docs/OPS_RUNBOOK.md`)

- Weekly: dependabot triage review.
- Monthly: govulncheck regression review.
- Quarterly: secret rotation drill.
- Annual: emergency multisig custody rotation drill (per Phase 1.11 spec).

---

## 15. Rollback Playbooks

### 15.1 Phase 0a/0b rollback

* **Never roll back past `v6.0.1`** (current `main`'s effective audit floor — pre-Phase 0 reference).
* Forward-fix preferred via hotfix PR.
* If `govulncheck` finds new vuln after Go bump, allowlist via `-skip` with **14-day expiry** + tracker issue.
* AUTH-CHAINID-01 backout: graceful — `tokenVersion=0` still accepted for 24 h. Rolling back to v6.0.1 retains acceptance.

### 15.2 Channels v3 rollback

1. Frontend `VITE_CHANNELS_REALM_VERSION=v2`. Redeploy Netlify (~1 min).
2. Emergency multisig EOA invokes `Pause()` (immediate; no DAO vote latency).
3. In-app banner.

### 15.3 React Query rollback (per-page)

1. Revert page-level PR. RQ infrastructure stays inert without callers.
2. If `MembaQueryProvider` root mount itself fails, revert `App.tsx` mount; gnolove section-scoped client unaffected.

### 15.4 Betanet rollback

1. Pause realm via DAO OR emergency multisig EOA (immediate).
2. `realm-versions.json` to `_vN+1`.
3. **Comms within 15 min**: publish `docs/comms/v7.1-betanet-rollback.md` (pre-recorded).

### 15.5 Backend rollback (Fly) — **rolling, NOT bluegreen**

**Pre-condition (Phase 0a a.5):** `[deploy] strategy = "rolling"` in `fly.toml`; `--wait-timeout=300`. Per-release **GHCR image mirror** (a.7).

**Canonical rollback:**
```bash
# Option A — Fly's release list (if image still in registry)
flyctl releases rollback <id> -a memba-backend

# Option B — GHCR mirror (authoritative when Fly retention expires)
flyctl deploy --image ghcr.io/samouraiworld/memba-backend:vX.Y.Z -a memba-backend
```

**Accept brief downtime** (~30 s on single-machine rolling).

### 15.6 v7.1 full rollback

1. `git revert` release commit; re-tag previous good as `v7.1.0-rollback`.
2. Fly rollback via GHCR (15.5); Netlify rollback to previous deploy.
3. Post-mortem at `docs/reports/v7.1-postmortem.md`.

### 15.7 Rollback drill (PRE-PHASE-5)

**Before Phase 5 kickoff**, execute a live rollback drill on a throwaway revision:
- Fly rollback time-to-traffic: target < 5 min.
- Netlify rollback to prev deploy: target < 2 min.
- Volume snapshot restore: target < 10 min.
Record times in `docs/reports/v7.1-rollback-drill.md`.

---

## 16. Observability & Telemetry

(Unchanged from Rev1 except: source-map fix moved to Phase 0a; Sentry event-quota check added before RQ instrumentation; alert mechanism specified; GHCR mirror status visible in dashboards.)

---

## 17. Test Plan

### 17.1 Categories

| Category | Tool | Status |
|----------|------|--------|
| Unit (frontend) | Vitest + jsdom | Live |
| Component | Vitest + Testing Library | Live |
| Unit (backend) | `go test -race` | Live (+ AUTH-CHAINID-01 regression, +Go fuzz `FuzzMakeADR36SignDoc`) |
| Integration | `go test` w/ mocked RPC | Live |
| E2E — page render | Playwright (chromium only in CI) | Live (175 tests; no Adena/sign flows) |
| E2E — Adena sign flows | Adena mock fixture (Phase 3.0 spike OR v7.2) | **Not live today** |
| Gno realm | `gno test` | Live |
| Security | govulncheck pinned, npm audit (--omit=dev), Trivy, `actions/dependency-review-action@v4` | Phase 0 |
| Lint | golangci-lint, eslint, tsc, gno lint | Live |
| Sanitizer regression | Vitest + OWASP DOMPurify corpus (≥ 30 vectors at 3 sites) | Phase 0b |
| Cache invalidation | Vitest + MemoryPersister fixture | Phase 3.6 |
| Smoke (manual) | `docs/SMOKE_CHECKLIST.md` — **TO BE WRITTEN in Phase 0** (does not exist today) | Phase 0/6 |

### 17.2 Per-phase gates

| Phase | Must-pass |
|-------|-----------|
| 0a | CI green; AUTH-CHAINID-01 4-case table + Go fuzz; Sentry source maps verified for v6.0.2 |
| 0b | CI green; OWASP DOMPurify corpus pass; v6.0.3 deployed; PR backlog cleared |
| 1 | All green; AUTH-SESSION-REJECT-01 unit test; Custody section signed |
| 2 | Channels v3 4-case pause; storage-deposit methodology documented |
| 3 | RQ chain-bust verified (MemoryPersister test, not network panel); coverage non-decreasing |
| 4 | Aggregate + critical-path manifest met; observability dashboards visible |
| 5 | Betanet smoke; pair-deploy verified; comms-first ordering verified |
| 6 | Full regression; GPG-signed tag; cross-perspective review filed |

### 17.3 Negative-test strategy (new)

Each category requires at least one test:
- Network failure (RPC down, timeout).
- Signature rejection (Adena denies).
- Chain mismatch (`X-Chain-ID` ≠ token's chain).
- Paused realm (channels v3 in `Pause()` state).
- Throttled RPC (429).
- Stale block height (chain head < cached).
- Persisted-cache corruption (corrupt JSON in `localStorage`).
- Time skew (client clock ahead/behind).
- Concurrent sign by two signers on same multisig tx.

### 17.4 Test data provisioning (new)

* Playwright + Vitest component tests: **MSW mock at `gnoclient` boundary** (Phase 3.0 prereq for RQ migration). Reserve live test12 for the manual smoke checklist.
* Backend integration: mocked Gno RPC fixtures in-repo.
* Manual smoke: live test12 + (Phase 5) live gnoland1.

### 17.5 Manual-vs-automated boundary (new)

* **Playwright** = page-render + form-validation smoke only. No wallet/sign/broadcast/vote flows today.
* **Adena sign flows** = manual until v7.2 ships Adena mock fixture (or Phase 3.0 budget approved).
* **`docs/SMOKE_CHECKLIST.md`** = the authoritative manual list, updated each release.

---

## 18. Sequencing, Critical Path, PTO Float

```
Day 1     Phase 0a (PR0a CI+AUTH)  → v6.0.2
Day 1-2   Phase 0b (PR0b deps)     → v6.0.3 + PRs #314, #329
Day 3-7   Phase 1 (foundation + custody + reviewer + KT init)
Day 8-10  Phase 2 (channels v3 on test12)
Day 11-21 Phase 3 (RQ migration)  ───┐
Day 14-26 Phase 4 (quality/obsv)     │ overlap; layer-separated PRs
Day 23-29 Phase 5 (betanet — paired) │  (gated on §9.1)
Day 29-33 Phase 6 (polish + release)

Total working days: 33
PTO/sickness/hotfix reserve: 5 days
Calendar window: 6 weeks (~38 days)
```

**Hard gates:**
* Phase 0 → everything else.
* Phase 1.11 (custody) → Phase 2.
* §9.1 8-gate set → Phase 5.

**Day 17 stop-work check** (§14.3).

**No merges Fri 15:00 local → Mon 09:00 local** during Phase 0, Phase 2 cutover, Phase 5 betanet activation, and v7.1.0 release windows (SRE on-call rule for single-operator project).

**Estimate confidence labels** (rough rule of thumb):
- High = ±15 %. Low = ±50 %. Phase 3 (11 d) and Phase 5 (7 d) carry the most uncertainty due to first-of-kind work (chain-bust + #5629 deposit sizing).

---

## 19. Open Questions for Approval (18 items)

| Q | Question | Default |
|---|----------|---------|
| Q1 | Phase 0 timing — today or wait? | **Today** (after Q16/Q17/Q18 confirmed) |
| Q2 | Clerk 5.x patch vs major? | **Stay 5.x, pin `^5.61.6` explicitly** |
| Q3 | dompurify direct pin + overrides? | **Both (belt + braces)** |
| Q4 | Allowlist for unfixed advisory? | **No unless required; 14-day expiry** |
| Q5 | Channels v3 — migrate v2 threads or fresh start? | **Fresh start** on test12 |
| Q6 | RQ — touch GnoBuilders/NFT or defer? | **Defer to v7.2** |
| Q7 | Betanet activation: hard cutover or progressive? | **Hard cutover (small user base)** |
| Q8 | Weekly minor cadence (v7.1.x) for patches? | **Yes** |
| Q9 | v6.0.2 / v6.0.3 as tagged releases or silent PRs? | **Tagged** |
| Q10 | Cross-Perspective Review reviewers — same or external? | **Same** |
| Q11 | Pin GH Actions to SHAs in v7.1 or defer? | **Defer to v7.2** (single follow-up PR) |
| Q12 | Deduplicate vulncheck workflows in Phase 0a a.2? | **Drop duplicate** in security.yml |
| Q13 | AUTH-CHAINID-01 — Phase 0a hotfix (v6.0.2) or wait? | **Phase 0a hotfix** with token-version grace |
| Q14 | AD-14 user-flow analytics — PostHog or Sentry Performance? | **Decide by Day 13** |
| Q15 | Phase 5 fallback if transfer-lock still on? | **Defer Phase 5**; pursue whitelist via GovDAO in parallel |
| **Q16** | **Who is the secondary reviewer (CODEOWNERS) and have they consented?** Default: **BLOCK Phase 0 until written consent recorded in `docs/comms/v7.1-reviewer-roster.md`.** | TBD by zooma |
| **Q17** | **Who funds the deployer key (~60 GNOT) on gnoland1 + backup contact?** Default: **BLOCK Phase 5 until named in `docs/comms/v7.1-fund-key-roster.md`.** | TBD by zooma |
| **Q18** | **Domain renewal status for `samourai.app` + `samourai.live`?** Default: **verify autopay + 30-day buffer before Phase 0.** | TBD by zooma |

---

## 20. Appendices

### 20.1 PR #329 micro-checklist

```bash
# After Phase 0b lands:
gh pr view 329 --comments
curl -s https://api.github.com/users/davd-gzl | jq .login   # author still active?
git fetch origin pull/329/head:pr-329 && git checkout pr-329
grep -ri MikaelVallenet frontend/src    # only line 57 of gnoloveConstants.ts
curl -s https://api.github.com/users/mvallenet | jq .login   # confirm casing
# ping davd-gzl if any ambiguity
gh pr review 329 --approve
gh pr merge 329 --squash --delete-branch
```

### 20.2 Phase 0a + 0b PR commit message templates

See [`MEMBA_V7_1_PR_TRIAGE.md`](MEMBA_V7_1_PR_TRIAGE.md) §4 for the day-1 sequencing. Templates:

**PR0a (v6.0.2):**
```
chore(ci+auth): unblock CI, AUTH-CHAINID-01 hotfix, rollback hardening

* go: 1.25.9 → 1.25.10 (go.mod, ci.yml, deploy-backend.yml, backend/Dockerfile pinned 1.25.10-alpine)
* security.yml → go-version-file; drop redundant backend-audit job
* govulncheck pinned @v1.1.4 in all sites
* deploy-frontend.yml: remove `|| true`; wire SENTRY_AUTH_TOKEN; assert SM upload
* frontend/Dockerfile: VITE_GNO_CHAIN_ID test11 → test12
* fly.toml: [deploy] strategy = "rolling"; --wait-timeout=300
* deploy-*.yml: cancel-in-progress: false (queue, not cancel)
* New: GHCR image mirror per release; volume snapshot retention 5
* AUTH-CHAINID-01: inject ChainID into ADR-036 signDoc; add chain_id cache key; tokenVersion field w/ 24h grace
* HSTS header in netlify.toml
* New: docs/comms/v7.1-token-rotation.md, docs/advisories/MEMBA-2026-001.md (embargoed body)
* Tag: v6.0.2
```

**PR0b (v6.0.3):**
```
chore(deps): frontend audit clean — Clerk 5.61.6, dompurify 3.4.2, +8 trivial patches, dep policy

* @clerk/clerk-react: 5.61.4 → ^5.61.6 (NOT @latest — dist-tag stale)
* overrides: { @clerk/shared: ^3.47.5, dompurify: ^3.4.2 }
* @clerk/themes: latest 2.x patch
* dompurify: direct dep ^3.4.2
* Folded: #315, #316, #317, #318, #319, #320, #322, #326, #327, #328
* Closed: #323 (superseded), #324 (defer v7.2), #325 (defer v7.2)
* New: docs/DEPENDENCY_POLICY.md (enforceable: SLA, escalation, exploitability notes)
* .github/dependabot.yml: groups + ignore-major + open-pull-requests-limit: 0 (paused for v7.1)
* actions/dependency-review-action@v4 on pull_request
* netlify build: npm ci --ignore-scripts
* New: OWASP DOMPurify regression test (3 call sites, ≥ 30 vectors)
* Tag: v6.0.3

Verifies:
- npm audit --audit-level=high --omit=dev → 0
- npm ls @clerk/shared → ≥ 3.47.5 only (POST-install)
- npm ls dompurify → exactly one node at ≥ 3.4.2 (POST-install)
- OWASP corpus passes at all 3 sanitizer call sites
- Sentry release shows source maps for v6.0.3
```

### 20.3 Operator runbook commands

```bash
# State
gh pr list --repo samouraiworld/memba --state open --json number,title,mergeStateStatus
gh pr checks <PR>
gh run view <RUN_ID> --log-failed

# Backend
cd backend && go install golang.org/x/vuln/cmd/govulncheck@v1.1.4 && govulncheck ./...
cd backend && go test -race ./...

# Frontend
cd frontend && npm audit --audit-level=high --omit=dev
cd frontend && npm ls @clerk/shared dompurify

# Transfer-lock probe (Phase 1.5)
gnokey query params/bank:p:restricted_denoms -remote https://rpc.gnoland1.samourai.live:443
gnokey query params/auth:p:unrestricted_addrs -remote https://rpc.gnoland1.samourai.live:443

# Rollback (rolling deploy + GHCR mirror)
flyctl releases list -a memba-backend
flyctl releases rollback <id> -a memba-backend
# OR if image GC'd:
flyctl deploy --image ghcr.io/samouraiworld/memba-backend:vX.Y.Z -a memba-backend

# Volume snapshot
fly volumes snapshots list memba_data
fly volumes snapshots create memba_data
```

### 20.4 Reading order for reviewers

1. **This plan** (Rev2) — full scope.
2. **`MEMBA_V7_1_EXPERT_REVIEW_REV2.md`** — what changed Rev1 → Rev2 and why.
3. **`MEMBA_V7_1_PR_TRIAGE.md`** — per-PR runbook.
4. **`MEMBA_V7_1_EXPERT_REVIEW.md`** — Rev0 → Rev1 audit trail (historical).
5. Predecessor `MEMBA_V7_IMPLEMENTATION_PLAN.md` (Rev7) — superseded.

### 20.5 Docs inventory (v7.1 deliverables)

Per `docs/planning/V7_1_DOCS_INVENTORY.md` (Phase 1 deliverable):
* `docs/DEPENDENCY_POLICY.md` (Phase 0b)
* `docs/BRANCH_PROTECTION.md` (Phase 1)
* `docs/OPS_RUNBOOK.md` (Phase 0 + Phase 6 finalize)
* `docs/SMOKE_CHECKLIST.md` (Phase 0 + Phase 6 finalize)
* `docs/SECRETS_ROTATION.md` (expanded Phase 1.12)
* `docs/advisories/MEMBA-2026-001.md` (Phase 0a, embargoed)
* `docs/comms/v7.1-reviewer-roster.md` (Q16)
* `docs/comms/v7.1-fund-key-roster.md` (Q17)
* `docs/comms/v7.1-token-rotation.md` (Phase 0a)
* `docs/comms/v7.1-channels-v3-cutover.md` (Phase 2)
* `docs/comms/v7.1-betanet-launch.md` (Phase 5)
* `docs/comms/v7.1-betanet-rollback.md` (Phase 5)
* `docs/reports/v7.1-betanet-gono.md` (Phase 5; ≥ 2 principals)
* `docs/reports/v7.1-scope-decision.md` (Day 17 stop-work, conditional)
* `docs/reports/v7.1-betanet-deferral.md` (conditional)
* `docs/reports/v7.1-rollback-drill.md` (Pre-Phase-5)
* `docs/reports/v7.1-review.md` (Phase 6)
* `docs/reports/v7.1-postmortem.md` (conditional)
* `docs/planning/V7_1_DOCS_INVENTORY.md`
* `docs/planning/V7_1_KT.md`
* `docs/planning/V7_1_DOCS_INVENTORY.md` updates: `MAINNET_PREPARATION.md` (Custody), `SECURITY.md` (PGP+CVE+embargo), `DISCLAIMER.md` (betanet), `CHANGELOG.md` (v6.0.2, v6.0.3, v7.1.0)

---

> **Status: Rev2 DRAFT — two-panel-vetted, ready for zooma review.**
> **Awaiting:** answers to §19 questions (18 items — Q16/Q17/Q18 are HARD gates). Phase 0 kicks off the next business day post-approval.
> **Do not implement before approval.**
