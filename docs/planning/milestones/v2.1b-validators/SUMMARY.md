# v2.1b Summary — Validators & Notifications

> Milestone: v2.1b
> Branch: `feat/v2.1b-validators-notifications`
> Date: 2026-03-08
> Commits: 4 (`809aa4d`, `c704704`, `f69a2bf`, `fc6363e`)

## Scope

| Feature | Status | Tests |
|---------|--------|-------|
| Notification Center | ✅ Complete | 27 |
| Validator Dashboard | ✅ Complete | 13 |
| Gasless Onboarding (Phase 1) | ✅ Data layer only | 16 |
| Dual-Round Audit | ✅ 15/15 fixed | — |

## Key Metrics

| Before | After |
|--------|-------|
| 360 unit tests (18 files) | 415 unit tests (21 files) |
| 0 new features | 3 features + 14 new files |
| No validator page | `/validators` with live RPC data |
| No notifications | Bell icon + dropdown in header |

## Architecture Decisions

1. **Tendermint HTTP RPC** — used GET-style path endpoints (`/validators`, `/status`) rather than JSON-RPC POST for Tendermint queries. Simpler, better caching.
2. **Optional daoPath** — notification hook accepts `null` daoPath for sync-only mode, enabling per-view polling in future.
3. **Per-address faucet storage** — each address gets its own localStorage key, preventing FIFO eviction-based cooldown bypass.
4. **Page Visibility API** — both validator polling and notification polling pause when tab is hidden.

## Files Added/Modified

### New Files (14)
- `lib/notifications.ts` + `.test.ts`
- `lib/validators.ts` + `.test.ts`
- `lib/faucet.ts` + `.test.ts`
- `hooks/useNotifications.ts`
- `components/layout/NotificationBell.tsx`
- `components/layout/notification-bell.css`
- `pages/Validators.tsx`
- `pages/validators.css`

### Modified Files (4)
- `App.tsx` — lazy route for `/validators`
- `components/layout/Sidebar.tsx` — Validators nav link
- `components/layout/Layout.tsx` — useNotifications hook integration
- `components/layout/TopBar.tsx` — NotificationBell rendering
