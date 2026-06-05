# Gnolove Feature — Improvements Plan (Proposal)

> **Status:** PROPOSAL — for review before any code. (Short improvements session, paused from the test-13 migration.)
> **Date:** 2026-06-04
> **Owner:** Memba core (zxxma)
> **Scope:** the gnolove feature inside Memba (`memba.samourai.app/<net>/gnolove`), plus two items that live in the **separate `samouraiworld/gnolove` backend repo**.

This is one consolidated doc: requirements → investigated reality (incl. premise corrections) → per-item implementation spec → sequencing/risks/tests → CTO + full-stack review (§8).

---

## 1. Requested changes (verbatim intent)

1. **Monitor** the gnolang GitHub Project board *"Notable PRs"* (https://github.com/orgs/gnolang/projects/66/views/1) inside gnolove.
2. **Add `gnoverse/community-scripts`** to the repositories tracked for scores.
3. **Home** (`/gnolove`) should default to **"This month"** instead of "All Time".
4. **Teams** (`/gnolove/teams`) should order teams by **score under the default (This month) filter** — e.g. Samouraï World should currently be ~2nd.
5. **Report** (`/gnolove/report`) should default to **"This month"** instead of "All time".
6. Investigate other low-risk optimisations/improvements.

> **Cautious-engineering note:** investigation found the codebase **does not match three of the premises**. Corrections are in §2 and each affected item. Net effect: the work is *smaller and safer* than the requests imply for some items, and *larger / cross-repo* for others. None of this changes the user-visible goals — it changes where/how we implement them.

---

## 2. Investigated reality — premise corrections (READ FIRST)

| # | Premise | Reality (verified) | Consequence |
|---|---|---|---|
| 3 | Home defaults to "All Time" | **TRUE** — `gnoloveHomeUrl.ts:38` `DEFAULT_HOME_STATE.time = TimeFilter.ALL_TIME`. | Change as requested. |
| 4 | Teams page filter is "All Time" | **FALSE** — Teams already defaults to **monthly** (`gnolovePeriod.ts:24` `DEFAULT_TEAM_HUB_PERIOD = "monthly"`). | The Teams ask is really about **ordering**, not the filter default. The teams **index list is not sorted at all** today (`GnoloveTeams.tsx:43` renders raw roster order). |
| 5 | Report defaults to "All time" | **FALSE** — Report defaults to **weekly** (`gnoloveReportUrl.ts:366` `period: "weekly"`). | We'll still change it to **monthly** per the stated intent ("This month by default"); just note it's weekly→monthly, not all→monthly. |
| 2 | Add a tracked repo (a gnolove change) | **TRUE, but not in Memba** — tracked repos = `GITHUB_REPOSITORIES` env var in the **`samouraiworld/gnolove` server** (`server/.env.example:9`). | Ops/env change on the gnolove VPS (Lours), **zero effect from any Memba-only edit**. |
| 1 | Monitor Project #66 in gnolove | **Feasible only via the gnolove backend** — Projects v2 is org-level **GraphQL-only**; the Memba frontend's gnolove calls are unauthenticated. Needs a token with `read:project`. | Cross-repo: gnolove backend (query+route) + Memba frontend (page). Largest, most external-dependent item. |

**Architecture reminder:** the gnolove feature in Memba is a **frontend-only consumer** of the gnolove Go backend (`backend.gnolove.world`, source `samouraiworld/gnolove/server`). Memba's own `backend/` is the quests/marketplace backend and is unrelated to gnolove scores/PRs. So items 1 & 2 are **gnolove-repo work**; items 3, 4, 5 are **Memba-frontend work**.

**Shareable-URL invariant (do not break):** each page encodes its period in the URL and **omits the default value** so clean URLs stay clean (Memba's shareable-URL feature, PR #336). When we change a default, we must also flip the "which value is omitted" serializer guard, or every shared link silently changes meaning. This is the #1 correctness trap in items 3 & 5.

---

## 3. Per-item implementation spec

### Item 3 — Home default → "This Month"  ·  effort: S  ·  risk: LOW  ·  repo: Memba
Single page system, no shared state (`TimeFilter` is used only by Home + `getContributors`; Teams/Report have their own enums — no cross-impact).

Changes in `frontend/src/lib/gnoloveHomeUrl.ts`:
- `:38` `DEFAULT_HOME_STATE.time` → `TimeFilter.MONTHLY`
- `:65` `.catch(TimeFilter.ALL_TIME)` → `.catch(TimeFilter.MONTHLY)` (garbage-value fallback)
- `:73` parse fallback `timeRaw ?? TimeFilter.ALL_TIME` → `?? TimeFilter.MONTHLY`
- `:124` serializer elision `if (s.time !== TimeFilter.ALL_TIME)` → `!== TimeFilter.MONTHLY` (so monthly is now the omitted default and `?time=all` becomes explicit)

Tests (corrected by review): the genuinely breaking ones are `gnoloveHomeUrl.test.ts:40-43` (garbage→ALL_TIME fallback) and `:98-100` (MONTHLY emits). **`:95` does NOT break** (`serialize(DEFAULT)` stays `""`) and `:32` stays green. **Add a new test** asserting `?time=all` now serializes explicitly.
Data flow unaffected: `getContributors` already sends `?time=monthly` and omits only on `ALL_TIME` (`gnoloveApi.ts:124`); queryKey includes `timeFilter` so no cache collision.
Cross-impact note (corrected): `TimeFilter` is **also** used by the Analytics page, but Analytics has its **own** independent default literal (`GnoloveAnalytics.tsx:53`), so changing `DEFAULT_HOME_STATE` does not affect it. (The earlier "used only by Home" reason was wrong; the no-cross-impact conclusion still holds.)

### Item 5 — Report default → "This Month"  ·  effort: S  ·  risk: LOW-MED  ·  repo: Memba
Report is **date-range based** (`period` + `at` key), not a single bucket. Changes in `frontend/src/lib/gnoloveReportUrl.ts`:
- `:366` `DEFAULT_REPORT_STATE.period` → `"monthly"`
- `:214` `.catch("weekly")` → `.catch("monthly")`
- `:230` parse fallback `periodRaw ?? "weekly"` → `?? "monthly"`
- `:318` serializer elision `if (urlPeriod !== "weekly")` → `!== "monthly"`
- Confirm `defaultKey("monthly")` (`:180-188`) returns the intended landing key (current `YYYY-MM`).

Tests (corrected by review): the default-dependent breakers are `useReportUrlState.test.tsx:67` and `gnoloveReportUrl.test.ts:222-226`. **`:131-163` do NOT break** — they pass explicit period args to `rangeFromKey`/`defaultKey` and are default-independent (the earlier "weekly-start" caution was misdirected). Verified: `defaultKey("monthly")` = current `YYYY-MM`; `rangeFromKey("monthly", null)` → calendar month-to-date (`:139-143`), so arriving with `period=monthly` and no `at` works with no edge case.

### Item 4 — Teams ordering by "This month" score  ·  effort: M  ·  risk: MEDIUM  ·  repo: Memba
This is the only item that is an **architectural change**, because the Teams **index** page (`GnoloveTeams.tsx`) is intentionally **metric-free** — it never fetches contributor stats and renders teams in raw roster order (`:43`).

Reality of scoring: there is **no per-team score from the backend**; a team's score is the **sum of member scores** from `/stats`, which **already honors the time filter** (`?time=monthly` = rolling 30-day, the same window the team-hub "Last month" uses — so index order will be coherent with the hub pages).

> ⚠️ **Correction from review (the key defect):** the two existing helpers are **NOT identical** — consolidating them mechanically would introduce a bug (exactly what's forbidden):
> - `gnoloveAnalytics.ts:99,110` — matches member login **case-SENSITIVELY** and filters `score > 0`.
> - `GnoloveHome.tsx:101,108` — matches **case-INSENSITIVELY** (`toLowerCase`) and filters `memberCount > 0`.
> - They also iterate the **build-time `TEAMS` constant**, whereas the Teams **index** renders the **live roster** `useGnoloveTeams().teams` (backed by `config/teams.yaml`). A backend-added team would score zero/unsorted if we scored over the constant.

Plan (revised):
1. **Consolidate into one helper `computeTeamScores(contributors, teams, opts)`** with **explicit options** — `caseInsensitive` (use **true**; it's the correct behavior) and `keepZeroScore`. Migrate Home/Analytics to it and **pin Home's current rendered order with a test** before/after (case-sensitivity or filter divergence could otherwise silently shift Home's team list). This is Item 6a, and it is a prerequisite, not a nicety.
2. In `GnoloveTeams.tsx`: add `useGnoloveContributors(TimeFilter.MONTHLY, …)` + `TimeFilter` imports, and score over **`useGnoloveTeams().teams`** (the live roster — it carries `members/slug/color`), **not** the `TEAMS` constant. Render **active teams sorted by score desc, then inactive (score 0) teams in curated roster order** (`keepZeroScore: true` — the index must stay a complete directory).
3. **Fallback:** while contributors are loading or on error (`useGnoloveContributors` `isLoading`/`isError`), render the live curated roster order — never blank the page. Subtle loading affordance consistent with other gnolove pages.

Naming note: the team is `"Samourai.world"` (slug `samouraiworld`) in `config/teams.yaml`, not "Samouraï World" — match on slug, not display string. The exact "~2nd" rank depends on live data (coherent with the hub's monthly window; not statically verifiable).

Decisions to confirm with the requester (S-1, S-2 in §8): (a) ordering fixed to **monthly** (matching the request) — not a new on-page period selector; (b) inactive teams sit at the bottom in curated order.

### Item 2 — Add `gnoverse/community-scripts` to tracked repos  ·  effort: XS code / ops  ·  risk: LOW-MED  ·  repo: gnolove (VPS env)
- Append exactly **`gnoverse/community-scripts/main`** to **`GITHUB_REPOSITORIES`**. Branch **confirmed `main`** (review checked `gnoverse/community-scripts` default HEAD = `main`; our local clone sitting on `feat/audit-security-app-bugs` is a red herring — that's LOurs' audit branch, not the tracked one). Format is per-entry `owner/name/branch`, space/comma/newline-separated (`server/models/repository.go:28-60`; documented `.env.example:9`).
- ⚠️ **Pre-flight (review):** `ParseRepositoriesConfig` (`repository.go:46-47`) **rejects the entire list** if any entry isn't 3 slash-parts — a malformed/wrong-branch addition would **silently zero out ALL tracking** on the next deploy. Validate the full env string before applying on the VPS.
- It's a **global** tracked set: adding it folds community-scripts contributions into **every** contributor/team score, ecosystem-wide (intended — it boosts Samouraï-crew contributors). Once added + re-synced, `/repositories` and `/stats` include it automatically; **no Memba frontend change**.
- **Ownership:** gnolove deploy is manual `workflow_dispatch`, env on VPS, **Lours has SSH** (per project memory). This item is an ops change coordinated with Lours, plus a 1-line `.env.example` doc update PR for discoverability.

### Item 1 — "Notable PRs" board (gnolang Project #66) monitor  ·  effort: L  ·  risk: MED-HIGH  ·  repo: gnolove backend + Memba frontend
**Cannot be frontend-only.** Projects v2 boards are org-level GraphQL-only; the Memba frontend gnolove calls carry no token. The gnolove backend already has everything needed: `githubv4` GraphQL client + `GITHUB_API_TOKEN` (`server/sync/sync.go`), exponential backoff (`sync/backoff.go`), cron/ticker sync, GORM persistence, and the REST→React-Query→Zod pipeline.

**Gating dependency (confirm BEFORE building):** the existing `GITHUB_API_TOKEN` must carry **`read:project`** (classic PAT) or **Projects: Read** (fine-grained), and — if Project #66 is org-private — the token's account must be a gnolang org member with project visibility. If #66 is public, a token is still required (GraphQL v4 rejects anonymous). **Action: verify scope/visibility first; this is the single blocker.**

Proposed shape (phased):
- **gnolove backend:** add a `projectV2(number: 66)` items query in `server/sync/` (new `syncNotableProjectBoard` slotted into the existing 2h sync loop), a new GORM model, and a REST route (e.g. `GET /projects/notable`) wired in `server/main.go`.
- **Memba frontend:** `getNotablePRs()` in `gnoloveApi.ts` + Zod schema in `gnoloveSchemas.ts` + a hook in `hooks/gnolove/index.ts` + a lazy `GnoloveNotablePRs` page + a `GnoloveSubNav.tsx:20-27` nav entry + an `App.tsx:220-229` route. Reuse the `TeamHub*Card` / `GnoloveReport` column styling (the existing PR-bucket UI is the closest analog).
- **Lean v1 option (recommended to de-risk):** if the token scope can't be confirmed quickly, ship a **read-only "Notable PRs" panel** that surfaces the board's items (title, author, review state, url, labels) via the backend route, no write-back, no polling beyond the 2h sync. A full Kanban mirror can follow. (Even leaner stop-gap: a deep-link card to project #66 — but that doesn't satisfy "monitor", so prefer the backend route.)

---

## 4. Item 6 — Other investigated improvements (optional, low-risk)

- **6a — De-duplicate team-score logic (DRY).** `computeTeamData` (gnoloveAnalytics.ts) and Home's `teamStats` memo are two copies of the same sum-and-sort. Consolidating (required anyway for Item 4) removes drift risk. **Recommend: do it, as the substrate for Item 4.**
- **6b — Zero-score team handling.** `computeTeamData` filters `score>0`; any reuse must consciously decide to show/hide inactive teams (Item 4 keeps them). Worth a shared, explicit option rather than an implicit filter. **Recommend: include in 6a.**
- **6c — (investigate only) Report period-switch UX.** Changing the default to monthly means the landing `at` key is `YYYY-MM`; confirm the period switcher and custom-range picker behave when arriving with no `at`. **Recommend: cover in Item 5 tests, no separate work.**
- **6d — (defer) On-page period selector for the Teams index.** Out of scope now; ordering is fixed to monthly. Note as a future enhancement only.

No other changes proposed — keeping the blast radius minimal per the "no new bugs, be cautious" directive.

---

## 5. Sequencing

**This session (small, cautious):**
1. **Quick wins (Memba, independent, low risk):** Item 3 (Home) + Item 5 (Report) + their tests. One combined "gnolove default period → monthly" PR.
2. **Item 6a consolidation** (case-insensitive `computeTeamScores` + Home-order pin test) → then **Item 4 (Teams ordering)** — separate PR; needs the §8 S-1/S-2 confirmations.
3. **Item 2 (tracked repo)** — a 1-line `.env.example` doc PR in gnolove + coordinate the VPS env change with **Lours** (validate the full env string first); re-sync; verify community-scripts appears in `/repositories`.

**Split OUT into its own follow-up spike (review recommendation — too big/cross-repo for a "short, no-new-bugs" session):**
4. **Item 1 (Notable PRs board).** Start with the **gating check**: confirm the gnolove `GITHUB_API_TOKEN` carries `read:project` and that Project #66 is visible to it. Then gnolove backend PR (projectV2 query + GORM model + REST route) → Memba frontend PR (schema + hook + lazy page + nav/route). Consider the lean-v1 read-only panel. **Not part of this session's deliverable.**

Items 1–3 (and 2) are independent; Item 4 depends on 6a. Nothing here touches the test-13 migration work.

---

## 6. Risks & mitigations

| Risk | Item | Mitigation |
|---|---|---|
| Shared-link meaning changes when default flips (serializer elision) | 3, 5 | Flip the elision guard in lockstep; add a test asserting `serialize(DEFAULT)===""` and that the old default is now explicit in the URL. |
| Teams page gains a network dependency → loading fl/failure regressions | 4 | Curated-order fallback on loading/error; never blank the directory; keep zero-score teams visible. |
| Hiding inactive teams (computeTeamData `score>0` filter) | 4, 6a | Explicit show-inactive option; merge sorted-active + curated-inactive. |
| Global score inflation from a new tracked repo | 2 | Expected/intended; communicate to team; it affects all leaderboards, not just Samouraï. |
| **Malformed `GITHUB_REPOSITORIES` entry zeroes ALL tracking** | 2 | `ParseRepositoriesConfig` rejects the whole list on any non-3-part entry; validate the full env string + use `gnoverse/community-scripts/main` before deploy. |
| **Item-4 helper consolidation introduces a silent bug** | 4, 6a | The two source helpers differ (case-sensitivity + filter predicate); use case-insensitive + explicit `keepZeroScore`, score over the **live roster**, and pin Home's rendered order with a before/after test. |
| Project #66 token scope/visibility unknown | 1 | Verify `read:project` + org visibility FIRST; lean v1 if blocked. |
| Cross-repo coordination (gnolove VPS, Lours) | 1, 2 | Explicit ownership + small doc PRs; don't expect Memba-only edits to take effect. |
| Test breakage from default changes | 3, 5 | Enumerated the exact failing tests (§3); update in the same PR. |

## 7. Test plan

- **Unit:** update + extend `gnoloveHomeUrl.test.ts`, `gnoloveReportUrl.test.ts`, `useReportUrlState.test.tsx` for the new monthly defaults + URL elision. New test for the consolidated `computeTeamScores` (sorting, zero-score retention).
- **Component:** `GnoloveTeams` renders sorted-by-monthly-score with curated fallback (mock `useGnoloveContributors`); asserts Samouraï World position given representative data.
- **E2E (existing fixtures mock `useNetworkKey:"test12"`):** verify Home/Report land on monthly; verify the teams order. Update any e2e asserting the old defaults.
- **Manual:** load each page with a clean URL (default omitted) and with an explicit `?time=all` / `?period=weekly` (back-compat); confirm shared links still resolve.

---

## 8. CTO + full-stack expert review

Two independent skeptical lenses (CTO: scope/sequencing/risk/proportionality · full-stack: file:line + mechanics) verified the plan against the real code. **Verdict: APPROVABLE after the edits below — not as-is.** Every line-number citation was confirmed exact; the premise corrections (§2) all checked out against source. The defects were concentrated in Item 4 and a few test-line imprecisions; all are now folded into the body above.

### Confirmed accurate (survived both lenses)
Items 3 & 5 mechanics and line numbers (38/65/73/124; 214/230/318/366) · the serializer-elision trap is real and handled · `defaultKey("monthly")`/`rangeFromKey(...,null)` work with no `at` · §2 premise corrections (Teams already monthly; Report is weekly; tracked-repo = `GITHUB_REPOSITORIES`; Project #66 needs `read:project`) · Item 1 backend feasibility + exact slot-in points (`sync.go` 2h loop, chi router `main.go:192`, `GnoloveSubNav.tsx:20-27`, nested `App.tsx:221-227`) · `/stats` carries per-member score sufficient for client-side team sums.

### Applied corrections

| ID | Sev | Finding | Applied |
|---|---|---|---|
| R1 | **HIGH** | Item 4 helpers **not identical** — `computeTeamData` case-sensitive + `score>0` vs `teamStats` case-insensitive + `memberCount>0`. "Keep behavior identical" was wrong & bug-prone. | §3 Item 4 rewritten: explicit `caseInsensitive`+`keepZeroScore` opts, use case-insensitive, **pin Home order with a test**. §6 risk added. |
| R2 | **MED** | Item 4 scores must iterate the **live roster** `useGnoloveTeams().teams`, not the build-time `TEAMS` constant (else backend-added teams render zero). | §3 Item 4 corrected; fallback uses live roster. |
| R3 | **MED** | Item 1 too big/cross-repo for a "short, no-new-bugs" session. | §5 splits Item 1 into its own follow-up spike, gated on the token-scope check. |
| R4 | LOW | Item 3 test list: `:95` does **not** break; real breakers `:40-43`, `:98-100`; add explicit-`?time=all` test. | §3 Item 3 corrected. |
| R5 | LOW | Item 3 reason wrong — `TimeFilter` also used by Analytics (but independent default → conclusion holds). | §3 Item 3 corrected. |
| R6 | LOW | Item 5 test list: `:131-163` are explicit-arg tests, won't break; real breakers `useReportUrlState.test.tsx:67`, `gnoloveReportUrl.test.ts:222-226`. | §3 Item 5 corrected. |
| R7 | LOW | Item 2: branch is **`main`**; malformed entry rejects the **whole** `GITHUB_REPOSITORIES` list. | §3 Item 2 + §6 risk added. |
| R8 | LOW | Team name is `"Samourai.world"` (slug `samouraiworld`) — match on slug. | §3 Item 4 note. |

### Open confirmations needed from you (before coding Item 4)
- **S-1:** Teams index ordering fixed to **monthly** (not a new on-page period selector) — confirm.
- **S-2:** Inactive (zero-score) teams listed at the **bottom in curated order** (kept visible, not hidden) — confirm.
- **S-3:** Item 1 — OK to **defer** to its own spike (and who confirms the `read:project` token scope / Project #66 visibility)?

### Recommended session scope (post-review)
Ship now: **Item 3 + Item 5** (one PR), **6a + Item 4** (one PR, after S-1/S-2), **Item 2** (gnolove doc PR + Lours VPS env). **Defer Item 1** to a scoped spike. This keeps the session small, reversible, and free of the cross-repo/token risk — matching the "cautious, no breaking changes" directive.
