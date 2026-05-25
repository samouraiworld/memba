# Handoff — Gnolove Team-Hub Rework (Phase 2c shipped, flag live)

> **Session date:** 2026-05-19
> **Use:** Paste this whole file (or its "Kickoff prompt" section) into the next Claude session to pick up cleanly.

---

## State at handoff

- **Plan:** `Memba/docs/planning/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md` — see §4.1 for the canonical phase status snapshot.
- **Team hub flag:** `VITE_GNOLOVE_TEAM_HUB=true` on Netlify since 2026-05-19. **Live to users in production.**
- **Local repo state:** both Memba and gnolove clean on `main`. Merged feature branches deleted locally.

## What shipped this session (2026-05-19)

| PR | Repo | Title | Status |
|---|---|---|---|
| **gnolove#222** | `samouraiworld/gnolove` | feat(topics): server-side Focus Areas taxonomy + GET /topics | merged + deployed (operator-triggered workflow_dispatch since Lours was 3-4h unavailable) — `curl /topics` returned schemaVersion=1, 16 topics, first=`gnovm` |
| **memba#342** | `samouraiworld/memba` | feat(gnolove): consume server-side Focus Areas taxonomy | merged |
| (no PR) | Netlify | flip `VITE_GNOLOVE_TEAM_HUB=true` | done by operator |

**Net effect:** the Focus Areas regex bag now lives in `gnolove/server/config/topics.yaml` (16 topics, ported verbatim from the legacy TS). Memba consumes via `useGnoloveTopics()` (seed-union, same shape as `useGnoloveTeams`). When `/topics` is unreachable the card renders identically to before the cutover — fully back-compat.

## What's pending

| Item | Status | When |
|---|---|---|
| **24h prod soak** of the team hub | ⏳ in flight | started 2026-05-19; clears 2026-05-20 |
| **Operator Phase 6** — Playwright canary + `useGnoloveBackendHealth` integration | ⏳ blocked on soak | starts 2026-05-20 |
| **Operator Phase 7** — drop `GnoloveTeamProfileLegacy` + the flag | ⏳ blocked on Phase 6 | est. 2026-05-21+ |
| **Original Phase 7** — UX polish + a11y (empty states, skeleton fidelity, tabs, focus mgmt, motion gating, `var(--font-mono)`) | 🟡 audit in flight 2026-05-19 — punch list to be presented before next coding work | ASAP, possibly interleaved with operator Phase 6 |
| **Phase 2b** — curated `~50-repo` expansion in `infra_gnolove` | ⏸ deferred | revisit when Mistral context-budget pressure appears |

## Decisions logged this session

- **Phase 5.5 (CORS glob for `*.netlify.app`) — dropped.** Operator opted for prod-only testing for this release. Will revisit if/when a future feature actually needs preview canaries.
- **Phase 6 / 7 redefinition.** Plan §4 had Phase 6 as "Analytics rework" (3d) and Phase 7 as "UX polish + a11y" (1.5d). Operator redefined: new Phase 6 = canary smoke (1d), new Phase 7 = drop legacy (0.5d). The original UX-polish deliverables are being audited 2026-05-19 as candidates for a v6.2.x patch release.
- **Deploy without Lours.** The `Docker build and deploy Image V2` workflow_dispatch carries its own SSH credentials in GitHub Actions secrets — operator can self-trigger via `gh workflow run ... -R samouraiworld/gnolove --ref main`. No personal SSH key required.

## Watch out for (notes-to-future-self)

- The plan doc references the gnolove remote as `samouraiworld/topofgnomes` in a few places. The actual remote is `samouraiworld/gnolove`. Don't fix the plan retroactively — just know.
- New `useGnoloveTopics()` hook is only mounted inside `TeamHub`. With the flag live, it's now hit in production; but Phase 4's `useGnoloveBackendHealth` will auto-degrade to the legacy stub if any of the team-hub backend calls (including `/topics`) starts failing. That means: the *only* place a `/topics` 5xx would be user-visible is the brief window before auto-degrade kicks in.
- `FocusTopic` is now a `string` type alias, not a literal union. Future code touching the Focus Areas system should treat slugs as opaque strings; label lookups must use `labels[slug] ?? slug` to gracefully degrade for backend-only topics.

---

## Kickoff prompt for the next session (copy below)

```text
Continuing the gnolove team-hub rework. Phase 2c (Focus Areas → server-side
topics.yaml) shipped 2026-05-19 via gnolove#222 + memba#342. Team hub flag
VITE_GNOLOVE_TEAM_HUB is now live on Netlify.

Read first: Memba/docs/reports/handoff-team-hub-2026-05-19.md.
Plan + §4.1 phase status snapshot: Memba/docs/planning/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md.

What's pending, roughly in order:

1. The 24h soak clock from the flag flip clears 2026-05-20 — Phase 6
   (Playwright canary + useGnoloveBackendHealth integration) starts then.
2. Original Phase 7 UX-polish punch list — audit ran 2026-05-19, results
   in this session's last message. Operator may want to land a v6.2.x
   patch interleaved with or after Phase 6.
3. Operator Phase 7 — drop GnoloveTeamProfileLegacy + the flag once 6
   signs off.

Don't re-litigate operator decisions in plan §6. Phase 5.5 (CORS glob)
is dropped; Phase 2b (repo expansion) is deferred. Each PR is one branch,
TDD where it helps, ask before pushing.
```

---

*End of handoff. Good luck, future-Claude.*
