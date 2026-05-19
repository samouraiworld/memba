# Handoff — Gnolove Team-Hub Rework (after Phase 5)

> **Session date:** 2026-05-19
> **Status:** Phases 0 → 5 fully shipped. Phase 2c + 6 + 7 + production rollout still pending.
> **Use:** Paste the "Kickoff prompt" section into a fresh Claude session to resume cleanly.

---

## What's done

### Code merged

| PR | Repo | Phase | Merge commit | What it did |
|---|---|---|---|---|
| samouraiworld/gnolove#220 | gnolove | Phase 1 | (on `main`) | `teams.yaml` + `GET /teams,/:slug,/:slug/active-repos,/team-stats`; AI prompt v2 (`summary_short`/`summary_long`/`team` + `prompt_version` column); `POST /ai/report/regenerate` |
| samouraiworld/gnolove#221 | gnolove | Phase 2a | (on `main`) | Hardened `GITHUB_REPOSITORIES` parser; incremental `syncUserDetails` (7d skip); `SYNC_WORKERS` pool (default 4) + rate-limit backoff |
| samouraiworld/memba#337 | memba | Phase 0 | `6ddde92` | jsPDF lazy import, `useGnoloveYearReport` exported, `SectionErrorBoundary` extracted, DS tokens added, MSW+fast-check+@axe-core/playwright installed |
| samouraiworld/memba#338 | memba | Phase 3 | `abda84e` | `useGnoloveTeams()` seed+fetched union, slug field on `Team`, Onbloc+AmozPay roster fixes mirrored, `gnolove-cache-v1` → `-v2` |
| samouraiworld/memba#339 | memba | Phase 4 | `00acee0` | Six-card Team Hub MVP under `VITE_GNOLOVE_TEAM_HUB` (default off), `useGnoloveBackendHealth()` auto-degrade, per-card error boundaries |
| samouraiworld/memba#340 | memba | Phase 5 | `12d1b78` | Shared `<AIReportCard>` (short/long toggle, mobile bottom sheet, team filter), `?id=` → `?aiReport=` with back-compat |

### Production state

- **gnolove backend:** Phase 1 + 2a code is live on the VPS (deployed via `Docker build and deploy Image V2` workflow + `appleboy/ssh-action`). Lours validated four curl smoke tests on 2026-05-18 21:xx UTC:
  - `GET /teams` → `schemaVersion: 1`, 8 teams loaded
  - `GET /teams/onbloc` → 9 members (post-roster-fix)
  - `GET /teams/samouraiworld/active-repos` → 7 primary + 2 secondary (dual-threshold rule working with real PR data)
  - `GET /teams/samouraiworld/team-stats?time=monthly` → 24 PRs / 5 contributors / 4 repos
  - Sync hardening (#221) will exercise on the next 2h sync tick.
- **memba frontend:** Phases 0/3/4/5 are in `main`. **The team hub is NOT visible to users** — `VITE_GNOLOVE_TEAM_HUB` is unset on Netlify, so `/gnolove/teams/:teamName` still renders `GnoloveTeamProfileLegacy`. The `<AIReportCard>` polish IS live everywhere immediately (the short/long toggle activates as soon as prompt v2 reports start arriving).

### Test state

- gnolove backend: **47 Go tests** added across Phases 1 + 2a. First ever Go tests in this repo. All green via `go test ./...` from `server/`.
- memba frontend: **1826/1826 vitest** (1770 pre-rework + 56 added across Phases 0/3/4/5). `npx tsc -b --noEmit`, `npm run lint`, `npx vite build` all clean.

---

## What's still pending

### Production rollout (operator-owned)

| # | Task | Who | Notes |
|---|---|---|---|
| 1 | Flip `VITE_GNOLOVE_TEAM_HUB=true` on Netlify and redeploy | zxxma | Watch the auto-degrade probe in the network tab — if `/teams` HEADs start failing 2x in 30s the page falls back to the legacy stub automatically. Test on a preview branch first if you want a canary. |
| 2 | Fix Netlify-preview CORS so previews can fetch gnolove data | requires either a one-line `backend.env` addition per preview OR a small gnolove patch using `cors.AllowOriginFunc` to glob-match `*.netlify.app` | The durable option is the patch (Phase 5.5 below). Without it, deploy previews of any future PR will render empty pages whenever they touch gnolove data. |

### Code work still on the plan

| Phase | What | Estimated | Notes |
|---|---|---|---|
| **2c** | Migrate Focus Areas regex bag from `lib/gnoloveFocusAreas.ts` to a server-side `gnolove/server/config/topics.yaml` + new `GET /topics` endpoint. Memba then fetches the taxonomy with the same seed-union pattern Phase 3 used. | ~1 dev-day | Removes drift risk between frontend and any future server-side topic consumers (AI prompts, search facets). |
| **5.5** *(new)* | CORS allow-list patch on gnolove backend: replace the static comma-separated `CORS_ALLOWED_ORIGINS` with `AllowOriginFunc` from `github.com/rs/cors` to glob-match `*.netlify.app` deploy previews while keeping the production allow-list strict. | ~30 min | Could go in same PR as Phase 2c or stand-alone. Unblocks all future preview testing. |
| **6** | Canary smoke + `useGnoloveBackendHealth` integration test (Playwright). Plan §4 doesn't fully detail this — needs a re-read. | ~1 dev-day | Wall-clock: only after `VITE_GNOLOVE_TEAM_HUB` has been on in production for ~24h without incident. |
| **7** | Remove `GnoloveTeamProfileLegacy` and the flag once Phase 6 canary signs off. | ~0.5 dev-day | Pure cleanup. Delete component, delete fallback path in `GnoloveTeamProfile.tsx`, delete `useGnoloveBackendHealth()` (or repurpose). |

### Open follow-ups noted in code/PRs

- **Per-project URL deep-linking** on `<AIReportCard>` (e.g. `?aiReport=<id>&project=gnolang/gno`). Currently the expand state is component-local. Could be a Phase 5.1 refinement if real usage shows users want to share a specific project's long form.
- **PR-label matching** for Focus Areas. The plan's preferred first signal is PR labels, but `PullRequestSchema` doesn't carry labels yet. Punted to a future schema bump.
- **Matrix viz** (Q-5 v1.5) — operator decision left it behind `VITE_GNOLOVE_TEAM_SKILLS_MATRIX`. Not started; depends on PR labels being in the schema.

### Operational notes / watch-outs

- The Sunday weekly-report cron should produce its first `prompt_version=2` row when it next runs (next Sunday after Phase 1 deploy). Until then `<AIReportCard>` is showing v1-shaped historical rows; the short/long toggle only appears when a project has a distinct `summary_long`.
- The legacy `summary` field stays alive as `= summary_long` for **one rollover cycle** — i.e. one Sunday cron run on prompt v2. After that's confirmed working in production, the backend bridge can be removed (gnolove code change). Tracking note, not a deadline yet.
- `SYNC_WORKERS` defaults to 4. If `SQLITE_BUSY` shows up in the gnolove server log post-deploy, drop to `SYNC_WORKERS=2` via the env file. Plan calls for a benchmark; deferred until real Phase 2b traffic (curated ~50-repo expansion) lands.
- The handoff doc from the previous session is at `Memba/docs/reports/handoff-team-hub-2026-05-18.md`. That one referenced `samouraiworld/topofgnomes` as the gnolove remote — **wrong**, the actual remote is `samouraiworld/gnolove`. This file uses the right name throughout.

---

## Key file locations

- Plan: `/Users/zxxma/Desktop/Code/Gno/Memba/docs/planning/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md` (operator-approved Q-1..Q-7 in §6, topic taxonomy in §9)
- This handoff: `/Users/zxxma/Desktop/Code/Gno/Memba/docs/reports/handoff-team-hub-2026-05-19.md`
- Prior handoff (still useful for Phase 0 detail): `/Users/zxxma/Desktop/Code/Gno/Memba/docs/reports/handoff-team-hub-2026-05-18.md`
- gnolove backend roster: `/Users/zxxma/Desktop/Code/Gno/gnolove/server/config/teams.yaml`
- Memba seed roster: `/Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/gnoloveConstants.ts`
- Team hub orchestrator: `/Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/gnolove/teams/TeamHub.tsx`
- Shared AI report card: `/Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/gnolove/AIReportCard.tsx`
- Focus Areas client taxonomy (move to server in Phase 2c): `/Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/gnoloveFocusAreas.ts`

---

## Decisions still locked in (from prior sessions)

Operator decisions logged in plan §6, all answered, none outstanding:

1. Curated ~50 tracked repos (not ~120). Phase 2b deploys this via Ansible.
2. Dual-threshold "active repos" rule (>2% team's PRs AND >5% repo's PRs). Implemented in Phase 1.
3. AI report short + long inline; toggle labelled **"Read Detailed Report"** (NOT "CTO Perspective"). Implemented in Phases 4 + 5.
4. Client-side AI report team filter. Implemented in Phase 4.
5. Focus Areas as pills v1; matrix v1.5 behind `VITE_GNOLOVE_TEAM_SKILLS_MATRIX`. Pills shipped in Phase 4. Matrix not started.
6. Lours roster-change SLA: 24h EU-business; emergency fallback = client-side seed edit. SLA window — not exercised yet.
7. No staging; rollout via Netlify Deploy Previews + 24h production canary. CORS gap (5.5 above) blocks the preview part.

---

## Kickoff prompt for the next session

```text
Continuing the gnolove team-hub rework. Phases 0 → 5 are merged and the
gnolove backend (Phase 1 + 2a) is deployed + production-smoke-validated.

Latest state and pending work: read
/Users/zxxma/Desktop/Code/Gno/Memba/docs/reports/handoff-team-hub-2026-05-19.md
first (everything you need is there).

Plan: /Users/zxxma/Desktop/Code/Gno/Memba/docs/planning/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md
(operator-approved, Q-1..Q-7 in §6; topic taxonomy in §9 — that's
Phase 2c's source of truth).

What's still pending (in roughly the order I'd tackle):

  1. Phase 5.5 — small gnolove backend PR replacing the static
     CORS_ALLOWED_ORIGINS with cors.AllowOriginFunc to glob-match
     *.netlify.app. Unblocks all future preview testing. ~30 min.
  2. Phase 2c — move Focus Areas regex bag to gnolove server-side
     config/topics.yaml + new GET /topics; Memba consumes via the
     same seed-union pattern Phase 3 used. ~1 dev-day.
  3. Flip VITE_GNOLOVE_TEAM_HUB=true on Netlify (operator decision —
     after 5.5 ships so a preview can canary the new hub first).
  4. Phase 6 — canary smoke + useGnoloveBackendHealth Playwright
     integration. ~1 dev-day, gated on 24h of production team-hub uptime.
  5. Phase 7 — drop GnoloveTeamProfileLegacy + the flag once 6 signs
     off. ~0.5 dev-day pure cleanup.

Don't re-litigate operator decisions — they're locked in plan §6.

If unsure where to start, recommend an option with the main tradeoff
and let me pick.
```

---

*End of handoff. Working tree is clean on `main` in both repos; merged feature branches deleted locally; nothing in flight. Good luck, future-Claude.*
