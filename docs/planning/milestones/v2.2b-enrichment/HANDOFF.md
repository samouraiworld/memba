# v2.2b+c Handoff — Directory Enrichment + Quick Wins

> v2.2b: PR #77 (merged) | v2.2c: PR #78 (merged)
> Status: ✅ SHIPPED
> Branch: `dev/v2`

## What Was Done

### v2.2b — Directory Enrichment (PR #77, 5 commits, +658/-56)

1. **DAO Category Tags** — `getDAOCategory()` heuristic (6 categories), colored badges
2. **User Avatar Enhancement** — gradient CSS + first-letter placeholder, `img` support
3. **Token Detail Navigation** — already in v2.2a (confirmed)
4. **Per-DAO Notification View** — `getNotificationsForDAO()`, `getUnreadCountForDAO()`, `getDAOUnreadCount` hook
5. **Contribution Scores** — `calculateContributionScores()` with Set-indexed O(1) lookup, activity badges
6. **DAO Auto-Discovery** — `discoverDAOs()` ABCI probe, `addDiscoveryProbe()` API, sessionStorage cache
7. **Deep Review** — 7 findings (3 important, 4 minor), all fixed

### v2.2c — Quick Wins (PR #78, 1 commit, +78/-5)

1. **Sidebar Notification Badges** — `notifUnreadCount` prop on Sidebar, combined badge on DAOs nav
2. **IPFS Avatars in Directory** — `batchFetchUserAvatars()` via gnolove API, sessionStorage cache
3. **Typed BankMsgSend** — `BankMsgSend` interface replaces untyped `object` return

## What's NOT Done (Next Agent)

1. **v2.5a Channel Pages** — Standalone `/channels/:daoSlug` route (BoardView reuse)
2. **v2.5b Real-time UX** — 10s polling, "new messages" toast, presence
3. **v2.5c Audio/Video** — Jitsi Meet iframe, voice/video channel types
4. **v3.0a Extension Hub** — Plugin marketplace, install/uninstall per-DAO
5. **v3.0b NFT Integration** — GRC721 minting, IPFS gallery
6. **v3.0c AI Facilitator** — Proposal summarizer, voting guidance

### Still Deferred (Low Priority)

| Feature | Reason |
|---------|--------|
| Validator monikers | Needs upstream Gno support |
| Faucet Phase 3 (treasury signing) | Backend concern |
| GnoSwap Slippage | Deferred by user decision |

## Technical Notes

### New APIs Added This Session
- `getDAOCategory(path, name)` — heuristic DAO categorization
- `calculateContributionScores(users, memberMap)` — Set-indexed scoring
- `batchFetchUserAvatars(addresses, apiUrl)` — gnolove batch fetch
- `discoverDAOs()` / `addDiscoveryProbe()` / `getDiscoveryProbes()` — DAO discovery
- `getNotificationsForDAO()` / `getUnreadCountForDAO()` — per-DAO notification filtering
- `BankMsgSend` interface — typed faucet message

### Quality Gates
- 665 unit tests (29 files)
- 236 E2E tests (11 spec files)
- tsc 0, lint 0
- Build: 449KB (129KB gzip)
- package.json: 2.2.0-alpha.1
