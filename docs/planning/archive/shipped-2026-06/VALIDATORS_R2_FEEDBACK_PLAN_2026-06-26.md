# Validators — Round-2 prod-feedback plan

- **Date:** 2026-06-26 (after the unification epic #564/#566/#569/#571/#572 shipped to prod)
- **Status:** approved directions (via review); implementing in focused PRs off `main` (`f2b2126`+)
- **Worktree/branch base:** `memba-validators`, branches off latest `origin/main`

Four prod-review notes, decisions locked:

## A. Candidates tab (note #1) — small
- Rename the overview's **Operators** segment tab → **Candidates**; focus it on candidates (active validators already live in the Validators tab).
- `Validators.tsx`: seg label "Operators" → "Candidates"; count = candidate count.
- `ValoperPanel`: the Candidates tab renders candidates prominently. If any *active* registered operators exist, show a compact note linking them to the Validators tab (don't duplicate the active roster here). On test13 active-operators ≈ 0, so this is mostly a rename + de-emphasis.

## B. Overview = performance (note #3) — moderate; reverses earlier D2
- On `ValidatorProfile`, **fold the Performance metrics into the Overview tab** and **remove the dedicated Performance tab**. Tabs become **Overview · Quests · Contributions · Activity**.
- Overview order: **Identity** (signing pubkey + operator/signing note) on top → then the **live performance metrics** (voting power, network share, uptime, missed, 100-block heatmap, incidents, health) — replacing the removed **Snapshot** card.
- `ValidatorPerformancePanel` is reused inside Overview (mount on Overview now, still lazy-ish). Candidate → "not in the active set yet"; genesis → metrics + minimal identity.
- Persistent Reviews section stays below the tabs.

## C. Contributions mapping (note #4) — moderate; the data feature
- New curated map `lib/validatorIdentity.ts`: validator (by **moniker** lowercased AND **operator/signing address**) → `{ kind: "team"|"contributor", slug, label }`.
  - `gno-core-val-01` → team `all-in-bits`
  - `gno-core-val-02` → team `all-in-bits`
  - `samourai-crew-1` → team `samouraiworld`
  - `aeddi-1` → contributor `aeddi`
  - `gfanton-1` / addr `g19rl4cm2hmr8afy4kldpxz3fka4jguq0a0u3773` → contributor `gfanton`
  - (extendable; keyed both ways, address wins)
- `ValidatorProfile` Contributions tab: if a mapping exists →
  - **contributor**: `useGnoloveContributor(login)` → show real summary (commits/PRs/issues, top repos) + **"View on Gnolove →"** to `/:network/gnolove/contributor/<login>`.
  - **team**: `useGnoloveTeam(slug)` (+ optional team-stats) → show team summary + **"View team on Gnolove →"** to `/:network/gnolove/teams/<slug>`.
  - Unmapped → current address-based `fetchUserProfile` behaviour.
- gnolove data layer (confirmed): `getContributor(login)` / `useGnoloveContributor` (`/contributors/{login}`); teams in `lib/gnoloveConstants.ts` (slugs) + `getTeam(slug)`/`getTeamStats`. `GNOLOVE_API_URL` in `lib/config.ts`.

## D. Hovercard preview (note #2) — UI; lightweight custom (no new dep)
- A small CSS/JS hovercard on Validators-table rows + Candidate cards, clickable through (rows already navigate).
- Validators: moniker · status · voting power · uptime · health. Candidates: moniker · status · server type · bio snippet.
- One reusable `ValidatorHoverCard` (or a thin popover), positioned on hover/focus; keyboard + a11y friendly; theme-aware.

## Sequencing (focused PRs, TDD, ask-before-merge → autonomous-merge when green/safe/orthogonal)
1. **PR-A:** B (Overview=performance, remove Performance tab) + A (Candidates rename) — related profile/overview UX.
2. **PR-B:** C (contributions mapping + gnolove contributor/team fetch).
3. **PR-C:** D (hovercard).

## Verification
- Per PR: `npm run lint` + `npm run build` + full vitest; deploy-preview eyeball (when browser tool available).
- Re-verify real CI + main drift before each merge (parallel sessions active: §13 light-theme + mobile).
