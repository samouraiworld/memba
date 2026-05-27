# Changelog

All notable changes to Memba are documented here.

Full changelogs are split by version range for easier navigation:

## Unreleased — v6.3.0 (Gnolove UX overhaul — topic classifier, mobile, awards, profiles)

> Major Gnolove UX session (2026-05-25 / 2026-05-26): 10 PRs merged (#351–#360), covering architecture refactoring, accessibility, design tokens, test coverage, product trust, topic classifier precision, mobile PWA, team awards, and team profile enrichment. Phase 7 (drop legacy flag) still pending.

### Added — PRs #351–#360

- **Architecture refactor (#351).** God-components split: `gnoloveAnalytics.ts`, `gnoloveReportFilters.ts`, `NarrativeReportView` extracted. Error boundaries unified.
- **Accessibility AAA (#352).** `useFocusTrap` + `AccessibleDialog`, SortHeader aria, touch targets (44px min), chart aria-labels, aria-live regions.
- **UX polish + design tokens (#353).** Dead CSS cleanup, light-theme chart tokens, methodology text in collapsible `<details>`.
- **Product trust + shareability (#354).** `og:url`/`og:image` PageMeta, relative-time sync pills with stale warnings, AI report deep-link support, improved "Team not found" empty state.
- **Test coverage (#355).** `gnoloveTime.test.ts`, `gnoloveAnalytics.test.ts`, `gnoloveReportFilters.test.ts`, `TeamHub.test.tsx`.
- **Reliability foundation (#356).** Fixed `/health` endpoint handling, null-array Zod parse, backend-down banner.
- **Focus areas rework + repo badges + team report card + custom dates (#357).** Kill "Other" bucket (4 new topics: consensus, realms, frontend, testing), conventional-commit prefix matching, `gnolang/gno` "core" badge, team report card on hub pages, "Custom" date range with from/to pickers, new 480px mobile breakpoint.
- **Roster popover + team ordering (#358).** Clickable roster metric, case-insensitive login matching, Samouraiworld description update.
- **Topic classifier precision (#359).** 30+ new regex patterns reduce "Other" from 35% to 7.5%. Synced with gnolove backend `topics.yaml` (gnolove#225).
- **Mobile UX + team awards + team profiles (#360).** Dead burger menu hidden, `overflow-x: hidden` on `.gl-page`, 375px iPhone SE breakpoint. Data-driven award badges (Top Contributors, Top Reviewers, Most Efficient). Team logos (GitHub org avatars), websites, and verified Twitter handles on Teams page + team hub headers.

### gnolove backend (gnolove#224, #225)
- Samouraiworld description synced, `onbloc/gno-ibc` added to tracked repos.
- `topics.yaml` expanded with 30+ patterns matching the frontend classifier.

### Pending
- **Phase 7** — drop `GnoloveTeamProfileLegacy` + the `VITE_GNOLOVE_TEAM_HUB` flag. Overdue (gate was 2026-05-23). Safe to execute next session.
- **VPS env update** — add `onbloc/gno-ibc/main` to `GITHUB_REPOSITORIES` on VPS (Lours has SSH access).

---

## v6.2.3 (Gnolove analytics rework — final 2 panels + Phase 6 canary)

> Last beats of the team-hub rework. Plan §2's analytics promise is now fully delivered: 5 of 5 panels rendering against real data, with end-to-end canary coverage. Only Phase 7 (drop the legacy stub + the `VITE_GNOLOVE_TEAM_HUB` flag) remains, and that's intentionally gated on a few days of clean prod uptime.

### Added
- **Cohort retention panel.** Per-month cohort × month-offset retention grid, sourced from a new gnolove endpoint `GET /contributors/cohorts` (samouraiworld/gnolove#223). Newest cohort at the top; intensity from the shared `--gl-color-heatmap-l0..l4` ramp; empty cells where offset > cohort age render transparent so "hasn't aged yet" looks different from "dropped to zero." Backend math: per-author `MIN(created_at)` over the PR table picks the cohort; 24-month lookback cap.
- **Cross-team collaboration matrix.** 8×8 (auto-grows with `teams.yaml`) review-count matrix from new gnolove endpoint `GET /team-collab?time=...`. Joins `reviews` → `pull_requests` → `users` twice to attribute each review to (authorTeam, reviewerTeam). Self-reviews and dependabot excluded; "outsider" buckets (reviews involving non-team contributors) surface as a footnote. Diagonal cells get a dashed outline so intra-team activity reads distinctly. Driven by the page period selector.
- **Phase 6 — Playwright canary.** New `e2e/gnolove-team-hub.spec.ts` exercises: team hub mounts on `gnoland1`, "Roster updated" chip in header, period tablist URL state, network chip honesty (hidden on `gnoland1`, present on `test12`), all 5 analytics panel titles in trailing-year mode, and the On-Chain Metrics tile is **not** present (catches accidental revert of the v6.2.2 cleanup).
- **Dev/CI flag parity.** New `.env.development` (repo root — `vite.config.ts` sets `envDir: '..'`) sets `VITE_GNOLOVE_TEAM_HUB=true` so `npm run dev` and CI Playwright runs mirror production (where the flag has been on since 2026-05-19). Devs who want the legacy stub override with `.env.local` (also at the repo root). `.env.example` updated with doc-only entries.

### Fixed
- **Phase 6 canary actually green in CI.** Three follow-up corrections shipped after #346 landed red on main:
  1. `.env.development` was at `frontend/` but Vite's `envDir: '..'` reads from the repo root, so the flag was never loaded in dev/CI — moved to repo root.
  2. The period-tablist canary clicked a tab named `/Weekly/i` that never existed; labels are `Last week` per `TEAM_HUB_PERIOD_LABELS` — regex fixed.
  3. The 5-panels canary asserted panel titles, but each panel `<h2>` is gated behind `{data && (...)}` — without backend reachability from the runner (CORS blocks `localhost:5173`), no panels mount. Test now soft-skips with a clear reason rather than failing; data-mode runs on memba.samourai.app remain authoritative.

### Internal
- New Zod schemas: `CohortRowSchema` / `CohortsResponseSchema` and `TeamCollabCellSchema` / `TeamCollabResponseSchema`.
- New API client functions: `getContributorCohorts()`, `getTeamCollab(period)`.
- New hooks: `useGnoloveCohorts()`, `useGnoloveTeamCollab(period)` — 5-min staleTime matching the backend ristretto cache.
- New CSS namespaces: `.gl-cohort-grid-*`, `.gl-collab-matrix-*` (both reuse the topic-heatmap intensity ramp). `.gl-panel-footnote` utility class for the outsider-reviews line.

### gnolove backend (samouraiworld/gnolove#223)
- Two new aggregation endpoints — no new tables, no migrations, no new ingestion. `Review.AuthorID` + `Review.PullRequestID` was already populated by `syncPRs()` (see `server/sync/sync.go:263`); the new endpoints just aggregate from there + the PR `created_at` index.

### Tests
- 1843/1843 vitest unchanged.
- New Playwright canary spec covers the team hub + all 5 analytics panels.
- gnolove backend: full Go suite still green; new `handler/contributor/cohorts_test.go` + `handler/teams/collab_test.go` cover the cohort math, the dependabot/self-review exclusions, the outsider buckets, and the cache-hit behavior.

### Pending
- **Phase 7** — drop `GnoloveTeamProfileLegacy` + the `VITE_GNOLOVE_TEAM_HUB` flag. Gated on 3+ days of clean hub uptime (so don't open before 2026-05-23). Small cleanup, not a feature.

Handoff: [`docs/reports/handoff-team-hub-2026-05-20.md`](docs/reports/handoff-team-hub-2026-05-20.md).

---

## Unreleased — v6.2.2 (Gnolove audit fixes + Analytics period URL + 3 of 5 plan §2 panels)

Shipped 2026-05-19 via memba#344. See plan §4.1 for the full breakdown. Highlights:
- **3 of 5 plan §2 analytics panels** — PR cycle-time histogram, topic activity heatmap (16 topics × 12 months via the live `/topics` taxonomy), repo health matrix (traffic-light cells for PRs/wk, median cycle, open backlog, last activity).
- **`/gnolove` audit fixes (P0+P1)** — On-Chain Metrics tile removed (plan §2), `GnoloveTeams` slimmed to the index link grid plan §2 asked for, Score Factors badge folded into a `<details>` to hit the 5-section cap, "Last sync" → "Roster updated" pill (honesty), `TeamHubMetricsGrid` + `TeamHubActiveReposCard` distinguish "data unavailable" from "legitimately quiet period" instead of silently rendering 0s, auto-degrade banner above the legacy stub (plan §3 R-4), dual-threshold % surfaced inline on Primary/Secondary repo rows, AI report `?aiReport=<id>#<project>` deep-link with auto-expand + scroll + reduced-motion-safe highlight flash.
- **Period selector consistency** — Home time-filter migrated to `role="tablist"`; Analytics gains a tablist + URL state (`?time=`).

---

## Unreleased — v6.2.1 (Team-hub UX polish + Phase-7 a11y)

Shipped 2026-05-19 via memba#343. Highlights:
- Period selector → `role="tablist"` matching the `GnoloveReport` pattern. `aria-current`/`aria-selected` on the active period.
- Skeleton fidelity — each of the four loading cards renders a card-shaped placeholder instead of the generic 3-line stack. `aria-busy="true"` on the card, `aria-hidden="true"` on the skeleton DOM.
- `aria-live="polite"` regions on metrics, active repos, focus pills, recent activity so period changes announce.
- New `--gl-font-mono` token; 84 hardcoded `JetBrains Mono` declarations consolidated to `var()` references.
- `@media (max-width: 768px)` block for `.gl-thub-*` — header stacks, metrics grid drops to 2 cols, paddings tighten.
- Reduced-motion respect extended to team-hub interactives (cards, pills, repo rows, AI toggle).

---

## Unreleased — v6.2.0 (Gnolove Team Hub Rework)

> Makes `/:network/gnolove/teams/:teamName` the section's primary noun — team composition + active repos + scoped metrics + Focus Areas pills + embedded AI reports. Plan: [`docs/planning/archive/v6.3-gnolove/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md`](docs/planning/archive/v6.3-gnolove/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md). Live in production behind `VITE_GNOLOVE_TEAM_HUB`, flipped on Netlify 2026-05-19.

### Added
- **Phase 0 (#337)** — `jsPDF` lazy import (~135 KB gz off first paint); `useGnoloveYearReport()` exported as the shared base query so derived hooks reuse the same cache; `SectionErrorBoundary` extracted; TEAMS uniqueness invariants locked in vitest; design-system token additions for PR-state + Recharts palette + heatmap ramp; MSW + fast-check + `@axe-core/playwright` added as dev deps.
- **Phase 3 (#338)** — `useGnoloveTeams()` seed + fetched-union hook: build-time `TEAMS` constant becomes the seed; backend `GET /teams` replaces it once the network resolves. `KNOWN_TEAMS` becomes async-aware; localStorage cache key bumped `v1 → v2`.
- **Phase 4 (#339)** — Team Hub MVP behind `VITE_GNOLOVE_TEAM_HUB`. Six cards under `components/gnolove/teams/`: `TeamHubHeader` (name + colour stripe + period selector + "Last sync" pill + "Data: mainnet" chip on `test12`), `TeamHubMetricsGrid`, `TeamHubActiveReposCard` (dual-threshold "Primary" / "Also contributes to" rows), `TeamHubFocusAreasCard` (5 pills), `TeamHubRecentActivityCard`, `TeamHubAIReportsCard`. `useTeamProfileUrlState` URL-state codec; `lib/gnolovePeriod.ts` extraction; per-card `CardErrorBoundary`; `useGnoloveBackendHealth()` auto-degrades to `GnoloveTeamProfileLegacy` after 2× HEAD failure in 30s.
- **Phase 5 (#340)** — AI report v2 polish. Shared `<AIReportCard>` backs both the standalone page and the team-hub embed. Short summary visible by default; "Read Detailed Report" toggle expands the long form inline on desktop, opens as a bottom-sheet on mobile (<768px). `?id=` → `?aiReport=` URL namespace migration with back-compat. Empty-string-safe coalescing (`||`, not `??`) for the additive Zod migration on `summary_short` / `summary_long`.
- **Phase 2c (#342, paired with gnolove#222)** — Focus Areas taxonomy moves server-side. `gnolove/server/config/topics.yaml` (16 topics, ported verbatim from the legacy TS regex bag) is now the source of truth, exposed via `GET /topics`. Memba consumes via `useGnoloveTopics()` seed-union (same shape as `useGnoloveTeams`); `computeFocusAreas(signals, rules?)` accepts caller rules with the build-time copy as default. `FocusTopic` widened from a literal union to `string` since the backend now owns the taxonomy. `compileBackendTopic` drops invalid regexes with a warning rather than crashing the card.

### Changed
- The Team Hub auto-degrades to the legacy stub if the gnolove backend reports unhealthy — no Netlify redeploy required to mitigate a backend hiccup.

### Operator decisions logged
- **Q-1** Curated ~50 tracked repos (not naive ~120). **Q-2** Dual-threshold "active repo" rule (>2% of team's PRs AND >5% of repo's PRs → Primary; below → "Also contributes to"). **Q-3** Both AI summaries visible inline; toggle labelled **"Read Detailed Report"**. **Q-4** Client-side AI report team filter. **Q-5** Focus Areas pills v1 (matrix is v1.5 behind a sub-flag). **Q-6** 24h EU-business Lours SLA for roster changes; emergency client-side seed-edit fallback. **Q-7** No staging; rollout = Netlify Deploy Previews + 24h production canary. Full text in plan §6.

### Tests
- Memba: 1838/1838 vitest passing (started this version at 1759). New: 23 around `useGnoloveTopics` + Focus Areas refactor; 19 around `useGnoloveTeams`; full coverage of seed-union loading / success / null / empty-roster branches; per-card error boundary tests.
- gnolove backend: full Go suite green; `TestLoadRealConfigFile` smoke tests both `teams.yaml` and `topics.yaml` against the real checked-in YAML so a bad commit fails CI.

### Not in this version (intentionally)
- **Phase 2b** — curated `~50-repo` expansion in `infra_gnolove` (deferred; revisit when Mistral context-budget pressure justifies).
- **Phase 5.5** — CORS glob for `*.netlify.app` previews (dropped 2026-05-19: operator opted for prod-only testing).
- **Plan-original Phase 6** — Analytics rework (cycle-time histogram, cohort retention, repo health matrix, topic-time heatmap, cross-team collab matrix). Deferred; operator redefined Phase 6 as a 1-day Playwright canary instead.
- **Plan-original Phase 7** — UX polish + a11y (empty states, skeleton fidelity, tabs pattern consistency, focus management on dropdowns, motion gating, `var(--font-mono)` consolidation). Being audited 2026-05-19 as candidate work for a v6.2.x patch release.

### Internal
- New components: `components/gnolove/teams/` (TeamHub + 6 cards + `CardErrorBoundary`).
- New hooks: `useGnoloveTeams`, `useGnoloveTeam`, `useGnoloveTeamActiveRepos`, `useGnoloveTeamStats`, `useGnoloveTopics`, `useGnoloveBackendHealth`, `useTeamProfileUrlState`.
- New API client: `getTeams`, `getTeam`, `getTeamActiveRepos`, `getTeamStats`, `getTopics`.
- New Zod schemas: `BackendTeamSchema`, `TeamsResponseSchema`, `TeamResponseSchema`, `ActiveReposResponseSchema`, `TeamStatsResponseSchema`, `BackendTopicSchema`, `TopicsResponseSchema`.
- gnolove backend: new packages `server/teams`, `server/topics`, `server/handler/teams`, `server/handler/topics`. New endpoints: `GET /teams`, `GET /teams/:slug`, `GET /teams/:slug/active-repos`, `GET /teams/:slug/team-stats`, `GET /topics`. Two new env vars: `TEAMS_CONFIG_PATH` (default `config/teams.yaml`), `TOPICS_CONFIG_PATH` (default `config/topics.yaml`).

Handoffs: [`docs/reports/handoff-team-hub-2026-05-18.md`](docs/reports/handoff-team-hub-2026-05-18.md), [`docs/reports/handoff-team-hub-2026-05-19.md`](docs/reports/handoff-team-hub-2026-05-19.md).

---

## Unreleased — v6.1.0 (Gnolove shareable URLs + section UX hardening)

### Added
- **Gnolove — shareable report URLs.** Every filter on `/:network/gnolove/report`
  (period, period offset, status tab, team, repository set, view mode) now
  serializes to URL query params. Absolute period keys (ISO-8601
  `at=2026-W18` / `2026-05` / `2026`) so links stay valid forever — a Friday
  link still shows the same week on Monday. Same treatment for
  `/gnolove` (Home scoreboard: timeFilter / sort / excludedTeams /
  selectedRepos / page) and `/gnolove/reports` (AI archive: `?id=` deep-link
  with auto-scroll + highlight flash). `Copy link` button on the Report
  reconstructs the URL from validated state (Web Share API fallback on mobile).
- **Per-page contextual `document.title`** + `og:title` / `twitter:title` via
  a new `<PageMeta>` component (race-safe cleanup, no react-helmet).
- **Stale-repo / stale-team warning banners** on the Report when a shared
  URL pins a repo or team that no longer exists.
- **Smarter empty states**: branches per reason (no_data / team / repo /
  team_and_repo / filter) with scoped "Clear that one filter" buttons.

### Fixed
- **BUG-1**: all internal gnolove `<Link to="…">` use `useNetworkPath()`;
  SubNav + 12 link sites no longer detour through `LegacyRedirect` (extra
  render + URL flicker).
- **BUG-2**: Report no longer silently empties when the default repo
  (`gnolang/gno`) is missing from the backend response — a dismissible
  warning banner appears.
- **BUG-3**: Report "Highlights" (top 5 merged PRs) now sorts by `mergedAt`
  descending. Previously sorted by `title.length` (a meaningless proxy).
- **BUG-4**: PR status badge derives from PR data (`statusFor()`), not from
  the active tab. Blocked PRs now correctly show "Blocked" on the "All" tab.
- **BUG-5**: Switching period preserves time-window context. April week 18
  (which ends 2026-05-03) → Monthly now lands on **May**, not the current
  month. `all_time → weekly` no longer teleports to 1980.
- **BUG-6**: Report MD-export footer ID matches the report's period
  (was always week-ID regardless). Footer also embeds a "Filter URL" share
  link with `view=table` stripped.
- **UX-1**: `aria-current` on active period/status tabs; `aria-pressed` on
  view toggle; `aria-haspopup="listbox"` + `aria-expanded` on the repo
  multi-select; `role="tablist"` on tab groups.

### Internal
- New `lib/gnoloveReportUrl.ts` + `lib/gnoloveHomeUrl.ts` URL-state codecs
  with Zod validation, year-range cap, repos size cap, charset-restricted
  team allowlist, rate-limited Sentry breadcrumb on parse fallback.
- New `hooks/gnolove/useReportUrlState` + `useHomeUrlState` hooks with
  push/replace history strategy (push on coarse axes; replace only on
  `view` toggle).
- New `components/gnolove/PageMeta` (~50 LOC, race-safe `document.title`).
- `frontend/package.json` bumped `4.0.0 → 4.1.0` so Sentry release name is
  `memba@4.1.0`.
- Tests: 1,759 vitest (1,659 baseline + 100 new) + 13 Playwright chromium
  specs (3 new for URL-state behavior).

Plan: [`docs/planning/archive/v6.1-shareable-urls/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md`](docs/planning/archive/v6.1-shareable-urls/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md) (Rev1, ~1,750 lines).
Expert review (6 panels, immutable audit trail):
[`docs/planning/archive/v6.1-shareable-urls/GNOLOVE_SHAREABLE_REPORT_URLS_EXPERT_REVIEW.md`](docs/planning/archive/v6.1-shareable-urls/GNOLOVE_SHAREABLE_REPORT_URLS_EXPERT_REVIEW.md).

---

## Unreleased — post-v6.0.3 patches (Phase 0 wind-down)

- **#333** `fix(deploy)`: Sentry source-map assertion was a false negative (the
  Vite plugin deletes maps after upload by design) — replaced with a token-presence
  log. Fly → GHCR mirror jq query corrected (schema is
  `Registry/Repository/Tag`, not `.Ref`). After this, the GHCR mirror image
  `ghcr.io/samouraiworld/memba-backend:<sha>` is produced on every backend deploy.
- **#314** `fix(ux)`: improve error messages + execute button theme token.
- **#329** `chore`: rename `MikaelVallenet` → `mvallenet` in the gnolove
  contributors constant (matches the actual GitHub login casing).
- **#330** `docs(planning)`: v7.1 implementation plan + two expert review trails +
  PR triage runbook (5 markdown files under `docs/planning/`).
- **#334** `docs(reports)`: Phase 0 signoff record at
  `docs/reports/v7.1-phase0-signoff.md`.

Plan reference: `docs/planning/MEMBA_V7_1_IMPLEMENTATION_PLAN.md` §4.

## v6.0.3 (Phase 0b of v7.1) — Frontend deps, dependency policy, dependabot pause, OWASP regression suite

### Security
- **`@clerk/clerk-react`** bumped `^5.61.4` → **`^5.61.6`** (closes
  `GHSA-vqx2-fgx2-5wq9` + `GHSA-w24r-5266-9c3c`). Memba does not call any
  of the affected APIs (`has()`, `auth.protect()`, `createRouteMatcher`,
  billing, reverification, orgs) — see `docs/DEPENDENCY_POLICY.md` §7 for
  the evidence.
- **`@clerk/themes`** bumped `^2.4.57` → **`^2.4.60`** (peer of clerk-react).
- **`package.json` `overrides`**: `@clerk/shared` pinned to **`^3.47.5`** so
  the transitive cannot drag in a vulnerable copy.
- **`dompurify`** added as a **direct dep** at **`^3.4.2`** + `overrides`
  entry to coerce the `jspdf` transitive. Closes
  `GHSA-39q2-94rc-95cp`, `GHSA-h7mw-gpvr-xq4m`, `GHSA-crv5-9vww-q3g8`,
  `GHSA-v9jr-rg53-9pgp`. Memba's 3 sanitize call sites all use default
  config — not directly exploitable by the 4 CVEs.

### Folded patch bumps (10 dependabot PRs closed at merge)
- `@sentry/react` ^10.47.0 → ^10.49.0 (PR #315)
- `@tanstack/query-sync-storage-persister` ^5.99.0 → ^5.99.2 (PR #317)
- `@tanstack/react-query-persist-client` ^5.99.0 → ^5.99.2 (PR #319)
- `@tanstack/react-query` ^5.99.0 → ^5.99.2 (PR #327)
- `typescript-eslint` ^8.58.0 → ^8.59.0 (PR #322)
- `typescript` ~6.0.2 → ~6.0.3 (PR #326)
- `connectrpc.com/connect` v1.19.1 → v1.19.2 (PR #316)
- `github.com/cosmos/cosmos-sdk` v0.54.0 → v0.54.2 (PR #318; `internal/auth`
  test suite ran clean)
- `modernc.org/sqlite` v1.48.2 → v1.50.0 (PR #328)

### Tests
- New `frontend/src/lib/__tests__/sanitize-regression.test.ts` — 30 OWASP-style
  XSS vectors run against the production `DOMPurify.sanitize(html)` call
  shape (the same shape used at `NFTGallery.tsx:489`,
  `RealmDetailDrawer.tsx:164`, `SourceCodeView.tsx:116`). Locks the
  dompurify ≥ 3.4.2 baseline. Includes a meta-assertion that the helper
  passes no options (any future addition of `ADD_TAGS`, `RETURN_DOM`,
  `CUSTOM_ELEMENT_HANDLING`, or `SAFE_FOR_TEMPLATES` re-opens the closed
  CVE class and fails the test).

### Policy / process
- **New `docs/DEPENDENCY_POLICY.md`** — cadence, SLA (CRITICAL 24h /
  HIGH 5 BD / MODERATE 30d / LOW quarterly), responsibility matrix, group
  + auto-merge rules, Memba-specific exploitability evidence, allowlist
  procedure with 14-day expiry, escalation path, reviewer checklist.
- **New `.github/workflows/dependency-review.yml`** —
  `actions/dependency-review-action@v4` gates every PR; fails on severity
  ≥ HIGH; license allowlist (MIT / Apache-2.0 / BSD-2/3-Clause / ISC /
  MPL-2.0 / 0BSD / Unlicense / CC0-1.0).
- **`.github/dependabot.yml`** rewritten — grouping (tanstack, sentry,
  clerk, eslint, dev-deps, cosmos, connectrpc), `ignore: semver-major`,
  added `github-actions` ecosystem, `open-pull-requests-limit: 0`
  (**paused** for the v7.1 program; restored in Phase 6).

### Deferred (tracker)
- `eslint-plugin-react-hooks` stays at `~7.0.1`. The 7.1.x line adds
  `react-hooks/set-state-in-effect` which flags 60 patterns Phase 3
  React Query migration will eliminate. PR #320 closed; re-bump after
  Phase 3.
- `eslint` 10 (PR #324 closed; v7.2 spike).
- `vite` 8 (PR #325 closed; v7.2 spike).
- Clerk patch PR #323 closed (superseded — we jumped to 5.61.6 in this PR).

## v6.0.2 (Phase 0a of v7.1) — CI unblock, AUTH-CHAINID-01, rollback hardening

### Security
- **MEMBA-2026-001 / AUTH-CHAINID-01**: ADR-036 sign document now embeds the
  real `chain_id` instead of `""`. Auth tokens carry the chain they were issued
  for; cross-chain token replay is rejected. Includes a 24h legacy grace window
  for pre-fix clients. See `docs/advisories/MEMBA-2026-001.md` for the full
  write-up.

### CI / infrastructure
- Bumped Go toolchain to **1.25.10** across `go.mod`, `ci.yml`,
  `deploy-backend.yml`, and `backend/Dockerfile` (pinned `golang:1.25.10-alpine`).
  Closes `GO-2026-4918`, `GO-2026-4971`, `GO-2026-4980`, `GO-2026-4982`.
- Pinned `govulncheck` to `v1.3.0` in every workflow site (no more `@latest`).
- `security.yml` now uses `go-version-file: backend/go.mod` (was stale at
  `1.23`); dropped the duplicate `backend-audit` job that conflicted with
  `ci.yml` + `govulncheck.yml`.
- `deploy-frontend.yml`: removed `|| true` from `npm audit` (silent failure
  forbidden) and switched the production audit to `--omit=dev`.
- `deploy-frontend.yml`: wired `SENTRY_AUTH_TOKEN` into the build env so
  source maps actually upload, plus an explicit guard that fails the job if
  no `*.js.map` files were produced.
- `npm ci --ignore-scripts` on the Netlify build path (supply-chain defense).
- Frontend `Dockerfile`: default `VITE_GNO_CHAIN_ID` bumped from the stale
  `test11` to `test12`.

### Rollback / deploy hardening
- `fly.toml` now declares `[deploy] strategy = "rolling"` with
  `wait_timeout = "5m"` — bluegreen is incompatible with this app (volume +
  single-machine). See `docs/OPS_RUNBOOK.md` §4.
- Both deploy workflows now use `cancel-in-progress: false` so concurrent
  deploys **queue** instead of cancelling mid-traffic-flip.
- `deploy-backend.yml` now mirrors every successful Fly deploy to GHCR
  (`ghcr.io/samouraiworld/memba-backend:<git-describe>`) as a long-lived
  rollback artifact (Fly registry retention is undocumented).

### Headers
- Added `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  to `netlify.toml`.

### Docs
- New `docs/advisories/MEMBA-2026-001.md`.
- New `docs/comms/v7.1-token-rotation.md` (user-facing banner + Discord copy).
- New `docs/comms/v7.1-adena-disclosure.md` (coordinated disclosure draft).
- New `docs/OPS_RUNBOOK.md` (rollback playbooks, recurring tasks, SLO).

## v6.0.0 (2026-04-16) — Security Hardening, AVL Migration & Accessibility

### Security (10 fixes)
- **AUTH-01**: Pubkey-bound challenges prevent zero-click account takeover
- **SEC-01**: Removed unauthenticated `/api/eval` endpoint
- **SEC-02/03**: Auth required on IPFS upload and AI analyst endpoints
- **SEC-04**: Removed CORS wildcard for Netlify deploy previews
- **SEC-06**: Rate limiting now uses `Fly-Client-IP` (spoofing-proof)
- **SEC-NEW-01**: Fixed JSON injection in ABCI query construction
- **SEC-NEW-03**: Added 1MB body size limit to ConnectRPC handler
- **SEC-NEW-04**: Removed user-controllable LLM prompts (prompt injection)
- **SEC-05**: NFTGallery XSS fix (DOMPurify after markdown conversion)

### Gno Templates
- **GNO-NEW-01**: Unified AVL import paths (`p/demo/avl` → `p/nt/avl/v0`) across all templates
- **GNO-01**: Migrated daoTemplate from slices to AVL trees (O(n) → O(log n) lookups)
- **GNO-02**: Added `Render("page:N")` pagination to agent_registry, escrow, and daoTemplate
- **DEFI-01**: Fixed escrow dispute timeout — now refunds CLIENT (was releasing to freelancer)

### UX & Accessibility
- **UX-01**: Global `:focus-visible` styles for keyboard navigation (WCAG 2.1 AA)
- **UX-02**: Added 320px breakpoint with overflow guards
- **UX-04**: Vote confirmation dialog before irreversible on-chain votes
- **ARCH-07**: Replaced hardcoded hex colors with theme tokens in 3 files

### Infrastructure
- `min_machines_running = 1` (prevents cold start DoS)
- Memory: 256MB → 512MB
- ED25519_SEED startup guard (fails if unset in production)
- `npm test` added to deploy-frontend CI gate
- Coverage reporting (backend + frontend) with artifact upload
- Bundle size budget enforcement (main chunk < 600KB)
- Gno lint now fails CI (removed `|| true`)

### Docs
- `docs/planning/archive/v6/MEMBA_V6_IMPLEMENTATION_PLAN.md` — 32-expert audit, 108 issues catalogued
- `docs/SECRETS_ROTATION.md` — rotation procedures for all credentials
- `docs/PROGRESSIVE_DECENTRALIZATION.md` — roadmap for reducing centralization

## Version History

| Version Range | File | Period |
|---------------|------|--------|
| **v4.0** | [changelogs/v4.0.md](changelogs/v4.0.md) | 2026-04-08 |
| **v3.x** (v3.1–v3.2) | [changelogs/v3.x.md](changelogs/v3.x.md) | 2026-04-04 — 2026-04-06 |
| **v2.14–v2.29** | [changelogs/v2.14-v2.29.md](changelogs/v2.14-v2.29.md) | 2026-03-17 — 2026-04-02 |
| **v1.0–v2.13** | [changelogs/v1.0-v2.13.md](changelogs/v1.0-v2.13.md) | Pre-2026-03-17 |
