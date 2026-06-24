# Memba Home Rework — Session Doc

- Date: 2026-06-18
- Branch: `feat/home-rework` (off `origin/main`; isolated from the two parallel workstreams)
- Status: **awaiting decision — Option A vs Option B** → then implementation plan
- Process: audit → design proposals (validated) → adversarial experts council (Option B) → comparison → **decision** → implementation plan

---

## 0. Goal

Rework the home (`memba.samourai.app`) from a landing/preview into a **functional** home that surfaces real feature value directly — for both the logged-out visitor and the connected member. Make the home "useful," not a brochure.

---

## 1. Cross-perspective audit of the current home

**Diagnosis:** the home is two disconnected artifacts — a *brochure* for visitors (`Landing.tsx`: hero + 6 Remotion video cards + tech-stack badges) and a *multisig ledger* for members (`Dashboard.tsx`: its only "Recent Activity" is the user's own multisig transactions). Neither shows Memba is a living ecosystem, and both ignore ~70% of the product (NFTs, agents, services, channels, quests/badges, tokens, validators, feedback).

**Where all 5 audit lenses converged (Product · UX/a11y/mobile · Frontend/perf · Brand · Growth):**

1. **Kill the 6 Remotion video cards.** ~67 KB-gzip video engine to animate *fake* feature demos — weakest possible signal on an alpha ("vaporware reel") + real perf/battery/mobile cost.
2. **A cross-feature activity surface should be the spine** — real, deep-linked, serving both states. (Later challenged on *form* — see §4.)
3. **Show proof-of-life before the wallet wall.** Memba is on a public, read-only chain yet hides all of it behind "Install Adena."
4. **Reframe the logged-in home from "multisig console" → "DAO OS home":** keep the crown jewel (the **Action-Required strip + Quick-Vote** — the one thing already doing the functional-home job); surface the invisible quest/XP activation engine; demote the multisig tables.
5. **Empty-state strategy is non-negotiable** on alpha: never an empty room — widen window, stay chain-wide, or show an invitation. Never fake activity.
6. **Don't naively fan out.** "DAO recent activity" alone is 20–40 on-chain calls (the vote-scanner already self-throttles to 5 DAOs). Build isolated, lazy, individually-cached panels; aggregate heavy sources server-side via the Phase-0 indexer.
7. **Brand cleanups to ride on:** unify the two token systems (`tokens.css` vs Kodera `index.css` — different blacks/reds/radii) · lock radius + one hover convention · swap emoji → monoline icons · **teal = signal only** · retire the tech-badge/test-count flex · every clickable becomes a real `<button>`/`<a>` (a11y) · mono for data only.

**Feasibility — cheap-now vs needs-indexer:**

- **Cheap now:** multisig pending+recent txs · NFT activity (already indexer-backed) · network stats · ecosystem traction · feedback (GitHub) · top-N tokens/collections/DAOs · single featured-DAO headline · quests + leaderboard.
- **Needs Phase-0 indexer:** cross-DAO proposal/vote rates · channels activity · agent call/rating aggregates · escrow/services time-feed · NFT floor/sales trends. *(Rule: if "latest" needs parsing markdown from >1 realm or time-sorting, it waits.)*

---

## 2. Framing decisions

- **v1 data scope: cheap-now, indexer later.** (locked) Ship a functional home immediately from already-available data; richer cross-feature panels slot in as Phase-0 lands.
- **Page model: unified vs two-doors.** Option A bets on one adaptive page; Option B (council) challenges this with two doors built from one component system. → resolved by the A/B decision below.

---

## 3. Option A — "The Living Console"

*Unified adaptive console · observation/activity-led · live ledger as signature. (Provisionally validated before the council challenge.)*

One home for everyone that personalizes on connect (no separate marketing landing).

| Panel | Shows | Who | v1 data (cheap-now) | Later (indexer) |
|---|---|---|---|---|
| Brand frame | block · chain · ● live | everyone | `getNetworkStats` | — |
| Needs you | votes · signatures | connected | `useUnvotedProposals` + pending `api.transactions` | escrow, candidature |
| **Live ledger (hero)** | cross-feature event stream | everyone | multisig txs + NFT activity + newest token/collection/proposal, best-effort merge | unified `GetHomeFeed` |
| Network pulse | block time · validators · members | everyone | `getNetworkStats` + `traction` | — |
| Climb | rank · XP · next quest | connected | `quests` lib + leaderboard | — |
| Your worlds | your DAOs/multisigs + deltas | connected | saved DAOs + `api.multisigs` | richer deltas |
| Discover | new dao/mint/agent/token | everyone | newest + top-rated reads | trend ranking |
| Connect prompt | unlock your worlds/votes/rank | visitor | static + CTA | — |

- **Hierarchy:** needs-you → ledger hero + pulse/climb rail → your-worlds + discover. On disconnect the three personalized panels collapse to the connect prompt; ledger/pulse/discover stay.
- **Empty-state:** never an empty room (widen window, chain-wide, invitation).
- **Mobile:** grid collapses to one prioritized column.
- **Edge:** iconic, demo-stunning. **Risk:** ledger needs the indexer to be honest; "ghost town" on thin alpha; mobile is a collapse, not a design; streaming merge-layer upkeep.

---

## 4. Option B — "The Control Room"  *(experts council proposal)*

*Action-first command + verifiable state · two distinct doors · mobile-first.*

**Council (9 seats): near-unanimous verdict.** Every seat said **kill the live-ledger-as-hero** and **keep "Needs you."** Key arguments:

- **Head of Design:** an activity feed is the most-copied crypto trope; for a sovereignty brand the home's verb should be *act/own*, not *observe*. Lead with a personal command surface.
- **UI Expert:** on pure-black, a moving terminal is the loudest element and hard-codes the eye to the least-trustworthy zone; A has three competing focal points and no spine. One focal point = the action inbox; collapse cards into one responsive `ActionCard` primitive; fix the two-token-system / radius / hover / emoji debt as step one; mono = machine-truth only.
- **UX Expert:** a home answers "what should I do now?" not "what's happening?"; route to three jobs — visitor (conviction + browse), returning-active (task inbox), returning-idle (one re-engagement hook).
- **Fullstack:** a cross-feature *time-sorted* ledger is exactly what the codebase cannot honestly produce today (multisig has timestamps; Render()-parsed feeds have none; NFT only via the indexer). Ship a **state board** of independent, individually-cached cards backed by one server-side `GetHomeSnapshot` (O(1) RPC regardless of traffic). App-wide TanStack Query.
- **Mobile engineer:** A is desktop-first that "collapses"; nobody reads a terminal ledger on a phone. Design mobile-up: one `ActionCard` stacks into a phone inbox, tiles into the desktop board; thumb-reachable primary action; persist intent across the Adena hand-off.
- **Gno core engineer (code-verified):** gno.land has **no native event index / time-ordering**; every per-feature feed is `queryRender` → regex-parse markdown with no timestamps; the only live/time-sorted feed (NFTActivityFeed) is indexer-backed. The existing `backend/internal/indexer/raw_ledger.go` is an immutable event ledger keyed by `(block, tx_index, event_index)` — a cross-feature `GetHomeFeed` is *widening it*, not greenfield, but it is "Q2 honest, not launch honest." Use 3 honesty-labeled tiers: Live/RPC heartbeat · Indexed (multisig + NFT) · Snapshot (top-N Render() reads as state "as of block N"). Realm-validity-gate every read.
- **Gno core founder:** a feed reduces gno.land's differentiator (verifiable Go realms) to an EVM-style ticker. B should show *verifiable state* — "don't trust us, query us," realm cards linking to gnoweb source — and evangelize governance + composability. State exists at 3am; events don't → B never looks dead.
- **Memba CTO:** A over-invests in the one component most likely to look bad on a thin alpha (reputational; "a screenshot, not a bug"), and "one adaptive page" is the most expensive shape to ship first while two workstreams run. Ship B as independently-shippable stacked blocks; every block must look good at N=0.
- **Users (desktop power-user + mobile casual):** the ledger is *noise* to the operator and *unreadable* on a phone. Both arrive with two questions only: **"do I need to do anything?"** and **"what changed in my stuff?"** Promote "Needs you" to *be* the home; global activity is a secondary, opt-in, pull-not-push tab.

**Option B spec:**

- **Philosophy:** answer "what needs me?" and "what's the state of my world / the ecosystem?" — act/own, not observe; **state** (always present, cheap, honest), not **stream**.
- **3 zones, fixed order, no bento, one focal point:**
  1. **Status strip** — thin mono brand/network heartbeat (block, validators, ● live). The genuinely-live cheap-RPC tier.
  2. **Spine (focal point):** member → **"Act now" action inbox** (votes · signatures · claimable quests · escrow releases · candidature) as stacked `ActionCard`s; visitor → conviction headline + one CTA ("Explore DAOs", no wallet) + Connect secondary, no fake personalization.
  3. **State board (two tiers)** — verifiable, always-non-empty cards, each lazy-mounted + error-isolated:
     - *Pulse & your stuff:* **network pulse** · **your worlds** (per-DAO state: open proposals · treasury · queue).
     - *Explore Memba* — feature previews, each = ONE highlight + a CTA to the full page: **featured DAO** (state + verify-on-chain link) · **Validators** (network-health highlight: healthy/degraded, active/total, participation, latest incident) · **Gnolove** (top contributors + PR count) · **Directory** (member count + a few members + search) · an **ecosystem quick-nav** tile strip (live counts per feature). Every number links to gnoweb/qrender ("don't trust us, query us").
- **Data model:** 3 honesty tiers (Live/RPC · Indexed · Snapshot); one backend `GetHomeSnapshot` endpoint, short TTL → O(1) RPC; app-wide TanStack Query; realm-validity-gated, lazy/viewport-gated, hard query budget; a card shows a relative timestamp **only if its source has a real one**. Future indexer `GetHomeFeed` slots in as **one optional "Activity" card**, earned — never the hero.
- **Mobile-first:** one responsive `ActionCard` primitive; mobile = "do I need to do anything?" + "what changed in your stuff" (3 items) + one primary bottom action; browse read-only; gated connect with intent persisted across the Adena hand-off.
- **Two doors, one system:** visitor vs member differ only by spine content + which zones render (`mode: 'visitor' | 'member'`) — same grid, same `ActionCard`, same tokens.
- **Type/token cleanup as step one:** unify tokens (one black, two radii, one hover), mono = machine-truth only, retire emoji.
- **Empty states:** truthful + inviting ("you're all caught up" · "0 tokens — create one").
- **Cuts vs A:** the real-time terminal ledger hero · the cross-feature merged event stream · "one adaptive page for all" · per-feature Render() on the critical path.

---

## 5. Comparison — A vs B

| Dimension | A · Living Console | B · Control Room |
|---|---|---|
| Core question | "what's happening?" (observe) | "what needs me / state of my world?" (act) |
| Focal point | live-ledger hero (motion) | "Act now" action inbox |
| Page model | one adaptive page | two doors, one component system |
| Data honesty (v1) | ⚠ needs indexer; thin/fabricated now | ✓ state-based, honest & cheap today |
| Thin-alpha resilience | ⚠ quiet feed = "ghost town" | ✓ state always non-empty |
| Mobile | desktop bento → collapse | ✓ mobile-first, one responsive primitive |
| Build & upkeep | ⚠ streaming merge layer + scrapers | ✓ isolated cards + one `GetHomeSnapshot` |
| Ecosystem/brand signal | "chain breathing" (generic trope) | ✓ verifiable sovereignty ("query us") |
| Iconic "wow" | ✓ strong, demo-stunning | calmer; less single hero moment |
| Returning-user value | watch a feed | ✓ clear your obligations |
| Indexer dependency | core payoff blocked on it | independent; indexer = bonus card later |

---

## 6. Recommendation

**Option B now — keep A's live ledger as an *earned* Phase-2 card** once the Phase-0 indexer lands and activity justifies it.

B hits the "functional home" goal honestly today, is genuinely mobile-first, lower-risk to ship alongside the two parallel workstreams, and is unmistakably gno-native — while preserving every good A instinct ("Needs you" spine, never-empty, cheap-now). A keeps its one real edge (iconic wow), which B reclaims later for free as a bonus "Activity" card. The council (9/9) judged A's ledger-hero dishonest pre-indexer (code-verified: no native time-index) and a reputational risk on a thin alpha.

---

## 7. Decision

- **CONFIRMED: Option B — The Control Room** (2026-06-18, user-confirmed).
- A's live ledger is deferred to an **earned Phase 3 "Activity" card** (lands once the indexer is widened beyond NFT events).

---

# 8. Implementation Plan — The Control Room

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace Memba's home (the `Landing` + `Dashboard`-home role) with "The Control Room" — an action-first, verifiable-state home built from one responsive `ActionCard` primitive, served to visitors and members from one component via a `mode` prop, on cheap-now data with an honest 3-tier data model and app-wide React Query.

**Architecture:** One `Home` component (`mode: 'visitor' | 'member'`) mounted at the `/:network/` index route, composed of three zones — `StatusStrip`, a spine (`ActionInbox` for members / `VisitorHero` for visitors), and a `StateBoard` of always-non-empty cards. Each data panel is a React Query hook with a per-source `staleTime`; data is tiered by honesty (Live/RPC · Indexed · Snapshot) and realm-validity-gated. Existing dashboard cards + the QuickVote broadcast path + `useUnvotedProposals` are reused. Phase 2 moves aggregation server-side (`GetHomeSnapshot` ConnectRPC); Phase 3 adds the earned live-ledger "Activity" card.

**Tech stack:** Vite 7 + React 19, React Router 7, TanStack Query v5, ConnectRPC (connect-es v2 / connect-go), Vitest 4 + React Testing Library 16, pure-CSS Kodera tokens, Go backend.

## Global Constraints

- Branch `feat/home-rework`. Never commit to `main`. **No Claude attribution** in commits/PRs (commit body = concise "why", no trailers).
- **v1 = cheap-now data only.** No dependency on the not-yet-built cross-feature indexer feed.
- **Honesty rule:** a card shows a relative timestamp ("2m ago") ONLY if its source carries a real one (multisig txs, NFT activity). Everything else shows state/counts ("2 open", "as of #N"). Never fake activity.
- **Never render an empty room** — empty resolves to an invitation/next-step, never a blank panel.
- **Type rule:** `var(--font-mono)` = machine truth only (addresses, hashes, counts, block height, eyebrows); `var(--font-sans)` = everything humans read.
- **Realm-validity-gate every on-chain read** via `isRealmValidOn(networkKey, path)` / the `isXValid()` family (`lib/config.ts:241`).
- **Never fan out expensive `Render()` scans on first paint.** `useUnvotedProposals` (the `voteScanner` path) stays authed-only, scoped to saved DAOs, behind its 2-min cache. Below-the-fold panels mount lazily (IntersectionObserver).
- TDD, frequent commits, exact paths. Run `cd frontend && npx vitest run <file>` per task.

## File Structure

**Create (frontend/src):**
- `pages/Home.tsx` — Control Room shell; takes `mode`; composes the three zones.
- `components/home/StatusStrip.tsx` — thin mono brand/network heartbeat (block, validators, ● live).
- `components/home/ActionCard.tsx` — the single responsive primitive (variants: action/stat/feature).
- `components/home/ActionInbox.tsx` — member spine; maps `useHomeActions()` → `ActionCard`s.
- `components/home/VisitorHero.tsx` — visitor spine; conviction headline + CTAs.
- `components/home/StateBoard.tsx` — grid wrapper for the state panels.
- `components/home/panels/NetworkPulsePanel.tsx`, `YourWorldsPanel.tsx`, `EcosystemPanel.tsx`, `FeaturedDaoPanel.tsx`, `ValidatorsPanel.tsx`, `GnolovePanel.tsx`, `DirectoryPanel.tsx`.
- `components/home/home.css` — home-scoped styles (uses canonical tokens only).
- `hooks/home/useHomeActions.ts` — member action inbox (votes + signatures + candidature).
- `hooks/home/useNetworkPulse.ts`, `useEcosystemCounts.ts`, `useValidatorHealth.ts`, `useGnoloveHighlights.ts`, `useDirectoryHighlights.ts` — React Query data hooks.
- `test/test-utils.tsx` — `renderWithProviders` (none exists today).

**Modify:**
- `main.tsx` — hoist a shared `QueryClientProvider` around `<App/>` (lines 51-55).
- `App.tsx` — replace `HomeRedirect` (lines 121-129, 163) to render `<Home mode={…}>`; keep `/dashboard` as a redirect to `/` for muscle-memory.
- `index.css` + `tokens.css` — unify tokens (see Task 0.1); add radius vars to the canonical layer; one hover convention.

**Deprecate (remove from the home path):** `pages/Landing.tsx`, `pages/landing.css`, `remotion/compositions/*` from the route. (Keep the files out of the bundle; decide delete-vs-archive in Task 1.8.)

**Reuse as-is:** `components/dashboard/ActionRequiredStrip.tsx`, `QuickVoteWidget.tsx`, `DashboardDAOList.tsx` (props `{ savedDAOs, userAddress }`), `lib/dao/builders.ts:buildVoteMsg`, `lib/grc20.ts:doContractBroadcast`, `hooks/useUnvotedProposals.ts`, `lib/validators.ts:getNetworkStats`, `lib/traction.ts:fetchTractionMetrics`, `lib/nftApi.ts:fetchNFTActivity`, `lib/daoSlug.ts:getSavedDAOsForOrg`, `lib/config.ts:isRealmValidOn`+`isXValid`. **Feature previews also reuse:** `lib/gnoloveApi.ts:getContributors`/`getNotablePRs`, `lib/validators.ts:getValidators` + `lib/validatorHealth.ts:computeNetworkHealth`, `lib/directory.ts:parseUserRegistry`.

---

## Phase 0 — Foundation

### Task 0.1: Unify the design tokens

**Files:** Modify `frontend/src/index.css` (`:root` L2-31, `[data-theme="light"]` L34-53), `frontend/src/tokens.css`.

**Interfaces — Produces:** canonical `--color-k-*` tokens (one black, one danger, one warning, one edge), new `--radius-*` available under the Kodera namespace, one hover convention `--color-k-hover-surface` / `--color-k-edge-hover`.

- [ ] **Step 1** — In `index.css :root`, add the missing scale so the Kodera layer is self-sufficient: `--radius-sm:4px; --radius-md:8px; --radius-lg:12px; --radius-full:9999px;` and `--color-k-hover-surface: rgba(255,255,255,0.04); --color-k-edge-hover:#333333;` (the latter already exists — confirm single definition).
- [ ] **Step 2** — In `tokens.css`, alias the divergent unprefixed vars to the canonical Kodera values so any stragglers converge: `--color-bg: var(--color-k-bg); --color-danger: var(--color-k-danger); --color-warning: var(--color-k-warning); --color-border: var(--color-k-edge); --color-text-secondary: var(--color-k-dim);`. (Resolves the `#0a0a0a`/`#000`, `#f44336`/`#ff4757`, `#f5a623`/`#ffa502`, `#1a1a1a`/`#222` splits from §5.)
- [ ] **Step 3** — Grep for raw hex usages the home will touch: `cd frontend && grep -rn "#00d4aa\|#ff4757\|#0a0a0a" src/components/home src/pages/Home.tsx` (expect none after this task — home uses vars only).
- [ ] **Step 4** — Run the full suite to confirm no visual-token test breaks: `cd frontend && npx vitest run`. Expected: PASS (token changes are value-compatible).
- [ ] **Step 5** — Commit: `style: unify Kodera tokens — one black/danger/warning/edge, add radius + hover vars`.

### Task 0.2: Hoist app-wide React Query

**Files:** Create `frontend/src/lib/queryClient.ts`; Modify `frontend/src/main.tsx:51-55`; Modify `frontend/src/layouts/GnoloveLayout.tsx:48-107` (consume the shared client).

**Interfaces — Produces:** `export const queryClient: QueryClient` with defaults `{ staleTime: 30_000, gcTime: 24h, retry: <=2 on 5xx, refetchOnWindowFocus: false }` (lift the exact config from `GnoloveLayout.tsx:48-77`), persisted with the existing `gnolove-cache-v2` key + `shouldDehydrateQuery: q => q.queryKey[0] === 'gnolove'`.

- [ ] **Step 1** — Create `lib/queryClient.ts` exporting `queryClient` (move the `new QueryClient({...})` + `persistQueryClient` setup verbatim from `GnoloveLayout.tsx`).
- [ ] **Step 2** — In `main.tsx`, wrap: `<ErrorBoundary><QueryClientProvider client={queryClient}><TxConfirmationProvider><App/>…`.
- [ ] **Step 3** — In `GnoloveLayout.tsx`, delete the local client/provider; rely on the app-wide one (keep gnolove queryKeys prefixed `['gnolove', …]` so persistence is unchanged).
- [ ] **Step 4** — Run: `cd frontend && npx vitest run src/components/gnolove`. Expected: PASS (gnolove still has a client via the root provider).
- [ ] **Step 5** — Commit: `refactor: hoist QueryClientProvider app-wide for the home data layer`.

### Task 0.3: Shared test harness

**Files:** Create `frontend/src/test/test-utils.tsx`.

**Interfaces — Produces:** `renderWithProviders(ui, { route?, authed? })` → wraps in a fresh `QueryClient({ retry:false })` + `MemoryRouter` + a mocked `useOutletContext` value matching `LayoutContext` (`types/layout.ts`).

- [ ] **Step 1** — Implement `renderWithProviders` per the discovered pattern (`TeamHub.test.tsx` style): `<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></QueryClientProvider>`; export a `mockLayoutContext(overrides)` factory returning the `LayoutContext` shape.
- [ ] **Step 2** — Add a self-test `test/test-utils.test.tsx` that renders a trivial component and asserts it mounts.
- [ ] **Step 3** — Run: `cd frontend && npx vitest run src/test/test-utils.test.tsx`. Expected: PASS.
- [ ] **Step 4** — Commit: `test: add renderWithProviders harness for home components`.

### Task 0.4: The `ActionCard` primitive

**Files:** Create `frontend/src/components/home/ActionCard.tsx`, `home.css`; Test `frontend/src/components/home/ActionCard.test.tsx`.

**Interfaces — Produces:**
```typescript
export type ActionAccent = 'teal' | 'amber' | 'danger' | 'neutral'
export interface ActionCardProps {
  accent?: ActionAccent          // left rail; 'neutral' for state-board cards (default)
  icon?: string                  // tabler class, optional leading icon
  eyebrow?: string               // mono machine-truth context, e.g. "vote · memba_dao"
  title: string                  // sans, human-readable
  meta?: string                  // mono sub, e.g. "closes in 6h · 2 of 5 voted"
  actionLabel?: string           // e.g. "vote"
  href?: string                  // renders <a>
  onAction?: () => void          // renders <button>
  loading?: boolean              // skeleton variant
}
```
Rule: if `href` → `<a>`; else if `onAction` → `<button>`; the whole card is the control (a11y). `eyebrow`/`meta` use `--font-mono`; `title` uses `--font-sans`. Accent = a 3px inner left rail element (full-border card + `overflow:hidden`, so no single-sided-radius issue).

- [ ] **Step 1: failing test**
```tsx
import { render, screen } from '@testing-library/react'
import { ActionCard } from './ActionCard'
test('renders an action as a button and fires onAction', async () => {
  const onAction = vi.fn()
  render(<ActionCard accent="teal" eyebrow="vote · memba_dao" title="Proposal #84" actionLabel="vote" onAction={onAction} />)
  const btn = screen.getByRole('button', { name: /vote/i })
  btn.click()
  expect(onAction).toHaveBeenCalledOnce()
})
test('renders a link when href is given', () => {
  render(<ActionCard title="memba dao" href="/test13/dao/x" />)
  expect(screen.getByRole('link')).toHaveAttribute('href', '/test13/dao/x')
})
test('shows skeleton when loading', () => {
  render(<ActionCard title="x" loading />)
  expect(screen.getByTestId('action-card-skeleton')).toBeInTheDocument()
})
```
- [ ] **Step 2** — Run: `cd frontend && npx vitest run src/components/home/ActionCard.test.tsx`. Expected: FAIL (module not found).
- [ ] **Step 3** — Implement `ActionCard.tsx` (accent rail + eyebrow/title/meta + trailing action; `loading` renders a skeleton with `data-testid="action-card-skeleton"`). Add `home.css` rules using only canonical vars + `--radius-lg`.
- [ ] **Step 4** — Run the test. Expected: PASS.
- [ ] **Step 5** — Commit: `feat: ActionCard — the home's single responsive primitive`.

---

## Phase 1 — The Control Room v1 (cheap-now, client-side)

### Task 1.1: Home shell, routing swap, `StatusStrip`

**Files:** Create `pages/Home.tsx`, `components/home/StatusStrip.tsx`; Modify `App.tsx:121-129,163,166`; Test `pages/Home.test.tsx`.

**Interfaces — Consumes:** `useOutletContext<LayoutContext>()` for `{ adena, auth }`. **Produces:** `<Home mode="visitor"|"member" />`; route `/:network/` index renders `<Home mode={adena.connected ? 'member' : 'visitor'} />`; `/:network/dashboard` → `<Navigate to="../" replace/>`.

- [ ] **Step 1: failing test** — `Home` in `member` mode renders the action spine container (`getByTestId('home-spine-member')`); in `visitor` mode renders `getByTestId('home-spine-visitor')`; both render `getByTestId('home-state-board')` and `StatusStrip` (`getByText(/test13/)`). Use `renderWithProviders`, mock `useOutletContext` + the data hooks.
- [ ] **Step 2** — Run: FAIL.
- [ ] **Step 3** — Implement `StatusStrip` (reads `useNetwork()` for `chainId/label` + `useNetworkPulse()` for block/validators; shows ● live). Implement `Home.tsx` composing StatusStrip → (ActionInbox|VisitorHero by `mode`) → StateBoard. In `App.tsx`, replace `HomeRedirect` body: `const { adena } = …; return <Home mode={adena.connected ? 'member' : 'visitor'} />` (drop the `<Navigate to="/dashboard">`); point `dashboard` route to `<Navigate to=".." replace/>`.
- [ ] **Step 4** — Run the test + `npx vitest run src/App` (routing). Expected: PASS.
- [ ] **Step 5** — Commit: `feat: Control Room home shell + StatusStrip; route /:network/ to mode-aware Home`.

### Task 1.2: `ActionInbox` + `useHomeActions` (member spine)

**Files:** Create `hooks/home/useHomeActions.ts`, `components/home/ActionInbox.tsx`; Tests for both.

**Interfaces — Consumes:** `useUnvotedProposals(address)` → `{ proposals: UnvotedProposal[]; loading }`; `api.transactions({ authToken, executionState: ExecutionState.PENDING, limit: 20 })`; `canApplyForMembership()`; the QuickVote path `buildVoteMsg` + `doContractBroadcast`. **Produces:**
```typescript
export interface HomeAction { id: string; kind: 'vote'|'sign'|'claim'|'candidature'; accent: ActionAccent; eyebrow: string; title: string; meta?: string; href: string }
export function useHomeActions(auth: LayoutContext['auth']): { actions: HomeAction[]; loading: boolean; allCaughtUp: boolean }
```

- [ ] **Step 1: failing test (`useHomeActions`)** — mock `useUnvotedProposals` to return 2 proposals and `api.transactions` to return 1 pending tx the user hasn't signed; assert `actions` has a `vote` (accent `teal`) + a `sign` (accent `amber`), `allCaughtUp === false`. Empty mocks → `allCaughtUp === true`.
- [ ] **Step 2** — Run: FAIL.
- [ ] **Step 3** — Implement `useHomeActions`: map unvoted proposals → `{kind:'vote', accent:'teal', eyebrow:` `vote · ${daoName}`, title: proposalTitle, meta: status, href: dao route}`; wrap `api.transactions` PENDING in `useQuery(['home','pending-tx',address], …)`, filter to txs awaiting the user's signature → `{kind:'sign', accent:'amber'}`; if `canApplyForMembership()` → a `candidature` action. Concatenate, sort vote/sign before claim/candidature.
- [ ] **Step 4** — Implement `ActionInbox.tsx`: header "Act now" + count; maps `actions` → `ActionCard`; `loading` → 3 skeleton cards; `allCaughtUp` → a single "You're all caught up" `ActionCard` (neutral) with a "browse DAOs" link (never blank). Reuse `QuickVoteWidget`'s `onVote` → `buildVoteMsg`+`doContractBroadcast` for inline voting.
- [ ] **Step 5** — Run both tests. Expected: PASS.
- [ ] **Step 6** — Commit: `feat: ActionInbox + useHomeActions (votes, signatures, candidature)`.

### Task 1.3: `VisitorHero` + connect prompt (visitor spine)

**Files:** Create `components/home/VisitorHero.tsx`; Test.

**Interfaces — Consumes:** `adena.installed`, `adena.connect`. **Produces:** conviction headline + primary "Explore DAOs" (`<a href="/:network/dao">`, no wallet) + secondary "Connect wallet" (`adena.connect()` or install link).

- [ ] **Step 1: failing test** — renders headline text; "Explore DAOs" is a link to the dao route; when `installed:false` the secondary CTA is an install link, when `true` it is a button calling `adena.connect`.
- [ ] **Step 2** — Run: FAIL.
- [ ] **Step 3** — Implement `VisitorHero` (sentence-case headline; the two CTAs; "no wallet needed to look around" hint).
- [ ] **Step 4** — Run. Expected: PASS.
- [ ] **Step 5** — Commit: `feat: VisitorHero — conviction headline + explore/connect CTAs`.

### Task 1.4: `StateBoard` + `NetworkPulsePanel`

**Files:** Create `components/home/StateBoard.tsx`, `panels/NetworkPulsePanel.tsx`, `hooks/home/useNetworkPulse.ts`; Tests.

**Interfaces — Consumes:** `getNetworkStats(rpcUrl, undefined, signal)` → `NetworkStats`, `fetchTractionMetrics()` → `TractionMetrics`. **Produces:** `useNetworkPulse()` → `useQuery(['home','pulse'], …, { staleTime: 30_000, refetchInterval: 30_000 })` returning `{ blockHeight, avgBlockTime, totalValidators, daoCount, memberCount, loading }`.

- [ ] **Step 1: failing test** — mock `getNetworkStats`/`fetchTractionMetrics`; assert the panel shows block time, validators, and a count; on error the panel renders a neutral "—" state, never throws (per-panel isolation).
- [ ] **Step 2** — Run: FAIL.
- [ ] **Step 3** — Implement `useNetworkPulse` (React Query, Page-Visibility handled by `refetchOnWindowFocus:false` + interval). Implement `StateBoard` (responsive grid: `repeat(auto-fit,minmax(220px,1fr))`, lazy-mount below-fold panels via IntersectionObserver) and `NetworkPulsePanel` (stat `ActionCard`s).
- [ ] **Step 4** — Run. Expected: PASS.
- [ ] **Step 5** — Commit: `feat: StateBoard + NetworkPulse panel (React Query, isolated errors)`.

### Task 1.5: `YourWorldsPanel` (reuse DashboardDAOList)

**Files:** Create `components/home/panels/YourWorldsPanel.tsx`; Test.

**Interfaces — Consumes:** `getSavedDAOsForOrg(orgId)` → `SavedDAO[]`, the existing `DashboardDAOList` (`{ savedDAOs, userAddress }`). **Produces:** member-only panel; empty (no saved DAOs) → cold-start invitation ("Join a DAO · claim testnet GNOT · try a quest"), never blank.

- [ ] **Step 1: failing test** — with saved DAOs → renders `DashboardDAOList`; with none → renders the cold-start invitation links (not an empty box).
- [ ] **Step 2** — Run: FAIL.
- [ ] **Step 3** — Implement (read `useOrg()`/active org → `getSavedDAOsForOrg`; reuse `DashboardDAOList`; the empty branch renders invitation `ActionCard`s).
- [ ] **Step 4** — Run. Expected: PASS.
- [ ] **Step 5** — Commit: `feat: YourWorlds panel reusing DashboardDAOList + cold-start invite`.

### Task 1.6: `EcosystemPanel` (gated counts)

**Files:** Create `components/home/panels/EcosystemPanel.tsx`, `hooks/home/useEcosystemCounts.ts`; Test.

**Interfaces — Consumes:** `listFactoryTokens(rpcUrl)`, `fetchAgents()`, `getValidators(rpcUrl)`, `fetchTractionMetrics()` (daoCount), each behind `isTokenFactoryValid()` / `isNftLaunchpadValid()` / etc. **Produces:** `useEcosystemCounts()` → `useQuery(['home','ecosystem'], …, { staleTime: 120_000 })` → `{ daos, tokens, collections, agents, validators }` (a count is `null` if its realm is invalid on this network → tile shows "—", never errors). Each tile links to the feature route + carries an "as of #block" stamp (snapshot tier, no fake timestamps).

- [ ] **Step 1: failing test** — mock the count fns; assert tiles render with counts and deep-link hrefs; a count that throws → that tile shows "—" while siblings render (isolation); an invalid realm → tile omitted/"—".
- [ ] **Step 2** — Run: FAIL.
- [ ] **Step 3** — Implement the hook (`Promise.allSettled` over the gated count fns; never reject) + panel (tile grid, snapshot stamp).
- [ ] **Step 4** — Run. Expected: PASS.
- [ ] **Step 5** — Commit: `feat: Ecosystem directory panel (gated counts, per-tile isolation)`.

### Task 1.7: `FeaturedDaoPanel` + verifiability + empty-state sweep

**Files:** Create `components/home/panels/FeaturedDaoPanel.tsx`; Test.

**Interfaces — Consumes:** a configured featured DAO realm path (add `FEATURED_DAO` to `lib/config.ts`), `getDAOConfig` + `getDAOProposals` (reuse from `lib/dao/*`), `isRealmValidOn`. **Produces:** members + visitors panel showing the featured DAO's live state (members, treasury, open proposals) with a "verify on-chain ↗" link to gnoweb (`${gnowebUrl}/r/${path}`) and "read proposal without connecting →".

- [ ] **Step 1: failing test** — renders DAO name, an open-proposal headline, a "verify on-chain" link to the gnoweb URL; if the featured realm is invalid on the network the panel self-hides (no error).
- [ ] **Step 2** — Run: FAIL.
- [ ] **Step 3** — Implement panel + add `FEATURED_DAO` per-network to `config.ts`. Sweep all panels for empty/error/loading states (each must render an action or "—", never blank).
- [ ] **Step 4** — Run. Expected: PASS.
- [ ] **Step 5** — Commit: `feat: FeaturedDao panel with on-chain verify link; empty-state sweep`.

### Task 1.8: `ValidatorsPanel` (network-health highlight)

**Files:** Create `components/home/panels/ValidatorsPanel.tsx`, `hooks/home/useValidatorHealth.ts`; Test.

**Interfaces — Consumes:** `getValidators(rpcUrl)` → `ValidatorInfo[]`; `computeNetworkHealth(validators)` → `NetworkHealthSummary { healthy; degraded; down; unknown; avgUptime?; latestIncident? }` (`lib/validatorHealth.ts`); `getNetworkStats(rpcUrl)`. **Produces:** `useValidatorHealth()` → `useQuery(['home','validators'], …, { staleTime: 60_000 })` → `{ status: 'healthy'|'degraded'|'down'; active: number; total: number; avgUptime: number|null; latestIncident?: { severity; moniker; details }; loading }`. **CHEAP SUBSET ONLY** — do NOT call `fetchLastBlockSignatures` / `fetchValoperMonikers` / `getAggregatedNetPeers` (the heavy /validators-page enrichment, ~100+ RPC calls).

- [ ] **Step 1: failing test** — mock `getValidators` → 14 active + `computeNetworkHealth` → `{healthy:14,degraded:0,down:0}`; assert the panel shows "Healthy", "14 / 14", and a "view validators" link to `/:network/validators`. A thrown fetch → panel shows "—" (siblings unaffected).
- [ ] **Step 2** — Run: FAIL.
- [ ] **Step 3** — Implement `useValidatorHealth` (`getValidators` → `computeNetworkHealth`; `status = down>0 ? 'down' : degraded>0 ? 'degraded' : 'healthy'`; `active = validators.filter(v=>v.active).length`). Implement `ValidatorsPanel` (health dot + status + active/total + avg participation + latest incident if any + CTA).
- [ ] **Step 4** — Run. Expected: PASS.
- [ ] **Step 5** — Commit: `feat: Validators network-health preview panel (cheap subset)`.

### Task 1.9: `GnolovePanel` (top contributors)

**Files:** Create `components/home/panels/GnolovePanel.tsx`, `hooks/home/useGnoloveHighlights.ts`; Test.

**Interfaces — Consumes:** `getContributors(timeFilter?, excludeLogins?, repositories?, signal?)` → `TContributorsResponse { users: { login; avatarUrl; score; totalPRs; … }[]; lastSyncedAt? }` (`lib/gnoloveApi.ts`; 1 HTTP call to the Gnolove API). **Produces:** `useGnoloveHighlights()` → `useQuery(['home','gnolove'], …, { staleTime: 300_000 })` → `{ top: { login; score }[]; contributorCount: number; loading }` (sort `users` by `score` desc, slice 3).

- [ ] **Step 1: failing test** — mock `getContributors` → 5 users; assert top 3 by score render (login + score) + "N contributors" + an "open gnolove" link to `/:network/gnolove`.
- [ ] **Step 2** — Run: FAIL.
- [ ] **Step 3** — Implement hook (fetch, sort, slice 3) + panel (mini leaderboard + count footer + CTA).
- [ ] **Step 4** — Run. Expected: PASS.
- [ ] **Step 5** — Commit: `feat: Gnolove top-contributors preview panel`.

### Task 1.10: `DirectoryPanel` (members + search)

**Files:** Create `components/home/panels/DirectoryPanel.tsx`, `hooks/home/useDirectoryHighlights.ts`; Test.

**Interfaces — Consumes:** `fetchTractionMetrics()` → `{ contributorCount }` (member count); `parseUserRegistry(render)` → `{ name; address; avatarUrl? }[]` (`lib/directory.ts`; one ABCI `Render` of the users registry realm, gated by `isRealmValidOn`). **Produces:** `useDirectoryHighlights()` → `useQuery(['home','directory'], …, { staleTime: 300_000 })` → `{ memberCount: number; members: { name; address; avatarUrl? }[]; loading }`. **HONESTY:** members shown as "members" (registry order) + count + search CTA — NOT labelled "newest"; true newest/featured ordering needs the backend `ListProfiles` endpoint (Phase 2, Task 2.4).

- [ ] **Step 1: failing test** — mock count + registry → assert member count + a few member chips + a "search / open directory" link to `/:network/directory`.
- [ ] **Step 2** — Run: FAIL.
- [ ] **Step 3** — Implement hook + panel (count + member avatars/handles + "find anyone by address or username" + CTA).
- [ ] **Step 4** — Run. Expected: PASS.
- [ ] **Step 5** — Commit: `feat: Directory members preview panel (count + registry + search)`.

### Task 1.11: Mobile-first + a11y + retire Landing/Remotion

**Files:** Modify `components/home/home.css`, `App.tsx`; delete `pages/Landing.tsx`, `pages/landing.css`, `remotion/compositions/*` imports from the home path.

- [ ] **Step 1** — Add real breakpoints to `home.css`: spine + state board stack to one prioritized column ≤768px (member order: ActionInbox → NetworkPulse → YourWorlds → FeaturedDao → Validators → Gnolove → Directory → Ecosystem quick-nav); ensure a thumb-reachable primary action; verify nothing overflows at 375/320px.
- [ ] **Step 2** — A11y pass: every card control is a real `<button>`/`<a>` (already enforced by `ActionCard`), focus-visible rings present, `prefers-reduced-motion` respected for any pulse, headings/landmarks correct. Add a test asserting `getByRole('button'/'link')` reachability for the inbox.
- [ ] **Step 3** — Remove `Landing` from the route graph in `App.tsx` (and its lazy import); delete `Landing.tsx`/`landing.css`/unused remotion compositions. Confirm the Remotion chunk drops: `cd frontend && npx vite build && ls -la dist/assets | grep -i remotion` (expect none on the home route).
- [ ] **Step 4** — Run full suite + build: `cd frontend && npx vitest run && npx vite build`. Expected: PASS, clean build.
- [ ] **Step 5** — Commit: `feat: mobile-first home, a11y pass, retire Landing + Remotion from the home path`.

**End of Phase 1 → shippable redesign (cheap-now, no backend/indexer dependency).**

---

## Phase 2 — Server-side snapshot (outline; do after Phase 1 ships)

Moves the StateBoard's read fan-out off the client to one cached backend call (O(1) RPC regardless of traffic), per the fullstack/gno-core seats.

- **Task 2.1** — Proto: add `GetHomeSnapshotRequest/Response` + `rpc GetHomeSnapshot` to `MultisigService` in `api/memba/v1/memba.proto`; `buf generate` (regenerates Go iface + TS client). Response carries ecosystem counts + featured-DAO state + network pulse, each with `as_of_block`.
- **Task 2.2** — Go handler `backend/internal/service/home_rpc.go` following the `GetNFTActivity` pattern (`nft_rpc.go:63`): aggregate from existing tables (`nft_collections`, `nft_tokens`, `profiles`, `user_quests`) + cached chain reads; short server-side TTL. Auto-mounted by `NewMultisigServiceHandler` (no registration).
- **Task 2.3** — Frontend `lib/homeApi.ts:fetchHomeSnapshot()`; swap `useNetworkPulse`/`useEcosystemCounts`/`FeaturedDao` to read the one snapshot query; keep the per-source hooks as fallback when the endpoint is absent (mirror `fetchNFTActivity`'s indexer-first/on-chain-fallback shape).
- **Task 2.4** — Directory "newest/featured members": add `rpc ListProfiles(ListProfilesRequest) returns (ListProfilesResponse)` over the `profiles` table (today only `GetProfile` exists — no list), ordered by a new `created_at` / `updated_at`; `buf generate`; handler in `profile_rpc.go`. Then `useDirectoryHighlights` shows real newest members instead of registry order. Until this lands, v1 shows member count + registry members + search (Task 1.10).

## Phase 3 — Earned "Activity" card (outline; after the indexer widens)

The deferred A signature, now honest.

- **Task 3.1** — Widen `backend/internal/indexer/dispatch.go` beyond NFT events into a generic event projection (the raw ledger `nft_raw_events` already preserves all attrs for replay); add a `GetHomeFeed` rpc over the projection.
- **Task 3.2** — Add an "Activity" `ActionCard` list to the StateBoard (below the fold, opt-in), reusing the `NFTActivityFeed` rendering shape. This is the live-ledger from Option A — shipped only once it's backed by real timestamps.

---

## Self-review

- **Spec coverage:** every Option B element (§4) maps to a task — action inbox (1.2), visitor door (1.3), state board: pulse (1.4) / your-worlds (1.5) / ecosystem quick-nav (1.6) / featured DAO (1.7) / Validators (1.8) / Gnolove (1.9) / Directory (1.10), two-doors-one-component (1.1), mobile-first + empty states (1.11 + per-panel), token/type cleanup (0.1), app-wide React Query (0.2), single ActionCard primitive (0.4), honest 3-tier data (constraints + 1.4/1.6/1.7/1.8/1.10), server snapshot (Phase 2), earned ledger (Phase 3). ✓
- **Signatures verified** against the codebase reference (api.transactions params, getNetworkStats, useUnvotedProposals, getSavedDAOsForOrg, buildVoteMsg/doContractBroadcast, isRealmValidOn). ✓
- **No placeholders;** types consistent across tasks (`HomeAction`, `ActionCardProps`, `useNetworkPulse` return). ✓

## Execution (when you give the go)

- **Option 1 — Subagent-driven (recommended):** one fresh subagent per task, two-stage review between tasks.
- **Option 2 — Inline:** execute in-session in batches with checkpoints.

Phase 0 + Phase 1 are independently shippable and indexer-free; Phases 2-3 are deferred follow-ups.
