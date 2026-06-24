# Home Atlas Redesign — Plan 1: Foundation + Visitor Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Memba home's visual execution with the "Atlas" board-of-doors design (visitor home first), fix the live CTA/empty-data/hierarchy defects, and reduce the network set to test13 + gnoland1 — shipping a working, awesome visitor home in dark and light.

**Architecture:** Keep the shipped Control Room's honest architecture (`<Home mode>` + `StatusStrip` + lazy/error-isolated panels). Introduce one `Door` primitive (variants + states) and rework `StateBoard` → `ShowcaseBoard`. Collapse the two token systems into the canonical Kodera layer. Reduce `NETWORKS` to test13 (default) + gnoland1. All data reads stay honest: empty → invitation, never "—"/"0".

**Tech Stack:** Vite + React 19 + TypeScript SPA, vanilla CSS (Kodera tokens), react-router-dom@7, TanStack Query v5, ConnectRPC, @phosphor-icons/react. Tests: Vitest + React Testing Library via `renderWithProviders`. Backend Go (untouched in Plan 1).

**Design source of truth:** `Memba/docs/planning/HOME_ATLAS_REDESIGN.md` (spec) + the approved Claude Design mockups from the 2026-06-23 session (visitor dark `memba_home_atlas_visitor_v2`, light `memba_home_atlas_light_theme`, member `memba_home_atlas_member`, door-state legend).

## Global Constraints

- **Networks:** only `test13` (primary) + `gnoland1`/betanet. `DEFAULT_NETWORK = "test13"`. Remove test12, Staging, Portal Loop from `NETWORKS`. Generalize `SNAPSHOT_NETWORK` usage to support both priority networks (Plan covers test13; gnoland1 fallback path verified not to crash).
- **Visual:** Kodera tokens only — bg `#000`, elevated `#0c0c0c`, panel `#111`/`#141414`, edge `#222` (hover `#333`), text `#f0f0f0`, dim `#9a9a9a`, muted `#5a5a5a`, accent `#00d4aa` (hover `#00e6bb`), danger `#ff4757`, warning `#ffa502`. Light: accent `#00a88a`, warm-white surfaces. **teal = signal only.** Fonts: Inter (sans) + JetBrains Mono (mono = machine-truth: addresses, hashes, counts, block height, eyebrow labels). **Labels lowercase, never ALL CAPS.** Radius sm 4 / md 8 / lg 12; 4px spacing grid; flat (no gradient/glow).
- **Honesty:** no fabricated activity/timestamps. Every door `empty` → `invitation`, never "—"/"0". Every figure deep-links to gnoweb/qrender or its in-app page.
- **Gated features stay OFF:** never surface NFT/badges/treasury/agent-credits/services as live (`VITE_ENABLE_*` are CI-enforced fund-safety kill-switches; build fails if any is `true` in `.env.example`).
- **a11y:** every door is a real `<a>`/`<button>`; visible focus-visible rings; `prefers-reduced-motion` respected; banners `role="alert"`.
- **Perf:** preserve lazy-mount (`useInViewport`, eager index 0) + per-door `PanelBoundary`; no expensive `Render()` fan-out on first paint; CI main-chunk budget < 600 KB.
- **Backend:** do NOT mirror the frontend `"active"` removal into `backend/internal/service/home_rpc.go` (raw render `ACTIVE` = open).
- **Git:** branch `feat/home-atlas` off `origin/main`. One PR per phase. Never commit to `main`. No Claude attribution anywhere. Never merge without explicit user approval.
- **Test/verify:** `cd frontend && npm run test` (Vitest), `npx tsc -b` (typecheck), `npm run lint` (eslint). Visual tasks verified via the preview workflow (dev server + screenshots desktop 1440 + mobile 390), not fake unit tests.

---

## Pre-flight (do once before Task 0.1)

- [ ] **Confirm clean base.** `git -C Memba fetch origin && git -C Memba switch -c feat/home-atlas origin/main`. Confirm `npm ci` in `frontend/` then `npm run test` is green as a baseline (record the passing count).
- [ ] **Locate test colocation pattern.** Grep for an existing test (`rg -l "renderWithProviders" frontend/src | head`) and mirror its file location/import style for every new `*.test.tsx` below.

---

## Phase 0 — Foundation & quick wins

Outcome: one token source, a `Door` primitive, the visitor CTA bug fixed, and the network set reduced to test13 + gnoland1. Each task is its own reviewable commit; the phase is one PR.

### Task 0.1: Reduce networks to test13 + gnoland1; default to test13

**Files:**
- Modify: `frontend/src/lib/config.ts` (`NETWORKS`, `DEFAULT_NETWORK`, any `SNAPSHOT_NETWORK` literal)
- Test: colocated `config.test.ts` (mirror existing pattern)

**Interfaces:**
- Produces: `NETWORKS` (array of network configs containing only `test13` + `gnoland1`), `DEFAULT_NETWORK === "test13"`. Consumers: `RootRedirect`, `NetworkGate`, `TopBar` switcher, `useHomeSnapshot`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { NETWORKS, DEFAULT_NETWORK } from "../config";

describe("network config", () => {
  it("exposes only test13 and gnoland1", () => {
    const keys = NETWORKS.map((n) => n.key).sort();
    expect(keys).toEqual(["gnoland1", "test13"]);
  });
  it("defaults to test13", () => {
    expect(DEFAULT_NETWORK).toBe("test13");
  });
  it("no longer references test12 / staging / portal", () => {
    const keys = NETWORKS.map((n) => n.key);
    expect(keys).not.toContain("test12");
    expect(keys).not.toContain("staging");
    expect(keys).not.toContain("portal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** `cd frontend && npx vitest run src/lib/config.test.ts` → FAIL (test12 present, default test12).
- [ ] **Step 3: Implement.** In `config.ts`: delete the test12, Staging, Portal Loop entries from `NETWORKS`; keep test13 + gnoland1 (verify gnoland1's RPC URL + chainId are correct against the live `Betanet (gnoland1)` option). Set `DEFAULT_NETWORK = "test13"`. Leave `SNAPSHOT_NETWORK` working for test13; confirm the gnoland1 path falls back to per-panel hooks without throwing.
- [ ] **Step 4: Run test to verify it passes.** Same command → PASS. Then `npx tsc -b` to catch any now-dangling test12 references; fix each (search `rg -n "test12|testnet12|Portal Loop|Staging" frontend/src`).
- [ ] **Step 5: Commit.** `git add -A && git commit -m "reduce networks to test13 + gnoland1; default to test13"`

### Task 0.2: Unify token systems onto Kodera

**Files:**
- Modify: `frontend/src/tokens.css` (alias legacy vars to canonical Kodera values), `frontend/src/index.css` (`:root` is the canonical source)
- Test: visual (preview) — no logic test

**Interfaces:**
- Produces: a single set of effective token values. Any `--color-*` legacy var resolves to its Kodera `--color-k-*` equivalent (no divergent blacks/reds/warnings).

- [ ] **Step 1: Inventory divergences.** `rg -n "#0a0a0a|#1a1a1a|#f44336|#f5a623" frontend/src/tokens.css` — these are the legacy values that differ from Kodera (`#000`, `#222`, `#ff4757`, `#ffa502`).
- [ ] **Step 2: Alias legacy → Kodera.** In `tokens.css`, repoint each legacy var to the Kodera value (e.g. `--color-background: var(--color-k-bg)`, `--color-danger: var(--color-k-danger)`, warning → `--color-k-warning`, border → `--color-k-edge`). Do not delete legacy var names yet (avoids breaking consumers).
- [ ] **Step 3: Verify in preview.** Start dev server; load `/test13/` dark + toggle light. Confirm no color regressions (blacks/reds/borders consistent). Screenshot both.
- [ ] **Step 4: Commit.** `git commit -am "unify legacy tokens onto Kodera values (single source of truth)"`

### Task 0.3: Build the `Door` primitive (variants + states)

**Files:**
- Create: `frontend/src/components/home/Door.tsx`
- Modify: `frontend/src/components/home/home.css` (add `.door*` classes from the mockups)
- Test: `frontend/src/components/home/Door.test.tsx`

**Interfaces:**
- Produces:
```ts
export type DoorState = "ready" | "loading" | "empty" | "error";
export type DoorVariant = "featured" | "list" | "stat" | "search" | "promo" | "action" | "invitation";
export interface DoorProps {
  variant: DoorVariant;
  state?: DoorState;            // default "ready"
  eyebrow: string;             // lowercase mono label
  icon?: React.ReactNode;      // phosphor icon
  href?: string;               // makes the door an <a>; else <button> if onClick
  onClick?: () => void;
  onRetry?: () => void;        // used by state="error"
  invitation?: { label: string; href: string }; // used when state="empty"
  children?: React.ReactNode;  // body for state="ready"
}
```
- Consumed by: every panel in Phase 1 (`ShowcaseBoard`) and Phase 2 (`ActionInbox`).

- [ ] **Step 1: Write the failing tests** (`Door.test.tsx`, using `renderWithProviders`):

```tsx
import { render, screen } from "@testing-library/react";
import { Door } from "./Door";

it("renders body when ready", () => {
  render(<Door variant="stat" state="ready" eyebrow="validators"><b>5 / 5</b></Door>);
  expect(screen.getByText("5 / 5")).toBeInTheDocument();
});
it("renders an invitation (never blank) when empty", () => {
  render(<Door variant="featured" state="empty" eyebrow="featured dao"
    invitation={{ label: "Create one", href: "/test13/dao" }} />);
  expect(screen.getByRole("link", { name: /create one/i })).toHaveAttribute("href", "/test13/dao");
});
it("renders a retry control when error", () => {
  const onRetry = vi.fn();
  render(<Door variant="stat" state="error" eyebrow="tokens" onRetry={onRetry} />);
  screen.getByRole("button", { name: /retry/i }).click();
  expect(onRetry).toHaveBeenCalled();
});
it("is a real link when href is set", () => {
  render(<Door variant="promo" eyebrow="launchpad" href="/test13/tokens">Launch</Door>);
  expect(screen.getByRole("link")).toHaveAttribute("href", "/test13/tokens");
});
```

- [ ] **Step 2: Run to verify they fail.** `npx vitest run src/components/home/Door.test.tsx` → FAIL (no Door).
- [ ] **Step 3: Implement `Door.tsx`.** A single component that: renders an `<a href>` when `href`, else `<button>` when `onClick`, else a non-interactive container; switches body by `state` (`ready`→children, `loading`→3 skeleton bars, `empty`→invitation block with the dashed style + `invitation.href` link, `error`→message + `onRetry` button); applies `.door` + `.door--{variant}` classes. Eyebrow always lowercase mono. Respect `prefers-reduced-motion` for skeleton shimmer (CSS).
- [ ] **Step 4: Add CSS.** Port `.door`, `.door--featured` (full teal border `#14463a`), `.door--invitation` (dashed), skeleton, and state classes from the approved mockups into `home.css` (lowercase eyebrow `.door__eyebrow`, etc.). No single-sided rounded borders.
- [ ] **Step 5: Run tests to verify they pass.** Same command → PASS. `npx tsc -b` clean.
- [ ] **Step 6: Commit.** `git commit -am "feat: Door primitive with variants and ready/loading/empty/error states"`

### Task 0.4: Fix the broken visitor CTA

**Files:**
- Modify: `frontend/src/components/home/VisitorHero.tsx`, `frontend/src/components/home/home.css`
- Test: `frontend/src/components/home/VisitorHero.test.tsx`

**Interfaces:**
- Produces: a `VisitorHero` whose primary + secondary CTAs are spaced, styled buttons/links (not run-together text).

- [ ] **Step 1: Write the failing test:**

```tsx
import { render, screen } from "@testing-library/react";
import { VisitorHero } from "./VisitorHero";

it("renders two distinct, accessible CTAs", () => {
  render(<VisitorHero />);
  const explore = screen.getByRole("link", { name: /explore daos/i });
  const wallet = screen.getByRole("link", { name: /connect wallet|install adena/i });
  expect(explore).toBeInTheDocument();
  expect(wallet).toBeInTheDocument();
  expect(explore).not.toBe(wallet); // separate elements, not one string
});
```

- [ ] **Step 2: Run → FAIL** (current markup renders them adjacent without distinct roles/spacing as designed).
- [ ] **Step 3: Implement.** Wrap CTAs in a flex container with `gap: 12px`; primary `Explore DAOs` → `.bp` (teal solid), secondary → `.bg` (ghost). Add the subhead + "No wallet needed to look around." Match the visitor mockup markup.
- [ ] **Step 4: Run → PASS;** preview `/test13/` logged-out, screenshot desktop + mobile, confirm the two buttons are visually separated.
- [ ] **Step 5: Commit.** `git commit -am "fix: visitor hero CTAs render as two spaced buttons (was run-together text)"`

### Task 0.5: Phase 0 PR

- [ ] Push `feat/home-atlas`; open PR to `main` titled "Home Atlas — Phase 0: foundation, Door primitive, network reduction, CTA fix". Body = summary + test plan (vitest counts, preview screenshots). **Do not merge without explicit user approval.**

---

## Phase 1 — Visitor Atlas (dark + light)

Outcome: the logged-out `/test13/` (and `/gnoland1/`) home is the Atlas board of doors, in dark and light, desktop and mobile. One PR.

### Task 1.1: Per-network featured-DAO resolution (logic, TDD)

**Files:**
- Create: `frontend/src/hooks/home/useFeaturedDao.ts` (or extend the existing featured hook)
- Modify: `frontend/src/lib/config.ts` (featured-DAO config per network)
- Test: `frontend/src/hooks/home/useFeaturedDao.test.ts`

**Interfaces:**
- Produces: `useFeaturedDao(networkKey): { state: DoorState; dao?: { name; members?; health? }; invitationHref: string }`. On test13 → real `memba_dao`; on a network with none configured → `state: "empty"` + `invitationHref` to that network's DAO list.

- [ ] **Step 1: Write failing tests** — test13 returns a featured dao object; an unconfigured network returns `state:"empty"` with the correct `invitationHref`; a thrown read returns `state:"error"` (not a crash). Mock the read layer.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the per-network lookup gated via `isRealmValidOn`/`isXValid`; never return `0`/`—` — empty resolves to invitation.
- [ ] **Step 4: Run → PASS;** `tsc -b` clean.
- [ ] **Step 5: Commit.** `git commit -am "feat: per-network featured-DAO resolution with invitation fallback"`

### Task 1.2: Rework StateBoard → ShowcaseBoard with Door-based panels

**Files:**
- Create: `frontend/src/components/home/ShowcaseBoard.tsx` (replaces `StateBoard` usage in visitor mode)
- Modify: `frontend/src/components/home/panels/{FeaturedDao,Gnolove,Validators,Directory,Ecosystem}Panel.tsx` to render via `Door`
- Modify: `frontend/src/pages/Home.tsx` (visitor branch renders `ShowcaseBoard`)
- Modify: `frontend/src/components/home/home.css`
- Test: `frontend/src/components/home/ShowcaseBoard.test.tsx`

**Interfaces:**
- Consumes: `Door` (0.3), `useFeaturedDao` (1.1), existing panel hooks. Produces: a board where the featured door spans full width first, then `list`/`stat`/`search`/`promo` doors; preserves `useInViewport` lazy-mount (eager index 0) + per-door `PanelBoundary`.

- [ ] **Step 1: Write failing tests** — board renders the featured door first; renders contributors/validators/directory doors; a panel hook in loading state shows a `loading` Door (skeleton), an empty hook shows an `invitation` Door, a throwing panel is caught by `PanelBoundary` and shows the error Door (board still renders siblings).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `ShowcaseBoard` (grid `repeat(auto-fit, minmax(220px,1fr))`, featured spans all columns), convert each panel to emit a `Door` with the right `state`. Keep lazy-mount + error isolation. DOM order = mobile priority (featured → contributors → validators → directory → launchpad).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat: ShowcaseBoard of Doors (featured-first) replacing the visitor stat-wall"`

### Task 1.3: Visitor hero polish + StatusStrip alignment

**Files:** Modify `VisitorHero.tsx`, `StatusStrip.tsx`, `home.css`. Verify via preview.

- [ ] Match the approved visitor mockup: headline (A/B copy via a const), subhead, spaced CTAs (from 0.4), micro line; StatusStrip mono heartbeat with lowercase labels. Acceptance: preview desktop 1440 + mobile 390 match the mockup composition; screenshot both. Commit `feat: visitor hero + status strip to Atlas spec`.

### Task 1.4: Light theme parity

**Files:** Modify `home.css` + any per-component CSS lacking `[data-theme="light"]`; verify tokens drive light.

- [ ] Ensure every new `.door*`/board class reads from tokens so the light palette (accent `#00a88a`, warm-white surfaces) applies with no hardcoded dark hex. Acceptance: toggle theme in preview; visitor home matches the light mockup; contrast AA on text/teal. Screenshot light desktop + mobile. Commit `feat: light-theme parity for Atlas visitor home`.

### Task 1.5: Responsive + a11y pass (visitor)

**Files:** `home.css`, `MobileTabBar.tsx` (verify), components.

- [ ] Verify breakpoints (1024/768/480/428/375/320): board → 1 col ≤768, DOM order = priority, bottom tab bar present. Every door is `<a>`/`<button>` with focus-visible ring; run an a11y check (axe in the preview or `@axe-core/react`); fix violations. Acceptance: keyboard-tab through all doors; screenshots at 390 + 1440. Commit `chore: responsive + a11y pass for visitor Atlas`.

### Task 1.6: Phase 1 PR

- [ ] Push; open PR "Home Atlas — Phase 1: visitor home (dark + light)". Body = summary + test plan (vitest counts, desktop/mobile/dark/light screenshots, bundle size vs 600KB budget). **Do not merge without explicit user approval.**

---

## Self-review (run against the spec)

- Spec §4 (visitor) → Tasks 1.1–1.5. ✅
- Spec §3 (Door primitive + states) → Task 0.3. ✅
- Spec §6 (per-network + invitations; networks=test13+gnoland1; default test13) → Tasks 0.1, 1.1, 1.2. ✅
- Spec §7 (Kodera unify, light) → Tasks 0.2, 1.4. ✅
- Spec §1 #1 (CTA bug) → Task 0.4. ✅
- Spec §1 #2/#3 (hierarchy, no empties) → Tasks 1.2 (featured-first, invitation states). ✅
- Spec §8 (responsive/a11y/perf) → Task 1.5 + preserved lazy/error-isolation in 1.2. ✅
- Spec §5 (member) → **deferred to Plan 2** (not in scope here). Documented below.
- Placeholder scan: visual tasks use preview-verification (correct for CSS) with explicit acceptance criteria, not fake unit tests; logic tasks (0.1, 0.3, 1.1, 1.2) are full TDD. No "TBD"/"handle edge cases" left.
- Type consistency: `DoorState`/`DoorVariant`/`DoorProps` (0.3) reused verbatim in 1.1/1.2.

---

## Subsequent plans (separate docs when reached)

- **Plan 2 — Phase 2 (Member Atlas):** elevate `ActionInbox` + `QuickVoteWidget` (vote/sign/claim/candidature), add "Activity" tab, rebuild `YourWorlds` on TanStack Query, condensed explore doors. Spec §5.
- **Plan 3 — Phase 3 (per-network featured + data wiring):** generalize snapshot to gnoland1, DAO-count fix, invitation fallbacks across networks. Respect the backend `"active"` watch-out. Spec §6.
- **Plan 4 — Phase 4 (polish):** motion, perf (self-host fonts), footer legibility, final a11y. Spec §8.
- **Separate ops track — test12 on-chain winddown** (frontend/config removal already done in Phase 0).
