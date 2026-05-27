# Gnolove Next Session — Implementation Plan

> Written 2026-05-25. Covers 8 workstreams across UX, data, and polish.
> Start from `main` at commit `7210fa7` (post PR #356 merge).
> Prior session: fixed team hub health probe + Zod null-array bug (#356), full product audit passed.

---

## Workstream 1: gnolang/gno Repository Priority & Tagging

### Problem
All repositories are treated equally across the product. `gnolang/gno` is the Gno ecosystem's core repo and should be visually distinguished as the primary/core repo everywhere it appears.

### What to change

**1a. Repo ordering — always show `gnolang/gno` first**

In every list where repos appear, sort `gnolang/gno` to the top regardless of alphabetical or metric order:
- **AI Reports page** (`GnoloveAIReports.tsx`): Projects currently ordered arbitrarily by the backend (e.g., `samouraiworld/zenao` first, `gnolang/gno` second). Sort client-side: `gnolang/gno` pinned first, rest by existing order.
- **Report page repo filter** (`GnoloveReport.tsx`): The multi-select dropdown lists repos from the backend. Pin `gnolang/gno` to the top.
- **Home page repo activity chart** (`GnoloveHome.tsx`): `repoActivity` already sorted by PR count, but `gnolang/gno` should always be first even if another repo has more team PRs.
- **Team hub active repos** (`TeamHubActiveReposCard.tsx`): `gnolang/gno` should always appear in "Primary" if the team has any contributions there.

**1b. Add "core" / "ecosystem" badges**

Add a small tag/badge next to repo names across the product:
- `gnolang/gno` gets a `core` badge (accent color, e.g., blue)
- All other repos get an `ecosystem` badge (muted/grey)

Implementation: Create a `<RepoBadge repo={repoId} />` component:
```tsx
function RepoBadge({ repo }: { repo: string }) {
    const isCore = repo === "gnolang/gno"
    return <span className={`gl-repo-badge ${isCore ? "gl-repo-badge--core" : "gl-repo-badge--eco"}`}>
        {isCore ? "core" : "ecosystem"}
    </span>
}
```

Use in: `TeamHubActiveReposCard`, `AIReportCard` project headers, report page repo chips, home page repo activity bars.

**1c. Score weighting (future — needs backend)**

Check `GET /score-factors` to see if `gnolang/gno` contributions are weighted differently. If not, propose a backend config change. This is a follow-up, not blocking.

**Files:**
- `frontend/src/components/gnolove/RepoBadge.tsx` (NEW — shared component)
- `frontend/src/components/gnolove/teams/TeamHubActiveReposCard.tsx`
- `frontend/src/components/gnolove/AIReportCard.tsx`
- `frontend/src/pages/gnolove/GnoloveReport.tsx`
- `frontend/src/pages/gnolove/GnoloveHome.tsx`
- `frontend/src/pages/gnolove/GnoloveAIReports.tsx`
- `frontend/src/pages/gnolove/gnolove.css`

---

## Workstream 2: Focus Areas Rework (Kill "Other", Add Precision)

### Problem
- "Other" appears when PRs don't match any topic pattern (common for team repos like memba/gnolove)
- `gnovm` topic catches ALL `gnolang/gno` PRs because `gnoland/gno` is a pattern — a docs PR gets classified as "Gno VM"
- Need more technically precise categories (e.g., "consensus", "realms")

### Root Cause
The classifier in `gnoloveFocusAreas.ts:classify()` does `haystack = "${signal.repo} ${signal.title}".toLowerCase()`, then first-match-wins. The `gnovm` rule has `gnoland/gno` as a catch-all pattern for the entire repo.

### Fix Strategy

**2a. Remove `gnoland/gno` from `gnovm` patterns**

The repo name should NOT be a pattern. Rely on title keywords instead:
- Add: `gnomod`, `precompile`, `type-check`, `transpile`, `\bast\b`, `\bparser\b`
- Keep: `\bvm\b`, `interpreter`, `\bstack[- ]engine\b`

**2b. Add conventional-commit prefix matching**

PRs in `gnolang/gno` commonly use `feat(gnovm):`, `fix(tm2):`, `chore(ci):` prefixes. Add patterns:
- `\(gnovm\)` -> gnovm
- `\(tm2\)` -> gnocore (rename from "Core protocol" to "Core / TM2")
- `\(gno\.land\)` -> realms (new topic)
- `\(ci\)` or `\(build\)` -> gnops

**2c. Expand taxonomy — new topics to reduce "Other"**

```yaml
- slug: "frontend"
  label: "Frontend"
  patterns: ["\\breact\\b", "\\bvite\\b", "\\bcss\\b", "\\bui\\b", "component", "\\bux\\b"]

- slug: "testing"
  label: "Testing & CI"
  patterns: ["\\btest\\b", "\\bvitest\\b", "\\be2e\\b", "coverage", "\\(ci\\)", "\\(build\\)"]

- slug: "realms"
  label: "Realms & packages"
  patterns: ["\\brealm\\b", "\\bpackage\\b", "grc20", "\\bavl\\b", "\\(gno\\.land\\)"]

- slug: "consensus"
  label: "Consensus"
  patterns: ["\\bconsensus\\b", "\\btendermint\\b", "\\bbft\\b", "\\bvalidator\\b", "\\bblock\\b"]
```

Move `consensus` out of `gnocore` into its own topic for finer granularity.

**2d. Never show "Other" pill**

In `gnoloveFocusAreas.ts`:
- Remove `OTHER_HIDE_THRESHOLD` logic entirely
- Hard filter: `entries.filter(p => p.topic !== OTHER_SLUG)`
- Increase `TOP_N` from 5 to 6

**2e. Update backend `topics.yaml` (if deployable) and frontend seed**

The backend `gnolove/server/config/topics.yaml` is authoritative. Update both the backend config and the frontend `SEED_TOPIC_RULES` in `gnoloveFocusAreas.ts`.

**Expected result for Samourai.world:**
Instead of: `Gno VM (80%) | Other (20%)`
After: `Gno VM (30%) | Security (20%) | Frontend (18%) | AI (15%) | Testing (12%) | Realms (5%)`

**Files:**
- `frontend/src/lib/gnoloveFocusAreas.ts` — classifier + seed rules + kill "Other"
- Backend: `gnolove/server/config/topics.yaml`
- `frontend/src/components/gnolove/teams/TeamHubFocusAreasCard.tsx` — minor render adjustments

---

## Workstream 3: Team Report on Each Team Page

### Problem
The team hub shows an "AI weekly report" card but lacks a team-scoped PR status report (merged/in-progress/blocked breakdown).

### What to build

**3a. `TeamHubReportCard` — new card component**

Shows a compact PR status summary for the team in the selected period:
- Status breakdown: merged / in-progress / waiting for review / blocked (colored counts)
- Top 3 most recent merged PRs (title + repo + date)
- Link: "View full report" navigates to `/gnolove/report?team=<teamName>&period=<period>`

Uses existing `useGnoloveReport(start, end)` hook + filters by team members (same logic as `filterPrs` in `gnoloveReportFilters.ts`).

**3b. Card placement in TeamHub.tsx**

```
Header -> Metrics Grid -> **Report Card (NEW)** -> Active Repos -> Focus Areas -> Recent Activity -> AI Report
```

**3c. Deep-link URL construction**

The report page already supports `?team=Onbloc` via `useReportUrlState`. The card constructs:
```
/gnolove/report?team=${team.name}&period=${period}
```

**Files:**
- `frontend/src/components/gnolove/teams/TeamHubReportCard.tsx` (NEW)
- `frontend/src/components/gnolove/teams/TeamHub.tsx` — wire new card
- `frontend/src/pages/gnolove/gnolove.css` — card styles

---

## Workstream 4: Flexible Weekly Period Filter

### Problem
The "Weekly" period in the report page is locked to Monday-to-Monday. Users can't choose a custom start date — the prev/next buttons jump by fixed weeks. This is rigid for teams that want to see "last 7 days from Thursday" or a sprint-aligned period.

### Current Implementation
- `GnoloveReport.tsx` line 164: `case "weekly"` computes `start` from `weekKeyFromDate()`
- `startOfWeek(date, { weekStartsOn: 1 })` hardcodes Monday
- Navigation: `addWeeks(start, delta)` jumps by whole weeks
- URL state: `at=2026-W21` (ISO week key)

### Proposed UX

**Option A: Add "Custom" period alongside weekly/monthly/yearly/all-time**

Add a 5th period option: "Custom". When selected:
- Show a date range picker (start date + end date)
- URL state: `period=custom&from=2026-05-20&to=2026-05-27`
- Prev/next buttons disabled in custom mode (user picks dates explicitly)

**Option B: Let user pick week start day (simpler)**

Add a "Week starts on" toggle (Mon/Sun/Today) to the weekly view. Less flexible but simpler.

**Recommended: Option A** — it covers all use cases and the date picker is reusable.

### Implementation

**4a. Add "Custom" to period options**

In `gnoloveReportUrl.ts`:
- Add `"custom"` to the period union
- Add `from` and `to` URL params for custom range
- `rangeFromKey("custom", { from, to })` returns the user-selected dates

**4b. Date range picker UI**

Two native `<input type="date">` fields (no external lib needed):
```tsx
{period === "custom" && (
    <div className="gl-report-custom-range">
        <input type="date" value={fromDate} onChange={...} />
        <span>to</span>
        <input type="date" value={toDate} onChange={...} max={today} />
    </div>
)}
```

**4c. Disable prev/next arrows in custom mode**

`canGoBack` and `canGoForward` should both be `false` when `period === "custom"`.

**Files:**
- `frontend/src/lib/gnoloveReportUrl.ts` — URL state + custom period parsing
- `frontend/src/hooks/gnolove/useReportUrlState.ts` — expose from/to state
- `frontend/src/pages/gnolove/GnoloveReport.tsx` — UI (date inputs + period option)
- `frontend/src/pages/gnolove/gnolove.css` — date picker styles

---

## Workstream 5: Milestone Page Polish

### Problem
The milestone description renders raw text including literal `**bold**` markdown markers. Issue titles may also contain markdown artifacts.

### Root Cause
`GnoloveMilestone.tsx` line 55 renders `milestone.description` as plain text:
```tsx
<div className="gl-ms-description">{milestone.description}</div>
```
GitHub milestone descriptions are markdown but we render them as a text node.

### Fix

**5a. Parse markdown in milestone description**

Use a lightweight markdown renderer. Options:
- **Option 1 (minimal):** Regex-replace common markdown (`**text**` to `<strong>`, `*text*` to `<em>`, `\n` to `<br>`, links). Implement as `renderMarkdownLite()` + sanitize with DOMPurify (already in project deps).
- **Option 2 (proper):** Use `marked` or `react-markdown` if already a dependency.

Check for existing markdown lib: `grep -r "marked\|react-markdown\|remark" package.json`

DOMPurify is already available — use it to sanitize any rendered HTML for XSS protection.

**5b. Style improvements**
- `gl-ms-description`: add proper typography (paragraph spacing, list styles, link colors)
- Ensure rendered `<strong>`, `<em>`, `<a>` elements inherit correct colors

**Files:**
- `frontend/src/pages/gnolove/GnoloveMilestone.tsx` — markdown rendering
- `frontend/src/pages/gnolove/gnolove.css` — description typography
- Possibly `frontend/src/lib/markdownLite.ts` (NEW — lightweight parser)

---

## Workstream 6: Mobile UX/UI Improvements

### Current State
- 3 breakpoints: `768px`, `640px` (no `480px` for small phones)
- Team hub has responsive rules at 768px
- No mobile-specific optimizations below 640px

### Audit & Fix List

**6a. Team hub (375px-480px)**
- Metrics grid: 5 cells in a row -> stack to 2x2+1 at 480px, single column at 375px
- Period selector pills: add `overflow-x: auto` + scroll snap for horizontal scroll
- Active repos: percentage badges may clip -> stack vertically on narrow screens
- Focus area pills: add `flex-wrap: wrap`

**6b. Home page (375px-480px)**
- Leaderboard table: hide low-priority columns (commits, issues) on mobile, keep name+score+PRs
- Team compact cards: single column below 480px
- Stats row: wrap to 2x2 grid

**6c. Analytics page (375px-640px)**
- Cohort retention heatmap: horizontal scroll wrapper
- Team collab matrix: horizontal scroll wrapper
- Chart legends: stack below chart instead of beside it

**6d. Report page (375px-640px)**
- Filter row: 4 dropdowns -> stack vertically on mobile
- Export buttons: collapse into a menu or wrap
- PR table: card layout on mobile instead of table rows

**6e. AI Reports page (375px-768px)**
- Report cards: ensure long project names don't overflow
- Toggle buttons (short/long): full-width on mobile

**6f. Global mobile touches**
- Minimum 44x44px touch targets on all interactive elements
- Body text >= 14px on mobile (check 12px metro labels)
- Test safe area insets for bottom nav bars (iOS)

### Testing
Chrome DevTools: iPhone SE (375px), iPhone 14 (390px), iPhone 14 Pro Max (430px), iPad Mini (768px).

**Files:**
- `frontend/src/pages/gnolove/gnolove.css` — add `@media (max-width: 480px)` blocks
- Component files only if structural changes needed (e.g., responsive column hiding)

---

## Workstream 7: Additional UX/UI Optimizations

### Issues found during product audit

**7a. `HubBackendDownBanner` cardErrorCount threshold is dead code**

`cardErrorCount >= 3` can never trigger (only 2 queries counted). Change to `>= 2` as a defense-in-depth measure, or remove the path entirely now that the health probe works.

**7b. Orphaned CSS classes — add missing definitions**

3 classes used in JSX but missing from CSS (not breaking, but unstyled):
- `gl-thub-chip-sync` (used in TeamHubHeader + GnoloveTeams) — add sync-specific colors (green for recent, yellow for stale)
- `gl-thub-activity-repo` — add subtle styling to distinguish from title
- `gl-thub-activity-when` — add muted color for relative timestamps

**7c. Empty state consistency**

Some cards show "No data for this period" while others show "Not enough signal" — unify the empty-state copy across all team hub cards for consistency.

**7d. Contributor profile page — orphaned CSS classes**

The code review found ~11 orphaned classes in `GnoloveContributorProfile.tsx`. Most inherit parent styles but some (like `gl-profile-badge`, `gl-repo-card-*`) may have been planned but never styled. Audit and either add styles or remove dead class references.

**7e. Loading skeleton consistency**

Some cards use 4-row skeletons, some use 5, some use 2. Standardize: 3 rows for small cards, 5 for lists.

**Files:**
- `frontend/src/pages/gnolove/gnolove.css`
- `frontend/src/components/gnolove/teams/HubBackendDownBanner.tsx`
- Various component files for copy consistency

---

## Workstream 8: General UX sweep (catch-all)

Things to check and fix during implementation if spotted:

- **Accessibility:** Verify all interactive elements have proper `aria-label` and keyboard navigation
- **Dark/light theme:** Check that chart colors and badges work in both themes
- **Performance:** Check if any page has unnecessary re-renders (React Profiler)
- **SEO:** Verify all pages have proper `PageMeta` with title/description
- **Error states:** Make sure all error boundaries render helpful retry UI (not blank white space)
- **Shareable URLs:** Verify all filter states roundtrip through URL correctly

---

## Execution Order (Recommended)

| Phase | Workstream | Effort | Risk | Branch |
|-------|-----------|--------|------|--------|
| 1 | Focus Areas rework (#2) | 1-2h | Low | PR A |
| 2 | Repo priority & badges (#1) | 1-2h | Low | PR A |
| 3 | Team Report card (#3) | 2h | Low | PR A |
| 4 | Flexible weekly period (#4) | 2h | Low | PR B |
| 5 | Milestone markdown (#5) | 30min | Low | PR B |
| 6 | Mobile UX pass (#6) | 2-3h | Low | PR C |
| 7 | UX polish (#7 + #8) | 1h | Low | PR C |

**Total: ~10-12h across 3 PRs.**

Split into 3 PRs:
- **PR A** (functional): Focus Areas + Repo Priority + Team Report card
- **PR B** (features): Custom period filter + Milestone markdown
- **PR C** (polish): Mobile UX + UX optimizations

---

## Key Files Quick Reference

| Purpose | Path |
|---------|------|
| Focus area classifier | `frontend/src/lib/gnoloveFocusAreas.ts` |
| Focus area card | `frontend/src/components/gnolove/teams/TeamHubFocusAreasCard.tsx` |
| Team hub orchestrator | `frontend/src/components/gnolove/teams/TeamHub.tsx` |
| AI reports page | `frontend/src/pages/gnolove/GnoloveAIReports.tsx` |
| AI report card | `frontend/src/components/gnolove/AIReportCard.tsx` |
| Report page | `frontend/src/pages/gnolove/GnoloveReport.tsx` |
| Report URL state | `frontend/src/lib/gnoloveReportUrl.ts` |
| Milestone page | `frontend/src/pages/gnolove/GnoloveMilestone.tsx` |
| Home page | `frontend/src/pages/gnolove/GnoloveHome.tsx` |
| All CSS | `frontend/src/pages/gnolove/gnolove.css` |
| Backend topics config | gnolove repo: `server/config/topics.yaml` |
| Hooks barrel | `frontend/src/hooks/gnolove/index.ts` |
| Constants (TEAMS) | `frontend/src/lib/gnoloveConstants.ts` |
| Active repos card | `frontend/src/components/gnolove/teams/TeamHubActiveReposCard.tsx` |
| Backend down banner | `frontend/src/components/gnolove/teams/HubBackendDownBanner.tsx` |
| Contributor profile | `frontend/src/pages/gnolove/GnoloveContributorProfile.tsx` |
