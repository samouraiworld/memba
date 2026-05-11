# Memba — Dependency Policy

> **Owner**: zxxma (sole maintainer at v7.1)
> **Last updated**: 2026-05-11 (initial publication; PR0b of the v7.1 program)
> **Scope**: every direct and transitive dependency of `frontend/`, `backend/`, `.github/workflows/`, `backend/Dockerfile`, `frontend/Dockerfile`. Also covers GitHub Actions used in CI.
> **Audit trail**: see `docs/planning/MEMBA_V7_1_*` for the threat model that motivated this policy.

---

## 1. Goals

1. Every published advisory at severity ≥ **HIGH** affecting a dependency Memba **uses in production** must be remediated within the SLA in §3, with traceable evidence (PR + advisory link) in the commit history.
2. Every dependency bump must be tested (CI green, including the call-site regression suites in §6) **before** it lands on `main`.
3. The policy is **enforceable**: it specifies who decides, who acts, by when, and what triggers an escalation.
4. CI runs `npm audit` (production-only) and `govulncheck` (pinned version) on every PR — silent failure (`|| true`, `continue-on-error: true`, "warn instead of fail") is forbidden anywhere downstream of `main`.

## 2. Triage cadence

| Trigger | Cadence | Action |
|---------|---------|--------|
| GitHub Dependabot opens a new PR | Within 5 business days of open | Review per §4; merge, defer (with tracker issue), or close (with rationale). Auto-merge is allowed only for the "patch-bump" group (§5) and only after CI is green. |
| `govulncheck.yml` cron (Monday 08:00 UTC) reports a NEW finding | Per §3 SLA, starting from the cron run timestamp | Open a fix PR per §3. |
| `npm audit --audit-level=high --omit=dev` returns non-zero in CI | Immediate | Block merge of the offending PR. If the failure is unrelated to the PR (pre-existing on `main`), open a follow-up unblock PR (per the Phase 0 pattern). |
| External report (email, GitHub Security Advisory inbound, partner notification) | Per §3 SLA, starting from receipt | Open an internal advisory under `docs/advisories/MEMBA-YYYY-NNN.md`, then a fix PR. |
| Memba release | Always | Run `npm audit` + `govulncheck` against the release commit; record the result in the CHANGELOG. |

## 3. Remediation SLA

| Severity | SLA (PR opened) | SLA (deployed to prod) |
|----------|------------------|--------------------------|
| **CRITICAL** | 24 hours | 48 hours |
| **HIGH** | 5 business days | 10 business days |
| **MODERATE** | 30 days | 60 days |
| **LOW** | Quarterly review | Next release |

"PR opened" = a fix PR exists, CI is running, and the operator has acknowledged it. "Deployed to prod" = the fix is live on `memba.samourai.app` (or `memba-backend.fly.dev`).

If the upstream fix is **not yet available** when the SLA clock starts, the operator MUST:

1. File an allowlist with an explicit **expiry date** (max 14 days, renewable once).
2. Document the residual risk in the relevant advisory file under `docs/advisories/`.
3. Re-evaluate every 7 days.

## 4. Responsibility matrix

| Surface | Owner | Backup |
|---------|-------|--------|
| Frontend deps (`frontend/package.json`, lockfile) | zxxma | TBD (post-v7.1 hire/recruit per v7.1 plan §1.8) |
| Backend deps (`backend/go.mod`, `go.sum`) | zxxma | TBD |
| Docker base images (`backend/Dockerfile`, `frontend/Dockerfile`) | zxxma | TBD |
| GitHub Actions versions | zxxma | TBD |
| External services (Sentry, Clerk, Lighthouse, OpenRouter) | zxxma | TBD |
| Disclosure coordination (e.g., Adena) | zxxma | TBD |

Single-owner state is acknowledged as a risk (v7.1 plan R-12) and addressed as part of the post-v7.1 ops.

## 5. Dependabot grouping & auto-merge rules

`/.github/dependabot.yml` groups patch and minor updates to reduce review churn. The current groups (PR0b):

| Group | Pattern | Auto-merge eligible |
|-------|---------|---------------------|
| `tanstack` | `@tanstack/*` | Yes (patch only) — but only after Phase 3 RQ migration |
| `sentry` | `@sentry/*` | Yes (patch only) |
| `clerk` | `@clerk/*` | **No** — Clerk has had advisories; always manually reviewed |
| `eslint` | `eslint`, `eslint-*`, `@typescript-eslint/*` | No — formatting/style PRs benefit from human review |
| `dev-deps` | `dependency-type: "development"` | Yes (patch only) |
| Singletons | everything else | No — single-package PRs reviewed individually |

**Major version bumps are ignored** (`update-types: ["version-update:semver-major"]`). When a major lands upstream, file a tracker issue with a spike budget. See `MEMBA_V7_1_PR_TRIAGE.md` Bucket B for examples (ESLint 10, Vite 8).

**Pause flag**: `open-pull-requests-limit: 0` is set during v7.1 phases to prevent merge-bus race during the program. Re-enable in Phase 6 (`10` for frontend, `5` for backend).

## 6. Call-site regression suites

For dependencies whose runtime behavior we can pin to a specific risk class, we maintain a regression test that runs in CI and is reviewed when the dep bumps:

| Dependency | Risk class | Regression test |
|------------|-----------|-----------------|
| `dompurify` | XSS sanitizer | `frontend/src/lib/__tests__/sanitize-regression.test.ts` (30 OWASP-style XSS vectors at the 3 call sites' default config). Locks the 3.4+ baseline and flags any future regression to a vulnerable version. |
| `@clerk/clerk-react` | Auth surface | The Clerk advisories `GHSA-w24r-5266-9c3c` and `GHSA-vqx2-fgx2-5wq9` are **not exploitable in Memba** (no calls to `has()`, `auth.protect()`, `createRouteMatcher`, billing, reverification, or org-scoped APIs). See `docs/advisories/MEMBA-2026-001.md` §"Memba-specific exploitability" for the evidence. Re-audit after any Clerk major bump. |
| `golang.org/x/net`, `crypto/x509`, `html/template`, `net/http` | Stdlib | `govulncheck` (pinned `v1.3.0`) runs on every PR and weekly cron. Memba is currently on Go **1.25.10** (closes `GO-2026-4918/-4971/-4980/-4982`). |

When adding a new call-site regression test:

1. Reference the closed advisories by GHSA / CVE ID in the test file header.
2. Run the test in CI on every PR (do not gate on `*.dompurify.*` path filters — sanitizer behavior is platform-wide).
3. Document the call sites in the test, by file:line.

## 7. Memba-specific exploitability notes (currently relevant)

| Advisory | Affected dep | Memba's call surface | Exploitable today? | Evidence |
|----------|-------------|----------------------|--------------------|----------|
| `GHSA-w24r-5266-9c3c` (Clerk auth bypass on org/billing/reverification) | `@clerk/clerk-react ≤ 5.61.5` | `<ClerkProvider>`, `useAuth`, `useUser`, `SignInButton` only — alerts page only | **No** — Memba uses none of `has()`, `auth.protect()`, `createRouteMatcher`, billing, reverification, or orgs. | `grep -rn "has\\(\\|auth\\.protect\\|createRouteMatcher\\|hasPermission" frontend/src` → 0 hits as of 2026-05-11. |
| `GHSA-vqx2-fgx2-5wq9` (Clerk middleware bypass) | `@clerk/shared ≤ 3.47.4` | Same as above; transitive via `@clerk/clerk-react` and `@clerk/themes` | **No** — affects `@clerk/nextjs\|nuxt\|astro`, none of which Memba uses (Memba is a Vite SPA). | `frontend/package.json` does not depend on any `@clerk/{nextjs,nuxt,astro}` package. |
| dompurify 3.3.x advisories (4 × ADD_TAGS/RETURN_DOM/SAFE_FOR_TEMPLATES/CUSTOM_ELEMENT_HANDLING) | `dompurify ≤ 3.3.3` | 3 sites: `NFTGallery.tsx:489`, `RealmDetailDrawer.tsx:164`, `SourceCodeView.tsx:116` — all `DOMPurify.sanitize(html)` with **no options** | **No, in default config** — the 4 CVEs require non-default options Memba doesn't pass. Regression suite locks that fact. | `sanitize-regression.test.ts` "the production sanitize helper passes no options" case. |

When a future advisory lands, add a row here with the same evidence shape. The intent is that an external auditor reading this file can confirm the exposure assessment without re-reading the entire codebase.

## 8. Allowlist process

A dependency MAY remain on a vulnerable version only if **all** of the following hold:

1. The upstream fix is not yet available, OR the patched version has a documented incompatibility that requires a non-trivial migration.
2. An advisory file exists at `docs/advisories/MEMBA-YYYY-NNN.md` capturing the residual risk + the Memba-specific exploitability assessment (per §7).
3. The allowlist entry includes an **expiry date** (max 14 days, renewable once with explicit rationale).
4. The CI gate is configured to ignore the specific advisory by ID (not by package), so a NEW advisory on the same package still fires.

Today there are **zero** active allowlist entries (intentionally). The mechanism is documented for completeness.

## 9. Escalation path

If the SLA in §3 is exceeded without a fix or allowlist:

1. Add `severity:overdue` label on the tracker issue (or PR).
2. Notify `security@samourai.coop`.
3. Discord `#memba` post pinned for 24h.
4. If the unmitigated vulnerability is exploitable in production (per §7 evidence) at severity ≥ HIGH, the affected surface is **disabled** (Netlify env flag flip or backend route removal) within the next 24h, ahead of the fix landing.

## 10. Known short-term tech debt

These are dep bumps available upstream but intentionally not yet taken in v7.1; tracked for v7.2.

| Package | Current | Available | Why deferred |
|---------|---------|-----------|--------------|
| `vite` | `^7.3.1` | `8.0.x` | Major bump; needs `@sentry/vite-plugin` peer verification, Rollup 5 compat, manualChunks hash format check. v7.2 spike budget: 1 day. (PR #325 closed; tracker filed.) |
| `eslint` | `^9.39.1` | `10.2.x` | Major bump; flat-config peer verification. v7.2 spike budget: 0.5 day. (PR #324 closed; tracker filed.) |
| `eslint-plugin-react-hooks` | `~7.0.1` | `7.1.x` | Adds `react-hooks/set-state-in-effect` rule. Flags 60 legitimate patterns that **Phase 3 React Query migration is going to remove**. Re-bump after Phase 3 lands. (PR #320 closed; tracker filed.) |

`fast-uri`, `postcss` (via `@remotion/cli`), `vite 7.x` — all DEV-only advisories (`--omit=dev` clears them). Not in CI gate; tracked in this row only for visibility.

## 11. Reviewer checklist for dep-bump PRs

When reviewing a dependency PR:

- [ ] CI `Backend (Go)` and `Frontend (React)` are **PASS** (or the PR description explains a pre-existing failure being addressed elsewhere).
- [ ] `npm ls <bumped-pkg>` resolves to a single version (no peer mismatch surprises).
- [ ] For Clerk / dompurify / any auth/sanitizer surface: the relevant regression suite in §6 is green.
- [ ] For backend deps with breaking changes: the relevant `_test.go` file ran (e.g., `internal/auth/` after `cosmos-sdk`).
- [ ] CHANGELOG entry references the GHSA / CVE / advisory IDs if applicable.
- [ ] No `|| true` or `continue-on-error: true` introduced in workflow YAML.
- [ ] Lockfile diff is reviewed (npm overrides took effect; no unexpected hoisting).

If `actions/dependency-review-action@v4` is configured (see `.github/workflows/dependency-review.yml`), it gates the PR automatically.
