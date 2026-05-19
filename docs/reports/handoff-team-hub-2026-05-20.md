# Handoff — Gnolove Team-Hub Rework (substantially complete)

> **Session date:** 2026-05-19 evening / 2026-05-20
> **Use:** Paste this whole file (or its "Kickoff prompt" section) into the next Claude session to pick up cleanly.

---

## State at handoff

- **Plan:** `Memba/docs/planning/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md` — see §4.1 for the canonical phase status snapshot.
- **Team hub flag:** `VITE_GNOLOVE_TEAM_HUB=true` on Netlify since 2026-05-19. **Live to users in production for ~24h+.**
- **Dev / CI parity:** `frontend/.env.development` now sets the same flag, so `npm run dev` and Playwright runs mirror prod (shipped in memba#346).
- **gnolove backend:** all required endpoints live on `backend.gnolove.world` — `/teams`, `/teams/:slug/{active-repos,team-stats}`, `/topics`, `/contributors/cohorts`, `/team-collab`. No deploy pending.
- **Local repo state:** both `Memba` and `gnolove` clean on `main`. All session branches deleted locally.

## What shipped in this session arc (2026-05-19 → 2026-05-20)

| PR | Repo | Title | Status |
|---|---|---|---|
| **gnolove#222** | `samouraiworld/gnolove` | server-side Focus Areas taxonomy + GET /topics | merged + deployed 2026-05-19 |
| **memba#342** | `samouraiworld/memba` | consume server-side Focus Areas taxonomy | merged 2026-05-19 |
| **memba#343** | `samouraiworld/memba` | v6.2.1 team-hub UX polish + Phase-7 a11y | merged 2026-05-19 |
| **memba#344** | `samouraiworld/memba` | v6.2.2 — full /gnolove audit fixes (P0+P1) + Analytics panels 3/5 | merged 2026-05-19 (admin) |
| **gnolove#223** | `samouraiworld/gnolove` | `/contributors/cohorts` + `/team-collab` endpoints | merged + deployed 2026-05-19 |
| **memba#345** | `samouraiworld/memba` | cohort retention + cross-team collab panels (4/5 + 5/5) | merged 2026-05-19 (admin) |
| **memba#346** | `samouraiworld/memba` | Phase 6 — team-hub canary + analytics smoke tests | merged 2026-05-19 (admin) |

**Net effect:**
- Team hub renders for users in production with all six cards working off live data.
- All five plan §2 analytics panels live: PR Cycle Time, Topic Activity heatmap (12 months × 16 topics, live `/topics` taxonomy), Repo Health matrix, Contributor Cohort Retention, Cross-Team Collaboration (with outsider buckets footnote).
- The audit gaps (silent zeros on error, missing degrade banner, hidden dual-threshold %, missing AI deep-link anchor, "Last sync" mislabel) all closed.
- Playwright canary covers the team hub + every analytics panel + the network-chip honesty conditional.

## What's pending

| Item | Status | When |
|---|---|---|
| **Phase 7** — drop `GnoloveTeamProfileLegacy` + the `VITE_GNOLOVE_TEAM_HUB` flag | ⏳ pending | **Don't open before 2026-05-23.** Give the hub + auto-degrade 3+ days of clean prod soak before pulling the safety net. |
| **Phase 2b** — curated `~50-repo` expansion in `infra_gnolove` | ⏸ deferred | Revisit only if Mistral context-budget pressure appears. |

## Decisions locked in this arc

- **Plan-original Phase 6 (analytics rework) was reactivated** by the operator after initially being deferred. All five panels now shipped (3 in v6.2.2 from data already on hand, 2 in v6.2.3 after gnolove#223 exposed cohorts + collab).
- **Plan-original Phase 7 (UX polish + a11y) shipped as v6.2.1** (memba#343). Operator-redefined Phase 7 (drop legacy + flag) is the only remaining piece.
- **Phase 5.5 (CORS glob)** stays dropped. Operator chose prod-only testing for this release.
- **Backend deploys without Lours.** `gh workflow run "Docker build and deploy Image V2" -R samouraiworld/gnolove --ref main` runs end-to-end with the GH Actions secrets. Operator can self-trigger.
- **Admin-merge is OK for this operator's workflow.** Operator is repo admin; explicit "merge what can be merged" in this arc authorized bypassing branch-protection approval for green PRs while mobile-only.

## Watch out for (notes-to-future-self)

- `FocusTopic` is a `string` type alias (widened in #342). Don't narrow it back to a literal union — the backend owns the taxonomy now and the union would drift.
- `useGnoloveBackendHealth` integration is covered by the Vitest unit test next to the hook. The Playwright spec (`e2e/gnolove-team-hub.spec.ts`) deliberately skips it — 15s+ probe-interval waits per case with no marginal information gain.
- `GnoloveTeamProfileLegacy` accepts a `degradedFromHub` prop now (#344). Only render the banner on that path, not the flag-off path — flag-off is intentional and silent.
- `.env.development` is committed and gitignore-safe. Don't commit `.env.local` — that's the dev-override file.
- `Date.now()` inside `useMemo` trips `react-hooks/purity`. Pattern in `GnoloveAnalytics.tsx`: snapshot via `const [nowMs] = useState(() => Date.now())` and feed memos.
- The plan doc references the gnolove remote as `samouraiworld/topofgnomes` in a few places. Actual is `samouraiworld/gnolove`. Don't fix retroactively.

## Where Phase 7 lives when it kicks off

- `Memba/frontend/src/pages/gnolove/GnoloveTeamProfile.tsx` — delete the branch, render `<TeamHub />` unconditionally.
- `Memba/frontend/src/pages/gnolove/GnoloveTeamProfileLegacy.tsx` — delete the file.
- `Memba/frontend/src/lib/gnoloveFeatureFlags.ts` — remove `isTeamHubEnabled()` + the flag reference.
- `Memba/frontend/.env.development` — drop the `VITE_GNOLOVE_TEAM_HUB` line.
- `Memba/frontend/.env.example` — drop the doc entry.
- Netlify production env — drop the variable (post-merge, otherwise the flag still resolves to true via fallback default which is fine).
- Update `useGnoloveBackendHealth` consumer (`GnoloveTeamProfile`) — backend-down case still needs an honest UX (currently degrades to the legacy stub). Decide: render an inline error state inside the hub, or keep a tiny "Service unavailable" page. Plan §3 R-4 only requires the user knows.
- `Memba/frontend/e2e/gnolove-team-hub.spec.ts` — the network-chip and tablist tests still apply. Remove any assertion that the legacy stub renders, since that path will be gone.
- `Memba/CHANGELOG.md` — v6.2.4 (or v6.3.0 if you want the major-bump signal).

---

## Kickoff prompt for the next session (copy below)

```text
Continuing the gnolove team-hub rework. Substantially complete — only
Phase 7 (drop GnoloveTeamProfileLegacy + the VITE_GNOLOVE_TEAM_HUB flag)
remains. Don't open Phase 7 before 2026-05-23 — give the hub + auto-
degrade 3+ days of clean prod soak before pulling the safety net.

Read first: Memba/docs/reports/handoff-team-hub-2026-05-20.md.
Plan + §4.1 phase status snapshot:
Memba/docs/planning/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md.

Production state to verify before touching anything:
1. Open https://memba.samourai.app/gnoland1/gnolove/teams/samouraiworld
   — team hub should render with all 6 cards (Header, Metrics, Active
   Repositories, Focus Areas, Recent merged PRs, AI weekly report).
2. Open https://memba.samourai.app/gnoland1/gnolove/analytics?time=yearly
   — five analytics panels should render in order: PR Cycle Time,
   Topic activity, Repo health, Contributor cohort retention,
   Cross-team collaboration.
3. curl https://backend.gnolove.world/topics | jq '.topics | length'
   should be 16; /contributors/cohorts | jq '.cohorts | length' > 0;
   /team-collab | jq '.cells | length' > 0.

If anything in steps 1-3 is broken, debug that first — Phase 7 is gated
on the hub working steadily.

If Phase 7 is the move: it's a small cleanup, not a feature. Touchpoints
are in the handoff doc's "Where Phase 7 lives when it kicks off" section.

Don't re-litigate Q-1..Q-7 from plan §6 — those are locked. Don't fix
the gnolove remote typo in older docs ("topofgnomes" vs "gnolove") —
it's a known artifact, not worth churning.

Backend deploys via `gh workflow run "Docker build and deploy Image V2"
-R samouraiworld/gnolove --ref main` (~2 min). Operator can self-trigger;
doesn't need Lours.
```

---

*End of handoff. The team page is now what it should always have been: the section's primary noun. Future-Claude — Phase 7 is one cleanup PR away.*
