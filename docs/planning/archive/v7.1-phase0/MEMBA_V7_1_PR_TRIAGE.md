# Memba v7.1 — PR Triage & Repo-State Clean-Up Runbook

> **Date:** 2026-05-11
> **Companion to:** [`MEMBA_V7_1_IMPLEMENTATION_PLAN.md`](MEMBA_V7_1_IMPLEMENTATION_PLAN.md)
> **Purpose:** Per-PR disposition for the 15 currently-open PRs, with conflict map vs the Phase 0 PR, and a deterministic sequencing strategy.
> **Outcome:** After this runbook is executed, the repo has **0 stale dependabot PRs**, **0 blocked human PRs**, **green main**, and `v6.0.1` tagged.

---

## 1. Snapshot (2026-05-11)

* **Open PRs:** 15 (1 human author, 1 contributor, 13 dependabot).
* **Drafts:** 0.
* **Open issues:** 0.
* **All 15 PRs:** `mergeable: MERGEABLE`, `mergeStateStatus: BLOCKED` (CI red or review required).

## 2. Conflict Map vs Phase 0 PR

The Phase 0 PR will touch:

| File | What Phase 0 changes |
|------|----------------------|
| `backend/go.mod`, `backend/go.sum` | Go 1.25.10, deps |
| `backend/Dockerfile` | pin `golang:1.25.10-alpine` |
| `frontend/Dockerfile` | `VITE_GNO_CHAIN_ID=test12` |
| `frontend/package.json`, `frontend/package-lock.json` | Clerk 5.61.6, `@clerk/shared` override, `@clerk/themes` patch, dompurify 3.4.2 + override |
| `.github/workflows/ci.yml` | Go pin, govulncheck pin |
| `.github/workflows/deploy-backend.yml` | Go pin, govulncheck pin |
| `.github/workflows/deploy-frontend.yml` | remove `\|\| true`, add `SENTRY_AUTH_TOKEN` |
| `.github/workflows/security.yml` | `go-version-file`, drop redundant `backend-audit` job |
| `.github/workflows/govulncheck.yml` | govulncheck pin |
| `.github/dependabot.yml` | groups + major-bump ignore |
| `docs/DEPENDENCY_POLICY.md` (new) | policy + exploitability notes |
| `CHANGELOG.md` | `v6.0.1` entry |

The "Phase 0 file footprint" determines conflict severity for every other PR:

| Footprint type | PRs affected | Conflict severity |
|----------------|--------------|-------------------|
| `frontend/package.json` + lockfile | #315, #317, #319, #320, #322, #323, #325, #324, #326, #327 (10 PRs) | **CRITICAL** — lockfile is fully rewritten by Phase 0; rebase produces a near-100% conflict on `package-lock.json` |
| `backend/go.mod` + `go.sum` | #316, #318, #328 (3 PRs) | **HIGH** — go.mod has very limited surface; rebase succeeds *only if* dep version conflict can be resolved |
| `frontend/Dockerfile` | none from existing PRs | none |
| `frontend/src/**` (non-dep) | #314, #329 (2 PRs) | **NONE** — different files entirely |

**Implication:** rebasing 13 dependabot PRs after Phase 0 lands is **not free**. The lockfile-touching ones will all require `@dependabot recreate` (full regen) rather than `@dependabot rebase` (which only replays commits and will fail). This is more risky and slower than the alternative.

## 3. Recommended Strategy: Fold-In Patches, Defer Majors, Close Superseded

Three buckets:

### Bucket A — **FOLD INTO PHASE 0 PR** (8 trivial patches)

These are all routine patch-level bumps. Their lockfile changes will be **regenerated as a side effect** of the Phase 0 Clerk/dompurify work anyway. Folding them in produces a single atomic green commit, eliminates rebase churn, and unblocks dependabot's queue at once.

| PR | Bump | Why fold | Action when folded |
|----|------|----------|---------------------|
| #315 | `@sentry/react` 10.47.0 → 10.49.0 | Patch series, API-stable | Comment "Closed in favor of Phase 0 PR #<N> (atomic CI unblock)" |
| #316 | `connectrpc.com/connect` 1.19.1 → 1.19.2 | Patch, wire-format stable | Same |
| #317 | `@tanstack/query-sync-storage-persister` 5.99.0 → 5.99.2 | Patch | Same |
| #318 | `cosmos-sdk` 0.54.0 → 0.54.2 | Indirect dep (BIP-39/keyring); run auth tests | Same; note auth test pass in Phase 0 PR description |
| #319 | `@tanstack/react-query-persist-client` 5.99.0 → 5.99.2 | Patch | Same |
| #320 | `eslint-plugin-react-hooks` 7.0.1 → 7.1.1 | Dev-dep patch | Same |
| #322 | `typescript-eslint` 8.58.0 → 8.59.0 | Dev-dep patch | Same |
| #326 | `typescript` 6.0.2 → 6.0.3 | Dev-dep patch | Same |
| #327 | `@tanstack/react-query` 5.99.0 → 5.99.2 | Patch | Same |
| #328 | `modernc.org/sqlite` 1.48.2 → 1.50.0 | Backend patch (already tracked by go.sum bump) | Same |

> **Trade-off acknowledged:** the Phase 0 PR becomes bigger (~+30 LOC of `package.json` deltas, hundreds of LOC of lockfile churn). Mitigation: PR description lists every bump with the rationale + advisory link. Reviewer can scan deltas in `package.json` (~30 lines) and trust `npm ci` to validate the lockfile.

### Bucket B — **DEFER (close + tracker)** (3 PRs)

| PR | Bump | Reason | Tracker action |
|----|------|--------|-----------------|
| #323 | `@clerk/clerk-react` 5.61.4 → **5.61.5** | **SUPERSEDED** — Phase 0 jumps to 5.61.6 (5.61.5 still vulnerable to `GHSA-w24r-5266-9c3c` per advisory) | Close with comment: "Superseded by Phase 0 PR #<N> which jumps to 5.61.6 (the actual fix). Reopening this would re-introduce vulnerable version." |
| #324 | `eslint` 9.39.3 → **10.2.1** (MAJOR) | Major bump needs spike (flat-config compat; Node engine bump). v7.2 budget: 0.5 day. | Close + open issue: "v7.2 spike: ESLint 10 upgrade. Acceptance: `npx eslint .` returns 0 errors on Node 22, all `eslint-plugin-*` peers compatible." |
| #325 | `vite` 7.3.1 → **8.0.9** (MAJOR) | Major bump needs spike (Rollup 5; `@sentry/vite-plugin` peer; manualChunks hash format). v7.2 budget: 1 day. | Close + open issue: "v7.2 spike: Vite 8 upgrade. Acceptance: `npm run build` succeeds; `dist/assets/index-*.js` hash format unchanged; bundle gate < 600 KB holds; Playwright passes." |

### Bucket C — **HUMAN PRs, INDEPENDENT** (2 PRs)

| PR | Title | Conflict with Phase 0 | Disposition |
|----|-------|------------------------|--------------|
| #314 | `fix(ux): improve error messages + execute button theme token` (zxxma) | None (touches 3 pages, no deps) | **Merge in Phase 0b** — single review needed. CI already green. |
| #329 | `chore: rename mikael vallenet to mvallenet` (davd-gzl) | None (one constants file) | **Merge in Phase 0b** — after Phase 0 lands. Rebase, single review, squash. |

### 3.1 Summary table

| Bucket | Count | Action | When |
|--------|-------|--------|------|
| A (fold in) | 10 | Close at Phase 0 merge with note | Day 1 (during Phase 0 PR review) |
| B (defer + tracker) | 3 | Close + open v7.2 issue | Day 1 |
| C (human, merge) | 2 | Review + merge | Day 1–2 (Phase 0b) |

**Result after Day 2:** zero open PRs that don't belong to the v7.1 active work.

## 4. Sequencing on Day 1–2 (Phase 0 + 0b)

```
T+0h    Open Phase 0 PR (folds 10 dep bumps into the security PR)
T+0.5h  Self-review; flip to "Ready for review"
T+1h    External reviewer assigned (per Phase 1.8 new CODEOWNERS — but this PR is meta;
        zxxma must be reviewable by SOMEONE here. If no secondary reviewer yet, accept
        merge-by-author after green CI + AskUserQuestion approval. AD-15 records this exception.)
T+2-4h  CI runs; fix any unexpected red signals
T+4h    Merge Phase 0 PR → main green → v6.0.1 tag → Fly + Netlify deploy
T+4.5h  Verify deploys (smoke checklist, Sentry shows new release with maps)
T+5h    Bucket A: close 10 dep PRs with comment + link to merged Phase 0 PR
T+5.5h  Bucket B: close 3 deferred PRs + open 2 v7.2 tracker issues
T+6h    Bucket C: rebase + review + merge PR #314 (zxxma error-messages)
T+6.5h  Bucket C: rebase + review + merge PR #329 (rename)
T+7h    Verify: `gh pr list --state open` returns empty (or only fresh non-v7.1 PRs).
T+Day2  Buffer for hotfixes if any of the merges introduced a regression.
```

## 5. Dependabot Going Forward

After Phase 0 lands the new `dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/frontend"
    schedule: { interval: "weekly" }
    open-pull-requests-limit: 10
    labels: ["dependencies", "frontend"]
    groups:
      tanstack:   { patterns: ["@tanstack/*"] }
      sentry:     { patterns: ["@sentry/*"] }
      clerk:      { patterns: ["@clerk/*"] }
      eslint:     { patterns: ["eslint", "eslint-*", "@typescript-eslint/*"] }
      dev-deps:   { dependency-type: "development" }
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]

  - package-ecosystem: "gomod"
    directory: "/backend"
    schedule: { interval: "weekly" }
    open-pull-requests-limit: 5
    labels: ["dependencies", "backend"]
    groups:
      cosmos:     { patterns: ["github.com/cosmos/*"] }
      connectrpc: { patterns: ["connectrpc.com/*"] }
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]
```

This caps next-week's potential output at ~5 PRs (one per group + any singletons), down from today's per-package fanout. Major bumps surface as **tracker issues** (via `dependabot ignore` + future `@dependabot ignore this minor version` workflow), not as PRs.

## 6. What Could Still Go Wrong

| Risk | Likelihood | Detection | Mitigation |
|------|-----------|-----------|------------|
| Folding 10 bumps into Phase 0 introduces an unexpected regression | LOW-MED | Unit/E2E test fail in CI | Revert specific bump (single line in package.json + lockfile regen) and re-push without that PR's content |
| `@dependabot recreate` doesn't fire after we close Bucket A PRs (it normally only triggers on a NEW dep version) | MED | Watch next weekly cron | None needed — Bucket A PRs are *intentionally* closed; we don't want them back. |
| Reviewer SPOF on Phase 0 PR (only zxxma is in CODEOWNERS today) | HIGH | PR view | AD-15: accept zxxma-self-merge for THIS PR only; Phase 1.8 fixes CODEOWNERS before subsequent PRs |
| PR #314 zxxma error-messages introduces a UX regression in error path | LOW | Manual smoke | Rollback to prior commit; the PR is small and surgical |
| PR #329 casing of `mvallenet` not match real GitHub login | LOW | `curl api.github.com/users/mvallenet` in review | Block merge until verified |
| Bucket B v7.2 tracker issues get forgotten | MED | Quarterly review of v7.2 milestone | Add to v7.2 milestone immediately at close |
| Phase 0 PR review takes > 1 day because of size | MED | Hours-since-open metric | If > 4h, ping a contributor for a second look; otherwise self-merge per AD-15 |

## 7. Decision points before Phase 0 starts

The runbook above assumes the answers below (defaults). The operator should confirm or override.

| Q | Question | Default |
|---|----------|---------|
| T1 | Fold 10 patch bumps into Phase 0 PR or rebase them after? | **Fold in** (avoids 10× lockfile rebase churn) |
| T2 | Close PR #323 explicitly or let dependabot auto-close after #-of-prior-versions merge? | **Explicit close** with comment |
| T3 | Open v7.2 tracker issues for #324/#325 right now or batch with Phase 6? | **Right now** (so they're not lost) |
| T4 | Accept zxxma-self-merge on Phase 0 PR? (CODEOWNERS still SPOF at Phase 0 time) | **Yes, AD-15 one-time exception**; Phase 1.8 fixes CODEOWNERS before subsequent PRs |
| T5 | If a folded patch turns out to break tests in CI, revert just that one or revert whole PR? | **Revert that one** (smallest blast radius) |
| T6 | Tag `v6.0.1` even if Phase 0 also contains 10 trivial bumps (not just security fixes)? | **Yes** (changelog itemises both; trivial bumps don't change semver) |

## 8. Side-effects to confirm during Phase 0

- [ ] After `npm install`, verify `npm ls react` reports a **single** React version (no `--legacy-peer-deps` needed)
- [ ] After `npm install`, verify `npm ls @tanstack/react-query` resolves all 3 tanstack packages to **5.99.2** (no peer mismatch)
- [ ] After `go mod tidy`, no surprising transitive dep upgrades beyond connectrpc + cosmos-sdk + sqlite
- [ ] After Fly deploy, `flyctl logs -a memba-backend` shows `Go: go1.25.10` in startup banner (or equivalent)
- [ ] After Netlify deploy, browser DevTools Network panel confirms `@clerk/clerk-react` chunk version is 5.61.6
- [ ] Sentry "Releases" tab shows the v6.0.1 release with **source maps** attached (R-09 resolved verification)
- [ ] `npm audit --audit-level=high --omit=dev` exits 0 against `main` after merge

---

> **End of triage runbook.** This document is the single source of truth for what happens to each PR. Once Phase 0b completes (≤ 2 days), the repo state is clean and Phase 1 of the implementation plan begins.
