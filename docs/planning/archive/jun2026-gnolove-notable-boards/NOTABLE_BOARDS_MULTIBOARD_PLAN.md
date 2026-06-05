# Notable-PRs → Multi-Board Viewer — Design & Implementation Plan

> **Status:** PROPOSAL — approved shape, pending spec review.
> **Date:** 2026-06-05
> **Owner:** Memba core (zxxma) · requested by David (Sam crew).
> **Repos touched:** `gnolove` (Go backend + sync) → `Memba` (React frontend).

## 0. Why

David, on the Notable-PRs page:

> *"it would be amazing to be able to change the board (so we can see this view for board of UX team, vm, …). This page (memba) can be adapted to other github project."*

He pointed at **gnolang project #38, view #25** (`a/ux`) as the kind of board he wants to see the same treatment applied to.

The page today is hardwired to a single board, **gnolang project #66 "Notable PRs by Area"**. This plan generalises it to a **board viewer with a selector**, driven by a backend-defined registry, so any GitHub Projects-v2 board can be added as a config entry.

## 1. The two boards are structurally different

This is the crux — it is **not** "swap the project number."

| | **#66 "Notable PRs by Area"** (today) | **#38 "🧙‍♂️Gno.land development"** (David's ask) |
|---|---|---|
| Size | ~dozen curated items | **730 items** (PRs *and* issues) |
| Area encoding | `Main Area` single-select field (UX/Blockchain/VM/Gnops/Gno.land) | **No area field.** Area = `a/*` **labels**; per-area "views" are saved filters (`a/ux`=view 25, `a/vm`=23, `a/gnops`=24, `a/blockchain`=22, `a/gnoland`=26) |
| Statuses | Todo / In progress / Done (3) | Triage / Backlog / Todo / In Progress / In Review / Done (6) |
| Content | PR-backed items only | PRs **+ issues** |

Consequences that shape the design:
- **Area** must be derived per-board: from a field (#66) *or* from `a/*` labels (#38).
- **Status order** must be per-board (3 vs 6 columns, different names).
- The page must render **issues**, not just PRs (#38 includes them; user chose to mirror everything).
- GitHub's GraphQL API does **not** expose a saved view's filter set usably, so we reconstruct "the a/ux view" from the `a/ux` label — which the existing area-filter UI already gives David for free once area is label-derived.

## 2. Decisions (locked)

1. **Config-driven board registry** in the backend (not hardcoded per-board UI). Adding a board = one registry entry.
2. **#38 mirrors everything** — all 730 items incl. issues, closed/merged. *(User pick. Cost mitigations in §6.)*
3. **#66 stays the default landing tab** so the curated review-queue remains the first thing users see; #38 is opt-in via the selector.
4. **Issues render in a PR-shaped UI**, degraded gracefully (no reviewers/diff for issues).

## 3. Backend changes — `gnolove/server`

### 3.1 Board registry — `server/sync/notable.go`
Replace the two constants (`notableProjectOwner`, `notableProjectNumber`, lines 12–15) with:

```go
type BoardConfig struct {
    ID         string   // stable slug: "notable", "gnoland-dev"
    Label      string   // "Notable PRs", "Gno.land development"
    Owner      string   // "gnolang"
    Number     int      // 66, 38
    AreaSource string   // "field" | "label"
    AreaField  string   // "Main Area" when AreaSource=="field"
    AreaLabels map[string]string // a/* label → canonical area, when AreaSource=="label"
    Statuses   []string // status column order for this board
    IncludeIssues bool  // #38 = true
}

var notableBoards = []BoardConfig{
    {ID: "notable", Label: "Notable PRs", Owner: "gnolang", Number: 66,
        AreaSource: "field", AreaField: "Main Area",
        Statuses: []string{"Todo", "In progress", "Done"}},
    {ID: "gnoland-dev", Label: "Gno.land development", Owner: "gnolang", Number: 38,
        AreaSource: "label",
        AreaLabels: map[string]string{"a/blockchain": "Blockchain", "a/vm": "VM",
            "a/gnops": "Gnops", "a/ux": "UX", "a/gnoland": "Gno.land"},
        Statuses: []string{"Triage", "Backlog", "Todo", "In Progress", "In Review", "Done"},
        IncludeIssues: true},
}
```
Optionally overridable via `NOTABLE_BOARDS_JSON` env (parsed at startup; falls back to the code default). Boards change rarely and the mapping is code-coupled, so code-default is the primary source.

### 3.2 Sync — `server/sync/notable.go` + `server/sync/sync.go`
- Rename `syncNotableBoard(ctx)` → `syncBoard(ctx, board BoardConfig)`.
- In `sync.go` (~line 98) loop the registry: `for _, b := range notableBoards { if err := s.syncBoard(ctx, b); err != nil { log... } }`. Keep best-effort (one board failing must not break others or the main sync).
- GraphQL query changes:
  - Keep `Status` single-select via `fieldValueByName`.
  - Keep `Main Area` field read, but only **use** it when `AreaSource=="field"`. When `AreaSource=="label"`, derive area = first label in `AreaLabels` present on the item (mapped to a canonical area name).
  - Add an `... on Issue` fragment alongside `... on PullRequest` and ingest issues when `board.IncludeIssues` (number, title, url, state OPEN/CLOSED, author, labels, assignees, createdAt/updatedAt; no reviews/additions).
  - Pass `login`/`number` from `board`.
- **Per-board prune**: scope the stale-delete to the board — `Where("board_id = ? AND synced_at < ?", board.ID, syncedAt)` — so syncing #66 never wipes #38's rows.
- **Page cap** (§6): bound pages per board (e.g. 20 → ~1000 items) and `log` a warning with the dropped count rather than truncating silently.

### 3.3 Model — `server/models/notable_pr.go`
- Add `BoardID string` with an index: `gorm:"index"`. `ItemID` stays the PK (ProjectV2Item node ids are globally unique across boards, so no composite-PK change).
- Add `ItemType string` (`"pr"` | `"issue"`) so the frontend can branch rendering.
- Update the doc comment (no longer #66-specific).

### 3.4 API — `server/main.go` + `server/handler/notable.go`
- **New** `GET /projects/boards` → registry metadata: `[{id, label, areas[], statuses[]}]`. Lets the frontend build the selector + per-board taxonomy with zero hardcoding.
- **Extend** `GET /projects/notable?board=<id>` → filter `WHERE board_id = ?`; default to `"notable"` (#66) when absent for back-compat. Keep `ORDER BY pr_updated_at DESC`.

### 3.5 Migration
GORM `AutoMigrate` adds the two columns. Existing #66 rows get `board_id = ""`; backfill on first sync (they're re-stamped with `board_id="notable"`). Add a one-line startup backfill `UPDATE notable_prs SET board_id='notable' WHERE board_id=''` to avoid a transient empty-board flash before the first sync completes.

## 4. Frontend changes — `Memba/frontend`

### 4.1 API + schema — `src/lib/gnoloveApi.ts`, `src/lib/gnoloveSchemas.ts`, `src/hooks/gnolove/index.ts`
- `getBoards()` → `GET /projects/boards`; `getNotablePRs(boardId)` → `GET /projects/notable?board=<id>`.
- `NotablePRSchema`: add `boardId`, `itemType` (`"pr" | "issue"`); make `status`/`mainArea` already-nullable (✓). Add a `BoardMetaSchema`.
- `useBoards()` + `useNotablePRs(boardId)` React-Query hooks.

### 4.2 Page — `src/pages/gnolove/GnoloveNotablePRs.tsx`
- **Board selector** (tabs) at top, fed by `useBoards()`; default to `"notable"`. Switching board refetches, resets filters, updates heading + the `PROJECT_URL` link (derive from board number).
- **Taxonomy from API**: `AREA_ORDER`/`AREA_COLOR`/`STATUS_ORDER` (lines 28–36) become per-board, sourced from board metadata; keep current #66 values as the fallback when the API is older.
- **Item type**: `PRRow`/`PRCard` branch on `itemType` — issues drop the reviewers stack + additions/deletions, show an issue glyph.
- **Quick win (folded in):** in the Kanban render (`STATUS_ORDER.map`, ~line 366), when `hideDone` is on, drop terminal columns (`Done`, and `isDone`-equivalent) so the actionable board has no dead empty column.
- **URL state**: add `?board=<id>` to the shareable URL (page already supports URL-state per v6.1.0).

## 5. Phased implementation

| Phase | Repo | Work | Done-when |
|---|---|---|---|
| **P1** | gnolove | Registry + `syncBoard` refactor (still #66 only behaviour) + model columns + `/projects/boards` + `?board=` | `go build`/`go vet` clean; #66 unchanged; new endpoint returns `[notable]` |
| **P2** | gnolove | Add #38 to registry: label-area derivation, issue fragment, per-board prune, page cap | #38 rows land with correct area/status/itemType; #66 untouched; prune scoped |
| **P3** | Memba | API client + schema + hooks + board selector + taxonomy-from-API + issue rendering + quick-win column drop + URL state | vitest green; **Playwright e2e green**; both boards render locally (route-mock) |
| **P4** | rollout | gnolove PR → review → admin-merge → **you** deploy → Memba PR → review → merge | both boards verified **on prod** (`memba.samourai.app`) |

Two PRs (gnolove, then Memba). gnolove **must be deployed before** Memba prod-verify (CORS allowlists only `memba.samourai.app` + `gnolove.world` — deploy-previews show empty). Backend deploy: **you** run `gh workflow run "Docker build and deploy Image V2" --ref main`. Branch + PR for each; `gh pr merge --admin` (1-review gate); strip any Claude attribution.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **#38 sync cost** — 730 items × per-PR review enrichment every 2h | Page cap + dropped-count log (§3.2); issues skip review sub-queries; best-effort so a slow/over-budget board can't break the main sync. Watch GraphQL rate budget after first prod sync. |
| **Page semantics** — "Notable PRs" now also shows a 730-item full board incl. issues | #66 stays default tab; #38 opt-in; per-board heading/labels make the active board explicit. |
| **`a/*` label → area mapping drift** | Mapping lives in the registry; an item with no `a/*` label → `Unassigned` (existing bucket). |
| **GraphQL `read:project` scope** | Already held (token has `project` scope). Best-effort: missing scope logs, doesn't break sync. |
| **Empty-board flash on first deploy** | Startup backfill of `board_id='notable'` (§3.5). |
| **e2e** | Add/extend a Playwright spec covering board switch + issue rendering; CI runs e2e (local vitest does not). |

## 7. Out of scope (YAGNI)
- Per-saved-view replication (GitHub API limitation; label-area filter covers David's need).
- Writing back to GitHub boards (read-only mirror, unchanged).
- Arbitrary user-supplied boards at runtime (registry is curated/code-owned).
