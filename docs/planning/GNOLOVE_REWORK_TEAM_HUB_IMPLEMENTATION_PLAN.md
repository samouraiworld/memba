# Gnolove Rework — Team-Hub Implementation Plan

> **Date:** 2026-05-18 · **Status:** APPROVED — Q-1..Q-7 answered by operator 2026-05-18 (see §6).
> **Execution snapshot (2026-05-19):** Phases 0, 1, 2a, 3, 4, 5 ✅ shipped. Phase 2c (new — Focus Areas → server-side topics) ✅ shipped via gnolove#222 + memba#342. Phase 2b (curated repo expansion) ⏳ deferred. Phase 5.5 (CORS glob) ❌ dropped — operator opted for prod-only testing. **Plan Phases 6 & 7 have been redefined by the operator** (see §4.1) — the analytics rework + UX-polish phases as originally written are deferred; the new 6 is a 24h canary + Playwright smoke, the new 7 is dropping the legacy stub. The original Phase 7 deliverables (UX polish + a11y) are being audited 2026-05-19 as candidate work for a Phase 6b or v6.2.x patch release.
> **Goal:** Make `/:network/gnolove/teams/:teamName` the section's primary noun — composition, active repos, scoped metrics, an honest expertise visualisation, and embedded team-scoped AI reports — and ship the Onbloc/AmozPay roster fixes, a curated tracked-repo expansion, and short+long AI report summaries along the way.
> **Predecessor:** v6.1.0 shareable-report-URLs work (PR #336, 2026-05-12). This plan extends that URL-state infrastructure rather than reinventing it.
> **Repos touched:** `Memba` (this repo, frontend only) + `samouraiworld/topofgnomes` (gnolove backend) + `infra_gnolove` (Ansible env templates).
> **Budget:** ~3 weeks at 1 FTE (≈19 working days, see §5).

---

## 1. The pivot in one paragraph

Today the section's information architecture is inverted: `GnoloveHome` carries seven sections of cross-cutting noise, while `GnoloveTeamProfile` is a 145-LOC stub that renders the *global* tracked-repo list with a misleading "Tracked Repositories" heading (`pages/gnolove/GnoloveTeamProfile.tsx:91-110`) and zero team-specific data. The fix is one sentence: **make the team page the section's primary noun. Overview becomes the lobby; everything else is a lens applied to a team.** The team-page becomes the natural artifact you share when you tell someone "look what Samourai shipped this month."

## 2. What changes, surface by surface

**`/gnolove/teams/:teamName` — full rebuild.** Six cards top-to-bottom: header (name + colour stripe + period selector + "Last sync" pill + "Data: mainnet" chip when `:network==='test12'`); metrics grid (5 stats); active repositories (top-N by team's merged PRs with a dual-threshold rule — see §4); Focus Areas tag pills (the honest v1 of the expertise viz); recent activity (team-scoped PRs); embedded AI reports filtered by period + repo with a short/long toggle on each card. Each card has its own ErrorBoundary so one crash doesn't black-out the page. Lazy backend-health probe degrades the whole hub to the legacy stub if the backend goes down.

**`/gnolove/teams` — slim down.** Today it duplicates the team-stats compute already in `GnoloveHome`. Drop the duplicate; keep the index link grid.

**`/gnolove` (Home) — reduce density.** Cap visible sections to 5: milestone, top teams, filters, leaderboard, repos. Activity feed collapses by default (today it does). Drop the full tracked-repos grid at the bottom — links live on each team page now.

**`/gnolove/analytics` — five new panels, one removed.** Add: PR cycle-time histogram, contributor-cohort retention curve, repo health matrix (rows=repos, cols=`PRs/week | cycle time | open backlog | last commit`, traffic-light cells), topic activity heatmap (15 topics × 12 months), cross-team collaboration 8×8 matrix (excluding dependabot — it pollutes Core Team). Remove the On-Chain Metrics tile (duplicates the stat cards above it). Wire the page-level period selector to URL state (today it's hardcoded `TimeFilter.ALL_TIME` at `GnoloveAnalytics.tsx:40`).

**`/gnolove/reports` — short/long toggle per card.** Each `<AIReportCard>` shows the 2-sentence "Gno Expert" sum-up always; a `▾ Read Detailed Report` toggle expands the long form inline (`<details>`-backed for free a11y). On mobile, the long form opens as a full-height sheet. Deep-link via `?aiReport=<cycle>#<project_name>`.

**Roster + tracked-repo data — move to the backend.** Today `TEAMS` lives in `gnoloveConstants.ts:22-83` (8 teams, client-hardcoded). Move to `gnolove/server/config/teams.yaml`, served via `GET /teams`. Memba keeps the constant as a build-time *seed* for first paint and URL-validation. Tracked repos expand from 13 to a curated ~50 (Appendix A) — not the naive "all of gnolang+gnoverse+onbloc" which is ~120 repos and would hit GitHub GraphQL rate limits.

**AI reports — additive Zod migration.** Backend prompt v2 emits `summary_short` (≤2 sentences) + `summary_long` (CTO-perspective paragraph) + `team` echo-back + a `prompt_version` int per row. Backend writes legacy `summary` field = `summary_long` for one rollover cycle. Memba's Zod schema treats both new fields as `.optional()` with `||` (not `??` — empty-string fallthrough) coalescing to the legacy field.

## 3. Critical architectural decisions

- **Team data lives in the backend, not the client constant** (cost: ~1 backend-day + 0.5 frontend-day). The hardcoded `TEAMS` stays as the seed. Reason: Onbloc-expansion-style edits stop requiring a Memba PR; team config can carry through to AI prompts and per-team metric endpoints. *Caveat:* the new path goes through Lours's deploy queue (~24h SLA assumed); for emergency roster fixes, a client-side seed edit still ships in 30 min.

- **"Active repos" = top-N with a dual threshold.** Top-N by merged PRs in the selected period, BUT only repos where the team's share of repo PRs > 5% AND the team's share of its own PRs in this repo > 2% qualify as "Primary." Below those thresholds the repo renders in an "Also contributes to" secondary row. Without this, every team's #1 active repo would be `gnolang/gno` (everyone touches it) — same class of lie as today's stub.

- **Skills viz v1 = "Focus Areas" tag pills.** Not a force graph, not a word cloud, not a matrix. Five tag pills per team, derived from a curated `topics.yaml` (Appendix B) crossed with the team's PR labels and repo names. Calls it "Focus Areas" — sets honest expectations. The full repo × topic matrix is a v1.5 follow-up behind a sub-flag; it depends on data we don't have yet (PR labels aren't even on the current `PullRequestSchema`).

- **Hand-rolled SVG for all heatmap-class visualisations.** Extract `components/gnolove/Heatmap.tsx` from the existing pattern in `GnoloveContributorProfile.tsx:28-157`. Reused by repo-health matrix, topic-time heatmap, cross-team collab matrix. Total bundle delta < 5KB gz. Forbidden: `d3-force`, `d3-cloud`, `three.js`, `react-force-graph`.

- **Hoist jsPDF out of the lazy chunk.** Today `gnoloveExport.ts` statically imports jsPDF + jspdf-autotable (~85KB gz) into every gnolove page's first paint. Convert to `await import("jspdf")` inside the export handler. Standalone PR; ships in Phase 0; not gated by the team-hub flag.

- **Per-section ErrorBoundary at the card level.** `GnoloveLayout`'s existing boundary catches page-level throws. Extract to `SectionErrorBoundary` and wrap each new hub card individually. A crash in the skills card doesn't black-out members + active repos.

- **`useGnoloveBackendHealth()` + auto-degrade.** If `/teams` HEAD fails twice in 30s, render `<GnoloveTeamProfileLegacy>` automatically with a banner. No Netlify redeploy needed when the gnolove backend hiccups.

## 4. Phases & critical path

| # | Phase | Days | Repo | Key deliverables |
|--:|---|---:|---|---|
| 0 | Foundation | 2.0 | Memba | jsPDF lazy import; `useGnoloveYearReport` exported; DS token additions; TEAMS uniqueness vitest; `SectionErrorBoundary` extracted; MSW + fast-check + `@axe-core/playwright` deps installed. **Deferred to land with consumers:** kitchen-sink dev route → Phase 4 (needs real components to display); cross-repo CI smoke → Phase 1 (needs endpoints to probe); bundle-budget enforcement → Phase 4 (needs team-hub chunk); flag wiring through `deploy-frontend.yml` → Phase 4 (first phase that defines `VITE_GNOLOVE_TEAM_HUB`). |
| 1 | Backend: teams + AI v2 | 2.5 | gnolove | `teams.yaml` + `GET /teams,:slug,:slug/active-repos,/team-stats`; AI prompt v2 with `summary_short/_long` + `team` + `prompt_version`; on-demand `/ai/report/regenerate` (Sunday cron fallback) |
| 2a | Backend: sync hardening | 1.0 | gnolove | Sharded workers; incremental `syncUserDetails`; per-repo backoff; N=4 SQLite contention benchmark |
| 2b | Backend: repo expansion | 1.0 | infra_gnolove | Curated `~50-repo` allowlist deployed via Ansible; backfill window observed |
| 3 | Memba: TEAMS migration | 2.0 | Memba | `useGnoloveTeams` (seed + fetched union); `KNOWN_TEAMS` async-aware; localStorage cache key bumped `v1→v2`; **end-of-phase paper-prototype demo to operator for Q-5 (Focus Areas vs matrix)** |
| 4 | Memba: Team Hub MVP | 5.0 | Memba | Behind `VITE_GNOLOVE_TEAM_HUB`. 8 components under `components/gnolove/teams/`; `useTeamProfileUrlState`; `lib/gnolovePeriod.ts` extraction; `Heatmap` primitive; per-card ErrorBoundaries; `useGnoloveBackendHealth` auto-degrade; `Last sync:` pill; `Data: mainnet` chip; embedded `<TeamHubAIReportsCard>` (no longer deferred to Phase 5 — the hub would otherwise ship missing its centrepiece) |
| 5 | Memba: AI short/long card | 2.0 | Memba | `<AIReportCard>` toggle (short visible, long expand-inline; mobile sheet); Zod additive migration with `\|\|` fallback; team-scoped filter on team page; `?aiReport=` namespaced |
| 6 | Memba: Analytics rework | 3.0 | Memba | Recharts AT fallback baseline shipped FIRST; cycle-time histogram; cohort retention; repo health matrix; topic-time heatmap; cross-team collab matrix (excl. dependabot); on-chain duplicate removed; period selector wired to URL state with default synced to team-page (`monthly`) |
| 7 | UX polish + a11y | 1.5 | Memba | Empty-state ports; loading-skeleton fidelity; tabs pattern consistency; focus management on dropdowns; motion gating; `var(--font-mono)` consolidation |

**+1.5 days buffer** booked at phase boundaries (end of 4, end of 6, post-7) — not absorbed slack.

## 4.1 Phase status snapshot (updated 2026-05-20)

| # | Phase | Status | PRs / notes |
|--:|---|---|---|
| 0 | Foundation | ✅ shipped | memba#337 |
| 1 | Backend: teams + AI v2 + /team-stats | ✅ shipped + deployed | gnolove#220 |
| 2a | Backend: sync hardening | ✅ shipped + deployed | gnolove#221 |
| 2b | Backend: curated ~50-repo expansion (`infra_gnolove`) | ⏸ deferred (revisit only if Mistral context budget gets tight) | — |
| 2c | Focus Areas → server-side `topics.yaml` + `GET /topics` | ✅ shipped + deployed 2026-05-19 | gnolove#222, memba#342 |
| 3 | Memba: TEAMS migration (seed-union) | ✅ shipped | memba#338 |
| 4 | Memba: Team Hub MVP (6 cards behind flag) | ✅ shipped | memba#339 |
| 5 | Memba: AI short/long card | ✅ shipped | memba#340 |
| 5.5 | CORS glob for `*.netlify.app` previews | ❌ dropped 2026-05-19 (operator: prod-only testing) | — |
| **v6.2.1** | Original Phase 7 — UX polish + a11y (tablist, skeleton fidelity, mobile, motion, --gl-font-mono, error states, deep-link anchor) | ✅ shipped 2026-05-19 | memba#343 |
| **v6.2.2** | Full `/gnolove` audit fixes (P0+P1) + Home/Analytics period URL state + **3 of 5 plan §2 analytics panels** (PR cycle time, topic heatmap, repo health matrix) + On-Chain Metrics tile removed + GnoloveTeams slimmed + auto-degrade banner + dual-threshold % surfaced | ✅ shipped 2026-05-19 | memba#344 |
| **v6.2.3 (backend)** | `GET /contributors/cohorts` + `GET /team-collab` (uses existing `Review` table + PR `created_at` — no migration) | ✅ shipped + deployed 2026-05-19 | gnolove#223 |
| **v6.2.3 (frontend)** | **Remaining 2 of 5 plan §2 analytics panels** — contributor cohort retention + cross-team collab matrix | ✅ shipped 2026-05-19 | memba#345 |
| **6** | Playwright canary (team hub + 5 analytics panels + network chip honesty) + dev/CI flag parity via `.env.development` | ✅ shipped 2026-05-19 | memba#346 |
| **7** | Drop `GnoloveTeamProfileLegacy` + the `VITE_GNOLOVE_TEAM_HUB` flag | ⏳ **pending** — gated on 3+ days of clean hub uptime; don't open before 2026-05-23 | — |

**Flag state (production, 2026-05-20):** `VITE_GNOLOVE_TEAM_HUB=true` on Netlify since 2026-05-19. Team hub is live to users. The legacy stub renders only as the auto-degrade target when `useGnoloveBackendHealth` reports the backend unhealthy. Dev/CI parity for the flag via `frontend/.env.development` (memba#346).

**`useGnoloveBackendHealth` integration:** The hook auto-degrades to `<GnoloveTeamProfileLegacy degradedFromHub />` after 2× HEAD-probe failure in 30s (`/teams`). The legacy stub renders a warning banner only on the `degradedFromHub` path so the flag-off case stays silent. Covered by `useGnoloveBackendHealth.test.tsx` (Vitest); the Playwright spec (`gnolove-team-hub.spec.ts`) skips it deliberately because the 15s probe interval would buy no marginal signal vs the unit test.

**All 5 plan §2 analytics panels live** at `/:network/gnolove/analytics` (in order): PR Cycle Time histogram, Topic Activity heatmap (12 months × 16 topics via the live `/topics` taxonomy), Repo Health matrix (traffic-light cells), Contributor Cohort Retention, Cross-Team Collaboration matrix (with outsider buckets footnote).

**Critical path:** Phase 0 → Phase 1 PR1 deploy → Phase 1 PR2 weekly cycle (Sunday) → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7. **Sunday weekly-report cycle is the only hard wall-clock dependency**; the on-demand `/ai/report/regenerate` endpoint in Phase 1 is the fallback if Sunday's cron misses.

**Cross-repo gates (CI-enforced):**
- Memba CI smoke probes each new gnolove endpoint and reads a `prod/teams-api-v1` git tag written by the gnolove deploy workflow on success. PRs labelled `phase:3+` block until the tag exists and probes pass.
- gnolove backend changes deploy via manual `workflow_dispatch` — Lours is the only human with credentials today. **24h roster-change SLA** assumed (operator confirm in Q-6).

## 5. Rollout

**No staging exists for either Memba or gnolove.** Production is the only environment. Rollout discipline:

- Build-time feature flags (`VITE_GNOLOVE_TEAM_HUB`, `_TEAM_HUB_FALLBACK`, `_TEAM_SKILLS_MATRIX`, `_ANALYTICS_V2`) — ~5 min flip via Netlify env edit + redeploy.
- Phase 4 merges with `TEAM_HUB=0` in production. Flip to `1` after 24h Netlify Deploy Preview soak with 2-3 internal users clicking around.
- gnolove backend deploys go straight to prod off-hours; one curl-level smoke from operator laptop is the gate; Prom histograms watched for 1h after.
- Repo expansion (Phase 2b) deploys Friday evening; weekend monitored; revert path = edit `infra_gnolove/backend.env.templates` + commit + `docker compose down && up -d`. Direct VPS env edit is for *emergency only* — Ansible would overwrite.

**Flag combination invariants** enforced by `frontend/src/test/flagCombinations.test.ts`: `TEAM_HUB=1 + TEAM_HUB_FALLBACK=1` forbidden in production; `TEAM_SKILLS_MATRIX=1` requires `TEAM_HUB=1`.

## 6. Operator decisions (answered 2026-05-18)

| Q | Question | Decision | Note |
|---|---|---|---|
| **Q-1** | Tracked-repo scope — curated ~50 vs naive ~120? | **Curated** | Appendix A is the v1 allowlist; revisions are one-line `infra_gnolove` edits post-Phase-2b |
| **Q-2** | "Active repo" threshold — dual-threshold vs simpler? | **Dual-threshold** (CTO call) | >2% of team's PRs AND >5% of repo's PRs → "Primary"; below → "Also contributes to" secondary row |
| **Q-3** | AI report short/long — both visible inline? | **Both visible**, toggle label = `▾ Read Detailed Report` | Renamed from "CTO perspective" per operator preference; Mistral prompt still asks for a CTO-perspective voice internally |
| **Q-4** | AI report team filtering — client vs server? | **Client-side v1** | Per-team prompt-engineered reports = v1.5 only if usage warrants |
| **Q-5** | Skills viz form — pills v1 or matrix v1? | **Focus Areas pills v1** | Matrix gated behind `VITE_GNOLOVE_TEAM_SKILLS_MATRIX` as v1.5; paper-prototype walkthrough at end of Phase 3 |
| **Q-6** | Lours roster-change SLA? | **24h EU-business confirmed**; emergency client-side seed-edit fallback (30-min cycle) | |
| **Q-7** | No-staging acceptance? | **Accepted** | Rollout = Netlify Deploy Previews + 24h production canary (flag=0 → flag=1). No staging VPS for gnolove |
| Defaults | Smaller deferred questions | **All defaults accepted** | Subnav "Overview" stays; `MILESTONE_NUMBER=7` stays (separate ticket); colour policy at >7 teams = monogram + existing 7 (NOT palette extension) |

## 7. Top risks

| ID | Risk | Mitigation |
|---|---|---|
| R-1 | GitHub GraphQL rate-limit cliff if repo count > 50 | Curated allowlist (Q-1); sharded sync workers + per-repo backoff (Phase 2a) |
| R-2 | `syncUserDetails` is O(N_users) every cycle; will silently degrade leaderboard at scale | Incremental refresh (`details_synced_at > now-7d`) in Phase 2a |
| R-3 | Mistral context overflow at ~120 projects × short+long | Curated allowlist + 4-project chunking; `gnolove_ai_report_tokens_used` Prom metric + Discord webhook alert |
| R-4 | Backend down → six error banners on team hub | `useGnoloveBackendHealth()` auto-degrades to legacy after 2× HEAD failure in 30s; no Netlify redeploy needed |
| R-5 | Sunday cron misses, Phase 5 cannot exit, slips a week | On-demand `/ai/report/regenerate` endpoint shipped in Phase 1 |
| R-6 | Stale roster cache after server-side TEAMS change | `CACHE_KEY` bumped `gnolove-cache-v1` → `-v2` in Phase 3; `teamsVersion` ETag in query keys; `Last sync:` pill on `<TeamHubHeader>` |
| R-7 | Backend YAML edit path is *slower* than today's Memba-PR path (Lours bottleneck) | Q-6 confirms SLA; emergency fallback = client-side `TEAMS` seed edit (30-min cycle) |
| R-8 | Empty-string Zod fallback bug — `summary_short ?? p.summary` accepts empty string and renders blank card | Use `\|\|` not `??`; fast-check property test on the transform |
| R-9 | Team double-attribution if a login is in two teams' arrays | Vitest invariant in Phase 0; server-side validator in `teams.yaml` loader |
| R-10 | `:network=test12` URL shows mainnet data without warning | "Data: mainnet" chip in `<TeamHubHeader>` (Phase 4); full network-strip deferred to v2 |

## 8. Appendix A — Curated tracked-repo allowlist (~50 repos, draft)

Operator approval required before Phase 2b deploy.

**gnolang (15):** `gno`, `gnopls`, `hackerspace`, `gnokey-mobile`, `awesome-gno`, `multisigs`, `zkgno`, `gno-loop-doctor`, `gno-govdao-activity-parser`, `gno-lz-oapp`, `gno-docs`, `peerdev`, `gnopo`, `gno-validator`, `portal-loop`.
**Excluded:** `.github`, `blog`, `gno-website`, `specs` (markdown-blast noise).

**onbloc (8):** `gnoscan`, `adena-wallet`, `adena-wallet-sdk`, `gnoswap-contracts`, `gnoswap-frontend`, `gnoswap-backend`, `gno-js-client`, `gno-ibc`.
**Excluded:** `.github`, `gno-playground`, `gno-studio`, `onbloc-kit`, `gnoswap-docs`.

**gnoverse (6):** `mygnoscan`, `gno-game-of-realms` (if currently active), `gnocchi`, plus 3 maintained tooling repos.
**Excluded:** archived hackathon repos; forks.

**samouraiworld (5):** `memba`, `gnolove`, `gnomonitoring`, `peerdev`, `zenao`.

**Misc (3):** `aeddi/gno-watchtower` (per operator §1.4), `TERITORI/teritori-dapp` (current), `berty/berty` (if Berty team tracking is desired).

Total ~47. Adding/removing is a one-line `infra_gnolove/backend.env.templates` edit + Ansible deploy — no Memba code change required after Phase 2b.

## 9. Appendix B — Topic taxonomy v1 (16 topics)

Lives at `gnolove/server/config/topics.yaml` (server-side, authoritative) and is fetched by Memba via `GET /topics` (no client-side duplicate to drift).

Topics: `gnovm`, `gnocore`, `gnosdk`, `gnops`, `security`, `devx`, `docs`, `wallet`, `indexer`, `governance`, `dex`, `nft`, `messaging`, `ibc`, `ai`, `zk`. Match order: PR labels → repo name → PR title. Unmatched bucket = `other`, hidden unless > 5% of team total. Full regex bags shipped in the YAML file; not duplicated here (the YAML *is* the canonical record).

## 10. Appendix C — Roster fixes shipped via `teams.yaml`

Below is the YAML the operator should review before Phase 1 ships. Names from the operator's brief; cross-referenced against current `gnoloveConstants.ts` for completeness.

```yaml
# gnolove/server/config/teams.yaml (excerpt)
teams:
  - slug: onbloc
    name: Onbloc
    color: purple
    members: [notjoon, r3v4s, adr-sk, jinoosss,
              dongwon8247, aronpark1007, HeesungB, junghoon-vans, gihun508443]
  - slug: samouraiworld
    name: Samourai.world
    color: red
    members: [n0izn0iz, omarsy, Villaquiranm, hthieu1110, mvallenet, WaDadidou,
              dtczelo, naim-ea, louis14448, pr0m3th3usEx, davd-gzl, moonia,
              zxxma, clegirar, omniwired, AmozPay]
  # ...remaining 6 teams unchanged from gnoloveConstants.ts
```

GitHub login case is preserved as the operator wrote it; lookups are case-insensitive at the boundary.

---

*End of plan. All questions answered; Phase 0 is unblocked. Next session: open the `feat/gnolove-team-hub` branch in Memba and the `feat/team-hub-api` branch in gnolove, and start with Task 0.1 (jsPDF dynamic-import — fastest win, no flag needed).*
