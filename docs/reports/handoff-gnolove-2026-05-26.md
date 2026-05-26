# Handoff — Gnolove UX Polish (2026-05-25 / 2026-05-26)

> **Session dates:** 2026-05-25 evening through 2026-05-26
> **Use:** Reference for next session continuity.

---

## What shipped

### PR #357 (merged) — Focus areas rework, repo badges, team report card, custom dates, mobile UX

| Workstream | Summary |
|---|---|
| Focus areas rework | Kill "Other" bucket, add 4 new topics (consensus, realms, frontend, testing), conventional-commit prefix matching, TOP_N raised to 6 |
| Repo priority + badges | `gnolang/gno` always sorted first with blue "core" badge across all views |
| Team report card | New card on team pages: merged/in-progress/waiting/blocked counts + top-3 PRs |
| Custom date range | "Custom" period on report page with from/to date pickers, URL-state roundtrips |
| Milestone markdown | Render milestone descriptions with `renderMarkdown` (XSS-safe) |
| Mobile UX | New 480px breakpoint, stacked layouts, touch-friendly sizing |
| Polish | Backend-down banner threshold lowered to 2, focus card skeleton updated to 6 pills |

CI fix commits:
- Split `RepoBadge.tsx` utilities into `lib/gnoloveRepo.ts` (react-refresh lint)
- Add missing `"custom"` case to all `ReportPeriod` switches (TS strict mode)

### PR #358 (open) — Roster popover, team ordering fix, description update

| Change | Detail |
|---|---|
| Roster popover | Click "Roster" metric on team pages to see member list with GitHub profile links |
| Team ordering | Case-insensitive login matching fixes mis-rankings on Overview page |
| Samouraiworld description | Updated to reflect 4-year contributor history |
| Mobile roster | Popover adapts to full-width on 480px screens |

### gnolove#224 (open) — Backend config updates

| Change | Detail |
|---|---|
| Samouraiworld description | Synced with frontend |
| `onbloc/gno-ibc` | Added to `.env.example` (VPS env needs manual update) |
| Topics sync | 4 new topics + conventional-commit patterns synced with frontend classifier |

## Pending actions

| Item | Status | Owner |
|---|---|---|
| **Merge memba#358** | Awaiting CI + review | zxxma |
| **Merge gnolove#224** | Awaiting review | zxxma |
| **VPS env update** | Add `onbloc/gno-ibc/main` to `GITHUB_REPOSITORIES` | Lours (SSH) |
| **gnolove backend redeploy** | After gnolove#224 merge + VPS env update | zxxma |
| **Phase 7** — drop legacy team profile + feature flag | Overdue (gate was 2026-05-23) | Next session |

## Notes for next session

- Phase 7 (drop `GnoloveTeamProfileLegacy` + `VITE_GNOLOVE_TEAM_HUB` flag) is past its 3-day soak gate. Safe to execute. See `docs/reports/handoff-team-hub-2026-05-20.md` §"Where Phase 7 lives" for the full checklist.
- Custom date range is shipped and functional. Weekly period is intentionally Mon-Sun (ISO weeks). Users wanting arbitrary dates should use the "Custom" period option.
- `onbloc/gno-ibc` won't appear until someone with VPS SSH access updates the `.env` file and redeploys.
