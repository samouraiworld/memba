# Handoff — Gnolove Team-Hub Rework (after Phase 0)

> **Session date:** 2026-05-18
> **Use:** Paste this whole file (or its "Kickoff prompt" section) into the next Claude session to pick up cleanly.

---

## State at handoff

- **Plan:** `/Users/zxxma/Desktop/Code/Gno/Memba/docs/planning/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md` (operator-approved, Q-1..Q-7 answered).
- **Phase 0:** SHIPPED on `feat/gnolove-team-hub-phase0` → PR **#337** open: https://github.com/samouraiworld/memba/pull/337
- **Last green check:** `npm test` 1770/1770, `npx tsc -b --noEmit` clean, `npm run build` clean. `jsPDF` is now a lazy chunk.
- **Branch in flight:** `feat/gnolove-team-hub-phase0` (do NOT delete locally — PR #337 still tracks it).
- **Local repo state:** clean working tree on `feat/gnolove-team-hub-phase0`.

## What's done

- Plan doc with §6 operator decisions logged (curated repos, dual-threshold active-repos, both AI summaries inline, client-side AI filter, Focus Areas pills v1, 24h Lours SLA, no-staging accepted, defaults accepted for the smaller deferred questions).
- jsPDF dynamic-import (~135 KB gz freed from gnolove first paint).
- `useGnoloveYearReport` exported for Phase 4 derived hooks.
- TEAMS uniqueness + color + whitespace + name-uniqueness invariants locked in.
- DS tokens at top of `gnolove.css` for PR-state, Recharts series palette, heatmap ramp; dead `gl-error-banner` duplicate removed.
- `SectionErrorBoundary` extracted from `GnoloveLayout` to `components/gnolove/SectionErrorBoundary.tsx`; `GnoloveLayout` is its first consumer.
- Dev deps installed: `msw`, `fast-check`, `@axe-core/playwright`.

## What's deferred (intentional, documented in plan §4)

| Was | Now | Reason |
|---|---|---|
| Kitchen-sink dev route | Phase 4 | Needs real components to display |
| Cross-repo CI smoke | Phase 1 | Needs endpoints to probe |
| Bundle-budget enforcement | Phase 4 | Needs team-hub chunk |
| `VITE_GNOLOVE_*` flag wiring | Phase 4 | First phase that defines a flag |

## Decisions I made unilaterally (would un-do happily if needed)

- Bundled Phase 0 onto **one** branch + **one** PR instead of the 4 PRs the plan called for. Reason: operator's "one session = one PR" preference, now in memory.
- Deferred the 4 Phase-0 tasks above. Reason: each had no useful consumer yet; operator's "elegantly, not overkill" instruction.
- Picked `feat/gnolove-team-hub-phase0` as the branch name (not `chore/`) because the PR aggregates the foundational work for a `feat` rework.

## Open questions for operator (all answered, none outstanding)

All Q-1..Q-7 logged in plan §6. No questions block Phase 1 start.

## Next session — Phase 1: gnolove backend (teams + AI v2)

**Repo:** `/Users/zxxma/Desktop/Code/Gno/gnolove` (the gnolove sister repo, `samouraiworld/topofgnomes` on GitHub).
**Branch:** `feat/team-hub-api` (off `gnolove` repo `main`).
**Owner:** Backend IC + Lours for deploys.
**Duration:** 2.5 dev-days.

**Deliverables (one PR, three logical commits):**

1. **`teams.yaml` + `GET /teams`, `/teams/:slug`, `/teams/:slug/active-repos`** (plan §7 Task 1.1–1.3).
   - YAML loader with case-insensitive uniqueness validation.
   - Active-repos derivation uses the **dual-threshold rule** Q-2 confirmed: >2% of team's PRs AND >5% of repo's PRs → "Primary"; below → "Also contributes to" secondary row.
   - 5-min ristretto cache on `/teams/:slug/active-repos`.
   - Response includes `schemaVersion: 1` + `lastSyncedAt`.

2. **AI prompt v2 with `summary_short` / `summary_long` / `team` / `prompt_version`** (plan §7 Task 1.4).
   - `ai_reports.prompt_version` column added via GORM migration; backfill legacy rows to `prompt_version = 1`.
   - Backend writes legacy `summary = summary_long` for one rollover cycle.
   - Long-form prompt voice = "Gno Ecosystem CTO perspective" (the user-facing button is labelled "Read Detailed Report" — that lives in Memba Phase 5).
   - Mistral context-budget guard: chunk by project (4-project batches) if input would exceed 28K tokens.
   - **Add on-demand `/ai/report/regenerate?cycle=X&prompt_version=N` endpoint** (plan §7 Task 1.4 Step 7, plan §14 R-17 mitigation). This is the fallback if Sunday cron misses.

3. **`GET /team-stats`** (plan §7 Task 1.5).
   - Single GORM `GROUP BY (repository_id, author_id)` query filtered by `users.login IN team.members`.
   - 5-min ristretto cache keyed on `(team, period, repos)`.

**Coordination with Lours:**
- Three separate deploys (one per commit, ideally — staggered).
- After commit 2 deploys, wait one Sunday cycle to confirm `prompt_version=2` rows are written + both summaries render in Mistral output.
- The on-demand `/ai/report/regenerate` endpoint exists from day 1 so we don't have to wait for Sunday during the test cycle.

**Memba changes in this phase:** **none.** All Memba-side consumers land in Phase 3 (TEAMS migration) and Phase 5 (AI report card).

## Watch out for (notes-to-future-self)

- gnolove backend deploys via manual `workflow_dispatch` on `samouraiworld/topofgnomes`. Lours has SSH credentials. EU business hours.
- The plan's `GITHUB_REPOSITORIES` env var format is fragile; Phase 2a hardens the parser. Phase 1 should NOT add repos — that's Phase 2b's job.
- AI prompt v2 doubles input tokens (short + long both emitted). At current ~13 repos that's fine; the curated ~50 in Phase 2b might push close to Mistral's 32K context. Chunking guard MUST land in Phase 1, not Phase 2.
- Memba PR #337 (this session's work) hasn't been reviewed/merged yet at handoff time. Phase 1 work doesn't depend on it merging.

---

## Kickoff prompt for the next session (copy below)

```text
Continuing the gnolove team-hub rework. Phase 0 is shipped — Memba PR #337
open: https://github.com/samouraiworld/memba/pull/337. The plan is at
/Users/zxxma/Desktop/Code/Gno/Memba/docs/planning/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md
(operator-approved, §6 has the 7 decisions).

Now starting Phase 1: gnolove backend work in the sister repo at
/Users/zxxma/Desktop/Code/Gno/gnolove (samouraiworld/topofgnomes on GitHub).

Phase 1 lands as ONE PR on one branch (`feat/team-hub-api`) with three
logical commits:
1. teams.yaml + GET /teams, /teams/:slug, /teams/:slug/active-repos
   (dual-threshold "active" rule: >2% of team's PRs AND >5% of repo's PRs)
2. AI prompt v2 (summary_short + summary_long + team + prompt_version);
   ai_reports.prompt_version column added via GORM migration; on-demand
   /ai/report/regenerate endpoint as Sunday-cron fallback
3. GET /team-stats (GROUP BY repository_id, author_id; ristretto 5-min cache)

Each commit follows TDD (Go tests first). After commits, ask before
asking Lours to deploy — operator owns the deploy ack.

See docs/reports/handoff-team-hub-2026-05-18.md for full context.
```

---

*End of handoff. Good luck, future-Claude.*
