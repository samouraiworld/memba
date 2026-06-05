# Notable PRs — UX/UX Redesign Proposal

> **Status:** PROPOSAL — for review before coding.
> **Date:** 2026-06-05
> **Current state:** shipped + deployed as a *simple grouped list* (groups by Status; shows title, repo#, author, one review badge). Functional but undersells the data.
> **Goal:** a smooth, professional experience (Linear / GitHub-Projects quality) that helps **area leaders find important PRs and reviewers help where they're needed.**

---

## 1. What the board actually exposes (verified live against #66)

The project is literally titled **"Notable PRs by Area"** and carries two strong categorical dimensions plus rich per-PR metadata. I currently fetch only `Status`.

**Board fields:**
- **Main Area** (single-select): `UX · Blockchain · VM · Gnops · Gno.land` ← the board's primary organizing dimension
- **Status** (single-select): `Todo · In progress · Done`
- Assignees · Labels · Reviewers · Milestone · Repository · Created/Updated/Closed

**Per-PR (GitHub) — all available, none currently shown:**
| Field | Example | Why it matters |
|---|---|---|
| author + avatar | `aeddi` ◍ | identity at a glance |
| **requested reviewers** | `jaekwon ⧗` | **the "who should help review" signal** |
| **review verdicts** | `moul ✅`, `jeronimoalbi ✅`, `notJoon 🟡` | review progress / blockers |
| reviewDecision | `REVIEW_REQUIRED / CHANGES_REQUESTED / APPROVED` | one-glance state |
| labels (name + color) | `tendermint`, `devops`, `package/realm` | topic/area tags |
| size (+adds / −dels) | `+6343 −68` | effort/risk weight |
| state / isDraft | `OPEN / MERGED / DRAFT` | lifecycle |
| createdAt / updatedAt | `2d ago` | freshness/staleness |

**Implication:** the redesign is **data-bound to a backend enrichment** — we extend the `#228` sync/model/schema to also fetch Main Area, requested reviewers, review verdicts, labels, and size. That's one additive backend change + a redeploy (which I can now do end-to-end myself).

---

## 2. Design principles (purpose-driven)

1. **Surface the ask, not just the PR.** The #1 job is "needs review / needs help" — so review state + *who's requested* should be visually prominent, not buried.
2. **Organize by Area** (matches the board's own model) so each area leader sees their domain instantly.
3. **Dense but calm** (Linear's hallmark): high information density, generous type hierarchy, restrained color used only for state.
4. **Cohesive** with the existing gnolove design system (reuse `gl-tabs`, `gl-filter-btn`, state-color tokens, JetBrains Mono for numbers).
5. **Fast filters**, no page reloads: Area chips · Status · a **"Needs review"** quick-filter · **Hide done**.
6. **Mobile-graceful** (rows reflow; board view becomes horizontally scrollable or collapses to list).

---

## 3. Three layout options

### Option A — **Kanban board** (GitHub Projects / Trello style)
Columns = **Status**; cards grouped in columns; filter by Area.
```
Notable PRs                         [≣ List]  [▣ Board]      Area: ◉All  UX  Blockchain  VM  Gnops  Gno.land
──────────────────────────────────────────────────────────────────────────────────────────────────
  TODO · 17                  IN PROGRESS · 0            DONE · 14
 ┌───────────────────────┐  ┌──────────────────────┐  ┌───────────────────────┐
 │ 🔴 test-13 hardfork RC │  │                      │  │ ✅ IBC crypto stdlibs  │
 │ gno #5653 · Gnops      │  │   (empty)            │  │ gno #5725 · Gnops      │
 │ ◍ aeddi      +6.3k −68 │  │                      │  │ ◍ moul        merged   │
 │ ⧗ review: jaekwon      │  │                      │  │ ✓ notJoon              │
 │ ◌ tendermint · devops  │  │                      │  │                        │
 └───────────────────────┘  └──────────────────────┘  └───────────────────────┘
 ┌───────────────────────┐
 │ 🟡 grc721 ledger split │ ...
```
**Pros:** familiar, 1:1 mirror of board #66, visual. **Cons:** only 3 status columns (likely Todo-heavy, In-progress often empty → unbalanced); horizontal scroll on mobile; "Done" column is noise for the review-help goal.

### Option B — **Linear-style grouped list** (RECOMMENDED) — group by Area, review-need first
A dense, scannable list grouped by **Main Area** (collapsible), each row foregrounding review state + reviewers.
```
Notable PRs            Group: [ Area ▾ ]   ◉ Needs review   ☐ Hide done            [ ≣ List · ▣ Board ]
──────────────────────────────────────────────────────────────────────────────────────────────────
▾  Gnops · 8
   🔴  feat: test-13 hardfork release candidate          gno #5653    review needed
       ◍ aeddi    ⧗ jaekwon                  +6343 −68    ◌ tendermint · devops      · 2d
   🟡  refactor(grc721): token ledger split              gno #5728    changes requested
       ◍ jinoosss ⧗ davd-gzl, aeddi   ✓ jeronimoalbi     +2797 −1380  ◌ package/realm    · 5h
▾  VM · 6
   ✅  feat(interrealm)! Phase 3 captured realm caps      gno #5669    approved · merged
       ◍ jaekwon   ✓ moul                    +25k −11k    ◌ gnovm · docs            · 1d
▸  Blockchain · 4        ▸  UX · 7        ▸  Gno.land · 6     (collapsed)
```
- **Group-by switch:** Area · Status · Repository (segmented, reuses `gl-tabs`).
- **Left status glyph** encodes review state (🔴 review-needed · 🟡 changes-requested · ✅ approved · ⚪ draft · ✓ merged).
- **Reviewers line** is first-class: `⧗ requested` vs `✓ reviewed`.
- Right rail: size (mono), top labels, relative time.
**Pros:** matches "by Area" intent; best for the review-help job; dense + professional; mobile rows reflow cleanly; scales to 31→100s. **Cons:** less "visual kanban" (mitigated by the Board toggle).

### Option C — **Enriched card grid** (by-Area sections)
Responsive card grid (`repeat(auto-fill, minmax(280px,1fr))`), grouped under Area headers; each card a richer version of today's panel (avatar, labels, reviewers, size bar).
**Pros:** visually lighter, good on wide screens, low build risk (evolves current cards). **Cons:** lower density; weaker for scanning many PRs; reviewers/size compete for card space.

---

## 4. Recommendation

**Option B (Linear-style grouped list, default group-by Area) — with a Board view toggle (Option A) as the secondary view.**

Rationale: it's the most *professional and purposeful* — it answers "what in my area needs review, and who should do it" in one glance, mirrors the board's own "by Area" model, stays dense yet calm, and reuses our design system. The Board toggle keeps the familiar kanban for those who want it (and 1:1 parity with GitHub #66), without making the unbalanced 3-status columns the default.

**Default view:** List · group-by **Area** · **Needs-review** quick-filter ON · **Hide done** ON (the page becomes an actionable review-queue, not a board mirror). Toggles let you see everything / switch to Board.

---

## 5. Scope & phasing

**Backend (#228 enrichment) — I deploy it myself:**
- Extend the GraphQL query + `NotablePR` model + JSON to include: `mainArea`, `requestedReviewers[]`, `reviews[]{login,state}`, `labels[]{name,color}`, `additions`, `deletions`, `assignees[]`, `createdAt`.
- Migration is additive (new columns). Redeploy via the workflow (~2 min) — verified I can do this.

**Frontend (new page):**
- Phase 1 — **Option B list** (group-by Area/Status/Repo, filters, rich rows, review-need glyphs, reviewer line, labels, size). Replaces the current simple list.
- Phase 2 — **Board view toggle** (Option A kanban) sharing the same data + filters.
- Reuse `gl-tabs`, `gl-filter-btn`, state-color tokens; add a small `gl-notable-*` stylesheet block.

**Effort (rough):** backend enrichment ~0.5 d · Phase 1 list ~1–1.5 d · Phase 2 board ~0.5–1 d. Tests + e2e throughout.

**Non-goals:** write-back to the board (read-only mirror stays); auth changes (none).

---

## 6. Decisions — CONFIRMED 2026-06-05

1. **Direction:** ✅ **Option B — Linear-style grouped list (group-by Area) + Board/Kanban view toggle.**
2. **Default:** ✅ **Actionable review-queue** — `Needs review` ON + `Hide done` ON on load; toggles reveal everything / Done / Board.
3. **Build:** ✅ **List + Board together** (one cohesive PR), on top of the backend enrichment.

**Execution order:** (1) backend enrichment on gnolove `#228`-area code (add Main Area, reviewers, review verdicts, labels, size, createdAt, assignees) → redeploy (self-serve). (2) Memba frontend: schema + rebuilt page (List default-review-queue + Board toggle, group-by Area/Status/Repo, filters) + CSS + tests.
