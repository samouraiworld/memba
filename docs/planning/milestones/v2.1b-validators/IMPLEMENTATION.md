# v2.1b — Validators & Notifications (IMPLEMENTATION)

> **Branch**: `feat/v2.1b-validators-notifications` → `dev/v2`
> **Depends on**: v2.1a (✅ PR #74)

---

## Implementation Order

1. **Notification Center** (Feature 2 in BRIEF) — smallest, highest UX impact, unblocked
2. **Validator Dashboard** (Feature 1 in BRIEF) — biggest scope, needs ABCI research
3. **Gasless Onboarding** (Feature 3 in BRIEF) — depends on treasury realm

---

## Feature 1: Notification Center

### Data Layer

#### [NEW] `lib/notifications.ts`

Notification system with localStorage persistence:

```typescript
interface Notification {
    id: string           // unique - "{type}:{daoPath}:{identifier}:{timestamp}"
    type: "proposal_new" | "proposal_passed" | "proposal_failed" | "candidature_submitted" | "candidature_approved" | "candidature_rejected"
    title: string        // "New Proposal: Add Member"
    body: string         // "Proposal #12 created in samourai-dao"
    daoPath: string      // "gno.land/r/samcrew/samourai_dao"
    link: string         // "/dao/samourai-dao/proposal/12"
    timestamp: number    // Date.now()
    read: boolean        // default false
}
```

Key functions:
- `getNotifications(): Notification[]` — read from localStorage, sorted newest-first
- `addNotification(n: Omit<Notification, "id" | "timestamp" | "read">): void`
- `markRead(id: string): void` — mark single notification as read
- `markAllRead(): void` — mark all as read
- `getUnreadCount(): number` — count of unread notifications
- `clearNotifications(): void` — purge all (settings action)

Storage key: `memba_notifications_{address}` — per-wallet isolation.
Max 100 notifications stored (FIFO eviction).

#### [NEW] `lib/notifications.test.ts`

Tests for all CRUD operations, localStorage isolation per address, FIFO eviction, read/unread state.

### Polling Engine

#### [NEW] `hooks/useNotifications.ts`

React hook that polls for new notifications:

```typescript
function useNotifications(daoPath: string, address: string | null): {
    notifications: Notification[]
    unreadCount: number
    markRead: (id: string) => void
    markAllRead: () => void
}
```

- Polls ABCI every 30 seconds for new proposals (compare `proposalCount` with last known)
- On detecting new proposal: creates `proposal_new` notification
- Uses `useRef` for last-known proposal count to avoid re-renders
- Cleanup interval on unmount

### UI Components

#### [NEW] `components/layout/NotificationBell.tsx`

Bell icon in TopBar header:
- Phosphor `Bell` icon (consistent with existing icon set)
- Red badge with unread count (hidden when 0)
- Click → dropdown panel with notification list
- Each notification: icon + title + relative time + read/unread dot
- "Mark all read" button in dropdown header
- Click notification → navigate to link + mark read
- Dropdown closes on outside click

#### [MODIFY] `components/layout/TopBar.tsx`

Add `<NotificationBell />` between the network selector and connect wallet button.

---

## Feature 2: Validator Dashboard

### Data Layer

#### [NEW] `lib/validators.ts`

Validator data fetched via Gno RPC JSON-RPC (`consensus_params`, `validators`, `status`, `block`):

```typescript
interface ValidatorInfo {
    address: string       // hex address
    pubkey: string        // base64 pubkey
    votingPower: bigint   // power weight
    moniker: string       // display name (from on-chain if available)
    active: boolean       // in active set
}

interface NetworkStats {
    blockHeight: number
    blockTime: number      // avg ms between recent blocks
    totalValidators: number
    activeValidators: number
    totalVotingPower: bigint
}
```

Key functions:
- `getValidators(rpcUrl: string): Promise<ValidatorInfo[]>` — `/validators` RPC endpoint
- `getNetworkStats(rpcUrl: string): Promise<NetworkStats>` — `/status` + `/block` RPC
- `getValidatorUptime(rpcUrl: string, address: string, blocks?: number): Promise<number>` — check last N blocks for signatures

Data sources (Tendermint/CometBFT JSON-RPC — all chains support these):
- `GET /validators?per_page=100` — validator set
- `GET /status` — node status, latest block height, chain ID
- `GET /block?height=N` — block data with last_commit signatures

> **Note**: Gno does not expose a staking module via ABCI. On test11, validators are set in genesis. Commission, delegations, and slashing data are NOT available until Gno adds PoS support. The v2.1b dashboard will focus on **consensus data** that IS available via standard Tendermint RPC.

#### [NEW] `lib/validators.test.ts`

Tests for response parsing, error handling, uptime calculation.

### UI Components

#### [NEW] `pages/Validators.tsx`

Main validator page with two sections:

**Network Overview Card** (top):
- Block height (auto-refreshing every 5s)
- Active validators / total
- Total voting power
- Avg block time

**Validator Table** (below):
- Columns: Rank, Moniker/Address, Voting Power, Power %, Status (Active/Inactive)
- Sortable by voting power (default), rank
- Click row → validator detail (v2.1b-stretch — defer to v2.2 if complex)
- Search/filter by moniker

#### [MODIFY] `components/layout/Sidebar.tsx`

Add "⛓️ Validators" nav link below the "🔌 Extensions" link.

#### [MODIFY] App router

Add route: `/validators` → `<Validators />`

---

## Feature 3: Gasless Onboarding

### Data Layer

#### [NEW] `lib/faucet.ts`

Faucet logic with rate limiting:

```typescript
interface FaucetClaim {
    address: string
    claimedAt: number
    amount: number  // ugnot
}

const FAUCET_AMOUNT = 3_000_000  // 3 GNOT in ugnot
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000  // 7 days
```

Key functions:
- `canClaimFaucet(address: string): { eligible: boolean; reason?: string }` — check eligibility
- `recordFaucetClaim(address: string): void` — persist to localStorage
- `getFaucetHistory(): FaucetClaim[]` — admin audit trail

Eligibility rules:
1. Wallet connected
2. No prior claim in last 7 days
3. Must be an approved MembaDAO candidate (`isMembaDAOMember()`)

> **Note**: Actual GNOT transfer requires a funded treasury wallet. For Phase 1, this component prepares the MsgSend + UI. The treasury signing (via multisig proposal or admin key) is a backend concern deferred to deployment.

#### [NEW] `lib/faucet.test.ts`

Tests for eligibility checks, cooldown, rate limiting.

### UI Components

#### [MODIFY] `pages/DAOHome.tsx` or dedicated page

"🎁 Claim 3 GNOT" card visible to approved MembaDAO candidates:
- Shows eligibility status
- Claim button (disabled if ineligible with reason)
- Confirmation modal with amount + address

---

## Files Summary

| Action | File | Feature |
|--------|------|---------|
| NEW | `lib/notifications.ts` | Notifications |
| NEW | `lib/notifications.test.ts` | Notifications |
| NEW | `hooks/useNotifications.ts` | Notifications |
| NEW | `components/layout/NotificationBell.tsx` | Notifications |
| NEW | `pages/Validators.tsx` | Validators |
| NEW | `lib/validators.ts` | Validators |
| NEW | `lib/validators.test.ts` | Validators |
| NEW | `lib/faucet.ts` | Gasless |
| NEW | `lib/faucet.test.ts` | Gasless |
| MODIFY | `components/layout/TopBar.tsx` | Notifications |
| MODIFY | `components/layout/Sidebar.tsx` | Validators |
| MODIFY | App router (App.tsx or equivalent) | Validators |
| MODIFY | `pages/DAOHome.tsx` | Gasless |

---

## Verification Plan

### Automated Tests

```bash
# Run ALL unit tests (includes new test files)
cd frontend && npx vitest run

# TypeScript type-check
cd frontend && npx tsc --noEmit

# Lint
cd frontend && npx eslint src --max-warnings 0

# Build check
cd frontend && npm run build
```

Target: 529 + ~30 new tests = **~559 tests**, 0 tsc, 0 lint, clean build.

### Browser Verification

After implementation, visually verify via `npm run dev`:

1. **Notification Bell**: visible in header, shows badge count, dropdown opens/closes, notifications list, mark-read works
2. **Validator Page**: accessible via sidebar nav, shows network stats, validator table loads data, sorting works
3. **Faucet**: claim card visible on DAOHome for MembaDAO members, eligibility logic correct

### E2E Tests

Defer new Playwright specs to the audit phase — existing E2E suite must still pass.
