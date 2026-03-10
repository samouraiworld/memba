# v2.13 — Expert Team Implementation Plan

> **Prepared**: 2026-03-10 | **Baseline**: v2.12.0 (PR #96 merged)
> **Quality Gates**: 754 unit, 142 E2E, 0 lint, 469KB (134KB gzip)

## Strategic Context

| Factor | Implication |
|--------|-------------|
| **Betanet ~March 12** | 2 days — must be deployment-ready |
| **Mainnet ~April 2026** | 4 weeks — full production hardening window |
| **`r/sys/users` migration** (gno PR #5194) | 13 references to `r/gnoland/users` — MUST migrate before chain upgrade |
| **CORS PR #60 pending** | Validator monikers blocked — decouple from moniker display |

---

## Priority Tier 1 — CRITICAL (Betanet Readiness)

### 1.1 `r/sys/users` Migration
> **Risk**: Chain will remove `r/gnoland/users`. 13 references break.

#### [MODIFY] [config.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/config.ts)
- Add `r/sys/users` to `NETWORKS.betanet.userRegistryPath`
- `getUserRegistryPath()` already abstracts — just update config values

#### [MODIFY] [shared.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/dao/shared.ts)
- Verify `USER_REGISTRY` reads from `getUserRegistryPath()` (already does ✅)
- No code change needed — config-only migration

#### Verification
- `grep -r "gnoland/users" src/` → should return 0 hits after config change
- Unit tests for `getUserRegistryPath()` with betanet config

---

### 1.2 DAOHome Decomposition (741 LOC → ~300 LOC)
> **Risk**: Largest file in the codebase. Merge conflicts, maintenance burden, slow IDE.

#### [NEW] [components/dao/DAOHeader.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/dao/DAOHeader.tsx)
- Extract identity card (name, address, description, slug)
- ~120 LOC

#### [NEW] [components/dao/DAOStats.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/dao/DAOStats.tsx)
- Extract stat grid (members, active, proposals, health score, turnout, power)
- ~100 LOC

#### [NEW] [components/dao/ProposalSection.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/dao/ProposalSection.tsx)
- Extract proposal listing + "Awaiting Execution" + pagination
- ~200 LOC

#### [MODIFY] [DAOHome.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/pages/DAOHome.tsx)
- Orchestrator only: data fetching + composition of sub-components
- Target: ~300 LOC (down from 741)

#### Verification
- All 142 E2E tests pass (no visual regression)
- `DAOHome.tsx` under 350 LOC

---

### 1.3 Race Condition Hardening
> **Risk**: 15 pages use `catch {}` — silent failures mask real bugs during betanet load.

#### [MODIFY] Multiple pages
- Replace empty `catch {}` with `catch (err) { /* silent: expected in offline mode */ }` or proper error toasts
- Priority pages (by file size and traffic):
  1. `DAOHome.tsx` — 741 LOC, most-visited DAO page
  2. `DAOList.tsx` — 511 LOC, DAO entry point
  3. `ProposalView.tsx` — 484 LOC, voting flow
  4. `Treasury.tsx` — treasury page

#### [MODIFY] [proposals.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/dao/proposals.ts)
- Add `AbortController` support to `getDAOProposals()` — prevents stale fetches when navigating away mid-load
- Wire into `useEffect` cleanup in `DAOHome.tsx`

#### Verification
- Open DevTools → throttle to 3G → navigate rapidly between DAOs
- No uncaught promise rejections in console

---

## Priority Tier 2 — HIGH (Competitive Edge)

### 2.1 Betanet Deployment Pipeline
> **Business**: First Gno app on betanet = competitive advantage.

#### [MODIFY] [config.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/config.ts)
- Add complete `betanet` network entry with validated RPC URL, chain ID, user registry
- Gate `isTestnet()` flag for conditional UI (remove TESTNET badges on betanet)

#### [MODIFY] [netlify.toml](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/netlify.toml)
- Add `[[redirects]]` for betanet environment
- CSP update for betanet RPC domain

#### [NEW] [docs/BETANET_DEPLOYMENT.md](file:///Users/zxxma/Desktop/Code/Gno/Memba/docs/BETANET_DEPLOYMENT.md)
- Step-by-step betanet deployment checklist
- Environment variables, DNS, verification

#### Verification
- Build with `VITE_GNO_NETWORK=betanet` → app loads, RPC queries succeed
- CSP allows betanet RPC connections

---

### 2.2 Real-time Proposal Notifications (WebSocket-Ready)
> **UX**: 30s polling → Unnecessary ABCI load. Prepare for Tendermint WebSocket subscription.

#### [NEW] [lib/proposalStream.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/proposalStream.ts)
- Abstract proposal data source behind `ProposalStream` interface
- `PollingStrategy` (current) and `WebSocketStrategy` (future)
- Strategy selection via feature flag

#### [MODIFY] [useNotifications.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/hooks/useNotifications.ts)
- Use `ProposalStream` instead of direct ABCI polling
- Reducible polling interval: 30s → 10s when user is on DAO page

#### Verification
- Notification bell still updates within 30s
- No additional ABCI calls compared to current implementation

---

### 2.3 CSS Extraction Sprint
> **Engineering**: 30+ pages use inline styles. Blocks theming, dark/light mode, and maintainability.

#### [NEW] [pages/dao-home.css](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/pages/dao-home.css)
- Extract `DAOHome.tsx` inline styles (estimated 300+ style objects)
- Use existing Kodera design tokens (`--k-bg-card`, `--k-text-primary`, etc.)

#### [NEW] [pages/proposal-view.css](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/pages/proposal-view.css)
- Extract `ProposalView.tsx` inline styles

#### Priority order (by LOC):
1. `DAOHome.tsx` (741 LOC) — most inline styles
2. `Directory.tsx` (597 LOC) — already has `directory.css` but still has inline
3. `DAOList.tsx` (511 LOC)
4. `ProposalView.tsx` (484 LOC)

#### Verification
- Visual regression: screenshots before/after using Playwright `expect(page).toHaveScreenshot()`
- No inline `style={}` props remaining in extracted pages

---

### 2.4 Unified Cache Layer
> **Performance**: 4 separate cache implementations (sessionStorage × 3, localStorage × 1, in-memory × 1). Inconsistent TTLs, no eviction.

#### [NEW] [lib/cache.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/cache.ts)
- Generic `CacheLayer<T>` with pluggable storage backend:
  - `MemoryCache` — in-memory Map (current proposal cache)
  - `SessionCache` — sessionStorage (directory, monitoring, vote scanner)
  - `PersistentCache` — localStorage (usernames)
- Unified TTL, max-entries eviction, serialization
- `cache.get(key)`, `cache.set(key, value, ttl?)`, `cache.invalidate(pattern)`

#### [MODIFY] Refactor consumers:
  - `proposals.ts` → `MemoryCache`
  - `directory.ts` → `SessionCache`
  - `gnomonitoring.ts` → `SessionCache`
  - `voteScanner.ts` → `SessionCache`
  - `shared.ts` (usernames) → `PersistentCache`

#### Verification
- All 754 unit tests pass (cache is transparent to consumers)
- `grep -r "sessionStorage\|localStorage" src/lib/` → only `cache.ts` and `daoSlug.ts` (saved DAOs are user data, not cache)

---

## Priority Tier 3 — FUTURE (Post-Mainnet)

### 3.1 Progressive Web App (PWA)
> **Mobile**: Installable on home screen, push notifications, offline shell.

#### [NEW] `vite-plugin-pwa` integration
- Service worker for static asset caching
- App manifest (`manifest.json`) with Memba icons
- Offline fallback page
- Install prompt banner

#### Verification
- Lighthouse PWA audit score ≥ 90
- Install prompt appears on mobile Chrome

---

### 3.2 Analytics & Observability
> **Product**: No user behavior data today. Blind to feature adoption.

#### [NEW] [lib/analytics.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/analytics.ts)
- Privacy-first analytics (no PII, no cookies)
- Track: page views, DAO actions (vote, propose, execute), wallet connections
- Backend: self-hosted Plausible or PostHog (no third-party)
- CSP update for analytics domain

---

## Recommended Session Order

| Session | Focus | Est. Duration |
|---------|-------|---------------|
| **S1** | 1.1 `r/sys/users` + 1.2 DAOHome decomposition | 1 session |
| **S2** | 1.3 Race conditions + 2.1 Betanet config | 1 session |
| **S3** | 2.3 CSS extraction (top 4 pages) | 1 session |
| **S4** | 2.4 Unified cache layer | 1 session |
| **S5** | 2.2 Proposal stream abstraction | 1 session |
| **S6+** | Tier 3 items (PWA, analytics) | 2+ sessions |

---

## Verification Plan

### Automated
```bash
npm run build          # TypeScript + Vite (target: <470KB)
npm run lint           # ESLint (target: 0 errors)
npm test -- --run      # Unit tests (target: 754+)
npx playwright test    # E2E (target: 142+)
```

### Manual
- Betanet RPC connection test (when available)
- Mobile Safari + Chrome walkthrough
- 3G network throttling stress test

## User Review Required

> [!IMPORTANT]
> **Betanet timeline**: Is March 12 confirmed? This determines whether we prioritize S1+S2 (betanet readiness) or S3+S4 (quality).

> [!IMPORTANT]
> **`r/sys/users` migration**: Has the gno team deployed the new `r/sys/users` realm to test11 yet? We need to test against a live instance before betanet.

> [!WARNING]
> **CSS extraction (2.3)** is a large refactor with high regression risk. Recommend doing it with Playwright screenshot assertions for safety. Would you prefer to defer this to post-betanet?
