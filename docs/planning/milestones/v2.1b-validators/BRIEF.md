# v2.1b — Validators & Notifications (BRIEF)

> **Status**: ⬜ PLANNED | **Effort**: ~3 weeks | **Depends on**: v2.1a
> **Branch**: `feat/v2.1b-*` → `dev/v2`

---

## Objective

Add a professional Validator Dashboard (Mintscan-inspired), in-app Notification Center, and gasless onboarding for MembaDAO candidates.

## Scope

### ✅ In Scope

1. **Validator Dashboard**
   - Validator list: active/inactive, moniker, commission, voting power, uptime
   - Validator detail: delegations, rewards, slashing history, proposed blocks
   - Network overview: block height, avg block time, bonded ratio, inflation, total supply
   - Staking info: commission rates, delegation stats, reward calculator
   - Data source: Gno RPC ABCI queries + staking module (if available)

2. **Notification Center**
   - In-app bell icon in header
   - Notification types: new proposals, vote results, candidature updates
   - Read/unread state (localStorage)
   - Badge count for unread notifications

3. **Gasless Onboarding**
   - MembaDAO treasury-funded faucet
   - First 3 GNOT sponsored for new candidates
   - Rate limiting: 1 claim per wallet, cooldown period
   - Sybil resistance: wallet age check or minimum $MEMBA holding

### ❌ Non-Goals (v2.1b)

- Staking/delegation UI (v3.5)
- Push notifications (v2.3)
- Mobile app (v3.5)

## Acceptance Criteria

- [ ] Validator Dashboard shows all active validators with key metrics
- [ ] Validator detail page with delegation/reward/slashing data
- [ ] Network overview with real-time block height and chain stats
- [ ] Notification bell shows unread count
- [ ] New proposals trigger notifications for DAO members
- [ ] Gasless faucet delivers 3 GNOT to approved candidates
- [ ] Sybil resistance is active (rate limiting)
- [ ] All tests pass, new E2E coverage added
- [ ] AUDIT.md completed
