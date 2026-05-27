# /gnolove — AAA SWE Audit + Quality Lift Plan

> **Session date:** 2026-05-20
> **Scope:** Memba FE `/gnolove` only (10 pages, ~14 components, 7 hooks). Backend (`backend.gnolove.world`) treated as a contract — not in scope. Phase 7 (drop `GnoloveTeamProfileLegacy` + flag) is **separate** and gated to 2026-05-23. This plan is independent of Phase 7 but PR-1 unblocks it.
> **Approach:** 6 parallel expert perspectives audited the surface (UX/UI, Accessibility, Frontend Architecture, Operations/SRE, Product, QA). Findings are consolidated below by theme and then sequenced into 6 PRs.
> **Status:** Awaiting operator approval before implementation.

---

## 0. Executive summary

The /gnolove section is **substantially solid** post-#347: per-card error isolation, sane React Query usage, a working backend-health probe, well-decomposed Team Hub, honest "—" empty states, and a proper a11y test as a floor. But the audit surfaces **two structural P0s that gate Phase 7** and a meaningful AAA-polish gap distributed across all six lenses:

1. **`lib/gnoloveApi.ts` swallows every error and returns `null`.** React Query never sees `isError`, retries don't fire, Sentry never gets a network-failure event. The hub looks identical when a backend is broken vs. quiet. **This is the single highest-leverage fix.**
2. **Backend-down inside the hub is invisible once Phase 7 removes the legacy fallback.** A sticky hub-level banner + per-card retry is required for plan §3 R-4 honesty. PR-1 must ship before Phase 7 ships on 2026-05-23.
3. **The `AIReportCard` bottom sheet is `role="dialog" aria-modal="true"` but has no focus trap, no ESC handler, no scroll lock, no `aria-labelledby`.** Keyboard-unusable on desktop; backdrop-scrolls on iOS Safari. Fails WCAG 2.1 AA today.
4. **Several touch targets are 24–28 px tall on a mobile-primary surface.** Fails WCAG 2.5.5 / 2.5.8 AA.
5. **`PageMeta` never sets per-route `og:image` / `og:url`.** Every shareable /gnolove link previews as the generic Memba card — invisibly undoing the shareable-URLs work shipped in #336.
6. **Two god-components**: `GnoloveReport.tsx` (978 lines) and `GnoloveAnalytics.tsx` (839 lines). Filter pipeline duplicated in two places. 6 aggregators inline. Refactor unblocks unit testing of data-shaping logic.
7. **`TeamHub` orchestration and the auto-degrade pivot are entirely untested in Vitest.** Only the Playwright canary covers the page, against live prod data. A typo in the conditional at `GnoloveTeamProfile.tsx:33` would ship silently.

The "everything looks like a Grafana dev-console" feel is real but mostly cosmetic — six hardcoded chart hexes that bypass the design tokens already in place, emojis in `<h1>`s (also an a11y bug), and one universal card shape repeated nine times. Polish, not breakage.

**Proposed sequence:** PR-1 (reliability) lands first, before Phase 7. PR-2 (a11y) and PR-3 (architecture refactor) land in parallel after PR-1. PR-4 (UX polish) depends on PR-3's token work. PR-5 (product trust / sharing) and PR-6 (test coverage) close the arc. ~5–7 days of focused work.

---

## 1. Cross-cutting themes

Issues that appear under **multiple lenses** are weighted up here. Each row links to the lens-specific findings below.

| Theme | Severity | Lenses raising it | Where it lives |
|---|---|---|---|
| **API layer swallows errors → null** | P0 | SRE | `lib/gnoloveApi.ts` (~20 call sites) |
| **Backend-down banner missing inside the hub (blocks Phase 7)** | P0 | SRE | `components/gnolove/teams/TeamHub.tsx:42` |
| **AIReportCard sheet: no focus trap / ESC / scroll lock** | P0 | UX, A11y | `components/gnolove/AIReportCard.tsx:184-209` |
| **Touch targets <44 px on mobile** | P0 | UX, A11y | `pages/gnolove/gnolove.css:206-217, 678-692, 1117-1127, 2001-2011` |
| **Charts inaccessible (no aria-label / SR table)** | P0 | A11y | `pages/gnolove/GnoloveAnalytics.tsx:419-679` |
| **OG image/URL not per-route** | P0 | Product | `components/gnolove/PageMeta.tsx:45-52` |
| **Sentry never invoked in error boundaries** | P0 | SRE | `components/gnolove/SectionErrorBoundary.tsx:31`, `teams/CardErrorBoundary.tsx:32` |
| **TeamHub orchestration + degrade pivot untested** | P0 | QA | `components/gnolove/teams/TeamHub.tsx`, `pages/gnolove/GnoloveTeamProfile.tsx` |
| **Sortable `<th>` uses `role="button"` (broken semantics)** | P1 | A11y, Product | `pages/gnolove/GnoloveHome.tsx:497-508` |
| **Hardcoded chart hex colors bypass design tokens** | P1 | UX, Architect | `pages/gnolove/GnoloveAnalytics.tsx:34-43, 655-674, 703, 724, 747-750, 783-786` |
| **`Date.now()` inside `useMemo` (purity violation)** | P1 | Architect | `teams/TeamHubRecentActivityCard.tsx:42`, `teams/TeamHubHeader.tsx:39` |
| **`extractRepoFromUrl` duplicated 5 sites** | P1 | Architect | `lib/gnoloveApi.ts:114` (canonical) bypassed by 5 inline copies |
| **God-components: GnoloveReport 978 LoC, GnoloveAnalytics 839 LoC** | P1 | Architect | extract `lib/gnoloveAnalytics.ts` + `lib/gnoloveReportFilters.ts` |
| **No per-card retry buttons in error fallbacks** | P1 | SRE, UX | `teams/TeamHubMetricsGrid.tsx:78`, `teams/CardErrorBoundary.tsx:42` |
| **AI report card silently falls back to "show all"** | P1 | Product | `components/gnolove/AIReportCard.tsx:78-84` |
| **`teamHubA11y.test.tsx` doesn't cover focus mgmt / dialog / touch targets** | P1 | QA, A11y | `teams/teamHubA11y.test.tsx` |
| **Generic AI aesthetic: emoji in titles, one panel shape repeated** | P2 | UX, A11y | multiple page titles |
| **Roster sync label format diverges** | P2 | Product | `pages/gnolove/GnoloveTeams.tsx:33` vs `teams/TeamHubHeader.tsx:62` |
| **Metric labels lack tooltips** | P2 | Product, UX | `teams/TeamHubMetricsGrid.tsx:65-76` |

---

## 2. Findings by expert perspective

Each panel ran independently. P0 = ships broken, P1 = real quality cost, P2 = polish.

### 2.1 UX/UI Designer

> **Top-line:** Reads competent but visually identical from page to page. Every panel is the same 8 px-radius dark-surface card with uppercase 10–11 px monospace labels — no hierarchy. On mobile (primary surface) the 11 px mono + full-width tables crosses from "Grafana-inspired" into "dev console." Three things matter most: (1) typography density and touch-target sizing on phones, (2) the AI Report sheet ships without ESC/scroll-lock, (3) Analytics duplicates color literals the design system already exposes as tokens.

**P0**
- **AIReportCard sheet has no Escape, no body-scroll lock, no focus trap** — `AIReportCard.tsx:184-209` — `role="dialog" aria-modal="true"` declared but the modal is keyboard-unusable and the background scrolls underneath on iOS Safari. Fix: `useEffect` listens for `Escape`, sets `document.body.style.overflow="hidden"`, moves focus to the close button. ~10 lines.
- **GnoloveAIReports loading state has no page chrome** — `pages/gnolove/GnoloveAIReports.tsx:52-60` — when `isLoading`, the page renders three bare `gl-skeleton` rectangles with no `gl-page` wrapper, no title, no PageMeta. Hard layout shift when data lands. Fix: render the same `<div className="gl-page">` shell with title and a shaped report-card skeleton.
- **Leaderboard table on mobile is a 7-column horizontal scroller** — `pages/gnolove/GnoloveHome.tsx:399-423` + `gnolove.css:1845-1847` (the only mobile rule is `font-size: 11px`). A scroll-locked table is the wrong primitive for the main feature of the section's main page. Fix: under 640 px, render as a stacked card list (rank • avatar+name • inline mini-stats), keep the table for ≥768 px. ~40 lines + new mobile-row component.

**P1**
- **Emoji-as-section-title is the strongest generic-AI tell here** — `GnoloveAnalytics.tsx:371` (`📈 Ecosystem Insights`), `GnoloveTeams.tsx:31` (`🏆 Teams`), six emoji stat-card icons at `GnoloveAnalytics.tsx:403-408`. Replace with a subtle Radix icon (or none). Team-hub pages already do without emojis — inconsistent within the section.
- **Hardcoded chart hex colors bypass existing tokens** — `GnoloveAnalytics.tsx:34-43, 655-674, 703, 724, 747-750, 783-786` — uses `#00d4aa`, `#a855f7`, `#4a9eff`, `#22c55e`, `#ffc107`, while `gnolove.css:27-35` already defines `--gl-color-chart-series-primary/reviewed/open/issues/danger`. Light theme will look wrong (`[data-theme="light"]` at line 62 only redefines bg/grid/axis).
- **`TeamHubActiveReposCard` shows a math definition as default body copy** — `TeamHubActiveReposCard.tsx:87-89` — "> 2% of team's merged PRs and > 5% of the repo's merged PRs" is a methodology footnote, not headline content. Move to a `<details>` or hover-`?` tooltip on the "Primary" heading.
- **`TeamHubFocusAreasCard` copy reads like a dev note** — `TeamHubFocusAreasCard.tsx:71-74` — "Honest v1: top-5 topics… Matrix view is a follow-up." Drop or move to a "How this works" tooltip.
- **`GnoloveMilestone` is inline-style-heavy** — `pages/gnolove/GnoloveMilestone.tsx:47-107` — ten literal-value inline styles where `gl-panel`, `gl-issue-row` token classes already exist. ~30 lines to migrate.
- **`.gl-thub-card:hover` reduced-motion override targets a hover state that doesn't exist** — `gnolove.css:3371-3373` — dead code or missing default hover.

**P2**
- **Touch targets below 44 px on mobile** — `.gl-tab`, `.gl-pagination-btn`, `.gl-filter-btn` all land at ~24–28 px tall. Bump padding to hit 40 px under 768 px (folded into the a11y PR).
- **Six identical-shaped panels on Analytics** — `GnoloveAnalytics.tsx:412-679` — vary panel sizing (hero panel for "PR Activity Trend", 2-col for ratio metrics) instead of one shape repeated. Bigger refactor — flag the cost.
- **GnoloveTeams page is sparser than the cards it links to** — `GnoloveTeams.tsx:39-66` — pure-nav with no per-team activity hint. Consider inlining merged-PR-count or the period leader.
- **`.gl-thub-active-repo-pct` uses accent-green for primary repos** — competes with "merged" purple used elsewhere.

**Highest-leverage win (UX):** Strip the six emojis from page titles + stat-card icons, swap raw chart hex colors for the `--gl-color-chart-series-*` tokens that already exist, and add ESC + scroll-lock to the AIReport sheet. One day. Dramatic lift in "dev-tool prototype" feel and unblocks light-theme support.

---

### 2.2 Accessibility Engineer

> **Top-line:** The team-hub work (#336–#348) shipped a solid floor — real buttons, focus-visible rings, tablist roles, `aria-busy` on skeletons, `prefers-reduced-motion` respected. But several P0s remain that will fail an automated WCAG 2.1 AA scan today.

**P0**
- **Sheet "dialog" without focus management** — `AIReportCard.tsx:185-209` — `role="dialog" aria-modal="true"` but no `aria-label`/`aria-labelledby`, no focus trap, no initial focus, no focus restore, no Escape handler. Fix: `aria-labelledby`→ project name, move focus to close button on open, restore on close, trap Tab, listen for Escape.
- **Sortable table headers are buttons disguised as `<th>`** — `GnoloveHome.tsx:497-508` — `SortHeader` puts `role="button" tabIndex={0}` on `<th>`. Kills implicit `columnheader` semantic. AT announces "button" instead of "column header, sortable". Fix: keep `<th scope="col" aria-sort=…>` and put a real `<button>` inside.
- **Repo filter popup isn't a real combobox/listbox** — `GnoloveHome.tsx:309-360` — trigger uses `aria-expanded` but no `aria-haspopup`, no `aria-controls`, dropdown is `role="group"` of checkboxes with no roving focus, Escape only fires while focus is inside. Mobile users can't dismiss.
- **Touch targets below 44×44** — `gnolove.css:206-217, 678-692, 1117-1127, 2001-2011` — `.gl-filter-btn` (~27 px), `.gl-tab` (~28 px), `.gl-export-btn` (~24 px), `.gl-pagination-btn` (~26 px). Fails WCAG 2.5.5 / 2.5.8 AA.
- **Charts have no accessible alternative** — `GnoloveAnalytics.tsx:419-431, 651-679` and `GnoloveContributorProfile.tsx:420-476` — Recharts panels render as anonymous SVG; no `role="img"`, no `aria-label`, no offscreen `<table>` summary. (Heatmap matrix correctly uses `role="table"` — model that.) Fix: wrap each chart in `role="img" aria-label="<summary>"` + `.gl-sr-only <table>` mirror.

**P1**
- **Heading hierarchy: emoji ALT text + ordering** — `GnoloveAnalytics.tsx:371`, `GnoloveTeams.tsx:31`, `GnoloveReport.tsx:293`, `GnoloveHome.tsx:140` — emojis in `<h1>` read aloud ("bar chart increasing Ecosystem Insights"). Wrap in `<span aria-hidden="true">`. Also `TeamHubHeader.tsx:74`: back-link `<Link>` precedes the h1, so AT users hear the nav before the title — move `<h1>` first, or add `tabindex="-1"` and focus-move-on-route-change.
- **`aria-live` regions over-broadcast** — `TeamHubMetricsGrid.tsx:60-64`, `TeamHubActiveReposCard.tsx:72`, `TeamHubRecentActivityCard.tsx:94`, `TeamHubFocusAreasCard.tsx:75` — every card wraps its entire content in `aria-live="polite"`. On period change, screen readers re-announce 5 full cards simultaneously. Fix: scope to a short status string ("Metrics updated for last 30 days"), not whole grid.
- **Heatmap cells: numbers only, no level** — `GnoloveAnalytics.tsx:453-470, 504-518` — color level encodes intensity but the `aria-label`/`title` only repeat the raw count. Color-blind users get no fallback. Fix: include level in cell title (`"3 PRs (high)"`).
- **Vote chart click target isn't keyboard accessible** — `GnoloveAnalytics.tsx:768-789` — `onClick` on Recharts BarChart navigates to a proposal but bars aren't focusable and Enter doesn't trigger them. Add a parallel list of `<a>` links beneath the chart.
- **Form labels missing on team-select dropdown** — `GnoloveReport.tsx:403-413` — `<select aria-label="Filter by team">` works but pair with a visible `<label htmlFor>` for parity.

**P2**
- **`title` tooltips as the only carrier of info** — `TeamHubHeader.tsx:58-61`, `TeamHubActiveReposCard.tsx:35`, `GnoloveContributorProfile.tsx:386`. Promote to visible captions or `aria-describedby`.
- **Avatar `alt` redundancy on profile** — `GnoloveContributorProfile.tsx:323` uses `alt="${name}'s avatar"`; redundant since the name is next to it. Use `alt=""`.
- **Contribution heatmap missing per-month landmarks** — `GnoloveContributorProfile.tsx:81-132` — single `aria-label` is fine but cell `<title>` text won't reach mobile AT.
- **Skeleton with `aria-hidden=true` AND inside `aria-busy=true`** — double-muted; one mute is enough.
- **`teamHubA11y.test.tsx` gaps**: focus management (route change, dialog open/close), Escape key on the AI sheet, touch-target dimensions, chart `role="img"`, emoji-stripping in headings.

**Highest-leverage win (a11y):** Land a `useTrapFocus` hook + `<AccessibleDialog>` wrapper, retrofit `AIReportCard` sheet first, then reuse for the repo filter popup and any future mobile drawer — kills two P0s, lifts the touch-target work into the same PR, and gives `teamHubA11y.test.tsx` a real surface to assert against.

---

### 2.3 Frontend Architect

> **Top-line:** The surface is in solid shape post-#347: TeamHub is well-decomposed into 6 cards with consistent skeleton/loading/empty/error patterns; URL-state hooks share a coherent pattern; React Query keys are sane; `any` count is zero. The pain is concentrated in three places: two very long page files (`GnoloveReport` 978 lines, `GnoloveAnalytics` 839 lines) doing heavy aggregation inline, repeated GitHub-URL parsing and PR-filtering logic that drifts between sites, and a few raw `Date.now()` calls in `useMemo` that violate the handoff doc's purity pattern.

**P0**
- **Raw `Date.now()` inside `useMemo` reachable from React 19 strict** — `teams/TeamHubRecentActivityCard.tsx:42`, `teams/TeamHubHeader.tsx:39` — `relTime`/`formatRelativeTime` call `Date.now()` and are invoked inside the render path of cards whose `rows` are produced via `useMemo`. Handoff mandates `const [nowMs] = useState(() => Date.now())` (already used correctly in `GnoloveAnalytics.tsx:77`). Hoist a `nowMs` snapshot into each card and pass into helpers.
- **`extractRepoFromUrl` duplicated 5 sites, lib version bypassed** — `GnoloveAnalytics.tsx:228,269`; `teams/TeamHubFocusAreasCard.tsx:31`; `teams/TeamHubRecentActivityCard.tsx:32`. Canonical at `lib/gnoloveApi.ts:114` only consumed by `GnoloveReport.tsx`. Replace 5 inline copies.

**P1**
- **`GnoloveReport.tsx` is 978 lines — three components in one file** — contains `GnoloveReport`, `NarrativeReportView` (L616-961), `EmptyStateMessage` (L553-613), and `PRStateBadge`. PR-filtering pipeline implemented twice: parent L140-168 + `NarrativeReportView.filterPrs` L637-653. Extract `lib/gnoloveReportFilters.ts`; move `NarrativeReportView` to `components/gnolove/report/`.
- **`GnoloveAnalytics.tsx` is 839 lines, 12 query hooks, 6 inline aggregators** — `cycleTimeHistogram`, `topicHeatmap`, `repoHealth`, `cohortGrid`, `collabMatrix`, `voteData` (L86-365). God-component. Extract `lib/gnoloveAnalytics.ts` with pure unit-testable functions; reduce JSX file to ~300 lines.
- **Lexical shadow in `topicHeatmap`** — `GnoloveAnalytics.tsx:237` — `.map(([topic, counts]) => …)` shadows the outer `counts: Map<string, number[]>` declared L217. Filter L243-249 reaches across the shadow to the outer Map. Rename inner to `row` (already used elsewhere).
- **Missing `enabled` gate creates a useless query** — `hooks/gnolove/index.ts:139,162` — `useGnoloveRepoActivity`/`useGnoloveMonthlyActivity` use the queryKey `["…", "repoActivity", !!report]`. When `!!report` flips, the cache key changes and the false-keyed entry orphans. Harmless (queryFn never runs under false key) but clutters devtools.
- **Hub `setPeriod` uses `replace: true` inconsistently** — `useTeamProfileUrlState.ts:57` uses `replace: true` for period; `useReportUrlState`/`useHomeUrlState` use `push` for coarse axes so Back walks through filter history. Decide and document.

**P2**
- **Dropdown click-outside logic duplicated** — `GnoloveHome.tsx:64-73` and `GnoloveReport.tsx:85-100`. Extract `useClickOutside(ref, onClose)`.
- **Two error boundaries with overlapping intent** — `SectionErrorBoundary` (60 lines, with reset button) and `CardErrorBoundary` (53 lines, no reset). Same skeleton. Merge with a `variant: "section" | "card"` prop.
- **`recentActivity` list uses array index as key** — `GnoloveContributorProfile.tsx:521` — mixes PRs and issues with potentially-overlapping ids; use `${item.kind}-${item.id ?? item.url}`.
- **Inline-style overuse on `GnoloveMilestone.tsx` and `GnoloveContributorProfile.tsx`** — 8+ props via `style={…}` where CSS classes exist.
- **`useGnoloveBackendHealth` polls every 15s for the entire mount lifetime** — `useGnoloveBackendHealth.ts:22,76` — 240 HEAD requests/hour on a page open for hours. Pause on `document.hidden` or exponential backoff once `up`.

**Highest-leverage win (architect):** Extract `lib/gnoloveReportFilters.ts` and `lib/gnoloveAnalytics.ts`. Cuts ~400 LoC from the two longest files, unblocks unit testing of data-shaping logic, and creates an obvious home for the soon-to-be-shared `extractRepoFromUrl` callers.

---

### 2.4 Operations / SRE

> **Top-line:** The hub has many of the right ingredients — per-card boundaries, a HEAD-probe health hook, persisted React Query cache, "—" fallbacks — but the wiring is wrong in two structural ways. (1) `lib/gnoloveApi.ts` swallows every error and returns `null`, so React Query never sees `isError`, retries don't fire, Sentry never gets a network-failure event. (2) The legacy fallback is the *only* visible signal that the backend is down. Once Phase 7 removes it (2026-05-23), a hub with stale or absent data will look identical to a quiet-week hub.

**P0**
- **API layer swallows all errors** — `lib/gnoloveApi.ts:141-145, 154-157, 174-177, 200-203, 213-216, 228-229, 241-243, 254-256, 267-269, 280-282, 293-295, 304-307, 321-323, 334-336, 349-352, 363-366, 384-387, 402-405, 418-420, 432-435, 457-460` — every `try { ... } catch (err) { console.error; return null }` block converts hard failures (HTTP 5xx, timeout, parse error) into "indistinguishable from empty success". `HttpError` thrown at L97 with `.status` field, then immediately discarded. **Fix:** throw, don't return null. Let React Query own retry/error state. Switch card "hasFailed" check from `data == null` to `query.isError`.
- **Backend-down inside the hub is invisible post-Phase-7** — `components/gnolove/teams/TeamHub.tsx:42-112` — no hub-level banner, no aggregate health signal. With legacy fallback gone, hard-down backend renders six "—" cards with no explanation. **Fix (plan §3 R-4 inline UX):** at top of `TeamHub`, render a sticky banner when `useGnoloveBackendHealth() === "down"` OR when 3+ card queries are `isError`. Banner: *"Gnolove backend unreachable. Showing cached data from <relative-time>. [Retry now]"*. Button calls `queryClient.invalidateQueries({ queryKey: ["gnolove"] })`. Persisted cache (`GnoloveLayout.tsx:65-74`) makes the "cached data" claim honest.
- **Sentry documented but never invoked** — `SectionErrorBoundary.tsx:6, 31-33` and `teams/CardErrorBoundary.tsx:32-37` — comments say "surfaces in Sentry" but only `console.error` runs. `GnoloveLayout.tsx:81` doesn't pass `onError`. **Fix:** call `Sentry.captureException(error, { tags: { section: "gnolove", card: this.props.name }, contexts: { react: { componentStack: info.componentStack } } })` in both. Add React Query `QueryCache({ onError })` in `GnoloveLayout.tsx:47` that breadcrumbs every API failure with `queryKey` + team slug.

**P1**
- **No user-triggered retry inside cards** — `TeamHubMetricsGrid.tsx:78-82`, `TeamHubActiveReposCard.tsx:74-78`, `CardErrorBoundary.tsx:42-49`. Even `SectionErrorBoundary.tsx:48-54` has a button. Fix: pass `refetch` from per-card queries into fallback; render small "Retry" button.
- **Roster sync pill is honest, but no equivalent on data cards** — `TeamHubHeader.tsx:56-62` shows "Roster updated: Nm ago" sourced from `teams.yaml` mtime. Active-repos / metrics / activity / focus cards have no per-card freshness signal. Fix: surface `query.dataUpdatedAt` per card as a small "Updated Nm ago" footer.
- **404 team-not-found is a card-level concern, not a route** — `TeamHub.tsx:55-64` renders the message inline. Should `<Navigate>` to a dedicated 404 page (or `<PageMeta noindex>`) so SE doesn't index it as real, back button works cleanly. Also currently relies on seed roster matching — fresh backend-added teams 404 until seed catches up.
- **Probe URL/path can race with backend rollout** — `useGnoloveBackendHealth.ts:37` probes `${GNOLOVE_API_URL}/teams` via HEAD. Plan mentions `/health`. If backend doesn't implement HEAD on `/teams`, browsers see 405 (counted as "up") or CORS-preflight failure (counted as "down" → flaps). Fix: probe `/health` with GET; treat 200 only as up.

**P2**
- **Timeouts**: `FETCH_TIMEOUT_MS = 8_000` in `gnoloveApi.ts:64` + `retry: 1` (`GnoloveLayout.tsx:51`) = 16s worst case on flaky mobile. Consider `retry: (n, err) => n < 2 && err.status >= 500` with backoff.
- **Probe leak**: `setInterval(probe, 15s)` continues firing in hidden tabs. Pause via `visibilitychange` or use React Query `refetchInterval` on `["gnolove","health"]`.
- **Hub crash blast radius**: if `findTeam` throws (e.g. malformed `decodeURIComponent` on `TeamHub.tsx:32`), the whole hub crashes outside any boundary. Wrap `TeamHub` body in one.

**Highest-leverage win (SRE):** Stop swallowing errors in `lib/gnoloveApi.ts` and pipe failures into `useQuery.isError`. That one change unlocks honest backend-down UX in every card, enables React Query's retry/Sentry pipeline, and lets the hub render the R-4 banner from real state instead of the fragile HEAD probe.

---

### 2.5 Product Engineer

> **Top-line:** The team-hub is the strongest surface — honest "—" states, period-aware empty copy, dual-threshold rule explained, dual sync chips ("Roster updated" with tooltip distinguishing config-deploy from data-sync). The weak spots: zero tooltips on universal metric labels (so "Score", "Reviews", "PRs/wk" depend on a buried `<details>`); social previews identical across every /gnolove page; the `team` AI filter quietly shows ALL projects on rollover; several label-honesty / freshness inconsistencies across pages.

**P0**
- **OG image / URL never updated per route** — `components/gnolove/PageMeta.tsx:45-52` — sets `og:title`/`twitter:title`/`og:description` but never `og:image` or `og:url`. Every shared /gnolove link (Home, Teams, AI Reports, deep-linked report, contributor profile) inherits static `og:image="/og-image.png"` and `og:url="https://memba.samourai.app"` from `frontend/index.html`. Mobile is primary surface → DMs/Slack previews look identical for "PR Report · Core · This week" and "AI Reports". Fix: extend `PageMeta` with optional `image`, `url`, `type` props; set `og:url` to `window.location.href` by default; per-route default OG image.
- **"Last sync" still labels the contributors data clock on Home** — `pages/gnolove/GnoloveHome.tsx:142-144` — Home emits raw `toLocaleString()` with no tooltip and no stale indicator. If > 24h old, user sees a generic timestamp with no warning. Fix: relative time (matches `TeamHubHeader.formatRelativeTime`), tooltip with ISO, stale class once diff > 24h.

**P1**
- **`teamSlug` AI filter silently falls back to "show all"** — `components/gnolove/AIReportCard.tsx:78-84` — `filterByTeam` returns the entire project list when no project carries a `team` tag. The Team Hub embeds a card titled "AI weekly report" that visually claims team-scoped while showing the cross-ecosystem report. Fix: render "Team tagging not available for this report — showing all projects" hint.
- **Roster sync label format diverges between pages** — `GnoloveTeams.tsx:33-35` uses `toLocaleDateString()` (date only); `TeamHubHeader.tsx:62` uses `formatRelativeTime`. Same chip, two formats. Share one helper.
- **Sortable `<th>` missing `scope`/`aria-sort` inconsistently** — `GnoloveHome.tsx:404-410` `<th>` cells have no `scope="col"`; Analytics repo health at `GnoloveAnalytics.tsx:487-491` does. (Also raised in a11y.)
- **TeamHub doesn't propagate `aiReport` deep-link** — `teams/TeamHubAIReportsCard.tsx:23` always picks `reports[0]` (latest), so `/teams/core?aiReport=xyz` from a share scrolls nowhere. Fix: read `aiReport` from URL, find matching report.
- **`canGoForward` math off by a day at week boundaries** — `pages/gnolove/GnoloveReport.tsx:202-206` — `isFuture(addWeeks(start,1))` evaluates true the moment we cross Mon 00:00 UTC. Validate against `endOfWeek(now)` instead.
- **`gl-empty` (TeamHub "Team not found") lacks a search/redirect prompt** — `teams/TeamHub.tsx:55-63` — bare "Team not found: {decoded}" — only a small back chevron. Add `<Link to={backHref}>See all teams →</Link>` inline.

**P2**
- **Metric labels are jargon without tooltips** — `teams/TeamHubMetricsGrid.tsx:65-76`, `GnoloveAnalytics.tsx:403-409`, `GnoloveHome.tsx:406-410`, `GnoloveContributorProfile.tsx:402-405`. No `<abbr>`/`title`/`aria-describedby`. Home buries `<details>` "Score weights" toggle but it's not discoverable.
- **Honest day-window label** — `GnoloveAnalytics.tsx:715` says "Merged PRs (past year)" for "Most Active Repos" but feeds from `repoActivity` (backend-defined window). Either confirm and label precisely, or qualify as "recent".
- **Inconsistent error vocab** — `gl-error-banner` vs `gl-warning-banner` vs `gl-thub-empty role="status"`. Same severity, three visual treatments across the section. One shared `<DegradeBanner>`.
- **Sub-nav may swallow team-profile state** — `components/gnolove/GnoloveSubNav.tsx:20-27` — "Teams" tab at `path: "gnolove/teams"`, `end: false`. Verify `/gnolove/teams/core` keeps the tab active.
- **Tracked Repositories card has 0 activity signal** — `GnoloveHome.tsx:472-489`. Add "Active in window / Inactive" via `useGnoloveRepoActivity`.

**Highest-leverage win (product):** Fix PageMeta to set per-route `og:image` + dynamic `og:url`. Shareable URLs are the brand surface for /gnolove and currently every Slack/Twitter preview is the generic Memba card — invisible work since shipping #336.

---

### 2.6 QA / Test Engineer

> **Top-line:** Hook + lib layer is well-tested (URL parsers, seed/fetched unions, backend-health threshold). The team-hub Playwright canary correctly trades brittleness for soft-skip pragmatism. The big gaps are at the **seams**: `TeamHub` itself is never assembled in a test, the auto-degrade pivot (`degradedFromHub`) has zero coverage, `CardErrorBoundary` has no test (only `SectionErrorBoundary` does), and four of the six cards lack rendering tests beyond a11y-skeleton smoke. Mobile primary-surface promises (bottom sheet, viewport responsiveness, touch) are entirely unverified. Mock realism is decent but contract drift on `/team-stats`, `/active-repos`, `/cohorts`, `/team-collab`, `/ai-reports`, `/topics`, `/teams` is not caught.

**P0**
- **`TeamHub` orchestration fully untested** — `teams/TeamHub.tsx:42-112` — team-not-found branch, six-card composition, slug-vs-name lookup, stale-repo edge — none exercised in Vitest. Playwright only verifies "page renders" against prod data. Add `TeamHub.test.tsx`: not-found copy on `:teamName=missing`, all 6 cards on happy path, error-shape (`stats: null`) flips MetricsGrid to "—" without bringing siblings down, URL-encoded teamName decodes.
- **Auto-degrade path has no test** — `pages/gnolove/GnoloveTeamProfile.tsx:33-35` — when `health === "down"`, renders `<GnoloveTeamProfileLegacy degradedFromHub />`. The pivot is the entire reason R-4 exists. A typo in the conditional ships silently. Add page-level test that mocks `useGnoloveBackendHealth` returning `"down"`.

**P1**
- **`CardErrorBoundary` has no test** — `teams/CardErrorBoundary.tsx:25-53` — fallback rendering, `name`-prop propagation, optional `fallback` override unverified. Only `SectionErrorBoundary` is tested. Clone its test structure with `Boom` child + `name="Active repositories"` assertion.
- **`AIReportCard` mobile sheet untested** — `AIReportCard.tsx:110-121, 184-209` — `useIsMobile` 768px breakpoint + bottom-sheet dialog have no test. Mobile-primary-surface promise. jsdom test: stub `window.innerWidth = 400`, expand project, assert `role="dialog"`, click backdrop → closes.
- **`useGnoloveTeamActiveRepos` / `useGnoloveTeamStats` untested** — `hooks/gnolove/useGnoloveTeams.ts:108-127` — consumed by TeamHub, `enabled: !!slug` gate could regress to "always fetch".
- **Contract-drift coverage missing for new endpoints** — `lib/gnoloveApi.test.ts` — no tests for `getAIReports`, `getTeams`, `getTopics`, `getTeamActiveRepos`, `getTeamStats`, `getContributorCohorts`, `getTeamCollab`. A backend schema rename would surface in Sentry only. Add zod-rejection-returns-null cases for each.
- **`TeamHubFocusAreasCard` + `TeamHubRecentActivityCard` filters untested** — client-side period-cutoff filter is the most failure-prone code on the hub.

**P2**
- **Hooks index test anemic** — `hooks/gnolove/index.test.ts:1-18` — only one export locked. Add a snapshot of public surface.
- **`useHomeUrlState` no direct test** — only exercised via `GnoloveHome` rendering.
- **No visual regression** — six cards, two viewports, dark theme. Playwright `toHaveScreenshot()` at 375×667 and 1280×800.
- **`GnoloveAnalytics` page-level aggregators untested** — `GnoloveAnalytics.tsx:166-345` — ~180 lines of bucketing logic with off-by-one risk. Extract to `lib/gnoloveAnalytics.ts` and unit-test (also raised by architect).

**Top 5–8 highest-leverage new tests**
1. `TeamHub.test.tsx` — team-not-found banner (catches `findTeam` slug/name fallback regression).
2. `TeamHub.test.tsx` — partial-failure mount (stats null + active-repos ok → page still renders, MetricsGrid shows "—", others normal).
3. `GnoloveTeamProfile.test.tsx` — degraded pivot (mock health → "down" → renders legacy with `degradedFromHub`).
4. `CardErrorBoundary.test.tsx` — name-prop in fallback (throw inside child, assert `getByText("AI weekly report")`).
5. `AIReportCard.test.tsx` — mobile bottom sheet open/close (`innerWidth=400`).
6. `gnoloveApi.test.ts` — schema rejection for the 7 new endpoints (returns `null` on missing field).
7. `TeamHubFocusAreasCard.test.tsx` — period cutoff filter (frozen `Date.now()`, two PRs).
8. Playwright — invalid `:teamName` doesn't crash (`/gnoland1/gnolove/teams/%E2%9C%97` → not-found markup, no `pageerror`).

**Highest-leverage win (QA):** Add one integration test file `TeamHub.test.tsx` exercising not-found, partial-failure, and the degraded pivot. ~80 lines closes the largest seam — where a refactor today is most likely to ship a silent regression to the operator's mobile dashboard. Pair with the 7-endpoint contract-drift batch in `gnoloveApi.test.ts`.

---

## 3. Implementation plan — 6 sequenced PRs

Each PR is sized to land in one focused session, with green CI, and admin-mergeable. PRs are scoped so a partial roll-out leaves /gnolove in a strictly better state than today.

### PR-1 — Reliability foundation (P0, **blocks Phase 7**)

> **Why first:** Phase 7 ships 2026-05-23 and removes the legacy fallback. Without the inline backend-down banner and per-card retry, a hard-down backend post-Phase-7 renders six "—" cards with no explanation. This PR is the §3 R-4 honesty layer. It also unlocks Sentry capture (today neither boundary actually calls Sentry) and unblocks React Query's retry/`isError` pipeline.

**Scope**
- Stop swallowing errors in `lib/gnoloveApi.ts` (~20 sites): throw `HttpError`/parse errors instead of `return null`. Switch card "hasFailed" check from `data == null` to `query.isError`. Update every consumer's empty-vs-error branch.
- Add `<HubBackendDownBanner>` at top of `TeamHub.tsx`: sticky, shows when `useGnoloveBackendHealth() === "down"` OR ≥3 card queries are `isError`. Copy: *"Gnolove backend unreachable. Showing cached data from <relative-time>. [Retry now]"*. Button: `queryClient.invalidateQueries({ queryKey: ["gnolove"] })`.
- Add Sentry capture to both error boundaries with tags `{section: "gnolove", card: name}` + componentStack context.
- Add per-card retry button next to "Couldn't load this card" fallback. Each card receives `refetch` from its query and renders a small button when `isError`.
- Switch probe to `/health` GET (200-only = up) in `useGnoloveBackendHealth.ts:37`.
- Pause probe on `document.hidden` (use `visibilitychange`) — cheap reliability win.
- Add `QueryCache({ onError })` in `GnoloveLayout.tsx:47` for Sentry breadcrumbs.

**Files (10–12 touched)**
- `frontend/src/lib/gnoloveApi.ts` (throw, not null — biggest change)
- `frontend/src/components/gnolove/teams/TeamHub.tsx` (add banner + wrap root in boundary)
- `frontend/src/components/gnolove/teams/HubBackendDownBanner.tsx` (new, ~50 lines)
- `frontend/src/components/gnolove/SectionErrorBoundary.tsx` (Sentry call)
- `frontend/src/components/gnolove/teams/CardErrorBoundary.tsx` (Sentry call + retry button)
- `frontend/src/components/gnolove/GnoloveLayout.tsx` (`QueryCache.onError`)
- `frontend/src/hooks/gnolove/useGnoloveBackendHealth.ts` (`/health`, visibility-pause)
- Each TeamHub card (5 files) — switch `data == null` → `query.isError`, plumb `refetch` into fallback
- Test additions live in PR-6 but smoke a couple here as the spec exists

**Risk**
- Throwing instead of returning null is a contract change across the codebase. Some consumers may rely on `data == null` for "loading-and-empty" semantics. Audit at edit time; default each branch to "empty success unless `isError`".
- Banner false-positives if /health flaps. Use the 2× in 30s threshold consistently with the existing hook.

**Effort:** 1.5–2 days. Lands by 2026-05-22.

---

### PR-2 — Accessibility AAA pass (P0)

> **Why second:** Several findings will fail an automated WCAG 2.1 AA scan today (dialog focus mgmt, touch targets, chart inaccessibility, sortable header semantics). Bigger plumbing (focus trap hook + dialog wrapper) pays dividends across the codebase, not just /gnolove.

**Scope**
- New `frontend/src/hooks/useTrapFocus.ts` — generic Tab-trap.
- New `frontend/src/components/AccessibleDialog.tsx` — wraps `role="dialog"` content with `aria-labelledby`, initial-focus, focus-restore, Escape handler, body-scroll lock. Retrofit `AIReportCard` sheet first (`AIReportCard.tsx:184-209`); retrofit `GnoloveHome` repo filter popup second (`GnoloveHome.tsx:309-360`).
- `SortHeader`: keep `<th scope="col" aria-sort=…>`, put a real `<button>` inside instead of `role="button"` on `<th>` (`GnoloveHome.tsx:497-508`).
- Strip emojis from h1s OR wrap in `<span aria-hidden="true">` (`GnoloveAnalytics.tsx:371`, `GnoloveTeams.tsx:31`, `GnoloveReport.tsx:293`, `GnoloveHome.tsx:140`). Strip from stat-card icons (`GnoloveAnalytics.tsx:403-408`) — these become subtle Radix icons or nothing.
- Touch target: 44×44 min on `.gl-tab`, `.gl-filter-btn`, `.gl-export-btn`, `.gl-pagination-btn` under the mobile media query (`gnolove.css:206-217, 678-692, 1117-1127, 2001-2011`).
- Chart aria: wrap each `ResponsiveContainer` in `role="img" aria-label="<summary>"`; add offscreen `<table>` mirror inside `.gl-sr-only` (already a class in the codebase). Vote-bar chart gets a parallel list of `<a>` links beneath for keyboard parity.
- Scope `aria-live` to a short status string per card, not the whole grid content (`TeamHubMetricsGrid.tsx:60`, `TeamHubActiveReposCard.tsx:72`, `TeamHubRecentActivityCard.tsx:94`, `TeamHubFocusAreasCard.tsx:75`).
- Heatmap/repo-health cell labels: include level in `aria-label`/`title` (`"3 PRs (high)"`).
- Focus-move-on-route-change: focus the page `<h1>` (via `tabIndex={-1}`) on `pathname` change. Single hook used at the `GnoloveLayout` level.

**Files (~15 touched)**

**Risk**
- Focus-trap implementation edge cases (Shift-Tab into trigger). Lean on existing `react-focus-trap` or `@radix-ui/react-dialog` if Radix already in the bundle — likely faster than rolling our own.
- Stripping emoji changes scannability. Replace with single subtle icon (or nothing) at the same visual weight to avoid harsh diff.

**Effort:** 1.5–2 days. Parallel with PR-3.

---

### PR-3 — Architecture refactor (P1, enables PR-4 + PR-6)

> **Why:** Two god-components (`GnoloveReport` 978 LoC, `GnoloveAnalytics` 839 LoC) carry pure data-shaping logic that should be unit-testable. Extracting now unblocks PR-6 (test coverage) and PR-4 (UX polish — tokens are easier to swap when the JSX file isn't 800 lines).

**Scope**
- New `frontend/src/lib/gnoloveAnalytics.ts` — extract `cycleTimeHistogram`, `topicHeatmap`, `repoHealth`, `cohortGrid`, `collabMatrix`, `voteData` as pure functions. Each takes `(yearReport, period, nowMs[, rules])` and returns its shape. Reduces `GnoloveAnalytics.tsx` to ~300 lines of JSX.
- New `frontend/src/lib/gnoloveReportFilters.ts` — extract the team+repo+period+tab filter pipeline used twice in `GnoloveReport.tsx` (L140-168, L637-653) as `filterPrs(prs, criteria)`.
- New `frontend/src/components/gnolove/report/NarrativeReportView.tsx` — move L616-961 of `GnoloveReport.tsx` to its own file.
- Replace 5 inline copies of `extractRepoFromUrl` with the canonical helper at `lib/gnoloveApi.ts:114` (`GnoloveAnalytics.tsx:228,269`; `teams/TeamHubFocusAreasCard.tsx:31`; `teams/TeamHubRecentActivityCard.tsx:32`).
- Hoist `nowMs` snapshot pattern to `TeamHubRecentActivityCard.tsx:42` and `TeamHubHeader.tsx:39`.
- Rename `topicHeatmap` lexical shadow (`GnoloveAnalytics.tsx:237` `counts` → `row`).
- New `frontend/src/hooks/useClickOutside.ts` — extract from `GnoloveHome.tsx:64-73` and `GnoloveReport.tsx:85-100`.
- Merge `SectionErrorBoundary` + `CardErrorBoundary` into a single `<GnoloveErrorBoundary variant="section" | "card">` (this PR also enables PR-1's Sentry plumbing to live in one place).
- Drop the `!!report` segment of the `useGnoloveRepoActivity` / `useGnoloveMonthlyActivity` queryKey.
- Decide and document the `replace` vs. `push` history policy on `useTeamProfileUrlState.ts:57`. Recommendation: push for period (coarse axis), replace for repo set (fine filter). Match the rest of /gnolove.

**Files (~12 touched)**

**Risk**
- Big diff. Functional behavior should be byte-identical — every extraction is mechanical. CI + PR-6 tests catch regressions.
- The error-boundary merge changes a public-ish component name. Internal-only; safe to rename.

**Effort:** 2 days. Parallel with PR-2.

---

### PR-4 — UX polish + design tokens (P1)

> **Why:** With PR-3's leaner JSX file, swapping the 14+ hardcoded chart hexes for the existing `--gl-color-chart-series-*` tokens becomes a small, safe diff. This is the highest-leverage cosmetic lift.

**Scope**
- Swap all hardcoded chart colors for CSS-var lookups via `getComputedStyle` or inline `var(...)`:
  - `GnoloveAnalytics.tsx:34-43` (`TOOLTIP_STYLE`, `GRID_STYLE`, `AXIS_TICK`)
  - `GnoloveAnalytics.tsx:655-674` (3 area gradients)
  - `GnoloveAnalytics.tsx:703, 724, 747-750, 783-786` (5 `<Bar fill>`)
- Light theme: extend `[data-theme="light"]` (`gnolove.css:62-…`) to redefine chart series tokens too. Verify chart legibility in light mode.
- Strip / replace emoji in titles: `GnoloveAnalytics.tsx:371`, `GnoloveTeams.tsx:31`, `GnoloveHome.tsx:140`. Stat-card icons → single Radix icon (or omit; the label is enough).
- `GnoloveHome` leaderboard mobile: under 640 px, render `MobileLeaderRow` card list (rank · avatar+name · inline mini-stats). Keep desktop table at ≥768 px. ~50 lines + new component.
- `GnoloveAIReports` loading state: wrap in `<div className="gl-page">` with title + PageMeta + shaped skeleton matching `TeamHubAIReportsCard` shape.
- Move methodology-as-body-copy to tooltips / `<details>`: `TeamHubActiveReposCard.tsx:87-89` (dual-threshold rule); `TeamHubFocusAreasCard.tsx:71-74` ("Honest v1" dev note).
- Migrate `GnoloveMilestone.tsx:47-107` inline styles to existing CSS classes.
- Remove dead `.gl-thub-card:hover` reduced-motion override OR add a default hover (`gnolove.css:3371-3373`).
- Unified `<DegradeBanner>` component replacing `gl-error-banner` / `gl-warning-banner` / `gl-thub-empty role="status"` variants across `GnoloveHome.tsx:150`, `GnoloveReport.tsx:343`, `GnoloveAnalytics.tsx:392`, `TeamHubMetricsGrid.tsx:78`.

**Files (~10 touched, mostly CSS + JSX label diffs)**

**Risk:** None functional. Visual diff in light theme should be QA'd in the same PR.

**Effort:** 1.5–2 days.

---

### PR-5 — Product trust + shareability (P1)

> **Why:** Shareable URLs are the brand surface for /gnolove (shipped #336). Currently every Slack/Twitter preview shows the generic Memba card — invisible undo of that work. Plus several label-honesty + freshness inconsistencies degrade trust on the section.

**Scope**
- Extend `PageMeta.tsx` with `image`, `url`, `type` props. Default `og:url` to `window.location.href` at render time. Default `og:image` per route: `/og-gnolove-home.png`, `/og-gnolove-teams.png`, `/og-gnolove-report.png`, `/og-gnolove-analytics.png`, `/og-gnolove-ai-reports.png`. Each `<PageMeta>` call site passes a more-specific image (team OG card with team color + name; AI report OG with project + week).
- Replace generic OG image asset with 5 per-route defaults (creative is one-shot — Memba already has the dark-card aesthetic).
- `GnoloveHome.tsx:142-144` (`Last sync`) → relative time + tooltip with ISO + stale-warning class once > 24h.
- Unify roster-sync helper between `GnoloveTeams.tsx:33` and `TeamHubHeader.tsx:62` (same `formatRelativeTime`).
- `TeamHubAIReportsCard.tsx:23` reads `?aiReport=` from URL, finds matching report instead of picking `[0]`.
- `AIReportCard.tsx:78-84` — show "Team tagging not available for this report — showing all projects" hint when `filterByTeam` returns the full list under the team-slug rollover.
- `GnoloveReport.tsx:202-206` `canGoForward` math: validate against `endOfWeek(now)` instead of `addWeeks(start, 1)`.
- `teams/TeamHub.tsx:55-63` "Team not found" empty state: add `<Link to={backHref}>See all teams →</Link>` inline. Also route-level: `<Navigate>` or `<PageMeta noindex>` so SE doesn't index it.
- Metric tooltips on universal labels (`TeamHubMetricsGrid.tsx:65-76`, `GnoloveAnalytics.tsx:403-409`, `GnoloveHome.tsx:406-410`, `GnoloveContributorProfile.tsx:402-405`): small `?` affordance, hover/focus opens a one-sentence definition.
- Sortable `<th>` `scope="col"` consistency (`GnoloveHome.tsx:404-410`).
- `GnoloveSubNav.tsx`: verify `/gnolove/teams/core` keeps Teams tab active.
- "Tracked Repositories" card: optional small "Active in window / Inactive" chip from `useGnoloveRepoActivity` (`GnoloveHome.tsx:472-489`).

**Files (~12 touched)**

**Risk**
- OG images need design assets. If those don't exist, ship the dynamic-`og:url` + per-route-title work in this PR and defer per-route OG images to a follow-up.
- Tooltip pattern needs to be accessible (`<button aria-describedby>` or `<details>`; not `title=` only — also covered in PR-2's lens).

**Effort:** 2 days.

---

### PR-6 — Test coverage at the critical seams (P0/P1)

> **Why:** TeamHub orchestration + degrade pivot + CardErrorBoundary have zero Vitest coverage today. The Playwright canary covers the page but skips when CORS blocks (operator's choice). A refactor today is most likely to ship a silent regression here.

**Scope**
- `TeamHub.test.tsx` (~80 lines): not-found copy, all 6 cards on happy path, partial-failure (stats null + active-repos ok), URL-encoded `:teamName` decodes.
- `GnoloveTeamProfile.test.tsx`: mock `useGnoloveBackendHealth` → `"down"`, assert `<GnoloveTeamProfileLegacy degradedFromHub />` mounts.
- `CardErrorBoundary.test.tsx`: clone `SectionErrorBoundary.test.tsx`, assert `name`-prop in fallback.
- `AIReportCard.test.tsx`: stub `window.innerWidth = 400`, expand project, assert `role="dialog"`, click backdrop → closes, focus restored to trigger.
- `gnoloveApi.test.ts`: schema-rejection cases for `getAIReports`, `getTeams`, `getTopics`, `getTeamActiveRepos`, `getTeamStats`, `getContributorCohorts`, `getTeamCollab`.
- `TeamHubFocusAreasCard.test.tsx`: frozen `Date.now()`, two PRs (one inside / one outside cutoff), assert one feeds `computeFocusAreas`.
- `TeamHubRecentActivityCard.test.tsx`: same shape, period-cutoff filter behavior.
- `lib/gnoloveAnalytics.test.ts` (new, post-PR-3): unit tests for the 6 extracted aggregators. Off-by-one for month rollover, `>3mo` bucket, outsider-bucket sum.
- `lib/gnoloveReportFilters.test.ts` (new, post-PR-3): unit tests for `filterPrs` covering team + repo + period + tab edge cases.
- Playwright: `/gnoland1/gnolove/teams/%E2%9C%97` → not-found markup, no `pageerror`.
- Extend `teamHubA11y.test.tsx`: focus management (route change, dialog open/close), Escape key on AI sheet, touch-target dimensions, chart `role="img"`.
- (P2) Visual regression at 375×667 and 1280×800 via `toHaveScreenshot()` — keep off the default canary path so it doesn't churn CI.

**Files (~10 new test files, ~5 amended)**

**Risk**: minimal. Tests catch regressions; bad tests churn CI. Keep each one ≤80 lines, focused, no snapshots of large markup.

**Effort:** 2 days.

---

## 4. Sequencing & timeline

```
                                Phase 7 ships
                                     ▼
2026-05-20 — 21 — 22 — [23] — 24 — 25 — 26 — 27 — 28 — 29 — 30
  PR-1 ━━━━━━━━━━━━┓
                   ┃   (Phase 7 lands on top of PR-1's banner)
  PR-2 ━━━━━━━━━━━━╋━━━━━━┓
  PR-3 ━━━━━━━━━━━━╋━━━━━━┓
                   ┃      ┃
                   ┃      PR-4 ━━━━┓
                   ┃              PR-5 ━━━━┓
  PR-6 (rolling) ━━━━━━━━━━━━━━━━━━━━━━━━━━┓
```

- **PR-1 must land by 2026-05-22.** Phase 7 (2026-05-23) removes the auto-degrade fallback and is unsafe without PR-1's banner.
- **PR-2 + PR-3 run in parallel** after PR-1, both finishing by ~2026-05-25.
- **PR-4** sequenced after PR-3 (token swap is cleaner when GnoloveAnalytics.tsx is leaner).
- **PR-5** sequenced after PR-4 (DegradeBanner consolidates with PR-1's HubBackendDownBanner; PageMeta extension is independent).
- **PR-6** can drip-feed alongside each PR or ship as one batch after PR-3 lands (when the extracted lib files become test targets).

Total: ~10 working days serial, ~5–7 days with parallel PRs.

---

## 5. Open questions / decisions needed

1. **OG image assets** — does Memba have or want per-route OG images for /gnolove? If not, PR-5 ships dynamic `og:url` + per-route titles only and defers images to a separate creative pass.
2. **Light theme priority** — is light theme a release-blocker for /gnolove? PR-4 token swap improves light-theme support but doesn't *complete* it (chart color palette tuning + spot QA still needed). Could also defer light-theme polish to a follow-up.
3. **Route-level 404 for team-not-found** — preference for `<Navigate>` to a dedicated `/gnolove/teams/not-found` page vs. inline empty state with proper `noindex`? Inline + noindex is simpler; route is more SE-friendly.
4. **Focus-trap implementation** — roll our own `useTrapFocus` (clean, minimal) or pull in `@radix-ui/react-dialog` (already in the bundle, more features, more weight)? Recommend: roll our own; Radix's dialog has opinions about Portal usage that don't match the existing sheet markup.
5. **`replace` vs. `push` policy on `useTeamProfileUrlState`** — confirm: push for period, replace for repo set. Or keep current all-replace and document why TeamHub differs from Home/Report.
6. **Visual regression in CI** — opt-in (new job) or part of the default canary? Opt-in keeps CI fast.
7. **Effort tolerance** — comfortable with 6 PRs over ~1 week, or prefer to drop P2 items into a single follow-up "polish" PR?

---

## 6. Risks

- **PR-1's error-throwing change is a contract refactor across ~20 call sites.** If any consumer relies on `data == null` for "loading-and-empty" semantics, we get silent rendering bugs. Mitigation: PR-6's `TeamHub.test.tsx` partial-failure test catches this at the integration level; per-card lint review during the diff catches at the unit level.
- **HubBackendDownBanner false-positives** if `/health` flaps. Mitigation: reuse the existing 2× in 30s threshold from `useGnoloveBackendHealth`.
- **Sentry breadcrumb noise** from every API failure could drown signal. Mitigation: add a `fingerprint` tag scoped to `queryKey[0]` so identical errors group; set sample rate for the gnolove section.
- **OG image assets blocking PR-5** — if assets aren't ready, drop them from PR-5 scope without blocking the rest.
- **Two PRs in parallel (PR-2 + PR-3) touch some of the same files (TeamHub error boundary, GnoloveAnalytics).** Mitigation: PR-3 lands first if needed; PR-2 rebases.
- **Phase 7 gate** — if PR-1 slips past 2026-05-22, Phase 7 must wait. The user's locked plan says "3 days of clean prod soak" for the hub + auto-degrade, not specifically the banner — so the gate is 2026-05-23 OR PR-1-shipped+soaked, whichever is later.

---

## 7. What's NOT in scope

- **Phase 7 cleanup** (drop `GnoloveTeamProfileLegacy` + `VITE_GNOLOVE_TEAM_HUB` flag). Stays as its own gated PR per the existing plan. PR-1 here makes Phase 7 safer; doesn't replace it.
- **Backend changes** in `samouraiworld/gnolove`. Backend is treated as a contract. If `/health` endpoint isn't implemented exactly as PR-1 assumes, that's a coordinated change (separate gnolove-repo PR), not part of this plan.
- **Phase 2b** (curated ~50-repo expansion in `infra_gnolove`). Deferred per handoff.
- **New /gnolove features** (e.g., contributor → contributor comparisons, team-vs-team A/B view, alerting). This is a quality-lift plan, not a feature plan.
- **`topofgnomes` doc-typo cleanup.** Known artifact, not worth churning.
- **PostHog / external analytics integration.** Separate question.

---

## 8. Where this plan lives

- This document: `Memba/docs/planning/GNOLOVE_AAA_AUDIT_AND_QUALITY_PLAN_2026-05-20.md` (you're reading it)
- Referenced plan (Team Hub rework, Phase 7): `Memba/docs/planning/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md`
- Handoff (current state): `Memba/docs/reports/handoff-team-hub-2026-05-20.md`

---

## Kickoff — what I need from you

Read this. Confirm:

- **Go-ahead** to start with PR-1 (Reliability foundation — blocks Phase 7).
- **Decision on Open Questions §5** — at minimum #1 (OG assets) and #2 (light theme priority); the rest can resolve at PR boundaries.
- **Effort tolerance** — 6 PRs over ~1 week vs. consolidating P2 into a follow-up.

Once approved, I open PR-1 immediately and we hit the 2026-05-22 deadline for Phase 7 readiness.
