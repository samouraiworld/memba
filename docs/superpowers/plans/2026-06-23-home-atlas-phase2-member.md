# Home Atlas Redesign — Plan 2: Member Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rework the logged-in (member) home into the Atlas language — an "act now" inbox (vote / sign / claim / candidature) as the spine, then "your worlds", then condensed explore doors — reusing the `Door` primitive and `ShowcaseBoard` shipped in Phase 1.

**Architecture:** The visitor branch already renders `ShowcaseBoard` (Phase 1). This plan reworks the MEMBER branch of `pages/Home.tsx`: keep `StatusStrip`, elevate the existing `ActionInbox` + `QuickVoteWidget` to render through a new `Door` `action` variant, rebuild `YourWorlds` on TanStack Query, and reuse `ShowcaseBoard` for a condensed "explore" section. The old `StateBoard` (member panels) is retired from the member home once parity is reached.

**Tech Stack:** Vite + React 19 + TS, vanilla CSS (Kodera tokens), TanStack Query v5, ConnectRPC, @phosphor-icons/react. Tests: Vitest + RTL via `renderWithProviders`.

**Design source of truth:** `docs/planning/HOME_ATLAS_REDESIGN.md` §5 + the approved member mockup from the 2026-06-23 session (`memba_home_atlas_member`).

## Global Constraints
- Reuse the Phase-1 `Door` primitive (`components/home/Door.tsx`: `DoorProps`/`DoorState`/`DoorVariant`, incl. the `action` variant) and `ShowcaseBoard`/door components. Do NOT fork them.
- Honesty: empty inbox → "You're all caught up." (not blank); every metric omitted when absent (never "—"/"0"); figures deep-link to source.
- `teal = signal`, `mono = machine-truth`, lowercase labels. Kodera tokens only (incl. `--color-k-on-accent`, featured tokens). Light + dark parity. Flat (no gradient/glow).
- Action accents: vote/claim = teal; sign = amber (`--color-k-warning`); danger only for reject. Icon chips use full borders (no single-sided rounded accents).
- Gated features stay OFF (no NFT/badges/treasury/agent-credits/services surfaced as live). `claim` is for live quest rewards only (badges remain gated).
- a11y: real `<a>`/`<button>`, focus-visible, reduced-motion; inline quick-vote buttons have clear accessible names.
- Networks = test13 (default) + gnoland1 (already on main). Member view reachable when wallet connected.
- Do NOT touch the visitor branch / `ShowcaseBoard` internals except to reuse them. Do NOT mirror frontend `"active"` removal into backend `home_rpc.go`.
- Git: branch `feat/home-member` (off `main`, already created). Per-task commits; ZERO Claude attribution; no push without approval; never merge without explicit approval.
- Verify: `cd frontend` → `npm run test` (vitest), `npx tsc -b`, `npm run lint`. Visual tasks verified via controller preview (dev server, dark+light, desktop+mobile).

---

## Pre-flight
- [ ] Confirm baseline green on `feat/home-member`: `npm --prefix frontend ci` if needed, then `npm run test` (record count). Read the current member home: `pages/Home.tsx` (member branch), `components/home/{ActionInbox,QuickVoteWidget,StatusStrip}.tsx`, `hooks/home/useHomeActions.ts`, `components/home/panels/YourWorldsPanel.tsx`, `components/layout/MobileTabBar.tsx`.

## Task 2.1: Member `action` Door + elevate ActionInbox (TDD)
**Files:** Create/extend `components/home/doors/ActionDoor.tsx` (wraps `Door variant="action"`); modify `components/home/ActionInbox.tsx`; reuse `QuickVoteWidget`; `home.css`. Test: `ActionInbox.test.tsx` (+ `ActionDoor.test.tsx`).
**Interfaces:** consumes `useHomeActions(auth)` (existing) + `Door`. Produces an inbox rendering each action as an `ActionDoor` with: icon chip (teal vote/claim, amber sign), title, mono meta (DAO · quorum · deadline / n-of-m signed / reward ready), and inline action(s) — vote keeps inline `QuickVoteWidget` (Approve/Reject); sign/claim/candidature are deep-link buttons. Count pill + "view all activity". Empty → "You're all caught up." Loading → skeleton `ActionDoor`s.
- [ ] Write failing tests: a vote action renders inline Approve/Reject wired to the existing quick-vote handler; a sign action renders "Review & sign" linking correctly; empty actions → "You're all caught up" (no blank/—); loading → skeletons. Reuse `renderWithProviders`; mock `useHomeActions`.
- [ ] Run → FAIL. Implement `ActionDoor` + rework `ActionInbox` to map `useHomeActions` items → `ActionDoor`s (preserve existing vote/sign/claim/candidature logic; only restyle through `Door`). Add `.action-door*` CSS (icon chips, accents) using Kodera tokens.
- [ ] Run → PASS; `tsc -b` + lint clean; full suite no regressions.
- [ ] Commit: `feat: member act-now inbox via Door action variant (inline quick-vote)`.

## Task 2.2: Rebuild YourWorlds on TanStack Query (TDD)
**Files:** Create `hooks/home/useYourWorlds.ts`; rewrite `components/home/panels/YourWorldsPanel.tsx` → `components/home/doors/YourWorldsDoor(s)` rendered via `Door`. Test: `useYourWorlds.test.ts` + panel test.
**Interfaces:** `useYourWorlds(auth): { state: DoorState; worlds: {name; role?; openCount?; href}[] }` — reads saved DAOs/multisigs (localStorage) + per-DAO data via TanStack Query (NO imperative `forEach`+`catch{}`). Produces per-world `Door`s (role + open count + health if present) + an `Add a world` invitation door. Empty → invitation only.
- [ ] Write failing tests: ready → world cards with role/open count (omitted when absent, never 0/—); empty → only the "Add a world" invitation; error → Door error/retry. Mock the per-DAO source.
- [ ] Run → FAIL. Implement `useYourWorlds` on TanStack Query (replace the imperative fetch) + render via `Door`. 
- [ ] Run → PASS; tsc/lint/full-suite clean.
- [ ] Commit: `feat: rebuild your-worlds on TanStack Query as Door cards`.

## Task 2.3: Wire member Home + Activity tab
**Files:** modify `pages/Home.tsx` (member branch), `components/layout/MobileTabBar.tsx`, `home.css`. Test: Home member-mode test + MobileTabBar test.
**Interfaces:** member branch renders: `StatusStrip` + wallet chips (balance + truncated address, mono) → `ActionInbox` (2.1) → `YourWorlds` (2.2) → condensed `ShowcaseBoard` (reuse Phase-1 explore doors). Retire the old member `StateBoard`. Add an "Activity" tab to `MobileTabBar` for members (Home/DAOs/Tokens/Activity/More).
- [ ] Write failing tests: member Home renders the inbox first, then your-worlds, then explore doors (assert order); member tab bar includes "Activity"; visitor branch unchanged (still ShowcaseBoard). 
- [ ] Run → FAIL. Implement the wiring; remove the member `StateBoard` usage (keep the file if still used elsewhere — grep first). 
- [ ] Run → PASS; tsc/lint/full-suite clean.
- [ ] Commit: `feat: wire member home to Atlas (inbox → your worlds → explore) + Activity tab`.

## Task 2.4: Light-theme parity + a11y + responsive (member)
**Files:** `home.css`, components. Verify via controller preview.
- [ ] Ensure all new member CSS (`.action-door*`, wallet chips, your-worlds) reads from Kodera tokens so light mode renders; amber/teal/danger accents tokenized. Focus-visible on quick-vote + all inbox controls; reduced-motion respected. Responsive: inbox + your-worlds stack ≤768, no overflow at 390; member tab bar shows.
- [ ] `tsc -b` + lint + full suite clean. Acceptance: controller previews member mode (needs a connected-wallet stub or `mode="member"` story) dark+light, desktop+mobile; screenshots.
- [ ] Commit: `a11y+light+responsive: member Atlas home`.

## Self-review (against spec §5)
- Inbox (vote/sign/claim/candidature, inline quick-vote, empty state) → 2.1. Your worlds (TanStack Query, add-a-world) → 2.2. Wiring + Activity tab → 2.3. Light/a11y/responsive → 2.4. Honesty (no fabricated metrics, empty→invitation/all-caught-up) enforced via `Door`. Reuse of Phase-1 primitives confirmed.

## PR
- [ ] After all tasks + controller preview: push `feat/home-member`, open PR to `main`. **Do not merge without explicit user approval.** Deferred Phase-1 follow-ups (sidebar light parity, networkKey-prop tidy) may be folded here or tracked separately.

## Subsequent
- Plan 3 — Phase 3 (per-network featured wiring + DAO-count; gnoland1 snapshot). Plan 4 — polish.
