# Gnolove Shareable Report URLs — CTO Expert Panel Review (Rev0 → Rev1 audit trail)

> **Date:** 2026-05-12
> **Companion to:** [`GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md`](GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md)
> **Methodology:** Six independent expert sub-agents reviewed Rev0 of the plan in parallel with zero conversational context. Each agent was given the plan path, a domain-specific brief, and read the source code (or v7.1 plan, CI workflows, netlify.toml, etc.) directly to verify claims. Each returned a structured verdict + must-fix list. This document concatenates all six panels and then derives a **consolidated must-fix table** with traceability to each finding's source.
> **Status:** AUDIT COMPLETE — verdicts unanimous: **APPROVE WITH CHANGES**. No reviewer issued a BLOCK. Rev1 of the plan must address every item in §8 of this doc before implementation begins.
> **Format precedent:** Mirrors [`MEMBA_V7_1_EXPERT_REVIEW.md`](MEMBA_V7_1_EXPERT_REVIEW.md).

---

## Panel of reviewers (Rev0 audit)

| # | Role | Verdict | Findings | Source |
|--:|---|---|--:|---|
| 1 | **Principal Frontend Architect** (React 19 + RR7 + TanStack Query expert) | APPROVE WITH CHANGES | 8 must-fix | §1 |
| 2 | **Principal QA / Test Engineer** (vitest + Playwright + property-based) | APPROVE WITH CHANGES | 7 must-fix | §2 |
| 3 | **Principal Application Security Engineer** (URL attacks, CSP, OWASP) | APPROVE WITH CHANGES | 5 must-fix | §3 |
| 4 | **Principal Product Designer / UX Engineer** (share-flow UX, deep-link, analytics dashboards) | APPROVE WITH CHANGES | 7 must-fix | §4 |
| 5 | **Principal SRE / Release Engineer** (Netlify, CI gates, Sentry/Plausible, rollback) | APPROVE WITH CHANGES | 7 must-fix | §5 |
| 6 | **Principal Adversarial Red Team Reviewer** (find what the author missed) | APPROVE WITH CHANGES (major) | 10 must-fix | §6 |

**Cross-panel consensus signal:** the plan is structurally sound (URL schema, Zod validation, default-elision, layered fixes) but has **three plan-internal contradictions** and **~40 distinct must-fix items**, of which **~25 are touched by 2+ reviewers** — those become Rev1's mandatory edits.

---

## 1. Frontend Architect Panel

> Verbatim. Verdict: **APPROVE WITH CHANGES**.

### Strengths
- **ADR-002 (absolute period keys)** is exactly right — `?at=2026-W18` survives the weekend; `?offset=-1` doesn't. The `date-fns` `getISOWeek`/`getISOWeekYear` choice is correct and matches what's already imported at `GnoloveReport.tsx:28`.
- **ADR-003 (default state writes nothing)** correctly defuses the React 19 StrictMode double-mount write loop (R-5). Verified: `main.tsx:50` does wrap in `<StrictMode>`, so this matters.
- The Zod `.catch(default)` discipline (§3.4) plus `rangeFromKey` always returning a valid range (never throws, falls back to `now`) makes the hook genuinely crash-proof.
- Schema versioning reservation (`?v=` in ADR-004) at zero cost is good forward-thinking.
- `LegacyRedirect` already preserves `location.search` and `location.hash` — Phase 1's deep links over `/gnolove/report?…` will survive the redirect.

### Bugs / correctness
- **F-1** §6 Task 0.3 — `setUrlState` is NOT stably identified. RR v7's `useSearchParams` rebuilds `setSearchParams` with `[navigate, searchParams]` as deps; every URL change → new `setSearchParams` → new `setUrlState`. This contradicts the test in §6 Task 0.3 ("state object reference does not change between renders when params are unchanged"). The *state* identity is stable; the *setter* is not. Either drop the stability claim on the setter or pin via a ref-stored dispatcher.
- **F-2** §6 — `[searchParams.toString()]` as a memo key is redundant. RR already memoizes `searchParams` on `[location.search]`. Use `[searchParams]` — same correctness, no lint suppression, no per-render `.toString()`.
- **F-3** §3.4 `serializeReportUrl` `at` elision breaks acceptance #7. `defaultKey("weekly")` returns the previous week, so the serializer strips `at` when state matches default. But §15.1 #7 says "Copy link emits a fully-pinned URL even from defaults". The plan needs a `serializeReportUrl(state, { pinAt: true })` mode for the Copy Link button.
- **F-4** `repos: Set<string>` identity churns on every URL change. Switch to `readonly string[]` (sorted) and convert to `Set` at filter callsite only.
- **F-5** §4.3 BUG-5 fix is itself buggy at `period === "all"` boundaries. When user switches `all → weekly`, `start = 1980-01-01` and they get pinned to `1980-W01`. Guard: when leaving `all`, fall back to `defaultKey(next)`.
- **F-6** §3.4 weekly parsing near year boundaries. `getISOWeekYear(d)` for late-December dates returns the *next* ISO year. Test fixture in §6 Task 0.2 must include `at=2020-W53` (real), `at=2021-W53` (does not exist), and `weekKeyFromDate(new Date("2025-12-31"))`.
- **F-7** §11 Task 5.1 `<PageMeta>` cleanup races. The `useEffect` cleanup restores `prevTitle` captured at mount — if the user navigates Report → Analytics → Report quickly, the second Report mount captures the *Analytics* title as `prevTitle`. On unmount it'll restore the wrong title. Use a layout-level title or skip the restore.

### Architecture concerns
- **F-8** LegacyRedirect + new state interplay: `/gnolove/report?period=monthly&at=2026-05` triggers redirect → unmount → remount of `GnoloveLayout` (new `QueryClient` + `persistQueryClient`). In StrictMode this `useEffect` runs twice; the cleanup at `GnoloveLayout.tsx:108` only calls `unsubscribe()` for the first subscription, leaking the second. **Pre-existing bug**, but plan adds traffic to this path. File it as part of this PR or as a follow-up.
- Layout-local `QueryClient` + persisted cache: a user landing on `?repos=samouraiworld/memba` sees *stale* repo list from yesterday's cache for ~30s. BUG-2's banner can fire as a **false positive** when the repo exists server-side but is missing from the persisted cache. Document.
- No mention of TanStack v5 `placeholderData: keepPreviousData` for `useGnoloveReport`. Each Next-arrow click flashes the loading skeleton; one-line improvement.

### Required changes
1. Fix `setUrlState` identity claim and tests (§6 Task 0.3) — drop the setter-stability assertion.
2. Add `pinAt` option to `serializeReportUrl` (acceptance #7) — §11 Task 5.2.
3. Guard BUG-5 for `all → period` transitions (no 1980 teleport) — §4.3.
4. Replace `[searchParams.toString()]` memo key with `[searchParams]` and remove the `eslint-disable` — §6 Task 0.3.
5. Change `repos: Set<string>` → `repos: readonly string[]` in `ReportUrlState` — §3.4.
6. Add ISO week boundary test cases (W53 years, year-rollover) to §6 Task 0.2.
7. Reconcile `replace`-everywhere strategy (G4) with §17.2 spec #6 ("back restores filters") — they cannot both be true.
8. Document persisted-cache vs URL-state interaction (R-11 in risk register) and the BUG-2 false-positive risk.

---

## 2. QA / Test Engineer Panel

> Verbatim. Verdict: **APPROVE WITH CHANGES**.

### Strengths
- §17.1 enumerates all units with sensible per-file counts and calls out leap year + week 53 edges.
- TDD discipline in §6 Tasks 0.2/0.3 (RED → GREEN → commit) matches existing `gnolove*.test.ts` style.
- §17.2 includes a "garbage input" deep-link spec with a `pageerror` listener — more robust than current smoke tests.
- BUG-5 regression test is correctly singled out as a behavioral guard.
- Lighthouse is realistic: `frontend/lighthouserc.json` exists and `.github/workflows/ci.yml:143-151` wires `@lhci/cli`.

### Test gaps that will leak bugs
- **Q-1** §6 Task 0.2 missing critical parser cases despite "each error path" claim:
  - **DST**: assert ISO calendar-day count, not millisecond delta.
  - **Week 53**: pick concrete years (2020 has W53; 2021 does not) — assert both accept and reject.
  - **Stale `at` vs `period`**: `?period=monthly&at=2026-W18` behavior is not specified. Determinism bomb.
  - **URL encoding of `team`**: zero test cases for `team=Samourai%2Eworld`, `team=A%26B`, `team=` (empty). Add explicit decode round-trip tests.
  - **`Set` ordering**: round-trip equality of `Set` passes, but serialized strings differ across runs. Assert `serialize` sorts `repos` alphabetically.
  - **Idempotency**: `serialize(parse(serialize(s))) === serialize(s)` not listed — add.
- **Q-2** §6 Task 0.3 — "URL writes use `replace`" via `window.location.length` is **incorrect**. `window.location.length` is not a property; `window.history.length` is, but in jsdom under `MemoryRouter` it does not track. Spy on `setSearchParams` and assert `{ replace: true }` was the 2nd arg, or use `createMemoryHistory` and inspect `history.action === 'REPLACE'`.
- **Q-3** Plan does not mention wrapping the hook test in `<React.StrictMode>`. Add a strict-mode variant.

### Flaky / non-deterministic risks
- **Q-4** §7 Task 1.8 selectors — `button.gl-tab--active` is state-dependent; if click handler is async the active class may lag. Prefer `getByRole('tab', { name: 'Monthly', selected: true })`. Mandatory: `page.route('**/backend.gnolove.world/**', route => route.fulfill({ json: fixture }))` for all 10 new specs.
- **Q-5** BUG-5 regression test must freeze the clock or use explicit `?at=2026-W15`. `defaultKey` uses `new Date()`.

### Improvements
- **Q-6** `fast-check` (~20KB devDep) finds URL-encoding edge cases automatically and shrinks failures.
- Coverage gate: §17 says "≥90% new files" but plan does not add `coverage.thresholds.perFile` to `vite.config.ts`. Add it scoped to `src/lib/gnoloveReportUrl.ts` + `src/hooks/gnolove/**`.
- **Q-7** `@axe-core/playwright` (~80KB devDep, <1s/page) — make it a hard requirement; manual verification of 5 WCAG criteria across 10 specs is unreliable.
- Component-test mock pattern: `vi.mock(...) + vi.mocked(x).mockReturnValue(...)` per-test, matching `QuestProgress.test.tsx:19-45`. Don't invent a new style.
- §17.4 Lighthouse: existing `lighthouserc.json` uses absolute thresholds. "Baseline + 50ms TTI" is not currently enforceable. Either reuse existing thresholds or add a comparator script.

### Open questions
- Q-2 (`%20` vs `+`): pick one before TDD, else round-trip non-deterministic.
- 2026 ISO week 53 — does it exist? Verify with fixture year.

### Required additions
1. §6 Task 0.2 step 1: add stale-`at`, `team` URL-encoding (3 variants), idempotency, `repos` sort stability.
2. §6 Task 0.3 step 1: replace `window.location.length` with `setSearchParams` spy + `{ replace: true }` assertion; add strict-mode test.
3. §7 Task 1.8: every Playwright spec stubs `backend.gnolove.world` via `page.route` (define a single fixture).
4. §17.2 #4: deep-link with `?at=` instead of `Date.now()`.
5. Add `fast-check` and `@axe-core/playwright` to `devDependencies`; gate one a11y spec per page.
6. Add `coverage.thresholds` block to `vite.config.ts` scoped to the two new files.
7. Decide Q-2 (URL-encoding) before Phase 0.

---

## 3. Security / Privacy Panel

> Verbatim. Verdict: **APPROVE WITH CHANGES**.

### Threats correctly addressed
- CSRF: gnolove is read-only — N/A is correct.
- Iframe clickjacking: `X-Frame-Options: DENY` (netlify.toml:21). Verified.
- CSP fit: confirmed against `netlify.toml:26` and `index.html:17-29`. No edits needed.
- Owner/name regex rejects HTML metacharacters — safe.
- CSP `object-src 'none'` / `base-uri 'self'` blocks `<base href>` URL hijacks.

### Vulnerabilities introduced or unaddressed
- HIGH: **none**.
- **S-1 (MEDIUM)** `document.title` reflective injection via `team`. React escapes text content, but `document.title` is rendered by OS chrome, Sentry breadcrumbs (navigation captures title), Plausible (auto-pageview sends title), and screen readers. Attacker URL `?team=<RTL-override + spoofed string>` becomes a phishing/title-spoof primitive in shared previews and analytics. Zod schema does **not** length-cap or charset-restrict `team`. Constrain: `^[A-Za-z0-9 ._-]{1,64}$` or strict allowlist of known team names.
- **S-2 (MEDIUM)** `team` in Plausible event props. Even if today event uses `hasTeam: boolean` (safe), keep team **name** out of event props and add allowlist check.
- **S-3 (MEDIUM)** Copy-link uses `window.location.href`. An XSS landing elsewhere can mutate the URL; Copy then exfiltrates a spoofed URL the user trusts. Reconstruct from validated state: `origin + pathname + serializeReportUrl(state)`.
- **S-4 (LOW)** `rangeFromKey` accepts `at=9999-12` / `at=0000-01`. Regex allows it; `new Date(9999, 11, 1)` is valid; React-Query cache-poison via key. Cap year to `[2015, currentYear+1]` in the schema.
- **S-5 (LOW)** `repos` DoS via 10K entries. URL length limits this in practice, but add `reposRaw.length < 4096` and `.slice(0, 50)` after split for defence-in-depth.
- **S-6 (LOW)** Zod `.catch(default)` silently masks parameter pollution. Add Sentry breadcrumb when fallback fires.
- **S-7 (LOW)** Referer leakage: `Referrer-Policy: strict-origin-when-cross-origin` (netlify.toml:23) strips path+query cross-origin. **Verified safe.**

### Hardening recommendations
- Zod refinement: `team: z.string().regex(/^[\w .-]{1,64}$/).catch(null)`.
- Reconstruct copy-link URL from validated state.
- Cap year range; cap `repos` array length.
- Sanitize/allowlist `team` + `repos` before `document.title` AND before Plausible emit.
- Verify all outbound `<a target="_blank">` to GitHub have `rel="noopener noreferrer"`.
- Sentry breadcrumb (not event — low noise) when `.catch(default)` fires, tagged `gnolove.url.fallback`.
- Wrap `rangeFromKey` in try/catch defensively.

### Open questions
- Where do `team` strings originate? Backend hardcoded list, user-editable, or GitHub team API?
- Is the gnolove backend allowed to inject team names into the response shown in `<select>`?
- Does Plausible at `plausible.io` (cloud) sample query strings? If yes, `?team=` leaks regardless of explicit event emit.

### Required mitigations
1. Zod `team` schema with charset+length restriction.
2. Cap year range in `WEEK_RE` / `MONTH_RE` / `YEAR_RE` (e.g. `20[1-3]\d`).
3. Reconstruct copy-link URL from validated state, not `location.href`.
4. Confirm Plausible site setting on query-string capture (or accept that team names are in analytics).
5. Add `repos` array size cap (≤50) and raw-string length cap (≤4096) in `parseReportUrl`.

---

## 4. UX / Product Panel

> Verbatim. Verdict: **APPROVE WITH CHANGES**.

### Strong UX decisions
- ADR-002 (absolute period keys): correct.
- ADR-003 (defaults omit from URL): clean address bar, trivial reset.
- §3.6 (`repos=` empty = "all"): elegant; param-presence semantics > sentinel strings.
- §1.4 BUG-2 → §7 Task 1.2 fix: surfacing missing-repo warning with one-click "Remove" beats silent empties.
- §10 Task 4.4 (keyboard ←/→ on period nav): real a11y win.

### UX bugs / anti-patterns
- **U-1** Back-button semantics (G4, R-2) is wrong default. `replace` for every filter change → toggle team → repo → tab → period → Back yanks user to previous *page*, losing exploration. GitHub Insights, Linear, Amplitude all `push` filter changes. Recommend: `push` on period/team/tab/repos; `replace` only on `view` toggle.
- **U-2** §7 Task 1.7 "Clear filters" nukes everything. Should clear only the *culprit* dimension. Provide per-reason buttons:
  - `no_data`: "No PR activity in this period. Try widening the period or selecting all repositories."
  - `team`: "No PRs from **{team}** in this period. [Clear team] or [Pick another team]."
  - `repo`: "No PRs in **{repos.join(', ')}** for this period. [Clear repos] or [Try all repositories]."
  - `team_and_repo`: "**{team}** didn't ship in **{repos.join(', ')}** during this period. [Clear team] · [Clear repos] · [Reset all]."
  - `filter`: "No PRs match **{tab}** in this period. [Show all statuses]."
- **U-3** BUG-5 fix is underspecified. For `all → period`, plan says `at=null` ⇒ previous week — that's the right fallback, but acknowledge the ambiguity and document the rule.
- **U-4** `?at=2026-W18` is opaque to non-technical Slack readers. Hybrid: parser accepts `?week=YYYY-MM-DD` alias; serializer emits ISO form. Low cost, high goodwill.

### UX improvements (prioritized)
- **U-5 (P0)** Discoverability of share. URL changing silently won't teach 80%+ of users. Add a permanent low-key "Share" button (not just "Copy link"). On click: dropdown menu Copy / Slack / Twitter / Email; on mobile native share sheet.
- **U-6 (P0)** Visible button state, not just `aria-live`. Plan §11 5.2 mentions only aria-live. Add 250ms color flash + icon swap (clipboard → check) + 1.5s "Copied!" persist (NN/g sweet spot).
- **U-7 (P1)** Copy link always pins (single button, no split). The current URL is in the address bar already; the button's job is the *shareable* form.
- **U-8 (P1)** Empty-state copy strings (see U-2).
- **U-9 (P1)** AI Reports highlight on deep-link. §8 Task 2.3 does auto-scroll + expand; add 1.5s yellow-flash ring on target card. Standard pattern (Gmail/Linear).
- **U-10 (P1)** ADR explicitly stating: "Default is a *first-visit* concept; shared links override defaults completely."
- **U-11 (P2)** Mobile: don't redesign now, but ensure `navigator.share` works and acknowledge cramped multi-select dropdown.
- **U-12 (P2)** At minimum, write `<meta property="og:title">` twin via `<PageMeta>`. Slack reads meta on link unfurl for SPAs in some cases — partial wins free.

### Open product questions
- Should "Share" be dropdown (desktop) + native sheet (mobile)? Recommend yes.
- When state equals defaults, does Copy emit pinned or clean URL? Plan says pinned — confirm.
- Is `?at=2026-W18` confusing enough to alias `?week=YYYY-MM-DD`?
- One-time tooltip on first interaction? ("Tip: your URL updates as you filter.")
- "Reset filters" always visible next to the filter bar, not just in empty state?

### Required UX changes
1. Switch from `replace` to `push` for filter changes (or document explicit operator-signed-off trade-off).
2. "Clear filters" scoped per-reason in §7 Task 1.7; provide per-reason copy.
3. Visible button-state animation in §11 Task 5.2.
4. Highlight-flash on AI Reports deep-link target in §8 Task 2.3.
5. `<meta property="og:title">` twin in `<PageMeta>` §11 Task 5.1.
6. ADR-006: "Defaults apply only to bare URLs; shared links override defaults bit-for-bit."
7. Document mobile filter bar as known cramped; add Q-13 for follow-up.

---

## 5. SRE / Release Engineering Panel

> Verbatim. Verdict: **APPROVE WITH CHANGES**.

### Solid release practices
- Deploy flow correctly characterized. `deploy-frontend.yml` runs ci → `nwtgck/actions-netlify@v3` `production-deploy: true` on main push. Revert + push → ~3 min Netlify deploy. Plausible MTTR.
- No persistent-state writes (§16 invariant) accurate. Pure revert is safe.
- Sentry source-map upload works for new files without changes. `@sentry/vite-plugin` (`vite.config.ts:30-46`) globs all `dist/**`. PR #333's fix covers verification.
- CSP needs no edits (§20.3 confirmed) — `plausible.io` and `*.sentry.io` already in `script-src` / `connect-src`.

### Gaps in rollback / observability
- **R-1** §16 MTTR <10 min is optimistic. `deploy-frontend.yml:48-111` runs `npm ci` + full build before deploying → 3-5 min on cold cache plus CDN propagation. Realistic revert is **6-10 min**. Faster alternative: Netlify "Rollback to previous deploy" dashboard button (~30s). Make that the *primary* rollback path; `git revert` is the forward-fix secondary.
- **R-2** No Sentry breadcrumb on URL parse failure. §3.4 swallows malformed input via `.catch(default)` — correct UX but unobservable. Add rate-limited Sentry breadcrumb. Cross-confirmed by Security panel (S-6).
- **R-3** Two Plausible events is the floor. Missing: filter-change counts (debounced), back-button restoration success, "Copy link" failure (clipboard blocked). Without filter-change telemetry, cannot tell if feature is used vs cargo-shipped.

### CI / deploy risks
- **R-4** Branch protection not visible. CODEOWNERS = `* @zxxma` (sole reviewer). The §15.4 "Operator approves PR. Do not self-merge" is convention, not GitHub-enforced. Note honestly.
- **R-5** `ci.yml:104-120` already has bundle gate (main >600KB fail, total >3MB warn). §17.4 should reference it. **No `size-limit` package needed.**
- **R-6** Lighthouse CI is wired but crawls `./dist` `url: ["/"]` only — does **not** crawl `/test12/gnolove/report?...`. §17.4 "Lighthouse on the URL" is manual today. Either add URL to `lighthouserc.json` (with vite-preview + MSW shim) or downgrade wording to "manual smoke".
- **R-7** Playwright +10 specs ≈ 30-90s added to existing 4-6 min job. Mandate skip-if-API-unreachable for every spec that asserts rendered data (cross-confirmed by QA Q-4).
- **R-8** `netlify.toml:18-26` sets no `Cache-Control` for HTML. Netlify implicit `no-cache` for SPAs but undocumented. Add explicit `Cache-Control = "public, max-age=0, must-revalidate"` for `/index.html`.

### Improvements
- **R-9** Feature flag via `import.meta.env.VITE_GNOLOVE_URL_STATE === '1'`. No flag system today; flip via Netlify env var. MTTR-to-disable ≈ 3 min. Strongly recommended.
- **R-10** v7.1 Phase 3 collision is minor. AD-11 keeps gnolove RQ section-scoped & unchanged. This PR adds new URL→state mapping; no file overlap. Q-1: land in parallel with v7.1 Phase 3, after Phase 3.0's MSW prereq so new Playwright specs use the same mock harness.
- **R-11** v6.1.0 semver-correct; but `frontend/package.json` is `4.0.0` (independent from product v6.x). The Sentry release name uses `pkg.version` (`vite.config.ts:38` = `memba@4.0.0`). **Bumping `frontend/package.json` to 4.1.0 is what actually changes the Sentry release.** Plan must clarify.

### Open questions
- Plausible at `plausible.io` (cloud, cookie-free) satisfy Memba GDPR?
- Will new specs use live `backend.gnolove.world` in CI or mocks?
- Lighthouse: wire report URL into `lighthouserc.json` (build-time stub) or downgrade?

### Required changes
1. Rollback playbook (§16): Netlify dashboard rollback primary (~30s), `git revert` secondary (~6-10 min). Correct MTTR.
2. Sentry breadcrumb on URL parse fallback — required, not conditional.
3. Feature-flag the reader via `VITE_GNOLOVE_URL_STATE`; document flip in §16.
4. Lighthouse claim (§17.4): wire URL or downgrade to manual.
5. Playwright skip-if-API-unreachable + `page.route` mock for every data-asserting spec.
6. Version bump clarification (§6.3): `frontend/package.json` 4.0.0 → 4.1.0 for Sentry release `memba@4.1.0`.
7. Explicit `Cache-Control` for `/*.html` in `netlify.toml`.

---

## 6. Adversarial Red Team Panel

> Verbatim. Verdict: **APPROVE WITH CHANGES (major)**.

### Wrong-headed decisions
- **A-1** `ReportPeriod` rename `"all_time"` → `"all"` (§3.4) is a footgun. The runtime type rename forces a global rewrite: `case "all_time":` at lines 64, 201, 502, plus `period !== "all_time"` at 187, 285. Plan never lists these. Also: `TimeFilter.ALL_TIME = "all"` already exists for `GnoloveHome` — two `period: "all"` types meaning different things. **Recommendation:** keep runtime `"all_time"`; map only at URL boundary.
- **A-2** Blanket `{ replace: true }` destroys back-button for power users. Cross-confirmed by Frontend Architect F-3 reconciliation and UX U-1.
- **A-3** `useSearchParams` rerenders all subscribed components on every URL change. The `setSearchParams(prev => ...)` runs Zod parse + regex on every keystroke if filters are wired to inputs. Plan never measures.
- **A-4** "BUG-5 fix" via `start`-of-range is buggy. For weeks spanning month boundaries (e.g. ISO W18 starting 2026-04-27 → 2026-05-03), clicking Monthly takes the user to **April**, skipping May. Plan picks `start` without acknowledging the ambiguity. Should be explicit: use `end`, `midpoint`, or `start` with rationale.

### Hidden complexity / icebergs
- **A-5** `"all_time"` → `"all"` cascade touches ~6 sites in 778-LOC `GnoloveReport.tsx` plus `computeRange`, `dateLabel`, `canGoForward`, exports, `NarrativeReportView`, `PRStateBadge`. Realistic touch: **400-500 LOC**, not 250.
- **A-6** Phase 3 BUG-1 fix: `useNetworkPath` inside `.map()` callbacks is fine, but plan never says so. Worth a sentence to remove doubt.
- **A-7** Phase 2 Task 2.2 ("~2 hours") is off by 3-5×. GnoloveHome is 528 LOC with 9 useState including pagination clamp. Realistic: 1 full day.
- **A-8** `<PageMeta>` Task 5.1 Step 3 ("add to 7 other pages") is enumeration work; each touches data hooks. ~30 min/page = 3.5 hours, not "cheap".
- **A-9** MD export `Filter URL: ${window.location.href}` (Task 1.5) captures `view=table` if user is in table mode — confusing for a Markdown artifact. Canonicalize: drop `view=table` from the embedded URL.

### False claims in the plan
- **A-10** "Nothing new must be installed" (§1.5) — true for runtime; but `@axe-core/playwright` and `fast-check` are needed for a11y / fuzz testing (cross-confirmed by QA Q-6 + Q-7).
- §20.4 claim "Team/repo/tab changes do not re-fetch" — VERIFIED true.
- §3.6 "param empty = all repos" — works, but the UX of unchecking all repos producing `/report?repos=` (longer than default) is counterintuitive. Add a UX note.
- **A-11** `isTimeFilter` import in §3.4 is unused; lint will fail.

### Gaps the plan ignores
- **A-12** Cross-tab URL sync — never mentioned. (Likely "no" — but acknowledge.)
- **A-13** URL canonicalization / param order. Hand-edited URL refreshed produces different canonical Copy output. Document.
- **A-14** i18n / RTL — §20.2 says "English only" but `document.title` includes literal English month names ("May 2026"). Defer to `Intl.DateTimeFormat(navigator.language, …)` even as a stub.
- **A-15** Plan never specifies how `<select>` handles `?team=NotARealTeam`. Today: `TEAMS.find` returns undefined → no filter applied; dropdown shows that team name. Broken UX. Mirror BUG-2 with a stale-team warning banner.
- **A-16** `useReportUrlState` is imported from deep path; plan never adds it to `hooks/gnolove/index.ts` barrel.
- **A-17** MD export "Filter URL" silently inconsistent with Copy Link's pin promise (cross-confirmed by F-3).

### Estimate reality check
| Phase | Plan | Realistic |
|---|---|---|
| 0 | 0.5d | 0.75d |
| 1 | 2.0d | 3.0d |
| 2 | 1.5d | 2.5d |
| 3 | 0.5d | 0.75d |
| 4 | 0.75d | 0.75d |
| 5 | 0.75d | 1.5d |
| 6 | 1.0d | 1.0d |
| **Total** | **6-8d** | **10-12d (1 FTE)** |

§18 "1 day PTO float" is consumed by the rename cascade alone.

### Single point of failure
"Frontend Architect (single accountable IC)" — no pairing, no co-driver. Tribal knowledge: `gl-tab--active`, `gl-subnav-link--active`, `gl-warning-banner`, the `TEAMS` constant, `LegacyRedirect` route, network-prefix convention — all undocumented project lore. A new hire could **not** execute this plan unassisted as the plan claims.

### Required changes
1. Drop the `"all_time"` → `"all"` runtime rename. Map at URL boundary only.
2. Justify or switch the blanket `replace` policy (cross-confirmed F-1, U-1).
3. BUG-5: pick a deterministic rule (`end` / `midpoint` / `start`) and document.
4. Add stale-team warning banner (mirror BUG-2).
5. Canonicalize the URL in Copy Link AND MD-export footer (drop `view=table`).
6. Enumerate the cascade sites in §5.2; re-estimate Phase 1 to 3.0 days.
7. Strip unused `isTimeFilter` import; add `useReportUrlState` to `hooks/gnolove/index.ts` barrel.
8. Phase 2 Task 2.2: bump estimate to 1 day; write a `useHomeUrlState` schema spec.
9. i18n stub: wrap month/year formatting in helper that consults `navigator.language`.
10. Assign a Phase 0 reviewer who reads the schema BEFORE Phase 1 begins.

---

## 7. Cross-panel correlation matrix

| Theme | Frontend | QA | Security | UX | SRE | Adversarial | Severity |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---:|
| **`push` vs `replace` history strategy** | F-1 reconcile | — | — | U-1 | — | A-2 | HIGH |
| **`serializeReportUrl({ pinAt })` mode** | F-3 | — | — | U-7 | — | A-17 | HIGH |
| **`repos: readonly string[]` not `Set`** | F-4 | Q-1 sort | — | — | — | — | MED |
| **BUG-5 disambiguation (months spanning weeks)** | F-5 + all→X teleport | Q-5 freeze clock | — | U-3 | — | A-4 | HIGH |
| **ISO week 53 / year boundary tests** | F-6 | Q-1 | — | — | — | — | MED |
| **`<PageMeta>` cleanup race / og:title twin** | F-7 | — | — | U-12 | — | — | MED |
| **Stale-cache vs URL state interaction** | F-8 | — | — | — | — | — | MED |
| **`[searchParams.toString()]` → `[searchParams]`** | F-2 | — | — | — | — | — | LOW |
| **Per-file coverage gate + fast-check + axe** | — | Q-6, Q-7 | — | — | — | A-10 | MED |
| **Mock backend in Playwright (page.route)** | — | Q-4 | — | — | R-7 | — | HIGH |
| **Strict-mode hook test** | — | Q-3 | — | — | — | — | LOW |
| **Test assertion `window.location.length` is wrong** | — | Q-2 | — | — | — | — | LOW |
| **`team` charset/length restriction (Zod)** | — | — | S-1 | — | — | — | MED |
| **Cap year range in regex** | — | — | S-4 | — | — | — | LOW |
| **Reconstruct copy-link URL from state** | F-3 (pinAt) | — | S-3 | U-7 | — | A-17 | HIGH |
| **`repos` size cap + length cap** | — | — | S-5 | — | — | — | LOW |
| **Sentry breadcrumb on URL parse fallback** | — | — | S-6 | — | R-2 | — | HIGH |
| **Plausible: keep team out of props** | — | — | S-2 | — | — | — | MED |
| **Per-reason "Clear filters"** | — | — | — | U-2 + U-8 | — | — | MED |
| **Visible Copy-button state animation** | — | — | — | U-6 | — | — | LOW |
| **AI Reports deep-link highlight flash** | — | — | — | U-9 | — | — | LOW |
| **Share submenu (Slack/Twitter/Email)** | — | — | — | U-5 | — | — | LOW |
| **Defaults vs share-link override ADR-006** | — | — | — | U-10 | — | — | LOW |
| **Netlify dashboard rollback as primary** | — | — | — | — | R-1 | — | MED |
| **Feature flag VITE_GNOLOVE_URL_STATE** | — | — | — | — | R-9 | — | MED |
| **Lighthouse: wire URL or downgrade** | — | — | — | — | R-6 | — | LOW |
| **`frontend/package.json` version bump** | — | — | — | — | R-11 | — | LOW |
| **Explicit Cache-Control HTML** | — | — | — | — | R-8 | — | LOW |
| **Drop `"all_time"` → `"all"` rename** | — | — | — | — | — | A-1 | HIGH |
| **Stale-team banner (mirror BUG-2)** | — | — | — | — | — | A-15 | MED |
| **MD-export "Filter URL" canonicalize** | — | — | — | — | — | A-9, A-17 | LOW |
| **Strip `isTimeFilter` import; add barrel** | — | — | — | — | — | A-11, A-16 | TRIVIAL |
| **Re-estimate to 10-12 days** | — | — | — | — | — | A-5, A-7, A-8 | HIGH |
| **i18n stub** | — | — | — | — | — | A-14 | LOW |
| **Cross-tab URL sync acknowledgment** | — | — | — | — | — | A-12 | TRIVIAL |
| **Single point of failure: Phase 0 reviewer** | — | — | — | — | — | A-?? | MED |

---

## 8. Consolidated must-fix list for Rev1

These are the **mandatory edits** to the plan before implementation begins, sorted by severity. Each item points back to its panel-source IDs.

### 8.1 HIGH severity (block implementation start)

1. **[A-1]** Drop the runtime rename `"all_time" → "all"`. Map *only at the URL parser/serializer boundary*. Update §3.2/§3.4/§4.1.
2. **[F-1 + U-1 + A-2 + F-?? E2E spec #6 contradiction]** Switch history strategy: `push` on period/at/team/tab/repos changes; `replace` only on `view` toggle. Update G4, ADR-001, §17.2 spec #6 expectation, R-2 risk wording.
3. **[F-3 + U-7 + A-17 + S-3]** Add `serializeReportUrl(state, { pinAt: true })` mode. Copy Link button uses this AND reconstructs URL from validated state (not `window.location.href`). Same canonicalization applies to MD-export "Filter URL" footer (also drop `view=table` from the embedded link).
4. **[A-4 + U-3 + F-5]** BUG-5: pick the explicit rule "for weekly→monthly, use the month containing `end` (last day of the displayed week)". For `all → period`, fall back to `defaultKey(next)` (don't teleport to 1980). Document in §4.3 + ADR-007 (new).
5. **[Q-4 + R-7]** Every Playwright spec that asserts rendered data must `page.route('**/backend.gnolove.world/**', ...)` to a fixture **AND** retain skip-if-API-unreachable for resilience. Add a shared fixture file `frontend/e2e/fixtures/gnoloveReport.json`.
6. **[R-2 + S-6]** Sentry breadcrumb on URL parse fallback — Required, not conditional. Rate-limit to ≤1/min. Tagged `gnolove.url.fallback`. Wire from inside `parseReportUrl`.
7. **[A-5 + A-7 + A-8]** Re-estimate effort: **10–12 calendar days**, not 6–8. Update §18 sequencing chart, header duration estimate, and Phase 1/2/5 day allocations.

### 8.2 MEDIUM severity (must fix before merge)

8. **[F-4]** Type-change: `ReportUrlState.repos: readonly string[]` (sorted), convert to `Set` only at filter callsite. Update §3.4 + §6 Task 0.2 round-trip tests.
9. **[F-6 + Q-1]** Add explicit unit-test cases: `at=2020-W53` (accept), `at=2021-W53` (reject), `weekKeyFromDate(new Date("2025-12-31"))` (returns `2026-W01`), stale `at` vs `period` mismatch, URL-encoded `team` (`%20`, `%2E`, `%26`), idempotency check `serialize(parse(serialize(s))) === serialize(s)`, sort-stability of `repos`.
10. **[F-7 + U-12]** `<PageMeta>` must not race on rapid back-and-forth navigation: use a layout-level title source OR a per-mount sentinel that only restores if the current title matches the captured-on-mount title. Add `<meta property="og:title">` twin in the same effect.
11. **[F-8 + persisted-cache risk]** Document in §14 / §20.4 that BUG-2's banner can false-positive on persisted `gnolove-cache-v1` stale cache. Add `Promise.all([refetchRepos, refetchReport])` to "Reset filters" path.
12. **[S-1 + S-2]** Zod schema for `team`: `z.string().regex(/^[A-Za-z0-9 ._-]{1,64}$/).catch(null)`. Keep team name out of Plausible event props; emit only `hasTeam: boolean`.
13. **[U-2 + U-8]** Empty-state reasons: implement per-reason buttons + per-reason copy (use the strings in Panel 4 U-2 verbatim).
14. **[Q-6 + Q-7 + A-10]** Add `fast-check@4.x` and `@axe-core/playwright@4.x` to `devDependencies`. Gate one a11y spec per gnolove page in CI. Use `fast-check` for the round-trip property test.
15. **[Q-?? coverage]** Add `coverage.thresholds` to `vite.config.ts` scoped to `src/lib/gnoloveReportUrl.ts` and `src/hooks/gnolove/**` at ≥90% per file.
16. **[R-1]** Rollback playbook (§16) — Netlify dashboard rollback is the **primary** path (~30s); `git revert` is forward-fix secondary (~6-10 min). Correct the MTTR claim.
17. **[R-9]** Feature flag the reader via `import.meta.env.VITE_GNOLOVE_URL_STATE === '1'`. Default-on in dev, default-on in prod via Netlify env. Flip-off is a 3-min redeploy without `git revert`. Document in §16.
18. **[A-15]** Add a *stale-team* warning banner mirroring BUG-2: if URL pins `?team=Foo` and `Foo ∉ TEAMS`, fall back to "all teams" + show a dismissible banner.
19. **[A-?? SPOF]** Phase 0 review gate: name a **second** engineer who code-reads `gnoloveReportUrl.ts` + `useReportUrlState.ts` BEFORE Phase 1 begins. The schema is load-bearing; one set of eyes is too few.

### 8.3 LOW severity (must fix before merge, low effort)

20. **[F-2]** `[searchParams]` memo key; remove `eslint-disable`.
21. **[Q-2]** Hook test: replace `window.location.length` assertion with a `setSearchParams` spy that asserts `{ replace: true }` (or, after fix #2, `{ replace: false }` for the relevant axes).
22. **[Q-3]** Add a strict-mode variant of the hook test.
23. **[S-4]** Cap year range in regex: `(20[1-3]\d)` so accepted years are 2010–2039.
24. **[S-5]** `repos` parser: hard cap raw string length to 4096; truncate split-result to 50 entries.
25. **[U-5 + U-6 + U-9]** `<CopyLinkButton>`: 250ms color flash + clipboard→check icon swap + 1.5s "Copied!" persist. Optionally a dropdown menu "Copy / Slack / Twitter / Email" on desktop (P1; can defer if time).
26. **[U-10]** Add ADR-006: "Defaults are first-visit affordances only; any shared link overrides defaults bit-for-bit."
27. **[U-11]** Acknowledge mobile filter bar cramped state; add Q-13 for follow-up.
28. **[R-6]** §17.4 Lighthouse: either (a) add `/test12/gnolove/report?period=monthly&at=2026-05` to `lighthouserc.json` with a vite-preview + MSW shim, or (b) downgrade wording to "manual smoke check on PR author's machine".
29. **[R-8]** Add explicit `Cache-Control: public, max-age=0, must-revalidate` for `/index.html` in `netlify.toml`.
30. **[R-11]** Spell out: bump `frontend/package.json` from `4.0.0` → `4.1.0` so Sentry release is `memba@4.1.0`. Plan §6.3 must include this.
31. **[A-11 + A-16]** Strip unused `isTimeFilter` import in §3.4. Add `useReportUrlState` + `useHomeUrlState` to `hooks/gnolove/index.ts` barrel.
32. **[A-9]** MD-export "Filter URL" footer: drop `view=table` from the embedded URL (canonicalize to report view).
33. **[A-14]** i18n stub: `format(start, "MMMM yyyy", { locale: detectLocale() })` where `detectLocale()` consults `navigator.language` and falls back to `date-fns/locale/en-US`.
34. **[A-12]** §20 add note: no cross-tab URL sync today; acceptable for v1.

### 8.4 TRIVIAL (housekeeping)

35. **[A-?? barrel]** Update `frontend/src/hooks/gnolove/index.ts` to re-export `useReportUrlState` and `useHomeUrlState`.
36. **[U-?? share label]** Rename "Copy link" → "Share" if the dropdown menu (U-5 P0) ships; keep "Copy link" if only the single button ships.

---

## 9. Verdict matrix

| Reviewer | Rev0 verdict | After Rev1 with §8 applied (predicted) |
|---|---|---|
| Frontend Architect | APPROVE WITH CHANGES (8) | APPROVE |
| QA Test Engineer | APPROVE WITH CHANGES (7) | APPROVE |
| Security | APPROVE WITH CHANGES (5) | APPROVE |
| UX / Product | APPROVE WITH CHANGES (7) | APPROVE |
| SRE / Release Engineering | APPROVE WITH CHANGES (7) | APPROVE |
| Adversarial Red Team | APPROVE WITH CHANGES (major) (10) | APPROVE |

**Consensus:** with §8 applied, all six panels would issue APPROVE.

---

## 10. Outstanding open questions to escalate to operator

Beyond the must-fix list, these open product/process decisions need operator sign-off before Phase 0 begins:

| ID | Question | Recommendation |
|---|---|---|
| EQ-1 | Approve `push` for filter changes (cross-panel must-fix #2)? | Yes — matches GitHub/Linear/Amplitude precedent. |
| EQ-2 | Pick `%20` over `+` URL-encoding for `team` values (Plan Q-2)? | `%20`. RFC 3986-compliant non-form encoding. |
| EQ-3 | Add `fast-check` + `@axe-core/playwright` devDeps (must-fix #14)? | Yes; both <100KB devDeps; net testing-quality win. |
| EQ-4 | Feature-flag the reader via `VITE_GNOLOVE_URL_STATE` (must-fix #17)? | Yes; dark-launch + flip-off without revert. |
| EQ-5 | Bump `frontend/package.json` to 4.1.0 (must-fix #30)? | Yes; clarifies Sentry release name. |
| EQ-6 | Phase 0 reviewer (must-fix #19) — who? | Operator names a second IC; default `@n0izn0iz` (per recent v7.1 review trail). |
| EQ-7 | Land in parallel with v7.1 Phase 3, after Phase 3.0's MSW prereq (cross-confirmed by SRE R-10)? | Yes; the MSW harness lands in Phase 3.0 and is required by must-fix #5. |
| EQ-8 | Accept the 10–12 day re-estimate (must-fix #7)? | Yes; 6–8 days was optimistic. |
| EQ-9 | Share submenu (Copy/Slack/Twitter/Email) ships in this PR or follow-up? | Recommend: single Copy button now; submenu in v6.2.0. |
| EQ-10 | Cross-tab URL sync (BroadcastChannel) — implement or punt? | Punt to v6.2.0. |

---

## 11. What this review did NOT cover (out of scope)

- Performance regression analysis vs. live production traffic.
- Penetration testing of the deployed feature.
- A11y audit by a screen-reader specialist (the panel covered WCAG criteria but no manual NVDA/VoiceOver walkthrough).
- Browser-matrix testing beyond evergreen Chrome/Firefox/Safari/Edge.
- Mobile-device testing on real handsets.
- Comparative URL-state research vs. peer apps (GitHub Insights, Linear, Plausible's own dashboards).

These items belong in §17.5 of the Rev1 plan (new section: "Out-of-scope verification work — accepted risk").

---

> **Next:** Author of Rev0 should produce **Rev1** of [`GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md`](GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md) addressing every item in §8 of this document. Each Rev1 edit should cite the must-fix ID. Once Rev1 is published, this expert-review doc remains the immutable audit trail.
