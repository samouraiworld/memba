# CI Speed-Up — Audit & Delivery Plan (2026-06-27)

**Status:** Vetted by a 4-lens expert panel (CI/DevOps · Test-reliability · Security-gate · Pragmatic-CTO). All facts verified against the repo at HEAD. **Phase 0 IMPLEMENTED & green as [#598](https://github.com/samouraiworld/memba/pull/598) + [#599](https://github.com/samouraiworld/memba/pull/599) — NOT merged (awaiting GO / low-PR window).** Measured results recorded below.

**Goal:** Cut green CI wall-clock from **~20–21 min** with zero coverage loss, zero new flake, and **zero disruption to in-flight PRs** (mobile / marketplace / quests / profile streams). Phase 0 measured **~13–15 min**; the full ~8–10 min target needs Phase 1.

---

## TL;DR — the recommendation

Ship **Phase 0 only** to start: two config-only PRs, **job names unchanged**, each revertible in one line.

1. **Run E2E + Lighthouse once** (gate those steps to the Node-22 matrix leg). Keeps build+unit on both Node versions, keeps both required checks. → removes one full ~12 min E2E leg + a duplicate Lighthouse.
2. **`workers: 2`** in `playwright.config.ts` (already `fullyParallel: true`, so this is a one-liner). → remaining E2E leg ~12 min → ~5–7 min.

**Measured after Phase 0 (both PRs green, 2026-06-27): ~13–15 min** — not the ~8–10 first projected. Still a ~30% wall-clock cut + ~halved runner-minutes, zero coverage loss. **Stop here if good enough**, or continue to Phase 1 for ~8–10. Phase 2 is optional polish.

### Measured outcome (2026-06-27, #598 + #599 both green)

| | Node 20 leg | Node 22 leg | Note |
|---|---|---|---|
| Baseline | 18m25s | 17m21s | full pipeline ×2 |
| #598 alone (E2E once) | **4m14s** | 18m28s | Node-20 drops E2E/Lighthouse → big **runner-minute** save, but wall-clock still gated by Node-22's serial E2E |
| #599 alone (workers:2) | 13m58s | 12m34s | **E2E ~12 min → ~6 min** on each leg — parallelism worked |
| **Both merged (projected)** | ~4 m | **~12.5 m** | Node-22 = build+unit+E2E(workers:2); this leg + Docker tail = the floor |

**Lesson:** matrix legs run in parallel, so wall-clock = the *slowest leg*. #598's gain is runner-minutes, not wall-clock; #599's is the real wall-clock cut. The remaining floor is E2E **stacked on** build+unit inside the Node-22 leg, then Docker (`needs: [backend, frontend]`). Sub-10-min needs Phase 1 (unblock Docker) and/or splitting E2E into its own parallel job — the latter deliberately deferred for blast-radius (new required-check name).

---

## Measured baseline (verified)

| Job | Time | Note |
|---|---|---|
| Frontend (Node 20) | **18m25s** | full pipeline |
| Frontend (Node 22) | **17m21s** | full pipeline **again** (matrix) |
| Backend (Go) | 2m04s | fine |
| Docker Build | 2m11s | `needs: [backend, frontend]` — waits on slowest frontend leg |
| Frontend E2E guardrails | 1m41s | **only** iphone/pixel coverage |
| Proto (Buf) | 0m09s | fine |

Inside the frontend job: **E2E = 12m21s**, unit 2m20s, build 32s, Lighthouse ~30s, rest <1m. E2E runs **3×** total (Node 20, Node 22, guardrails).

**Root cause:** `frontend/playwright.config.ts` → `workers: process.env.CI ? 1` (serialized) + `retries: 2` over ~23 chromium specs. `fullyParallel: true` is **already set**, so raising `workers` is the only lever needed — no spec rewrite.

---

## What the audit corrected vs the original proposal

1. **🔴 Branch protection requires exact check names** — `Frontend (React · Node 20)`, `Frontend (React · Node 22)`, `Backend (Go)`, `Proto (Buf)`, `Docker Build` (`strict: true`). **Dropping the Node-20 matrix leg deletes a required check → permanent merge block.** Fix: keep both legs, gate only the *E2E/Lighthouse steps* via `if: matrix.node-version == '22'`. Job names stay identical.
2. **Don't shard across runners.** Each shard hits **live test13 RPC / gnolove API** independently → N× load on the one documented flake source. Use **in-runner `workers: 2`**, not sharding. (Both QA + CTO lenses.)
3. **Guardrails job is NOT redundant** — it's the only iphone/pixel coverage. "Consolidating the triple E2E" must **keep it**, not delete it.
4. **Docker is the true wall-clock floor** after E2E is fixed (`needs: [backend, frontend]`, backend 2m + docker 2m). The "6–8 min" target needs the Phase-1 Docker change; Phase 0 alone lands ~8–10 min.
5. **govulncheck is already pinned** (`@v1.3.0`). The real install tax is **golangci-lint `@latest`** (unpinned + uncached).
6. **Lighthouse already runs twice** (matrix) — a missed cheap win. Its `accessibility: error` assertion is swallowed by `lhci ... || echo warning` in ci.yml, so it's **non-blocking in practice** regardless of where it runs.
7. E2E runs **23** chromium specs, not 24 (`*.mobile.spec.ts` is `testIgnore`d; `visual.spec.ts` is CI-skipped).
8. **No shared mutable state** across specs → parallelism is correctness-safe; the only risk is **live-network contention**, concentrated in `validators` / `dao` / `directory` / `gnolove*` specs.
9. `codeql.yml` is mislabeled — it runs **gosec**, not CodeQL, and shares the display name "Security" with `security.yml` (cosmetic; flag for later).

---

## Phase 0 — Quick wins (config-only, near-zero risk) — **DO FIRST**

> Each item = its own PR. **Do not rename or remove any job.** Merge on a low-PR window; merge #1 first so rebases inherit faster CI.

### PR-A — E2E + Lighthouse once (Node 22 only)
- **File:** `.github/workflows/ci.yml` (frontend job).
- Add `if: matrix.node-version == '22'` to: `Install Playwright`, `E2E tests`, `Upload E2E artifacts on failure`, `Lighthouse CI`, `Upload Lighthouse report`.
- Keep `Build`, `Unit tests`, lint, tsc, both safety gates, bundle-size, npm audit on **both** legs (cheap, preserves Node-version build signal + all gates on both legs).
- Job name unchanged → both required checks still post. ✅
- **Saves:** one ~12 min E2E leg + one Lighthouse run. **Risk:** ~none (E2E tests the browser bundle; Node version is irrelevant there). **Rollback:** delete the `if:` lines.

### PR-B — `workers: 2`
- **File:** `frontend/playwright.config.ts` line 8 → `workers: process.env.CI ? 2 : undefined`. Keep `retries: 2` for now.
- **Saves:** remaining E2E ~12 min → ~5–7 min. **Risk:** low-med flake on live-RPC specs (mitigation below). **Rollback:** `? 1`.
- **Before merging:** capture a **first-attempt E2E pass-rate baseline** over ~20 runs on current `workers:1`.
- **Mitigation (fold into PR-B or a precursor):** mark the live-RPC specs serial — `test.describe.configure({ mode: 'serial' })` in `validators.spec.ts`, `dao.spec.ts`, `directory.spec.ts`, `gnolove*.spec.ts` — so only the deterministic specs run 2-wide. Replace fragile `waitForLoadState('networkidle')` calls with explicit element waits (they never settle under concurrency).

**Phase 0 result (measured):** ~20–21 → **~13–15 min** (#598 + #599, both green). ← *Stop here if satisfied; Phase 1 unlocks ~8–10.*

---

## Phase 1 — Low-risk tail (optional, no urgency)

- **golangci-lint:** replace `go install ...@latest` (ci.yml:59) with `golangci/golangci-lint-action@v6` (cached binary) + **pin** the version. *S · ~30–60s · low.*
- **Docker unblock:** add `docker/setup-buildx-action` + `cache-from/to: type=gha`; change `needs: [backend, frontend]` → `needs: [backend]` (Docker is a build-smoke test; it doesn't consume frontend test results). Keeps it a required check but off the slow E2E chain. *M · removes Docker from the wall-clock floor · med (Docker can now pass while E2E fails — acceptable).*
- **Lighthouse:** run once is already done in PR-A; optionally `numberOfRuns:1`. Do **not** move off PRs (cheap once de-duped; keep the signal). *S.*
- **gosec/`codeql.yml`:** pin gosec version + rename the workflow to stop the "Security" name collision. *S · hygiene.*

**Phase 1 result:** ~7–8 min + supply-chain hygiene + determinism.

---

## Phase 2 — Only on a quiet window (structural; touches check identity)

- **Reusable workflow** (`workflow_call`) to kill the `ci.yml` ↔ `deploy-frontend.yml` duplication (install/lint/tsc/**safety gate**/test/build/audit — already drifting; ci.yml has a §13 gate deploy lacks). *M-L · no wall-clock · eliminates drift.*
- **Path-filter** non-security jobs (Docker, Backend on FE-only PRs) **only** via the **aggregator pattern** below — never workflow-level `paths:` on a required job (→ permanent "Expected" block). *M · med.*
- **Do NOT split the frontend job** — saves ~0 total time, only improves first-signal, and new check names force every open PR to rebase. Revisit only if devs specifically complain about slow first-failure.

---

## Security-gate preservation (must hold across all phases)

**Blocking gates that must keep running on every PR (never path-filter away):** govulncheck, golangci-lint, gosec, npm audit, dependency-review, the **.env.example safety gate**, the **§13 color gate**, bundle-size hard check, proto breaking check, and the build step that runs **`assertSafeFlags`**.

- The **`.env.example` grep gate is NOT the authority** — it only sees the committed file, blind to Netlify dashboard env. The **authoritative fund-safety gate is `assertSafeFlags` inside `npm run build`** (`vite.config.ts` → `safeFlags.ts`), which runs in CI build **and** the Netlify production build. Treat `frontend/src/lib/safeFlags.ts` + its unit test as load-bearing — **a refactor may dedupe the grep, never the build-time gate.**
- Leave the `deploy` job in `deploy-frontend.yml` **disabled** (`if: ${{ false }}`) — re-enabling bypasses `netlify.toml` (CSP/headers/SPA fallback).
- If any phase collapses the matrix, ensure the gates above still run **at least once** on the surviving leg.

---

## Required-checks migration checklist (for Phase 2 only — Phase 0/1 don't touch names)

1. **Preferred:** introduce one aggregator required check — `ci-required` (`needs: [all gating jobs]`, `if: always()`, fails if any needed job failed; skipped = pass) — and make it the **only** required status check. Future splits/renames then never touch branch protection.
2. If keeping per-job checks: any rename must **add new + remove old name** in branch protection in the same PR. Current required names: `Backend (Go)`, `Frontend (React · Node 20)`, `Frontend (React · Node 22)`, `Proto (Buf)`, `Docker Build`.
3. Path-filter only via job-level `if:` (reports skipped=pass) or the aggregator — **never** `on.pull_request.paths` on a required job.

---

## Success metrics & kill criteria

- **Target:** P50 green CI ≤ **10 min** (stretch ≤ 8). E2E leg ≤ **6 min**.
- **Coverage:** build+unit stay on Node 20 **and** 22; only E2E drops to one version.
- **Flake ceiling (the real guardrail):** if first-attempt E2E pass-rate drops **>5pp** after `workers:2`, or any spec newly *requires* a retry to pass → **revert `workers` to 1** (one line) and fix the spec under parallelism first.
- **Flake visibility (add with PR-B):** report tests-that-retried in the job summary; add a **nightly `retries:0` run** to surface true instability without blocking PRs.

---

## Do-NOT-do list

- ❌ Drop the Node-20 matrix leg (deletes a required check → permanent block).
- ❌ Full Playwright sharding (N× live-RPC load → amplifies the #1 flake source).
- ❌ Split the frontend job (check-name churn > time saved for this team).
- ❌ Delete the guardrails job (only iphone/pixel coverage).
- ❌ Move Lighthouse off PRs (cheap once de-duped; keep the signal).
- ❌ Pin govulncheck (already `@v1.3.0`).
- ❌ Touch `assertSafeFlags` / `safeFlags.ts` when deduping the safety gate.

---

## Open decisions (need your GO)

1. **Scope:** ship Phase 0 only now, or pre-approve Phases 0→1?
2. **`workers`:** start at **2** (panel consensus, 2-vCPU runners + live RPC) — OK, or try 3?
3. **Serial-quarantine the live-RPC specs** as part of PR-B (recommended), or bump workers first and only quarantine if flake appears?
4. **Timing:** which low-PR window — these should merge when the mobile/marketplace/quests trains are quiet, #1 first.

**Files for execution:** `.github/workflows/ci.yml` (matrix 65–68, E2E 163–177, Lighthouse 182–193, guardrails 195–214, docker 229–239, golangci-lint 59) · `frontend/playwright.config.ts` (retries 7, workers 8) · `frontend/package.json` (test:e2e:guardrails 14).
