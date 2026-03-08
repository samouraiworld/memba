# v2.1b Handoff — Validators & Notifications

> Branch: `feat/v2.1b-validators-notifications` (deleted)
> Status: ✅ SHIPPED
> PR: #75 → `dev/v2` (merged)

## What Was Done

### Phase 1 (Original v2.1b)

#### Feature 1: Notification Center (6 files, 27 tests)
- **Data layer** (`lib/notifications.ts`): CRUD, per-wallet localStorage isolation, sanitization, FIFO eviction (100 cap), dedup with monotonic counter, date grouping, relative time formatting
- **Hook** (`hooks/useNotifications.ts`): 30s ABCI polling, optional daoPath (null = sync-only), Page Visibility API
- **UI** (`NotificationBell.tsx`): Bell icon + badge, dropdown panel with ARIA (aria-expanded, role=menu, focus return), outside-click + Escape close
- **Integration**: Wired into Layout → TopBar, renders when connected

#### Feature 2: Validator Dashboard (6 files, 13 tests)
- **Data layer** (`lib/validators.ts`): Tendermint RPC (/validators, /status, /block), AbortSignal support, prefetched validators optimization, uptime calculation
- **Page** (`Validators.tsx`): 4 stats cards, voting power distribution bar, sortable table (rank/power/share), search, 30s auto-refresh with Page Visibility API
- **Integration**: Lazy-loaded route `/validators` in App.tsx, sidebar nav link

#### Feature 3: Gasless Onboarding Phase 1 (2 files, 16 tests)
- **Data layer** (`lib/faucet.ts`): 7-day cooldown, per-address localStorage keys, MsgSend builder

#### Audit (15 fixes)
- All critical, important, and minor items from dual-round review resolved
- Detailed findings in [AUDIT.md](AUDIT.md)

### Phase 2 (Completion)

#### Faucet Claim UI (3 files, 12 tests)
- `FaucetCard.tsx` — Dashboard card with eligibility check, cooldown timer, external faucet link
- Premium glassmorphism styling (`faucet-card.css`), mobile responsive
- Shows when wallet connected + eligible, hides after claim or during cooldown

#### Multi-DAO Notification Polling (2 files modified)
- Refactored `useNotifications` from `daoPath: string | null` to `daoPaths: string[]`
- Layout polls all saved DAOs (`getSavedDAOs()`) with max 5/cycle performance cap
- Per-DAO tracking via `lastKnownCounts` Map, bell icon aggregates all

#### Validator Pagination (3 files, 5 tests)
- Auto-paginate `getValidators()` for >100 validators (parallel page fetch)
- Client-side page controls: page size (25/50/100), prev/next, "Showing X-Y of Z"

## What's NOT Done (Next Agent)

1. **Merge PR #75** when CI passes
2. **Per-DAO notification view** — DAOHome could show DAO-specific notification count/filter
3. **Faucet Phase 3** — actual treasury signing mechanism (backend concern)
4. **Nice-to-have**: typed `MsgSend` return, validator moniker display

## Technical Notes

### RPC Configuration
- Validators use Tendermint HTTP endpoints (GET requests to `/validators`, `/status`, `/block`)
- These are different from the ABCI JSON-RPC POST used for DAO queries
- Both use `GNO_RPC_URL` from `lib/config.ts`
- RPC domain validation from v1.3.1 applies to both

### localStorage Keys
- Notifications: `memba_notifications_{address}` (per wallet)
- Faucet: `memba_faucet_{address}` (per address, I9 fix)
- Legacy: `memba_faucet_claims` (shared, migrated from)

### Dependencies
- No new npm packages added
- `@phosphor-icons/react` — `Drop` for faucet icon, `LinkSimpleHorizontal` for sidebar
- All existing Phosphor icons already installed
