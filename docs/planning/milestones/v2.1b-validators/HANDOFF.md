# v2.1b Handoff — Validators & Notifications

> Branch: `feat/v2.1b-validators-notifications`
> Status: Implementation + Audit COMPLETE
> Next: Merge PR #74 (v2.1a) first, then open PR for v2.1b → `dev/v2`

## What Was Done

### Feature 1: Notification Center (6 files, 27 tests)
- **Data layer** (`lib/notifications.ts`): CRUD, per-wallet localStorage isolation, sanitization, FIFO eviction (100 cap), dedup with monotonic counter, date grouping, relative time formatting
- **Hook** (`hooks/useNotifications.ts`): 30s ABCI polling, optional daoPath (null = sync-only), Page Visibility API
- **UI** (`NotificationBell.tsx`): Bell icon + badge, dropdown panel with ARIA (aria-expanded, role=menu, focus return), outside-click + Escape close
- **Integration**: Wired into Layout → TopBar, renders when connected

### Feature 2: Validator Dashboard (6 files, 13 tests)
- **Data layer** (`lib/validators.ts`): Tendermint RPC (/validators, /status, /block), AbortSignal support, prefetched validators optimization, uptime calculation
- **Page** (`Validators.tsx`): 4 stats cards, voting power distribution bar, sortable table (rank/power/share), search, 30s auto-refresh with Page Visibility API
- **Integration**: Lazy-loaded route `/validators` in App.tsx, sidebar nav link

### Feature 3: Gasless Onboarding Phase 1 (2 files, 16 tests)
- **Data layer** (`lib/faucet.ts`): 7-day cooldown, per-address localStorage keys, MsgSend builder
- **Phase 2 needed**: Wire faucet UI into DAOHome + treasury signing mechanism

### Audit (15 fixes)
- All critical, important, and minor items from dual-round review resolved
- Detailed findings in [AUDIT.md](AUDIT.md)

## What's NOT Done (Next Agent)

1. **Open PR** for `feat/v2.1b-validators-notifications` → `dev/v2`
2. **Merge PR #74 first** (v2.1a Community Foundation) — may need rebase
3. **Faucet UI** — no frontend claim component yet (Phase 2)
4. **Multi-DAO polling** — C3 fix scoped notifications to sync-only in Layout. Per-DAO polling should be added to individual DAO views (DAOHome component)
5. **Pagination** — validators list capped at 100 (`per_page=100`), will need paginated fetch for mainnet with >100 validators

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
- `@phosphor-icons/react` — `LinkSimpleHorizontal` for sidebar
- All existing Phosphor icons already installed
