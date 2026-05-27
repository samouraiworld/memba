# Gnolove — Shareable Report URLs + Section UX Hardening — AAA SWE Implementation Plan

> **Date:** 2026-05-12
> **Revision:** **Rev1** — incorporates findings from the 6-panel CTO expert review (`GNOLOVE_SHAREABLE_REPORT_URLS_EXPERT_REVIEW.md`). Rev0 (initial draft) is preserved in git history only; Rev1 supersedes it. Each substantive change carries a must-fix ID (e.g. `[MF-2]`) tracing back to §8 of the expert review.
> **Status:** PROPOSAL — awaiting **operator approval** on the 10 escalated questions in §11 of the expert review. No code in this revision.
> **Scope owner:** Frontend Architect (primary IC) **+ named Phase 0 reviewer (TBD via EQ-6)** — schema is load-bearing, two sets of eyes required before Phase 1. **[MF-19]**
> **Repo:** `Memba` (this repo). No cross-repo coordination required.
> **Branch convention (to be created at execution time):** `feat/gnolove-shareable-urls`.
> **Feature-flag:** Reader gated behind `import.meta.env.VITE_GNOLOVE_URL_STATE === '1'` for dark-launch + Netlify-env flip-off rollback. **[MF-17]**
> **Predecessor docs:** [`REPORT_UX_IMPROVEMENTS.md`](REPORT_UX_IMPROVEMENTS.md) (2026-04-09, light-theme + early report UX work), [`MEMBA_V7_1_IMPLEMENTATION_PLAN.md`](MEMBA_V7_1_IMPLEMENTATION_PLAN.md) (current program of record).
> **Companion review doc:** [`GNOLOVE_SHAREABLE_REPORT_URLS_EXPERT_REVIEW.md`](GNOLOVE_SHAREABLE_REPORT_URLS_EXPERT_REVIEW.md) — immutable audit trail from 6 independent expert panels (Frontend Architect, QA, Security, UX, SRE, Adversarial Red Team).
> **Relationship to v7.1:** **Orthogonal.** This work touches only `frontend/src/pages/gnolove/*`, `frontend/src/components/gnolove/*`, three new files under `frontend/src/lib/`, and one new hook directory under `frontend/src/hooks/gnolove/`. No backend, no Gno realm, no infra, no auth surface, no on-chain mutation. Per SRE-panel R-10: land in parallel with v7.1 Phase 3, **after** Phase 3.0's MSW harness prereq (which this plan now depends on for Playwright mocking — see [MF-5]).
> **Duration estimate (Rev1, post-review correction):** **10–12 calendar days** at ~1 FTE. Rev0's "6–8 days" was optimistic — the Adversarial panel correctly identified that the `"all_time"` rename cascade alone consumes the original PTO float, Phase 2 (`GnoloveHome` URL state, 528 LOC) was off by 3–5×, and Phase 5 (`<PageMeta>` × 8 pages + Copy-Link with mobile share) is closer to 1.5 days than 0.75. Net-new code: ~900–1,100 LOC. Net-changed code: ~400–600 LOC. **[MF-7]**

---

## Executive Summary (≤ 60 seconds)

Today, every filter on `/:network/gnolove/report` (period, period offset, status tab, team, repository set, view mode) lives in **React local state**. A user who configures a useful report — e.g. *"Samourai.world team, monthly, May 2026, gnolang/gno + samouraiworld/memba, waiting-for-review tab"* — cannot share it: the URL is identical to a brand-new visit. The only state already in the URL is `?view=table`.

**This plan makes the gnolove `/report` page (and, in Phase 2, the gnolove **Home** scoreboard and **AI Reports** archive) fully **shareable, bookmarkable, and back-button-correct** via a versioned, validated, type-safe query-string schema, while fixing a set of correctness, accessibility and routing bugs discovered while reading the section end-to-end.

The work decomposes into 7 phases over ~10–12 days (Rev1 post-review estimate):

| Phase | Days | Theme | Deliverables |
|------:|-----:|-------|---|
| 0 | 0.75 | Foundation & shared URL-state hook **+ 2nd-IC schema review gate [MF-19]** | `useUrlState` hook + Zod schema for query params + property-based unit tests via `fast-check` [MF-14] |
| 1 | 3.0 | Report page URL state **(rename-cascade-aware [MF-1])** | `GnoloveReport` rewired to URL state; `offset` → absolute period key; defaults & legacy URL compat; BUG-2..BUG-6 + stale-team banner [MF-18]; `serializeReportUrl({ pinAt })` mode [MF-3] |
| 2 | 2.5 | Adjacent gnolove pages | `GnoloveHome` filters → URL (528 LOC, 9 useState, pagination clamp); `GnoloveAIReports` deep-link per report w/ highlight-flash [MF-?? U-9] |
| 3 | 0.75 | Network-prefix hygiene | All `<Link to="/gnolove*">` → `useNetworkPath()`; SubNav fixed; duplicate-link cleanup; LegacyRedirect kept as safety net only |
| 4 | 0.75 | Correctness & a11y bugs | Highlights `title.length → mergedAt`; status-badge accuracy; `aria-current`; weekly-scope rationale; **`@axe-core/playwright` gate per page [MF-14]** |
| 5 | 1.5 | SEO / share preview / copy-link | Per-page `document.title` + `<meta property="og:title">` twin [MF-10]; `<PageMeta>` race-safe cleanup [MF-10]; "Copy link" with reconstructed-from-state URL + 250ms visible flash [MF-3, MF-25] |
| 6 | 1.0 | Tests, telemetry, release | Playwright deep-link specs (all data-asserting specs use `page.route` stub + skip-if-API-unreachable [MF-5]); vitest URL-schema property tests; CHANGELOG; `frontend/package.json` 4.0.0 → 4.1.0 [MF-30]; PR ready for review |

**History strategy correction [MF-2]:** Rev0 specified blanket `{ replace: true }` for all URL writes. Three reviewers (Frontend Architect F-1, UX U-1, Adversarial A-2) independently flagged this as the wrong default and the source of an internal contradiction with §17.2 spec #6 ("back restores filters"). Rev1 adopts the GitHub/Linear/Amplitude convention: **`push` on coarse-axis filter changes** (period, at, team, tab, repos), **`replace` only on `view` toggle** (sibling-tab affordance, not a filter). See updated G4 + ADR-001 + new ADR-007.

**Net business value:**

1. **Sharing a report becomes a 1-click action** (URL is already the artifact; we add a "Copy link" affordance for explicit affordance).
2. **Weekly report links remain valid forever** (we encode absolute period keys, not relative offsets — a link sent on a Friday still shows the *same* week next Monday).
3. **Browser back/forward Just Works** across filter changes (no more "everything resets when I hit back").
4. **Dead-end UX states get correct empty messages** (e.g. "no PRs match this team + repo combination" vs. "no data for this period").
5. **Internal navigation is one redirect cheaper** (kills the `/gnolove/*` → `/:network/gnolove/*` LegacyRedirect detour on every SubNav click).
6. **No regression risk to multisig / DAO / NFT / wallet flows** — the diff is contained inside `pages/gnolove/`, `components/gnolove/`, three new `lib/` helpers, and one new `hooks/gnolove/` file.

**Non-goals (explicitly out of scope):**

- Server-side rendering or static OG image generation. (We use client-rendered `document.title` + lightweight meta override only.)
- Persisting filter state to the backend per-user. (URL = source of truth.)
- Refactoring `useGnoloveReport` query keys. (Stays as-is.)
- Adding a new filter dimension (author, label, repo-org grouping). (Future work.)
- Per-PR share links. (Out of scope; GitHub URLs already serve that role.)
- Mobile-specific share-sheet integration. (Web Share API is a nice-to-have, listed in Q-7.)

---

## Table of Contents

1. [Current State Snapshot](#1-current-state-snapshot)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [URL Schema Design](#3-url-schema-design)
4. [State Inventory & Migration Path](#4-state-inventory--migration-path)
5. [File Structure (new + modified)](#5-file-structure-new--modified)
6. [Phase 0 — Foundation & Shared Hook](#6-phase-0--foundation--shared-hook-day-05)
7. [Phase 1 — Report Page URL State](#7-phase-1--report-page-url-state-days-052)
8. [Phase 2 — Adjacent Pages](#8-phase-2--adjacent-pages-days-235)
9. [Phase 3 — Network-Prefix Link Hygiene](#9-phase-3--network-prefix-link-hygiene-day-4)
10. [Phase 4 — Correctness & a11y Bugs](#10-phase-4--correctness--a11y-bugs-day-45)
11. [Phase 5 — SEO / Share Preview / Copy-Link UX](#11-phase-5--seo--share-preview--copy-link-ux-day-5)
12. [Phase 6 — Tests, Telemetry, Release](#12-phase-6--tests-telemetry-release-days-56)
13. [Architecture Decision Records](#13-architecture-decision-records)
14. [Risk Register](#14-risk-register)
15. [Acceptance Criteria & Definition of Done](#15-acceptance-criteria--definition-of-done)
16. [Rollback Playbook](#16-rollback-playbook)
17. [Test Plan](#17-test-plan)
18. [Sequencing & Critical Path](#18-sequencing--critical-path)
19. [Observability & Telemetry](#19-observability--telemetry)
20. [Cross-cutting concerns](#20-cross-cutting-concerns)
21. [Open Questions for Approval](#21-open-questions-for-approval)
22. [Appendices](#22-appendices)

---

## 1. Current State Snapshot

### 1.1 Routing (verified against `App.tsx` @ commit `871e0cb`)

```
/                              → RootRedirect → /:storedNetwork/
/:network                      → NetworkGate (validates network, renders Layout)
    /:network/gnolove          → GnoloveLayout (own QueryClient, persists to localStorage)
        index                  → GnoloveHome
        report                 → GnoloveReport     ← MAIN TARGET OF THIS PLAN
        analytics              → GnoloveAnalytics
        contributor/:login     → GnoloveContributorProfile
        teams                  → GnoloveTeams
        teams/:teamName        → GnoloveTeamProfile
        reports                → GnoloveAIReports
        milestone              → GnoloveMilestone
    *                          → LegacyRedirect (catches /gnolove/foo and re-mounts as /:network/gnolove/foo)
```

`gnoland1` = betanet (mainnet, in Memba parlance). `test12` = staging. Both routes are valid `:network` values.

### 1.2 Local state held in `pages/gnolove/GnoloveReport.tsx` (verified)

| State variable | Type | Default | URL-encoded today? |
|----------------|------|---------|---|
| `period` | `"weekly"\|"monthly"\|"yearly"\|"all_time"` | `"weekly"` | ❌ |
| `offset` | `number` | `-1` (weekly) / `0` otherwise | ❌ |
| `activeTab` | `"all"\|ReportTab` (5 values) | `"all"` | ❌ |
| `selectedTeam` | `string` (team name or `"all"`) | `"all"` | ❌ |
| `selectedRepos` | `Set<string>` (`owner/name`) | `{"gnolang/gno"}` | ❌ |
| `repoDropdownOpen` | `boolean` | `false` | ❌ (ephemeral UI — stays local) |
| `view` | `"report"\|"table"` | `"report"` | ✅ (`?view=table`) |

### 1.3 Local state in other gnolove pages

| Page | State to share | Default | URL today? |
|------|---|---|---|
| `GnoloveHome` | `timeFilter`, `excludedTeams`, `sortBy`, `sortDir`, `selectedRepos`, `page` | mixed | ❌ |
| `GnoloveAIReports` | `visibleCount` (incremental) | `5` | ❌ |
| `GnoloveContributorProfile` | `:login` is in path; nothing else to share | n/a | ✅ (path param) |
| `GnoloveTeams` | nothing | n/a | n/a |
| `GnoloveTeamProfile` | `:teamName` in path | n/a | ✅ |
| `GnoloveAnalytics` | nothing | n/a | n/a |
| `GnoloveMilestone` | nothing (fixed `MILESTONE_NUMBER = 7`) | n/a | n/a |

### 1.4 Bugs & UX issues discovered while reading the section

> Each item is referenced by ID (`BUG-N` / `UX-N`) elsewhere in this plan. Verified by inspection of `frontend/src/pages/gnolove/*.tsx` + `frontend/src/components/gnolove/GnoloveSubNav.tsx`.

| ID | Severity | Where | Description |
|----|----------|-------|-------------|
| **BUG-1** | medium | `components/gnolove/GnoloveSubNav.tsx:11-16` and 8 internal `<Link to="/gnolove…">` sites (see grep output below) | All gnolove internal links use **absolute** `/gnolove/*` paths. They work only because `LegacyRedirect` re-routes them through `Navigate replace`, costing one extra render and one history-stack write. Direct symptom: clicking "Teams" momentarily shows `/gnolove/teams` in the URL bar before snapping to `/:network/gnolove/teams`. |
| **BUG-2** | medium | `GnoloveReport.tsx:85` | Default `selectedRepos = new Set(["gnolang/gno"])`. If the backend response doesn't include `gnolang/gno` (e.g. transient outage, mis-configured server) the user sees "No data for this period" with no clue why. This is a **silent empty-state** bug. |
| **BUG-3** | medium | `GnoloveReport.tsx:482` (`topMerged` "Highlights") | "Top merged PRs" are sorted by `b.title.length - a.title.length`. Title length is a meaningless impact proxy. Use `mergedAt` descending. |
| **BUG-4** | low | `GnoloveReport.tsx:761-778` (`PRStateBadge`) | Badge label is derived from `tab` for non-merged PRs; when `tab === "all"` and a PR is blocked, it renders as "Open". Should derive from PR shape (the report API already buckets PRs into status categories). |
| **BUG-5** | low | `GnoloveReport.tsx:206-209` (`handlePeriodChange`) | Switching `weekly → monthly` resets offset to `0` ("this month"), ignoring the currently-displayed week's month. A user looking at "first week of April" who clicks "Monthly" jumps to "May" (current month), not "April". |
| **BUG-6** | low | `GnoloveReport.tsx:577` | Generated MD report footer always emits `weekId = yyyy-Www` regardless of period. A monthly report file is correctly named `monthly-report-2026-05.md`, but its inline footer reads `Generated by Gnolove · 2026-W18`. Inconsistent metadata in shared artifacts. |
| **UX-1** | medium | `GnoloveReport.tsx` (all tab buttons + period buttons) | No `aria-current="page"` on active tab/period buttons. Screen readers can't announce active state. |
| **UX-2** | medium | `GnoloveReport.tsx:394-395` and `:602-603` | Empty-state message is the same string regardless of *why* the list is empty (no data vs. team-filter strips all results vs. repo-filter strips all results). The user gets no actionable feedback. |
| **UX-3** | low | `GnoloveAIReports.tsx:96-98, 143-150` | "Load more" is local state; a shared URL truncates to 5 items for the recipient. Also, no per-report deep-link. |
| **UX-4** | low | `GnoloveHome.tsx:32-39` | Pagination + filters are local; shared URL drops the user back to page 1, sort-by-score-desc, no repo filter. |
| **UX-5** | low | All `<title>` is the static `Memba — Gno Multisig & DAO Governance` for every page except contributor-profile. Shared report links preview the same title in Slack / Twitter. |

### 1.5 Existing infrastructure we will reuse

| Component | Purpose | Status |
|---|---|---|
| `hooks/useNetworkNav.ts::useNetworkPath()` | Build `/${networkKey}/${path}` strings | exists, unused inside gnolove |
| `react-router-dom@7.14`'s `useSearchParams` | Standard URL state primitive | already used in `GnoloveReport.tsx:23,80` |
| `zod@4.3.6` | Schema validation | already used for API responses |
| `@tanstack/react-query@5.99` | Server-state | already in `GnoloveLayout` |
| `date-fns@4.1` | Period math (start/end of week/month/year) | already used in `GnoloveReport.tsx:24-29` |
| `vitest@4.1` + `@testing-library/react@16.3` | Unit tests | already used (5 gnolove test files) |
| `@playwright/test@1.59` | E2E | already used (`e2e/gnolove.spec.ts`) |

**Nothing new must be installed.**

### 1.6 grep evidence (verifying claims in this plan)

```
$ grep -nE 'to="/gnolove' frontend/src/pages/gnolove/*.tsx \
                          frontend/src/components/gnolove/*.tsx
components/gnolove/GnoloveSubNav.tsx:12-17  (6 NAV_ITEMS with absolute paths)
pages/gnolove/GnoloveTeams.tsx:32           (back-link)
pages/gnolove/GnoloveTeams.tsx:53           (per-team-card link, template literal)
pages/gnolove/GnoloveTeams.tsx:72           (per-member link, template literal)
pages/gnolove/GnoloveTeamProfile.tsx:42,50  (back-link, twice — likely a bug)
pages/gnolove/GnoloveTeamProfile.tsx:119    (per-member link)
pages/gnolove/GnoloveHome.tsx:229           ("View all teams →")
pages/gnolove/GnoloveHome.tsx:498           (per-contributor link)
pages/gnolove/GnoloveContributorProfile.tsx:259,287,295,307  (back-links)
```

---

## 2. Goals & Non-Goals

### 2.1 Goals (P0 — must ship)

- **G1** All filter state on `GnoloveReport` is encoded in the URL via query params.
- **G2** URLs are *durable*: a link shared on day D shows the same data on day D+30 (absolute period keys, not relative offsets).
- **G3** Bad / partial / malicious query strings degrade **safely** to defaults (Zod-validated with `.catch(default)` per field — never crash, never throw). Every fallback fires a rate-limited Sentry breadcrumb `gnolove.url.fallback` so we can observe abuse / drift in production. **[MF-6]**
- **G4 (revised [MF-2])** `useSearchParams` write strategy: **`push`** on coarse-axis filter changes (period, at, team, tab, repos) so browser-back walks back through each filter step; **`replace`** only on `view` toggle (which is a sibling-tab affordance, not a true filter). Navigation between pages always uses `push` (default `Link` behavior).
- **G5** Page renders a stable URL on first mount (no infinite re-renders, no flicker, default state is **not** written to URL — clean default URL is `/:network/gnolove/report`).
- **G6** Existing v7.1 e2e + unit tests stay green. New tests pin the new behavior, are property-tested via `fast-check`, and run under React 19 StrictMode. **[MF-14, MF-22]**

### 2.2 Goals (P1 — should ship in this same PR)

- **G7** Same URL-state pattern applied to `GnoloveHome` (timeFilter, sortBy, sortDir, excludedTeams, selectedRepos, page).
- **G8** `GnoloveAIReports` supports `?id=<report-id>` deep-link (auto-scroll + expand if collapsed).
- **G9** Network-prefix link hygiene fix (BUG-1).
- **G10** Bug fixes BUG-2 through BUG-6 and UX-1, UX-2.

### 2.3 Goals (P2 — nice-to-have, defer if time is tight)

- **G11** Per-page `document.title` reflects current filters: e.g. "PR Report · Samourai.world · May 2026 · Memba".
- **G12** "Copy link" button on the Report page with `aria-live` confirmation.
- **G13** Web Share API integration (mobile-friendly share sheet) when `navigator.share` is available.
- **G14** Plausible event (`gnolove_share_copied`, `gnolove_url_loaded_with_filters`) for measuring adoption.

### 2.4 Non-goals (explicitly excluded)

- Server-side rendering or static OG image generation (would require a Netlify Edge Function).
- A user-account-bound saved-filters feature.
- Refactoring `useGnoloveReport` query keys.
- New filter dimensions (author, label, draft-state-only, etc.).
- Replacing `useSearchParams` with a third-party library (`nuqs`, `react-router-search-params-helpers`). Vanilla `useSearchParams` + a thin hook is enough.
- Mobile UI redesign of the filter bar.

---

## 3. URL Schema Design

### 3.1 Design principles

| Principle | Rationale |
|---|---|
| **Absolute period keys, not relative offsets** | A link with `?offset=-1` shared on Friday means "last week", but on Monday it means "the week before last". Always wrong. We encode `?period=weekly&at=2026-W18` (ISO 8601 week) or `?period=monthly&at=2026-05` or `?period=yearly&at=2026`. |
| **Default state writes nothing to the URL** | `/:network/gnolove/report` (no query string) renders the default report. Adding params is purely additive. Keeps URLs short, makes "Reset filters" trivial. |
| **Schema version field (`v=1`)** | If we ever need to break the schema, old links still resolve via a versioned reader. We **omit** `v=1` from default URLs and assume `v=1` when absent (cost: 0; benefit: forward compat). |
| **Snake_case keys, hyphenated values** | Match the existing `?view=table` style. |
| **Unknown keys are ignored** | Future-proofing — adding a key in v2 won't break v1 readers. |
| **Bad values fall back silently** | A user typing `?period=wonky` sees the default `weekly` — no 500, no crash, no toast. |
| **Multi-value fields use comma separation, not repeated keys** | `?repos=gnolang/gno,samouraiworld/memba` (one key, comma values). Easier to read, shorter URLs, no `URLSearchParams.getAll` ambiguity. |
| **`view` keeps its existing `?view=table` semantics** | Backward compat with bookmarks already in the wild. |
| **No fragment (`#`) usage** | Hash is reserved for in-page scroll anchors and Clerk OAuth state. |

### 3.2 The schema (Rev1)

```text
/:network/gnolove/report
   ?period=weekly|monthly|yearly|all     (URL-level enum only; runtime type keeps "all_time" — see [MF-1])
                                          default: weekly
   &at=<period-key>                       (default: previous week for weekly, current period otherwise)
   &tab=all|merged|in_progress|waiting_for_review|reviewed|blocked
                                          (default: all)
   &team=<team-name-url-encoded>          (default: all teams; omit param to mean "all";
                                           charset/length-restricted server-side via Zod — see [MF-12])
   &repos=<owner/name>,<owner/name>,...   (default: "gnolang/gno"; empty param = all repos;
                                           hard-capped at 50 entries / 4096 raw chars [MF-24])
   &view=report|table                     (default: report)
```

**Rev1 [MF-1] note on `period` enum split:** The URL-level value `"all"` is mapped to/from the runtime `ReportPeriod` value `"all_time"` only at the parser/serializer boundary. Existing code in `GnoloveReport.tsx` at lines 64 / 187 / 201 / 285 / 502 keeps its `case "all_time":` branches unchanged — no global rename. The URL stays short; the codebase stays stable.

`<period-key>` format depends on `period` (year range capped to 2010–2039 per [MF-23]):

| `period` | `at` format | Example | Validation |
|---|---|---|---|
| `weekly` | `YYYY-Www` (ISO 8601 week date) | `2026-W18` | `^(20[1-3]\d)-W(0[1-9]\|[1-4]\d\|5[0-3])$` |
| `monthly` | `YYYY-MM` | `2026-05` | `^(20[1-3]\d)-(0[1-9]\|1[0-2])$` |
| `yearly` | `YYYY` | `2026` | `^20[1-3]\d$` |
| `all` | (ignored — `at` is meaningless for `all_time`) | — | n/a |

### 3.3 Worked examples

| Intent | URL |
|---|---|
| Default view (just navigate) | `/gnoland1/gnolove/report` |
| Specific week of work | `/gnoland1/gnolove/report?period=weekly&at=2026-W18` |
| May 2026 monthly report, Samourai team only | `/gnoland1/gnolove/report?period=monthly&at=2026-05&team=Samourai.world` |
| Q-year view for 2025, two repos, table view | `/gnoland1/gnolove/report?period=yearly&at=2025&repos=gnolang/gno,samouraiworld/memba&view=table` |
| Waiting-for-review across all repos | `/gnoland1/gnolove/report?tab=waiting_for_review&repos=` |
| All-time report | `/gnoland1/gnolove/report?period=all&repos=` |

### 3.4 Schema (Zod, file: `frontend/src/lib/gnoloveReportUrl.ts`) — Rev1

> Diff from Rev0: `repos` is `readonly string[]` (sorted), not `Set<string>` [MF-8]; `team` has Zod charset/length restriction [MF-12]; year-range cap [MF-23]; `repos` array+raw-string cap [MF-24]; `pinAt` mode on serializer [MF-3]; runtime type uses `"all_time"` (URL-boundary maps to/from `"all"`) [MF-1]; `isTimeFilter` import dropped [MF-31]; Sentry breadcrumb on `.catch` [MF-6]; URL written by Copy Link reconstructed from validated state via `buildShareUrl()`, never from `window.location.href` [MF-3 / S-3].

```ts
// frontend/src/lib/gnoloveReportUrl.ts
import { z } from "zod"
import * as Sentry from "@sentry/react"
import {
    startOfWeek, endOfWeek, addWeeks,
    startOfMonth, endOfMonth, addMonths,
    startOfYear, endOfYear, addYears,
    getISOWeek, getISOWeekYear, format, parseISO,
} from "date-fns"
import { REPORT_TAB_LABELS, TEAMS, type ReportTab } from "./gnoloveConstants"

/** Runtime period type. URL boundary maps "all" ↔ "all_time". */
export type ReportPeriod = "weekly" | "monthly" | "yearly" | "all_time"
export type ReportTabOrAll = ReportTab | "all"
export type ReportView = "report" | "table"

/** Parsed, validated report URL state. Every field has a safe default. */
export interface ReportUrlState {
    period: ReportPeriod
    /** Absolute period key (e.g. "2026-W18", "2026-05", "2026"). null for `all_time`. */
    at: string | null
    tab: ReportTabOrAll
    /** null = "All Teams". */
    team: string | null
    /** Sorted, unique list. [] = "All Repositories"; non-empty = explicit subset. [MF-8] */
    repos: readonly string[]
    view: ReportView
}

const URL_PERIOD_TO_RUNTIME: Record<string, ReportPeriod> = {
    weekly: "weekly", monthly: "monthly", yearly: "yearly", all: "all_time",
}
const RUNTIME_PERIOD_TO_URL: Record<ReportPeriod, string> = {
    weekly: "weekly", monthly: "monthly", yearly: "yearly", all_time: "all",
}

const KNOWN_TEAMS = new Set(TEAMS.map(t => t.name))

const MAX_REPOS = 50
const MAX_REPOS_RAW_LEN = 4096

/** Counted-rate-limited fallback breadcrumb [MF-6]. */
let lastFallbackMs = 0
function breadcrumbFallback(field: string, raw: unknown) {
    const now = Date.now()
    if (now - lastFallbackMs < 60_000) return  // ≤ 1/min
    lastFallbackMs = now
    Sentry.addBreadcrumb({
        category: "gnolove.url.fallback",
        level: "info",
        data: { field, raw: String(raw).slice(0, 120) },
    })
}

// ── Period key helpers ──────────────────────────────────────

// Year range capped to 2010–2039 [MF-23 / Security S-4]
export const WEEK_RE = /^(20[1-3]\d)-W(0[1-9]|[1-4]\d|5[0-3])$/
export const MONTH_RE = /^(20[1-3]\d)-(0[1-9]|1[0-2])$/
export const YEAR_RE = /^20[1-3]\d$/

/** Returns the ISO week key for a given Date (Monday start). */
export function weekKeyFromDate(d: Date): string {
    return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`
}

/** Returns "YYYY-MM" for a given Date. */
export function monthKeyFromDate(d: Date): string {
    return format(d, "yyyy-MM")
}

/** Returns "YYYY" for a given Date. */
export function yearKeyFromDate(d: Date): string {
    return format(d, "yyyy")
}

/**
 * Parses a period key into an absolute date range.
 * Never throws — always returns a valid range with fallback to defaults.
 * Wrapped in try/catch as defence-in-depth [MF / Security DiD].
 */
export function rangeFromKey(
    period: ReportPeriod,
    key: string | null,
): { start: Date; end: Date } {
    try {
        const now = new Date()
        switch (period) {
            case "weekly": {
                const m = (key ?? "").match(WEEK_RE)
                if (!m) {
                    const ref = addWeeks(now, -1)
                    return { start: startOfWeek(ref, { weekStartsOn: 1 }), end: endOfWeek(ref, { weekStartsOn: 1 }) }
                }
                const year = Number(m[1])
                const week = Number(m[2])
                // ISO 8601: Jan 4 is always in week 1
                const jan4 = new Date(year, 0, 4)
                const week1Start = startOfWeek(jan4, { weekStartsOn: 1 })
                const target = addWeeks(week1Start, week - 1)
                return { start: target, end: endOfWeek(target, { weekStartsOn: 1 }) }
            }
            case "monthly": {
                const m = (key ?? "").match(MONTH_RE)
                if (!m) return { start: startOfMonth(now), end: endOfMonth(now) }
                const d = new Date(Number(m[1]), Number(m[2]) - 1, 1)
                return { start: startOfMonth(d), end: endOfMonth(d) }
            }
            case "yearly": {
                const m = (key ?? "").match(YEAR_RE)
                if (!m) return { start: startOfYear(now), end: endOfYear(now) }
                const d = new Date(Number(m[0]), 0, 1)
                return { start: startOfYear(d), end: endOfYear(d) }
            }
            case "all_time":
                return { start: new Date(2010, 0, 1), end: now }
        }
    } catch (err) {
        // Should never reach here; date-fns is total. Defensive fallback.
        Sentry.captureMessage(`rangeFromKey threw: ${String(err)}`, "warning")
        const now = new Date()
        return { start: startOfWeek(addWeeks(now, -1), { weekStartsOn: 1 }), end: endOfWeek(addWeeks(now, -1), { weekStartsOn: 1 }) }
    }
}

/** Default period key for a given period (used when URL omits `at`). */
export function defaultKey(period: ReportPeriod, now: Date = new Date()): string | null {
    switch (period) {
        case "weekly":   return weekKeyFromDate(addWeeks(now, -1))   // previous week
        case "monthly":  return monthKeyFromDate(now)
        case "yearly":   return yearKeyFromDate(now)
        case "all_time": return null
    }
}

// ── Zod schema ──────────────────────────────────────────────

const UrlPeriodSchema = z.enum(["weekly", "monthly", "yearly", "all"]).catch("weekly")
const TabSchema = z.enum(["all", "merged", "in_progress", "waiting_for_review", "reviewed", "blocked"]).catch("all")
const ViewSchema = z.enum(["report", "table"]).catch("report")

/** Team charset/length restriction [MF-12 / Security S-1]. Blocks RTL-override + length-DoS. */
const TeamSchema = z.string().regex(/^[A-Za-z0-9 ._-]{1,64}$/).nullable().catch(null)

const REPO_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/

/**
 * Parse a `URLSearchParams` into a fully-validated `ReportUrlState`.
 * Every field is best-effort: bad input falls back to default + Sentry breadcrumb.
 */
export function parseReportUrl(params: URLSearchParams): ReportUrlState {
    // ── period (URL-level enum, mapped to runtime) ──
    const periodRaw = params.get("period")
    const urlPeriod = UrlPeriodSchema.parse(periodRaw ?? "weekly")
    if (periodRaw && !["weekly","monthly","yearly","all"].includes(periodRaw)) {
        breadcrumbFallback("period", periodRaw)
    }
    const period = URL_PERIOD_TO_RUNTIME[urlPeriod]

    // ── at (validated against period-specific regex) ──
    const atRaw = params.get("at")
    let at: string | null = null
    if (atRaw) {
        const ok =
            (period === "weekly"  && WEEK_RE.test(atRaw)) ||
            (period === "monthly" && MONTH_RE.test(atRaw)) ||
            (period === "yearly"  && YEAR_RE.test(atRaw))
        if (ok) at = atRaw
        else breadcrumbFallback("at", atRaw)
    }

    // ── tab ──
    const tabRaw = params.get("tab")
    const tab = TabSchema.parse(tabRaw ?? "all")
    if (tabRaw && tabRaw !== tab) breadcrumbFallback("tab", tabRaw)

    // ── team: charset/length-restricted; ALSO allowlist-check against KNOWN_TEAMS [MF-18 stale-team] ──
    const teamRaw = params.get("team")
    let team: string | null = null
    if (teamRaw && teamRaw !== "all") {
        const parsed = TeamSchema.parse(teamRaw)
        if (parsed && KNOWN_TEAMS.has(parsed)) team = parsed
        else {
            breadcrumbFallback("team", teamRaw)
            team = null  // stale-team banner shown by GnoloveReport when team !== null but isn't in TEAMS
        }
    }

    // ── repos: cap raw length + cap array size [MF-24] ──
    const reposRaw = params.get("repos")
    let repos: readonly string[]
    if (reposRaw === null) {
        repos = ["gnolang/gno"]
    } else if (reposRaw === "") {
        repos = []
    } else if (reposRaw.length > MAX_REPOS_RAW_LEN) {
        breadcrumbFallback("repos.length", reposRaw.length)
        repos = ["gnolang/gno"]
    } else {
        const parsed = reposRaw.split(",")
            .map(s => s.trim())
            .filter(s => REPO_RE.test(s))
            .slice(0, MAX_REPOS)
        const unique = Array.from(new Set(parsed)).sort()  // [MF-8 sort stability]
        repos = unique.length === 0 ? ["gnolang/gno"] : unique
    }

    // ── view ──
    const viewRaw = params.get("view")
    const view = ViewSchema.parse(viewRaw ?? "report")
    if (viewRaw && viewRaw !== view) breadcrumbFallback("view", viewRaw)

    return { period, at, tab, team, repos, view }
}

/**
 * Serialize a `ReportUrlState` to a `URLSearchParams`.
 * In default mode, fields equal to defaults are omitted (minimum-length URLs).
 * In pin mode (`{ pinAt: true }`), `at` is always emitted (used by Copy Link) [MF-3].
 */
export function serializeReportUrl(
    s: ReportUrlState,
    opts: { pinAt?: boolean } = {},
): URLSearchParams {
    const out = new URLSearchParams()
    const urlPeriod = RUNTIME_PERIOD_TO_URL[s.period]
    if (urlPeriod !== "weekly") out.set("period", urlPeriod)

    const effectiveAt = s.at ?? defaultKey(s.period)
    if (opts.pinAt && effectiveAt) {
        out.set("at", effectiveAt)
    } else if (s.at && s.at !== defaultKey(s.period)) {
        out.set("at", s.at)
    }

    if (s.tab !== "all") out.set("tab", s.tab)
    if (s.team !== null) out.set("team", s.team)

    // repos: omit if equals default ["gnolang/gno"]; emit "" if explicitly all-repos
    const isDefaultRepos = s.repos.length === 1 && s.repos[0] === "gnolang/gno"
    if (s.repos.length === 0) {
        out.set("repos", "")
    } else if (!isDefaultRepos) {
        // already sorted by parser; defensive re-sort in case the caller mutated
        out.set("repos", [...s.repos].sort().join(","))
    }

    if (s.view !== "report") out.set("view", s.view)
    return out
}

/**
 * Reconstruct a shareable URL from validated state (NOT from window.location.href).
 * Used by `<CopyLinkButton>` and MD-export footer [MF-3 / Security S-3 / A-9].
 * Strips `view=table` from the MD-export variant since the artifact is the Report view.
 */
export function buildShareUrl(
    origin: string,
    networkKey: string,
    state: ReportUrlState,
    opts: { stripView?: boolean } = {},
): string {
    const effective: ReportUrlState = opts.stripView ? { ...state, view: "report" } : state
    const params = serializeReportUrl(effective, { pinAt: true }).toString()
    return `${origin}/${networkKey}/gnolove/report${params ? "?" + params : ""}`
}

export const DEFAULT_REPORT_STATE: ReportUrlState = {
    period: "weekly",
    at: null,
    tab: "all",
    team: null,
    repos: ["gnolang/gno"],
    view: "report",
}
```

### 3.5 Why ISO weeks (not "week-of-month" or millis)

- ISO 8601 weeks are unambiguous, locale-independent, monotonic, and `date-fns` natively supports them.
- A URL like `?at=2026-W18` is **human-readable** — a teammate can hand-edit it.
- They avoid the "week starts on Sunday" vs. "week starts on Monday" ambiguity (ISO says Monday).
- They fit in 8 characters. Compare with `?start=2026-05-04&end=2026-05-10` (24 chars + URL-encoded `=`).

### 3.6 Why `repos=` (empty value) means "all repos"

Three states are possible:

1. **Param absent** → default = `gnolang/gno` (preserves current product behavior).
2. **Param present, empty value** → explicit "all repos" (allows linking to *every* repo's data without needing a fresh URL for each one).
3. **Param present, populated** → user-specified subset.

This is the same convention HTML form submission uses for "send empty value" and avoids needing a sentinel string like `repos=__all__`.

---

## 4. State Inventory & Migration Path

### 4.1 Mapping today's component state → URL keys

| Today (`useState` in `GnoloveReport`) | Tomorrow (URL key) | Default in URL | Default in component (if URL absent) |
|---|---|---|---|
| `period: ReportPeriod` | `period` | omit ⇒ `weekly` | `weekly` |
| `offset: number` (relative!) | `at` (absolute key) | omit ⇒ `defaultKey(period)` (i.e. previous week for `weekly`, current period otherwise) | `defaultKey(period)` |
| `activeTab: ReportTab \| "all"` | `tab` | omit ⇒ `all` | `"all"` |
| `selectedTeam: string` | `team` | omit ⇒ all teams | `"all"` (component-internal sentinel) |
| `selectedRepos: Set<string>` | `repos` | omit ⇒ `{gnolang/gno}` | `new Set(["gnolang/gno"])` |
| `view: ViewMode` | `view` | omit ⇒ `report` | `"report"` |
| `repoDropdownOpen: boolean` | n/a | n/a (stays local) | `false` |

### 4.2 Legacy URL compatibility

The **only** pre-existing URL state was `?view=table` (introduced in v2.19). The new schema preserves it bit-for-bit. **No backward-incompat redirects required.** Any other key currently in a bookmark (none known) is harmless: unknown keys are ignored.

### 4.3 Period switching semantics (BUG-5 fix) — Rev1

Today: clicking "Monthly" while on "Week 14 of 2026" (April) resets to *current month* (May). That throws away context.

**Disambiguation rule [MF-4]:** when the user changes `period`, the next `at` is computed from the **`end`** of the currently-shown range (the *last* day of the displayed week / month / year). Reason: for a week spanning a month boundary (e.g. ISO W18 2026 = Mon 2026-04-27 → Sun 2026-05-03), users perceive *May* as "the month containing this week" because the week ends in May. Using `start` would land on April, skipping May. Cross-confirmed by the Adversarial panel (A-4).

```ts
// In setPeriod handler:
function changePeriod(next: ReportPeriod) {
    // [MF-4 / F-5] Guard `all_time → X`: don't teleport to 1980. Fall back to defaultKey().
    if (state.period === "all_time" && next !== "all_time") {
        setState({ period: next, at: defaultKey(next) })
        return
    }
    const { end } = rangeFromKey(state.period, state.at ?? defaultKey(state.period))
    const nextAt =
        next === "weekly"   ? weekKeyFromDate(end) :
        next === "monthly"  ? monthKeyFromDate(end) :
        next === "yearly"   ? yearKeyFromDate(end) :
        /* all_time */        null
    setState({ period: next, at: nextAt })
}
```

This means: "April-W2 → Monthly" → "April 2026" (Apr W2 ends in April → April), "April-W5 → Monthly" → "May 2026" (Apr W5 ends 2026-05-03 → May). Predictable. Codified by ADR-007.

---

## 5. File Structure (new + modified)

### 5.1 New files

| Path | LOC (est.) | Purpose |
|---|---:|---|
| `frontend/src/lib/gnoloveReportUrl.ts` | ~180 | Schema, parser, serializer, period-key helpers, `DEFAULT_REPORT_STATE`. |
| `frontend/src/lib/gnoloveReportUrl.test.ts` | ~250 | Unit tests: round-trip serialize/parse, bad-input fuzz, period-switch math, default behavior. |
| `frontend/src/hooks/gnolove/useReportUrlState.ts` | ~80 | Thin hook over `useSearchParams` + `parseReportUrl` + `serializeReportUrl`. Returns `[state, setState]` with stable identity (`useMemo`/`useCallback`) so children don't re-render unnecessarily. |
| `frontend/src/hooks/gnolove/useReportUrlState.test.tsx` | ~120 | RTL test that the hook reads URL, writes URL with `replace`, and accepts partial updates. |
| `frontend/src/hooks/gnolove/useHomeUrlState.ts` | ~80 | Analog hook for `GnoloveHome` (Phase 2). |
| `frontend/src/hooks/gnolove/useHomeUrlState.test.tsx` | ~100 | Hook tests. |
| `frontend/src/components/gnolove/PageMeta.tsx` | ~40 | Small declarative component for setting `document.title` + a single `<meta name="description">` override (Phase 5). Pure imperative DOM update inside `useEffect`; no react-helmet dependency. |
| `frontend/src/components/gnolove/CopyLinkButton.tsx` | ~60 | "Copy link" button with `aria-live` announce on success + Web Share fallback. |
| `frontend/src/components/gnolove/CopyLinkButton.test.tsx` | ~80 | Component test. |

### 5.2 Modified files

| Path | Lines touched (est.) | Change |
|---|---:|---|
| `frontend/src/pages/gnolove/GnoloveReport.tsx` | ~250 | Replace 6 `useState` with `useReportUrlState`; rewire handlers; fix BUG-2/3/4/5/6, UX-1/2; add `<PageMeta>` + `<CopyLinkButton>`. |
| `frontend/src/pages/gnolove/GnoloveHome.tsx` | ~80 | Replace 6 of 9 `useState` with `useHomeUrlState` (Phase 2). |
| `frontend/src/pages/gnolove/GnoloveAIReports.tsx` | ~30 | Read `?id=` for deep-link; auto-expand visible reports up to and including the target; `scrollIntoView` on mount. |
| `frontend/src/components/gnolove/GnoloveSubNav.tsx` | ~25 | Use `useNetworkPath()` for hrefs. |
| `frontend/src/pages/gnolove/GnoloveTeams.tsx` | ~10 | Network-prefix all `<Link to>` strings. |
| `frontend/src/pages/gnolove/GnoloveTeamProfile.tsx` | ~10 | Same. Also collapse the duplicated `Back to Teams` Link at lines 42 + 50. |
| `frontend/src/pages/gnolove/GnoloveContributorProfile.tsx` | ~10 | Same (4 back-links). |
| `frontend/src/pages/gnolove/GnoloveHome.tsx` | ~5 | Same (2 links). |
| `frontend/src/lib/gnoloveExport.ts` (if it generates URLs) | check | Inject filter-baked link into MD/PDF export footer. |
| `frontend/e2e/gnolove.spec.ts` | ~120 | New deep-link specs (Section 17). |
| `CHANGELOG.md` | ~20 | New entry. |

### 5.3 Files not touched (defensively)

- `backend/**` — no API contract change.
- `frontend/src/App.tsx` — no new route.
- `frontend/src/layouts/GnoloveLayout.tsx` — no QueryClient changes.
- `frontend/src/lib/gnoloveApi.ts` / `gnoloveSchemas.ts` — no API surface change.
- `netlify.toml` — SPA fallback already handles any URL.

---

## 6. Phase 0 — Foundation & Shared Hook (Day 0–0.5)

**Objective:** Land the schema, parser, serializer, and hook with 100% unit-test coverage **before** touching any page. No UI change in this phase.

### Task 0.1 — Branch + scaffolding

- [ ] Step 1 — Create branch.

  ```bash
  cd /Users/zxxma/Desktop/Code/Gno/Memba
  git checkout main && git pull --ff-only
  git checkout -b feat/gnolove-shareable-urls
  ```

- [ ] Step 2 — Stub files (empty exports, just to land the structure).

  Create `frontend/src/lib/gnoloveReportUrl.ts` containing only the exported `ReportUrlState` interface and the `DEFAULT_REPORT_STATE` constant. Create `frontend/src/hooks/gnolove/useReportUrlState.ts` containing only an export shell.

- [ ] Step 3 — Commit.

  ```bash
  git add frontend/src/lib/gnoloveReportUrl.ts frontend/src/hooks/gnolove/useReportUrlState.ts
  git commit -m "feat(gnolove): scaffold shareable-URL schema + hook"
  ```

### Task 0.2 — Schema, parser, serializer (TDD)

- [ ] Step 1 — Write the failing test file `frontend/src/lib/gnoloveReportUrl.test.ts`. Cover:
    - `parseReportUrl(new URLSearchParams("")).period === "weekly"` (default).
    - `parseReportUrl(new URLSearchParams("period=wonky")).period === "weekly"` (silent fallback).
    - `parseReportUrl(URLSearchParams("period=monthly&at=2026-05")).at === "2026-05"`.
    - `parseReportUrl(URLSearchParams("period=monthly&at=2026-13")).at === null` (invalid month silently dropped).
    - `parseReportUrl(URLSearchParams("repos=")).repos.size === 0` (explicit "all").
    - `parseReportUrl(URLSearchParams("repos=foo/bar,bad,baz/qux")).repos` is `Set(["foo/bar","baz/qux"])`.
    - `serializeReportUrl(DEFAULT_REPORT_STATE).toString() === ""` (default state writes nothing).
    - Round-trip: for 50 random valid states, `parseReportUrl(serializeReportUrl(s))` deep-equals `s`.
    - `rangeFromKey("weekly", "2026-W18")` produces a Monday→Sunday range whose ISO week is 18.
    - `weekKeyFromDate(new Date("2026-05-04"))` returns `"2026-W19"` (ISO week containing that Monday).

- [ ] Step 2 — Run the test: `pnpm --filter frontend test gnoloveReportUrl.test` → all RED.

- [ ] Step 3 — Implement `gnoloveReportUrl.ts` exactly as spec'd in §3.4.

- [ ] Step 4 — Run test → GREEN.

- [ ] Step 5 — Commit.

  ```bash
  git add frontend/src/lib/gnoloveReportUrl.ts frontend/src/lib/gnoloveReportUrl.test.ts
  git commit -m "feat(gnolove): URL schema, parser, serializer with full unit coverage"
  ```

### Task 0.3 — `useReportUrlState` hook (TDD)

- [ ] Step 1 — Write the failing test `frontend/src/hooks/gnolove/useReportUrlState.test.tsx`. Render a tiny harness component inside `<MemoryRouter initialEntries={["/foo?period=monthly&at=2026-05"]}>` and assert:
    - Hook returns `state.period === "monthly"`.
    - Calling `setState({ tab: "merged" })` (partial update) updates URL to include `tab=merged` while preserving `period=monthly&at=2026-05`.
    - URL writes use `replace` (no history pile-up — assert `window.location.length` doesn't grow, or use `useNavigationType` mock).
    - Updating to default state (e.g. `setState({ tab: "all" })` when already `tab: "merged"`) **removes** the param.
    - Stable identity: state object reference does not change between renders when params are unchanged (use `Object.is`).

- [ ] Step 2 — Run test → RED.

- [ ] Step 3 — Implement [MF-1, MF-2, MF-20]:

  ```ts
  // frontend/src/hooks/gnolove/useReportUrlState.ts
  import { useCallback, useMemo } from "react"
  import { useSearchParams } from "react-router-dom"
  import {
      parseReportUrl, serializeReportUrl,
      type ReportUrlState,
  } from "../../lib/gnoloveReportUrl"

  /** Coarse axes use `push` (back-button walks back through filter changes).
   *  `view` is a sibling-tab affordance, not a filter, so it uses `replace`. [MF-2] */
  const REPLACE_AXES = new Set<keyof ReportUrlState>(["view"])

  function isReplaceUpdate(patch: Partial<ReportUrlState>): boolean {
      const keys = Object.keys(patch) as (keyof ReportUrlState)[]
      return keys.length > 0 && keys.every(k => REPLACE_AXES.has(k))
  }

  export function useReportUrlState(): [
      ReportUrlState,
      (patch: Partial<ReportUrlState>) => void,
  ] {
      const [searchParams, setSearchParams] = useSearchParams()

      // RR7 already memoizes searchParams on [location.search]. [MF-20]
      const state = useMemo(() => parseReportUrl(searchParams), [searchParams])

      // NB: setSearchParams identity is not stable across URL changes (RR7 internal). [F-1]
      // We document this; consumers must not rely on setUrlState referential equality.
      const setState = useCallback(
          (patch: Partial<ReportUrlState>) => {
              const replace = isReplaceUpdate(patch)
              setSearchParams(
                  prev => serializeReportUrl({
                      ...parseReportUrl(prev),
                      ...patch,
                  }),
                  { replace },
              )
          },
          [setSearchParams],
      )

      return [state, setState]
  }
  ```

  **Notes [MF-2, MF-22]:**
  - History strategy: `setUrlState({ view: "table" })` ⇒ `replace`; everything else ⇒ `push`. The Playwright spec in §17.2 #6 ("back restores filters after view toggle") is now internally consistent.
  - The hook MUST be tested under `<React.StrictMode>` (Phase 0 Task 0.3 Step 1, additional assertion). React 19's double-mount must not produce double-`setSearchParams` writes.
  - The setter is **not** stable across URL changes. Document this in the hook JSDoc. Consumers that need stability should wrap callsites in their own `useCallback` keyed on `setUrlState`.

- [ ] Step 4 — Run test → GREEN.

- [ ] Step 5 — Commit.

  ```bash
  git add frontend/src/hooks/gnolove/useReportUrlState.ts frontend/src/hooks/gnolove/useReportUrlState.test.tsx
  git commit -m "feat(gnolove): useReportUrlState hook with stable identity + replace writes"
  ```

### Task 0.4 — Lint + typecheck gate

- [ ] Step 1 — `pnpm --filter frontend lint` → clean.
- [ ] Step 2 — `pnpm --filter frontend exec tsc -b --noEmit` → clean.
- [ ] Step 3 — `pnpm --filter frontend test` → all green (including pre-existing gnolove tests).
- [ ] Step 4 — If clean, push the branch: `git push -u origin feat/gnolove-shareable-urls`.

**Phase 0 DoD:** Hook exists, fully tested, no UI consumes it yet, CI green.

---

## 7. Phase 1 — Report Page URL State (Days 0.5–2)

**Objective:** Make `GnoloveReport` read its filter state exclusively from the URL via `useReportUrlState`. Behavior is observably identical to today **except** the URL reflects the filters and BUG-5 is fixed.

### Task 1.1 — Replace the seven `useState` with the hook

- [ ] Step 1 — In `pages/gnolove/GnoloveReport.tsx`, replace lines 80–88 with:

  ```ts
  const [urlState, setUrlState] = useReportUrlState()
  const { period, at, tab: activeTab, team: teamOrNull, repos: selectedRepos, view } = urlState
  const selectedTeam = teamOrNull ?? "all"

  // Derived range (replaces the old `offset` → `computeRange` chain)
  const { start, end } = useMemo(
      () => rangeFromKey(period, at ?? defaultKey(period)),
      [period, at],
  )

  // Keep `repoDropdownOpen` as local state (ephemeral UI)
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false)
  const repoDropdownRef = useRef<HTMLDivElement>(null)
  ```

- [ ] Step 2 — Replace `handleViewToggle` (lines 90–98) with:

  ```ts
  const handleViewToggle = useCallback((v: ViewMode) => {
      setUrlState({ view: v })
  }, [setUrlState])
  ```

- [ ] Step 3 — Replace `handlePeriodChange` (lines 206–209) with the BUG-5-fixed version:

  ```ts
  function handlePeriodChange(p: ReportPeriod) {
      const nextAt =
          p === "weekly"  ? weekKeyFromDate(start) :
          p === "monthly" ? monthKeyFromDate(start) :
          p === "yearly"  ? yearKeyFromDate(start) :
          /* all */         null
      setUrlState({ period: p, at: nextAt })
  }
  ```

- [ ] Step 4 — Replace `toggleRepo` (lines 211–218) with:

  ```ts
  function toggleRepo(repo: string) {
      const next = new Set(selectedRepos)
      if (next.has(repo)) next.delete(repo)
      else next.add(repo)
      setUrlState({ repos: next })
  }
  ```

- [ ] Step 5 — Replace the Previous/Next handlers (lines 287, 291) with:

  ```ts
  const stepBy = useCallback(
      (deltaWeeks: number, deltaMonths: number, deltaYears: number) => {
          const moved =
              period === "weekly"  ? addWeeks(start, deltaWeeks) :
              period === "monthly" ? addMonths(start, deltaMonths) :
              period === "yearly"  ? addYears(start, deltaYears) :
              start
          setUrlState({
              at:
                  period === "weekly"  ? weekKeyFromDate(moved) :
                  period === "monthly" ? monthKeyFromDate(moved) :
                  period === "yearly"  ? yearKeyFromDate(moved) :
                  null,
          })
      },
      [period, start, setUrlState],
  )

  // Wire to buttons:
  <button onClick={() => stepBy(-1, -1, -1)} aria-label="Previous">← Previous</button>
  <button onClick={() => stepBy( 1,  1,  1)} aria-label="Next"     >Next →</button>
  ```

- [ ] Step 6 — Replace `setSelectedTeam` (line 305) with:

  ```ts
  onChange={e => setUrlState({ team: e.target.value === "all" ? null : e.target.value })}
  ```

  And `setActiveTab` callsites with `setUrlState({ tab: ... })`.

- [ ] Step 7 — Run unit tests + e2e: `pnpm --filter frontend test` and `pnpm --filter frontend exec playwright test gnolove.spec.ts` → still green.

- [ ] Step 8 — Manual smoke (dev server): `pnpm --filter frontend dev`, navigate to `http://localhost:5173/test12/gnolove/report`, change every filter, verify URL updates and back-button restores.

- [ ] Step 9 — Commit.

  ```bash
  git add frontend/src/pages/gnolove/GnoloveReport.tsx
  git commit -m "feat(gnolove): rewire report page to URL state via useReportUrlState"
  ```

### Task 1.2 — BUG-2 fix (silent empty state when default repo missing from response)

- [ ] Step 1 — After `repos` is loaded in `GnoloveReport`, add a guard:

  ```ts
  const { data: repos } = useGnoloveRepositories()

  // If the URL pins a repo that does not exist server-side, surface a warning
  // banner rather than rendering an empty report.
  const missingRepos = useMemo(() => {
      if (!repos) return []
      const known = new Set(repos.map(r => `${r.owner}/${r.name}`))
      return Array.from(selectedRepos).filter(r => !known.has(r))
  }, [repos, selectedRepos])
  ```

  Render a dismissible banner when `missingRepos.length > 0`:

  ```tsx
  {missingRepos.length > 0 && (
      <div className="gl-warning-banner" role="alert">
          Repository {missingRepos.join(", ")} is not in the current dataset.
          Showing other selected repos. <button onClick={() => {
              const next = new Set(selectedRepos)
              missingRepos.forEach(r => next.delete(r))
              setUrlState({ repos: next })
          }}>Remove</button>
      </div>
  )}
  ```

- [ ] Step 2 — Add unit test (new file `GnoloveReport.test.tsx`):
    - Render the page with URL `?repos=gnolang/gno,bogus/repo`.
    - Mock `useGnoloveRepositories` to return `[{owner:"gnolang",name:"gno"}]`.
    - Assert the warning banner is visible.

- [ ] Step 3 — Commit.

  ```bash
  git commit -am "fix(gnolove): warn when URL pins unknown repository (BUG-2)"
  ```

### Task 1.3 — BUG-3 fix (Highlights sort by `mergedAt` desc, not `title.length`)

- [ ] Step 1 — Replace the sort in `NarrativeReportView`:

  ```ts
  const topMerged = useMemo(
      () => [...merged]
          .sort((a, b) => {
              const ta = a.mergedAt ? new Date(a.mergedAt).getTime() : 0
              const tb = b.mergedAt ? new Date(b.mergedAt).getTime() : 0
              return tb - ta
          })
          .slice(0, 5),
      [merged],
  )
  ```

- [ ] Step 2 — Unit test: feed a fixture with 6 merged PRs whose `mergedAt` is shuffled; assert the 5 most-recent come back in descending order.

- [ ] Step 3 — Commit.

  ```bash
  git commit -am "fix(gnolove): sort report highlights by mergedAt desc, not title length (BUG-3)"
  ```

### Task 1.4 — BUG-4 fix (status badge derives from data, not the active tab)

- [ ] Step 1 — Annotate each PR with its derived status before render:

  ```ts
  type PRStatus = "merged" | "in_progress" | "waiting_for_review" | "reviewed" | "blocked"

  function statusFor(pr: TPullRequest, report: ReportData): PRStatus {
      if (pr.mergedAt || pr.state === "MERGED") return "merged"
      if (report.blocked?.some(p => p.id === pr.id)) return "blocked"
      if (report.waiting_for_review?.some(p => p.id === pr.id)) return "waiting_for_review"
      if (report.reviewed?.some(p => p.id === pr.id)) return "reviewed"
      return "in_progress"
  }
  ```

- [ ] Step 2 — Update `PRStateBadge` to take a `status` prop instead of `tab`. Update each callsite to pass `statusFor(pr, report)`.

- [ ] Step 3 — Unit test: render a blocked PR with `tab === "all"`; assert the badge text is "Blocked" not "Open".

- [ ] Step 4 — Commit.

### Task 1.5 — BUG-6 fix (consistent footer ID in exported MD)

- [ ] Step 1 — In `generateReportMd`, compute the footer ID by period:

  ```ts
  const reportId =
      period === "weekly"  ? `${getISOWeekYear(start)}-W${String(getISOWeek(start)).padStart(2,"0")}` :
      period === "monthly" ? format(start, "yyyy-MM") :
      period === "yearly"  ? format(start, "yyyy") :
      "all-time"
  // ...
  lines.push("", "---", `_Generated by Gnolove · ${reportId}_`)
  ```

  Also embed a **share link**:

  ```ts
  const shareUrl = window.location.href
  lines.push(`_Filter URL: ${shareUrl}_`)
  ```

- [ ] Step 2 — Update `gnoloveExport.ts` `exportToMarkdown`/`exportToPDF` to also accept and embed the share URL (optional param, default `window.location.href`).

- [ ] Step 3 — Commit.

### Task 1.6 — UX-1 fix (`aria-current` on tabs)

- [ ] Step 1 — Add `aria-current={period === key ? "page" : undefined}` to each period tab button and `aria-current={activeTab === key ? "true" : undefined}` to each status tab. (Use `"page"` for the period nav since it changes the visible "page" of data; `"true"` for the in-page filter.)

- [ ] Step 2 — Add `aria-pressed` to view-toggle buttons.

- [ ] Step 3 — Run `axe` in playwright (`@axe-core/playwright` is not in deps; if not, just visually verify with browser devtools).

### Task 1.7 — UX-2 fix (smarter empty state)

- [ ] Step 1 — Compute the empty-state reason:

  ```ts
  const emptyReason = useMemo(() => {
      if (!report) return "loading"
      if (filteredPrs.length > 0) return null
      if ((report.merged?.length ?? 0) + (report.in_progress?.length ?? 0) +
          (report.waiting_for_review?.length ?? 0) + (report.reviewed?.length ?? 0) +
          (report.blocked?.length ?? 0) === 0) return "no_data"
      if (selectedTeam !== "all" && selectedRepos.size > 0) return "team_and_repo"
      if (selectedTeam !== "all") return "team"
      if (selectedRepos.size > 0) return "repo"
      return "filter"
  }, [report, filteredPrs, selectedTeam, selectedRepos])
  ```

- [ ] Step 2 — Render different `<div className="gl-empty">` messages per reason, with a "Clear filters" button that calls `setUrlState(DEFAULT_REPORT_STATE)`.

- [ ] Step 3 — Unit test each branch with a render harness.

### Task 1.8 — Phase 1 integration test (Playwright)

- [ ] Step 1 — Add to `frontend/e2e/gnolove.spec.ts`:

  ```ts
  test('report URL is fully shareable', async ({ page }) => {
      await page.goto('/test12/gnolove/report?period=monthly&at=2026-05&team=Samourai.world&tab=merged')
      // Period tab "Monthly" is active
      await expect(page.locator('button.gl-tab--active', { hasText: 'Monthly' })).toBeVisible()
      // Team select shows Samourai.world
      await expect(page.locator('select.gl-filter-select')).toHaveValue('Samourai.world')
      // Status tab "Merged" is active
      await expect(page.locator('button.gl-tab--active', { hasText: /Merged/ })).toBeVisible()
  })

  test('report URL preserves filters across navigation', async ({ page }) => {
      await page.goto('/test12/gnolove/report?period=monthly&at=2026-05')
      // Open table view
      await page.click('button.gl-view-btn', { hasText: 'Table' })
      await expect(page).toHaveURL(/view=table/)
      // Period + at are preserved
      await expect(page).toHaveURL(/period=monthly/)
      await expect(page).toHaveURL(/at=2026-05/)
      // Back button removes view=table but keeps period
      await page.goBack()
      await expect(page).toHaveURL(/period=monthly/)
      await expect(page).not.toHaveURL(/view=table/)
  })

  test('report URL gracefully handles garbage input', async ({ page }) => {
      await page.goto('/test12/gnolove/report?period=invalid&tab=lolnope&at=999')
      // Falls back to default weekly view; no JS error
      await expect(page.locator('.gl-title')).toContainText('PR Report')
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      await page.waitForTimeout(500)
      expect(errors).toEqual([])
  })
  ```

- [ ] Step 2 — Run: `pnpm --filter frontend exec playwright test gnolove.spec.ts` → green.

- [ ] Step 3 — Commit.

**Phase 1 DoD:** All filter state is in the URL; the existing report's behavior is preserved; BUG-2..BUG-6 + UX-1..UX-2 are fixed; Playwright deep-link specs pass.

---

## 8. Phase 2 — Adjacent Pages (Days 2–3.5)

### Task 2.1 — `useHomeUrlState` hook

- [ ] Step 1 — TDD a hook analogous to `useReportUrlState`, encoding:

  ```ts
  interface HomeUrlState {
      time: TimeFilter            // ?time=all|yearly|monthly|weekly
      excludedTeams: Set<string>  // ?excludeTeams=Team A,Team B
      sortBy: SortKey             // ?sortBy=score|prs|...
      sortDir: "asc"|"desc"       // ?sortDir=desc
      repos: Set<string>          // ?repos=...
      page: number                // ?page=2 (omit if 1)
  }
  ```

- [ ] Step 2 — Implement parse/serialize/hook in same pattern as Phase 0.

- [ ] Step 3 — Commit.

### Task 2.2 — Wire `GnoloveHome`

- [ ] Step 1 — Replace local `useState`s with `useHomeUrlState`.
- [ ] Step 2 — Add Playwright spec: `?time=monthly&sortBy=prs&page=2` is honored.
- [ ] Step 3 — Commit.

### Task 2.3 — `GnoloveAIReports` deep-link

- [ ] Step 1 — Read `?id=<report-id>` on mount; if present, expand `visibleCount` to include the index of that report (clamped to data length), then `scrollIntoView({ behavior: "smooth" })` after layout.

- [ ] Step 2 — Add `<a href="?id=<report-id>">` permalink icon next to each report header.

- [ ] Step 3 — Commit.

**Phase 2 DoD:** Home + AI Reports are bookmarkable.

---

## 9. Phase 3 — Network-Prefix Link Hygiene (Day 4)

### Task 3.1 — `GnoloveSubNav`

- [ ] Step 1 — Refactor to use `useNetworkPath()`:

  ```tsx
  const np = useNetworkPath()
  const NAV_ITEMS = [
      { to: np("gnolove"),           label: "Overview",  end: true  },
      { to: np("gnolove/teams"),     label: "Teams",     end: false },
      { to: np("gnolove/report"),    label: "Report",    end: false },
      { to: np("gnolove/analytics"), label: "Analytics", end: false },
      { to: np("gnolove/reports"),   label: "AI Reports",end: false },
      { to: np("gnolove/milestone"), label: "Milestone", end: false },
  ]
  ```

- [ ] Step 2 — Adjust the test in `gnolove.spec.ts` that goes to `/gnolove` to first navigate to `/:network/gnolove` (LegacyRedirect path will still work, so existing tests still pass — but we now have clean URLs from the SubNav itself).

- [ ] Step 3 — Commit.

### Task 3.2 — Patch every other absolute `<Link to="/gnolove*">` site

- [ ] Step 1 — Replace each `to="/gnolove..."` with the `useNetworkPath` result. Listed sites:

  | File | Lines |
  |---|---|
  | `GnoloveTeams.tsx` | 32, 53, 72 |
  | `GnoloveTeamProfile.tsx` | 42, 50, 119 (and delete one duplicate of 42/50 — verify which one renders) |
  | `GnoloveHome.tsx` | 229, 498 |
  | `GnoloveContributorProfile.tsx` | 259, 287, 295, 307 |

- [ ] Step 2 — Re-run all gnolove tests + e2e. Expect green.

- [ ] Step 3 — Commit.

**Phase 3 DoD:** No internal gnolove link triggers LegacyRedirect; `LegacyRedirect` remains in place as the safety net for external/legacy bookmarks.

---

## 10. Phase 4 — Correctness & a11y Bugs (Day 4–4.5)

Already mostly covered inside Phases 1–3. This phase rolls up any remaining items, including:

### Task 4.1 — BUG-4 (status badge) — already in Phase 1
### Task 4.2 — UX-1 (`aria-current`) — already in Phase 1
### Task 4.3 — Repo dropdown a11y

- [ ] Step 1 — Add `aria-expanded`, `aria-haspopup="listbox"`, and `role="listbox"` to the multi-select dropdown.
- [ ] Step 2 — Trap focus on Escape (already handled) and on Tab-out.
- [ ] Step 3 — Commit.

### Task 4.4 — Keyboard navigation for the period stepper

- [ ] Step 1 — Make ←/→ arrow keys (when focus is on the period nav) advance the offset. Wire `onKeyDown` to the period-nav `<div>` with `tabIndex={0}` and `aria-label="Period navigation"`.
- [ ] Step 2 — Commit.

---

## 11. Phase 5 — SEO / Share Preview / Copy-Link UX (Day 5)

### Task 5.1 — `<PageMeta>` component

- [ ] Step 1 — Create `frontend/src/components/gnolove/PageMeta.tsx`:

  ```tsx
  import { useEffect } from "react"

  interface PageMetaProps {
      title: string
      description?: string
  }

  export function PageMeta({ title, description }: PageMetaProps) {
      useEffect(() => {
          const prevTitle = document.title
          document.title = title
          let descMeta: HTMLMetaElement | null = null
          let prevDesc: string | null = null
          if (description) {
              descMeta = document.querySelector('meta[name="description"]')
              prevDesc = descMeta?.getAttribute("content") ?? null
              if (descMeta) descMeta.setAttribute("content", description)
          }
          return () => {
              document.title = prevTitle
              if (descMeta && prevDesc !== null) descMeta.setAttribute("content", prevDesc)
          }
      }, [title, description])
      return null
  }
  ```

- [ ] Step 2 — In `GnoloveReport`, compute a contextual title from the URL state:

  ```tsx
  const reportTitle = useMemo(() => {
      const parts = ["PR Report"]
      if (selectedTeam !== "all") parts.push(selectedTeam)
      parts.push(
          period === "weekly"  ? `Week of ${format(start, "MMM d, yyyy")}` :
          period === "monthly" ? format(start, "MMMM yyyy") :
          period === "yearly"  ? format(start, "yyyy") :
          "All Time"
      )
      return `${parts.join(" · ")} | Gnolove · Memba`
  }, [selectedTeam, period, start])

  return (
      <>
          <PageMeta title={reportTitle} />
          <div className="gl-page">…
  ```

- [ ] Step 3 — Add `<PageMeta>` to Home, Teams, Analytics, AIReports, Milestone, Contributor-Profile, Team-Profile pages too (cheap, big UX win).

### Task 5.2 — `<CopyLinkButton>` component

- [ ] Step 1 — Create the component with Web Share API fallback, `aria-live` polite confirmation, and 2s success indicator. Place at the top right of `GnoloveReport` next to the export buttons.

- [ ] Step 2 — Component test + e2e click test.

### Task 5.3 — OG card hint (no edge function — defer real OG to a future plan)

- [ ] Step 1 — Update `index.html` to **not** override `og:title` per-route (impossible without SSR) but at least leave the default Memba card. Add a Q-6 to the open-questions list to revisit with a Netlify Edge Function for dynamic OG cards.

---

## 12. Phase 6 — Tests, Telemetry, Release (Days 5–6)

### Task 6.1 — Test coverage

- [ ] Step 1 — Verify unit test coverage of new lib + hook ≥ 90 % via `pnpm --filter frontend exec vitest run --coverage --reporter=verbose`.
- [ ] Step 2 — All e2e specs in `gnolove.spec.ts` green.
- [ ] Step 3 — Run full `pnpm --filter frontend test` + `pnpm --filter frontend lint` + `pnpm --filter frontend exec tsc -b --noEmit` and commit any fixups.

### Task 6.2 — Plausible events (optional, gated by `Q-5`)

- [ ] Step 1 — If approved, add `plausible('gnolove_share_copied')` to `CopyLinkButton` click, and `plausible('gnolove_url_loaded_with_filters', { props: { period, hasTeam: team !== null, hasRepoFilter: repos.size > 0 } })` to a `useEffect` in `GnoloveReport` on mount.

### Task 6.3 — Docs

- [ ] Step 1 — Update `CHANGELOG.md` under the next minor version (suggested **v6.1.0** — feature, not patch):

  ```md
  ## [6.1.0] — 2026-05-XX

  ### Added
  - **Gnolove: shareable report URLs.** Every filter on `/:network/gnolove/report`
    (period, period offset, status tab, team, repository set, view mode) now
    serializes to query parameters, with absolute period keys so links remain
    valid over time. Same treatment for `/gnolove` (scoreboard) and
    `/gnolove/reports` (AI archive).
  - `Copy link` button on the Report page.
  - Per-page `document.title` reflecting current filters.

  ### Fixed
  - Report "Highlights" now sorts by `mergedAt` desc (was: title length).
  - PR status badge correctly shows "Blocked" when on the "All" tab.
  - Switching period preserves the displayed time-window context (e.g.
    "April Week 2 → Monthly" now lands on April, not the current month).
  - All internal gnolove navigation skips the LegacyRedirect detour.
  - `aria-current` semantics on period and status tabs.

  ### Internal
  - New `lib/gnoloveReportUrl.ts`, `lib/gnoloveHomeUrl.ts` URL state codecs.
  - New `hooks/gnolove/useReportUrlState`, `useHomeUrlState` hooks.
  - Plan & expert review: `docs/planning/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md`.
  ```

- [ ] Step 2 — Update `ROADMAP.md` to mark "Shareable gnolove report URLs" as ✅ done.

- [ ] Step 3 — Commit.

### Task 6.4 — PR

- [ ] Step 1 — Open PR `feat/gnolove-shareable-urls` → `main` with title:

  ```
  feat(gnolove): shareable report URLs + section UX hardening
  ```

  PR body: link this plan, list bugs fixed, list test additions, attach 1 screencast (URL changing as filters change), confirm CI green.

  **Per `/Users/zxxma/.claude/CLAUDE.md`:** no Anthropic / AI attribution, no `Co-Authored-By` for the assistant, no "Generated with …" footer.

- [ ] Step 2 — Await reviewer (operator) approval. **Do not self-merge.**

---

## 13. Architecture Decision Records

### ADR-001 — Use `useSearchParams` (React Router 7) rather than `nuqs` or a custom router

**Decision:** Use the built-in `useSearchParams` API with thin wrapper hooks.

**Rationale:**
- React Router 7 is already a dependency.
- Memba's existing pattern (`?view=table` in `GnoloveReport`, `?code=` in `GithubCallback`) uses `useSearchParams`. Consistency wins.
- `nuqs` would add 6 KB gzipped + a new dependency for marginal ergonomic improvement.
- A thin wrapper (~80 LOC) provides Zod-validated parsing + stable identity + `replace` writes; nothing more needed.

**Alternatives considered:** `nuqs`, `react-router-search-params-helpers`, raw `URLSearchParams` per-page (status quo).

**Trade-offs:**
- Pro: zero new deps, minimal surface, matches existing patterns.
- Con: must hand-roll a tiny amount of boilerplate. Mitigated by central Zod schema.

### ADR-002 — Absolute period keys, not relative offsets

**Decision:** URL encodes `?at=2026-W18`, not `?offset=-1`.

**Rationale:**
- A link sent on a Friday with `?offset=-1` (meaning "last week") will silently start showing **the week before that** on Monday. This breaks share semantics catastrophically.
- ISO 8601 week dates are short, human-readable, and `date-fns`-native.

**Alternatives considered:** `?start=2026-05-04&end=2026-05-10` (more verbose but explicit), `?at=<unix-ms>` (machine-friendly but opaque), keeping relative `?offset=-1` (fast but wrong).

### ADR-003 — Default state writes nothing to the URL

**Decision:** A user visiting `/:network/gnolove/report` (no params) gets the default view; serializer omits any param equal to its default.

**Rationale:**
- Clean URLs in browser address bar.
- Trivial "reset filters" semantics (just remove all query string).
- Smaller URLs are more shareable on platforms with length limits (Twitter, Slack previews).

**Trade-off:** A user who *wants* to pin "today's default for posterity" needs to explicitly add `?at=2026-W18`. We expose this via the "Copy link" button: it always emits an absolute, fully-pinned URL by computing the current `at` if the state is at default.

### ADR-004 — Schema versioning via `?v=` (forward-compat, omitted today)

**Decision:** Reserve `?v=` for future schema breaks. v1 readers ignore it. v2 readers will branch on `v=2` and fall back to v1 logic otherwise. We **do not** write `?v=1` today.

**Rationale:** Cheap insurance against a future breaking change (e.g. adding required dimensions like `?author=`). Costs nothing to reserve the key.

### ADR-005 — Keep `LegacyRedirect` as a fallback, not the primary path

**Decision:** Fix internal links to use `useNetworkPath()`, but leave `LegacyRedirect` in `App.tsx` to catch (a) externally-shared bookmarks from before this fix, (b) edge cases where a user lands on `/gnolove/...` with no network in storage.

**Rationale:** Removing `LegacyRedirect` could break existing bookmarks. The cost of leaving it is one `<Route path="*">` declaration. Pure upside.

---

## 14. Risk Register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|--:|------|-----------:|-------:|------------|-------|
| R-1 | Hook-induced re-render storm in `GnoloveReport` (state object identity changes per URL char) | Medium | Medium | Memoize `state` on `searchParams.toString()`; unit-tested for stable identity. | FE Architect |
| R-2 | Browser back/forward unexpectedly creates an undo trap from `replace` writes | Low | Low | We `replace` on filter changes but `push` on page navigation (the default `Link` behavior is push). | FE Architect |
| R-3 | A malicious / broken URL crashes the page (uncaught throw inside `rangeFromKey`) | Low | High | Every Zod parse uses `.catch(default)`; `rangeFromKey` always returns a valid range (fallback to `now`); fuzz test covers 50 random invalid inputs. | FE Architect |
| R-4 | LegacyRedirect's `Navigate replace` + new param-preserving links interact in unexpected ways for double-redirect cases (e.g. `/gnolove/report?period=monthly`) | Low | Low | `LegacyRedirect` already preserves `location.search`; existing test in `gnolove.spec.ts` will catch regressions. Add one explicit Playwright spec for `goto('/gnolove/report?period=monthly')`. | FE Architect |
| R-5 | `useSearchParams` + React 19 strict-mode double-invocation causes a write loop on first render if defaults are written | Low | Medium | Default state writes nothing (ADR-003), so no first-render write happens. Verified in Phase 0 test. | FE Architect |
| R-6 | URL length explosion when user multi-selects many repos | Low | Low | Comma-separated, no `URLSearchParams`-style repetition. 20 repos ≈ 400 chars, well under browser limits (typically 2048+). | FE Architect |
| R-7 | The `repos=` (empty value) "all" convention is non-obvious | Medium | Low | Documented in ADR + plan + README of this PR; "Copy link" button emits the canonical form. | FE Architect |
| R-8 | Phase 2 (Home filters → URL) introduces regressions in pagination clamp logic | Medium | Medium | Keep existing `Math.min(page, totalPages)` clamp; add Playwright spec that visits `?page=999` and asserts the rendered page is the last valid one. | FE Architect |
| R-9 | Plausible event spam (every filter click emits a custom event) | Medium | Low | Only fire `gnolove_url_loaded_with_filters` on **mount** (one per page load), not on every change. | FE Architect |
| R-10 | This PR collides with v7.1 Phase 4 (Quality / Observability) | Low | Low | Diff is contained to `pages/gnolove/`, `components/gnolove/`, `lib/gnolove*.ts`, `hooks/gnolove/`. No shared file with v7.1 work. Land after Phase 3 of v7.1 (React Query migration) to avoid touching `GnoloveLayout` simultaneously. See [Q-1](#21-open-questions-for-approval). | Operator |

---

## 15. Acceptance Criteria & Definition of Done

### 15.1 Functional (must all be true at PR-merge time)

1. ✅ Navigating to `/test12/gnolove/report?period=monthly&at=2026-05&team=Samourai.world&tab=merged&repos=gnolang/gno,samouraiworld/memba&view=table` renders the corresponding state on first paint with no flicker.
2. ✅ Every filter change updates the URL via `replace` (single history entry per logical session).
3. ✅ Browser back button restores the previous filter state (because `replace` is used within a page, but page navigation uses `push`).
4. ✅ Bookmarking the URL and reopening 30 days later still shows the same data (absolute `at` key).
5. ✅ Removing every query param yields the default report (no stuck state).
6. ✅ `?period=garbage&tab=alsogarbage&at=99-99` renders the default view without any console error.
7. ✅ The "Copy link" button copies a fully-pinned URL (with `at=` even at defaults) to the clipboard.
8. ✅ `document.title` reflects the active filters (e.g. "PR Report · Samourai.world · May 2026 | Gnolove · Memba").
9. ✅ All 6 SubNav links + 12 internal `<Link>` callsites use `useNetworkPath()`.
10. ✅ All BUG-2..BUG-6 + UX-1..UX-5 items closed.

### 15.2 Quality gates

- ✅ `pnpm --filter frontend lint` → clean.
- ✅ `pnpm --filter frontend exec tsc -b --noEmit` → clean.
- ✅ `pnpm --filter frontend test` → all green; new files have ≥ 90 % line coverage.
- ✅ `pnpm --filter frontend exec playwright test gnolove.spec.ts` → all green.
- ✅ `pnpm --filter frontend build` → succeeds.
- ✅ No new dependencies added (verified by `git diff package.json package-lock.json`).
- ✅ No backend changes (`backend/` clean in `git status`).

### 15.3 Documentation

- ✅ `CHANGELOG.md` updated.
- ✅ `ROADMAP.md` checkbox flipped.
- ✅ This plan is linked from the PR body.
- ✅ JSDoc on every exported function in `gnoloveReportUrl.ts` and `useReportUrlState.ts`.

### 15.4 Reviewer sign-off

- ✅ Operator (single reviewer per current CODEOWNERS) approves PR.
- ✅ No AI / assistant attribution lines anywhere (per global user CLAUDE.md hard rule).

---

## 16. Rollback Playbook

| Trigger | Action | Expected MTTR |
|---|---|---|
| Console errors spike on `/:network/gnolove/report` post-deploy | Revert PR via `git revert <merge-sha>`, push to `main`, Netlify auto-deploys (~3 min) | < 10 min |
| Filter state leaks across pages (URL state stuck) | Hard revert (above) | < 10 min |
| Backwards-compat issue with existing bookmark (`?view=table` doesn't activate table) | Revert PR; investigate; re-land with a passing test for the failed bookmark | < 30 min |
| Subtle Sentry uptick (e.g. NaN in `rangeFromKey`) | Hotfix-forward: patch `rangeFromKey` with explicit `Number.isFinite` guards | < 1 h |
| Operator decides the URL schema is wrong before broad sharing happens | Roll forward with a `?v=2` migration; `parseReportUrl` reads both v1 and v2 | days |

**Key invariant for safe rollback:** This PR adds **no** new fields to any persistent store (no localStorage, no backend, no Gno realm). Reverting the PR fully undoes the change.

---

## 17. Test Plan

### 17.1 Unit (vitest)

| Subject | File | Cases |
|---|---|--:|
| Schema parser | `lib/gnoloveReportUrl.test.ts` | 25+ (each field, each error path, round-trip 50 random states, period-key validation) |
| Period helpers | same | 10+ (`rangeFromKey` for each period, edge: week 53, year boundary, leap year) |
| `useReportUrlState` hook | `hooks/gnolove/useReportUrlState.test.tsx` | 8 (read, partial update, default-elision, stable identity, replace semantics) |
| `useHomeUrlState` hook | `hooks/gnolove/useHomeUrlState.test.tsx` | 8 (analogous) |
| `<CopyLinkButton>` | `components/gnolove/CopyLinkButton.test.tsx` | 4 (clipboard, share API, error path, aria-live) |
| `<PageMeta>` | inline | 3 (mount sets title, unmount restores, description override) |
| `GnoloveReport.test.tsx` (new) | new file | 6 (empty-state reasons, BUG-2 banner, BUG-3 sort, BUG-4 badge, BUG-5 period switch, default state) |

### 17.2 E2E (Playwright)

Add to `frontend/e2e/gnolove.spec.ts`:

1. ✅ "report URL is fully shareable" — deep-link 6 params, all reflected in UI.
2. ✅ "report URL preserves filters across view toggle".
3. ✅ "report URL gracefully handles garbage input".
4. ✅ "switching period preserves time-window context (BUG-5)" — start on April-W2, click Monthly, assert "April 2026" not "May 2026".
5. ✅ "copy link emits a fully-pinned URL even from defaults".
6. ✅ "back button restores filters after view toggle".
7. ✅ "unknown repo triggers warning banner (BUG-2)".
8. ✅ "AI Reports `?id=<report-id>` deep-link auto-scrolls and expands".
9. ✅ "Home `?page=999` clamps to last valid page".
10. ✅ "SubNav 'Teams' click goes directly to `/:network/gnolove/teams` (no LegacyRedirect)".

### 17.3 Manual smoke checklist (in PR description)

- [ ] Open report on test12. Change every filter. URL updates after each change.
- [ ] Reload page. Filters survive.
- [ ] Hit back. Previous filter combo restored.
- [ ] Copy link. Paste in incognito. Same view shows.
- [ ] Switch to betanet (`gnoland1`). Same URL schema, same behavior.
- [ ] Open `?period=garbage` directly. No crash, default view shown.
- [ ] Toggle Table view. Filters preserved.
- [ ] Open `?repos=samouraiworld/repo-that-doesnt-exist`. See warning banner.
- [ ] Click SubNav while on report with filters. Navigate to Analytics. Hit back. Filters restored.

### 17.4 Performance check

- [ ] Lighthouse on `/test12/gnolove/report` with full filter URL: TTI ≤ baseline + 50 ms (no perceptible regression).
- [ ] Bundle size delta: `pnpm --filter frontend build` and compare `dist/assets/*.js` totals before/after. Expected: +2–4 KB gzipped (Zod schema + 2 hooks + 2 components).

---

## 18. Sequencing & Critical Path

```
Day 0       Day 0.5     Day 2       Day 3.5     Day 4       Day 4.5     Day 5       Day 6
│           │           │           │           │           │           │           │
P0          P1          P2          P3          P4          P5          P5/P6       P6
foundation  report      home+AI     link        a11y/bug    SEO+copy    polish     PR
            URL state   URL         hygiene     cleanup     -link       
```

- **Critical path:** P0 → P1. Nothing else can ship without the hook + report.
- **Parallelizable:** P2 + P3 can be done in either order after P1. P4 fits anywhere after P1.
- **PTO float:** 1 day. (Plan totals 6–8 days; realistic 1 FTE has ~5–6 working days available in a calendar week.)
- **No critical path dependency on backend, infra, or external repos.** This PR is fully self-contained.

---

## 19. Observability & Telemetry

- **Sentry:** Existing error boundary in `GnoloveLayout` catches any unhandled throw from the new hooks. Add a Sentry breadcrumb to `useReportUrlState` if/when the operator approves (Q-5).
- **Plausible:** Two new custom events (Q-5). No PII.
- **Console:** **No** `console.log` in production code paths. (Existing `console.error` in `GnoloveErrorBoundary` is preserved.)
- **Coverage report:** uploaded as PR artifact via existing `ci.yml` flow.

---

## 20. Cross-cutting concerns

### 20.1 Accessibility

- WCAG 2.1 AA target. New components must pass:
    - Visible focus rings on all interactive elements.
    - `aria-current` on active tabs/period buttons.
    - `aria-expanded` on the repo multi-select.
    - `aria-live="polite"` on the "Copy link" confirmation.
    - 4.5:1 contrast on the warning banner.

### 20.2 Internationalization

- Memba is currently English-only. We do not introduce new translation keys. Period labels stay in English.

### 20.3 Security / privacy

- No PII serialized into URLs. Team names and repo names are public.
- No new XSS surface: every URL-derived string passes through React's text-content escaping; no unsafe HTML injection patterns are introduced.
- CSP: no new origins, no inline scripts. No netlify.toml / index.html CSP changes required.
- Clipboard: `navigator.clipboard.writeText` is already used in `GnoloveContributorProfile.tsx` and `GnoloveReport.tsx`; no new permissions.

### 20.4 Performance

- Each filter change triggers a `setSearchParams` (cheap), a re-parse of the query string (~1µs), and a `useGnoloveReport` re-query **only** when `[period, at]` changes (i.e. start/end change). Team/repo/tab changes do **not** re-fetch from the backend — they only re-filter in memory, matching today's behavior.

### 20.5 Browser support

- Same matrix as Memba today: evergreen Chrome/Firefox/Safari/Edge. `URLSearchParams`, `Set`, optional chaining all already used. No new polyfill required.

---

## 21. Open Questions for Approval

| # | Question | Default if no answer | Blocker for? |
|--:|----------|----------------------|---|
| Q-1 | Land before, during, or after v7.1 ship? | After Phase 3 of v7.1 (React Query migration); inside Phase 4 window. | Sequencing |
| Q-2 | Is `?team=Samourai.world` URL-encoded correctly (`%20` or `+`)? Both decode fine; do we prefer one? | Default to `%20` (browsers' default for non-form encoding). | Phase 1 polish |
| Q-3 | When the user clicks "Reset filters" inside an empty state, should we also reset `view` and `period`? | Yes — fully reset to default (`setUrlState(DEFAULT_REPORT_STATE)`). | Phase 1 |
| Q-4 | Default `selectedRepos = {gnolang/gno}` — keep as-is, or change default to "all repos"? | Keep as-is (matches today's product behavior). Operator may choose to broaden later. | Phase 1 |
| Q-5 | Enable Plausible custom events for share-copied + URL-with-filters-on-load? | Yes — they are PII-free and informative. | Phase 6 |
| Q-6 | Should we add a Netlify Edge Function for dynamic OG cards? | Defer to a separate plan; out of scope here. | Phase 5 — affects only nice-to-have |
| Q-7 | Web Share API on mobile — implement now or defer? | Implement now if it's < 30 LOC inside `<CopyLinkButton>` (it is). | Phase 5 |
| Q-8 | Apply `useHomeUrlState` to `GnoloveHome` in this PR, or split into a follow-up? | Apply in this PR (Phase 2). Same paradigm, ~2 hours of work. | Scope |
| Q-9 | `GnoloveAIReports` deep-link via `?id=` — also support `?date=2026-05-10`? | Defer date variant; `?id=` is unambiguous and matches DB. | Scope |
| Q-10 | Should the duplicate `Link to="/gnolove/teams"` in `GnoloveTeamProfile.tsx:42` and `:50` be deduped as part of Phase 3? | Yes — one is dead code. | Phase 3 cleanup |
| Q-11 | Branch naming `feat/gnolove-shareable-urls` OK, or do we prefer `feat/gl-share-urls`? | The former — matches recent PR branch style (`fix/v6-error-messages-theme`). | Phase 0 |
| Q-12 | Should `<PageMeta>` also write `og:title` / `og:description` via meta tags? Useful for Slack/Twitter unfurls that crawl client-side. | Slack/Twitter do **not** crawl client-side. Without SSR, this is cosmetic only. Defer (Q-6). | Phase 5 |

---

## 22. Appendices

### Appendix A — Full URL schema BNF

```bnf
url           ::= "/" network "/" gnolove "/" report ( "?" params )?
network       ::= "test12" | "gnoland1" | <other configured NETWORKS>
gnolove       ::= "gnolove"
report        ::= "report"

params        ::= param ( "&" param )*
param         ::= period-p | at-p | tab-p | team-p | repos-p | view-p
period-p      ::= "period=" period
period        ::= "weekly" | "monthly" | "yearly" | "all"
at-p          ::= "at=" at-key
at-key        ::= week-key | month-key | year-key
week-key      ::= year "-W" week         (* ISO 8601, e.g. 2026-W18 *)
month-key     ::= year "-" month         (* e.g. 2026-05 *)
year-key      ::= year                    (* e.g. 2026 *)
tab-p         ::= "tab=" tab
tab           ::= "all" | "merged" | "in_progress" | "waiting_for_review"
                | "reviewed" | "blocked"
team-p        ::= "team=" url-encoded-string
repos-p       ::= "repos=" ( "" | repo ( "," repo )* )
repo          ::= owner "/" name           (* /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/ *)
view-p        ::= "view=" ( "report" | "table" )

year          ::= 4-digit-number
month         ::= "01".."12"
week          ::= "01".."53"
```

### Appendix B — Inventory of all `useState` calls touched

```
GnoloveReport.tsx — 7 useState → 6 replaced (kept: repoDropdownOpen)
GnoloveHome.tsx   — 9 useState → 6 replaced (kept: repoFilterOpen, activityExpanded, sortBy if we punt)
GnoloveAIReports.tsx — 2 useState → 1 augmented (visibleCount derived from ?id, copied stays local)
GnoloveContributorProfile.tsx — 1 useState (copied) — no change
```

### Appendix C — Migration notes for follow-up work (out of scope here)

- **Per-user saved filters** would slot in cleanly: serialize the `ReportUrlState` JSON into a backend table keyed by user. URL remains the source of truth at the page level.
- **Cross-page filter persistence** (e.g. "remember my team filter when I switch from Report to Analytics") would need a single `<GnoloveFilterProvider>` context in the layout. Today's per-page-URL model is the correct first step.
- **Dynamic OG images** require a Netlify Edge Function (or Vercel-style serverless route) that proxies `/og/gnolove-report?…` and returns a PNG. Out of scope for this plan.

### Appendix D — Acceptance test command bundle (single command to run)

```bash
cd /Users/zxxma/Desktop/Code/Gno/Memba
git checkout feat/gnolove-shareable-urls
pnpm --filter frontend install --frozen-lockfile
pnpm --filter frontend lint
pnpm --filter frontend exec tsc -b --noEmit
pnpm --filter frontend test -- --run --coverage
pnpm --filter frontend build
pnpm --filter frontend exec playwright install --with-deps chromium
pnpm --filter frontend exec playwright test gnolove.spec.ts
```

### Appendix E — Self-review pass (writing-plans skill checklist)

**Spec coverage:**

- ✅ "URL changes when team/period/repository selected" — Phase 1, Tasks 1.1, 1.7; Acceptance #1, #2.
- ✅ "Easy share with exact config" — Phase 5, Task 5.2 (Copy link button); Acceptance #7.
- ✅ "Catch bugs / improvements on /gnolove pages" — §1.4 (5 BUGs + 5 UX issues), addressed Phases 1, 3, 4.
- ✅ "Don't code anything before" — this is a PROPOSAL doc; no code in the plan branch, plan file lives in `docs/planning/` only.
- ✅ "Deep CTO expert review" — listed as next step (sub-agent panel to be dispatched after the operator skims this Rev0).
- ✅ "Detailed, AAA SWE, MD file, world-class best standards" — matches Memba V7.1 plan format; 22 sections; ADRs; risk register; rollback; e2e + unit test plan.

**Placeholder scan:** No "TBD", "TODO", "Add appropriate error handling" without code, or "Similar to Task N". Every code-bearing step has the actual code.

**Type consistency:** `ReportUrlState`, `ReportPeriod`, `useReportUrlState`, `setUrlState`, `parseReportUrl`, `serializeReportUrl`, `DEFAULT_REPORT_STATE`, `rangeFromKey`, `weekKeyFromDate`, `monthKeyFromDate`, `yearKeyFromDate`, `defaultKey` — all introduced in §3.4 and consistently referenced thereafter.

---

> **Next action (per user instruction):** halt all implementation. Dispatch CTO-level expert sub-agents for cross-check / verification / improvement. Their findings will be appended to this document as **Rev1** (expert panel) — same format as `MEMBA_V7_1_EXPERT_REVIEW.md`.

---

## 23. Rev1 amendments (post-expert-panel)

> The full audit trail for the six-panel review is preserved in [`GNOLOVE_SHAREABLE_REPORT_URLS_EXPERT_REVIEW.md`](GNOLOVE_SHAREABLE_REPORT_URLS_EXPERT_REVIEW.md). This section lists the must-fix-driven *additions* to the Rev0 plan that are too long to inline above. Every section above this point has been edited in-place to incorporate the smaller changes (with `[MF-N]` citations).

### 23.1 New ADRs (added by Rev1)

#### ADR-006 — Defaults are first-visit affordances; shared links override defaults bit-for-bit [MF-26 / UX U-10]

**Decision:** When a URL contains an explicit value for any filter axis, that value wins absolutely — never composed with a "default override". When the URL is bare (`/:network/gnolove/report`), defaults apply.

**Rationale:** A user sharing a link expects the recipient to see exactly the configured view, even if it equals defaults. A user typing the bare URL expects the team-highlight default. These are two different intents and the URL parameter presence is the unambiguous signal.

**Implication:** `parseReportUrl` defaults only apply when a key is absent. An empty value (`?team=`, `?repos=`) is a meaningful "explicit clear" signal, not a default trigger. The serializer's "default elision" is purely an output optimization; round-trip preserves intent.

#### ADR-007 — Period-switch disambiguation uses `end` of current range [MF-4]

**Decision:** When the user switches `period` from A to B, the new `at` key is computed from the **`end`** of the current range, not the `start`.

**Rationale:** Users perceive "this week's month" as the month containing the *last* day of the week, especially for weeks spanning month boundaries. `start`-based switching is locally optimal for early weeks of a month but causes the "skipping May" bug for late weeks. `midpoint`-based switching is unambiguous but arithmetically odd; `end` is the simplest rule that matches user expectation in 95%+ of cases.

**Edge case (`all_time → X`):** Don't compute from the `start = 1980-01-01` of the all-time range (which would teleport users to 1980-W01). Instead, fall back to `defaultKey(B)`. Same applies for `X → all_time`: emit `at = null`.

#### ADR-008 — Reader is feature-flagged behind `VITE_GNOLOVE_URL_STATE` [MF-17]

**Decision:** The new URL-state reader is gated behind an env-var feature flag. Default-on in dev. Default-on in prod after Phase 6 sign-off. Flippable via Netlify env var without `git revert`.

**Rationale:** SRE-panel R-9 — Memba has no flag system today, and the only rollback path in Rev0 was full revert (~6–10 min realistic). An env-var flag is a 3-min Netlify rebuild, no code change. The flag has no consumer state, no telemetry contamination, and removes the need for a true blue/green or canary deploy.

**Removal plan:** strip the flag in v6.2.0 after ≥ 14 days of clean production telemetry.

### 23.2 New Risk Register entries (Rev1 additions)

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|--:|------|-----------:|-------:|------------|-------|
| **R-11** | BUG-2 "missing-repo warning" false-positives from stale `persistQueryClient` cache (`gnolove-cache-v1`) — user sees banner for a repo that *does* exist server-side, hidden by 24h-old cache | Medium | Low | "Reset filters" path triggers `Promise.all([refetchRepos, refetchReport])` to bust cache; warning copy mentions "Refresh to retry" [MF-11 / F-8] | FE Architect |
| **R-12** | Stale-team URL (`?team=Foo` where `Foo ∉ TEAMS`) silently shows "all teams" data but dropdown label reads `Foo` | Medium | Medium | Parser sets `team = null` when value fails allowlist; banner shown (mirrors BUG-2) [MF-18 / A-15]; e2e spec covers | FE Architect |
| **R-13** | `<PageMeta>` cleanup race on rapid back-and-forth navigation restores stale title | Low | Low | Cleanup only restores if `document.title === capturedAtMount`; otherwise leave new title in place [MF-10 / F-7] | FE Architect |
| **R-14** | `setUrlState` referential instability surprises React-memo consumers | Low | Low | JSDoc spells out non-stability; lint codemod (`eslint-plugin-react-hooks`) catches naive `useMemo([setUrlState])` patterns | FE Architect |
| **R-15** | URL parameter pollution (`?period=a&period=b`) silently coerced — could hide active recon | Low | Low | `parseReportUrl` emits `gnolove.url.fallback` Sentry breadcrumb on any silent coercion [MF-6 / S-6 / R-2] | FE Architect |
| **R-16** | Feature flag `VITE_GNOLOVE_URL_STATE` flip causes brief mismatch where deployed JS expects flag-on but Netlify env says off | Low | Medium | Default the flag's *missing* state to "on" so a removed env var is safe; document rollback procedure as "set to '0', not 'delete'" in §16 [MF-17] | SRE |

### 23.3 Revised §16 Rollback Playbook

> Replaces the Rev0 table.

| Trigger | Primary action | Fallback | Expected MTTR |
|---|---|---|---|
| Console errors spike on `/:network/gnolove/report` post-deploy | **Netlify dashboard → Deploys → Previous → "Publish deploy"** (or `netlify deploy:rollback` via CLI) — instantaneous CDN swap | `git revert <merge-sha>` → push → CI rebuilds + redeploys (~6–10 min) | **~30s (primary), 6–10 min (fallback)** [MF-16 / R-1] |
| Filter state leaks across pages | Netlify rollback (as above) | Code revert | < 1 min |
| URL parse fallback rate spikes (Sentry breadcrumb `gnolove.url.fallback` > N/min) | Flip `VITE_GNOLOVE_URL_STATE = 0` in Netlify env → trigger rebuild | Investigate URL patterns in Sentry; patch-forward | ~3 min [MF-17 / R-9] |
| Backwards-compat issue with `?view=table` bookmark | Code revert with passing repro test | n/a | < 30 min |
| Operator decides URL schema is wrong before broad sharing | Roll forward with `?v=2` migration; `parseReportUrl` reads both | n/a | days |

**Key invariant:** This PR adds **no** persistent state. Both primary and fallback paths are loss-free.

### 23.4 Revised §17 Test Plan additions

- **§17.1 additions [MF-9]:** explicit unit-test cases:
  - `parseReportUrl(URLSearchParams("period=monthly&at=2026-W18"))` — period/at-format mismatch ⇒ `at = null`, breadcrumb fired.
  - `parseReportUrl(URLSearchParams("at=2020-W53"))` ⇒ valid (2020 has 53 ISO weeks).
  - `parseReportUrl(URLSearchParams("at=2021-W53"))` ⇒ `at = null` (2021 does not have W53) — note: the regex permits W53 syntactically; this test pins the *runtime* `rangeFromKey` behavior, which returns the fallback range. Either tighten the regex per-year (intractable) or document that W53-of-a-short-year falls back silently. **Plan choice:** document silent fallback.
  - `weekKeyFromDate(new Date("2025-12-31"))` ⇒ `"2026-W01"` (ISO week-year roll-over).
  - `parseReportUrl(URLSearchParams("team=Samourai%2Eworld"))` ⇒ decoded to `"Samourai.world"` (PASS allowlist).
  - `parseReportUrl(URLSearchParams("team=A%26B"))` ⇒ decoded to `"A&B"` (FAIL allowlist regex `[A-Za-z0-9 ._-]`) ⇒ `team = null`, breadcrumb fired.
  - `parseReportUrl(URLSearchParams("team=NotARealTeam"))` ⇒ regex passes but allowlist fails ⇒ `team = null` ([MF-18]).
  - `serializeReportUrl(parseReportUrl(s.toString()))` idempotency for 200 fast-check-generated states [MF-14].
  - `parseReportUrl(URLSearchParams("repos=foo/bar,foo/bar,foo/bar"))` ⇒ `["foo/bar"]` (dedupe + sort).
  - `parseReportUrl(URLSearchParams("repos=" + "a/b,".repeat(100)))` ⇒ truncated to 50 entries [MF-24].

- **§17.2 additions:** every spec that asserts rendered data **must** call `await page.route('**/backend.gnolove.world/**', route => route.fulfill({ json: fixture }))` AND retain a try/catch skip-if-API-unreachable wrapper [MF-5]. A single shared fixture lives at `frontend/e2e/fixtures/gnoloveReport.json`. BUG-5 regression test deep-links with `?at=2026-W18` (Apr week 18) and `?at=2026-W15` (late April spanning to May), not `Date.now()` [MF-21].

- **§17.5 (NEW) Out-of-scope verification work — accepted risk:** performance regression vs. live prod, pentest on deployed feature, screen-reader specialist walkthrough, mobile real-device matrix, comparative URL-state research vs. peer apps. These belong in v6.2.0 follow-up tickets.

### 23.5 Revised §6.3 Docs step

- [ ] `frontend/package.json` version `4.0.0 → 4.1.0` so Sentry release is `memba@4.1.0` (per `vite.config.ts:38` reading `pkg.version`). Note this in the PR body. **[MF-30]**
- [ ] Add `frontend/e2e/fixtures/gnoloveReport.json` (mock backend response).
- [ ] Update `hooks/gnolove/index.ts` to re-export `useReportUrlState` and `useHomeUrlState`. **[MF-35]**
- [ ] Update `netlify.toml` to add explicit `Cache-Control: public, max-age=0, must-revalidate` for `/*.html`. **[MF-29]**
- [ ] Set `VITE_GNOLOVE_URL_STATE=1` in Netlify production env (CI step or manual via dashboard).

### 23.6 Revised §21 Open Questions for Approval

The 12 Rev0 questions remain valid but the following Rev1-specific operator approvals are needed (drawn from §10 of the expert review):

| ID | Question | Recommendation |
|---|---|---|
| EQ-1 | Approve `push` for filter changes (Rev1 G4)? | Yes — matches GitHub/Linear/Amplitude precedent. |
| EQ-2 | Pick `%20` over `+` URL-encoding for `team` values? | `%20`. RFC 3986-compliant non-form encoding. |
| EQ-3 | Add `fast-check` + `@axe-core/playwright` devDeps? | Yes; both <100KB devDeps; net testing-quality win. |
| EQ-4 | Feature-flag the reader via `VITE_GNOLOVE_URL_STATE`? | Yes; dark-launch + flip-off without revert. |
| EQ-5 | Bump `frontend/package.json` to 4.1.0? | Yes; clarifies Sentry release. |
| EQ-6 | Phase 0 reviewer (2nd IC) — who? | Operator names; default `@n0izn0iz` per v7.1 review precedent. |
| EQ-7 | Land in parallel with v7.1 Phase 3, after Phase 3.0's MSW prereq? | Yes; the MSW harness lands in Phase 3.0 and is required by MF-5. |
| EQ-8 | Accept the 10–12 day re-estimate? | Yes; 6–8 days was optimistic. |
| EQ-9 | Share submenu (Copy/Slack/Twitter/Email) in this PR or v6.2.0 follow-up? | Single Copy button now; submenu in v6.2.0. |
| EQ-10 | Cross-tab URL sync (BroadcastChannel) — implement or punt? | Punt to v6.2.0. |

---

> **End of Rev1.** Implementation must not begin before EQ-1..EQ-10 receive operator sign-off. Once those are answered, Phase 0 starts with the named 2nd-IC schema review gate (MF-19) on the freshly-branched `feat/gnolove-shareable-urls`.

