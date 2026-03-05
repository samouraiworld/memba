# v2.0-δ Polish — Milestone Brief

> **Read `SESSION_CONVENTIONS.md` before starting this milestone.**

## Scope

| Feature | Branch | Priority |
|---------|--------|----------|
| Leaderboard plugin | `feat/v2.0-delta/leaderboard-plugin` | 🟡 |
| Settings page | `feat/v2.0-delta/settings-page` | 🟡 |
| Memba Feedback Feed | `feat/v2.0-delta/feedback-feed` | 🟡 |
| Network info section | (same branch as settings) | 🔵 |
| CI/E2E improvements | `feat/v2.0-delta/testing-improvements` | 🟢 |

## Acceptance Criteria

- [ ] Leaderboard plugin: sortable table (gnolove + vote data), All time timeframe (MVP)
- [ ] Settings page: `/settings` with network, appearance, security, data export, advanced sections
- [ ] Settings links to profile page (not duplicated)
- [ ] Memba Feedback Feed: `r/samcrew/memba_feedback` board realm deployed
- [ ] Feedback Feed linked from footer + Settings
- [ ] Basic network info: chain status, block height, latest block time
- [ ] E2E tests expanded for all new v2.0 features
- [ ] CI pipeline updated with new test targets
- [ ] All docs updated, CHANGELOG complete for v2.0
- [ ] 11-perspective cross-audit documented

## Key Technical Details

### Leaderboard data sources
- `gnolove /onchain/packages/:addr` → package count
- `gnolove /users/:addr` → GitHub stats
- Memba vote scanner → governance participation
- DAO proposals parser → proposals authored

### Settings storage
- Network, appearance, gas defaults → `localStorage`
- Profile → link to `/profile/:addr` (not moved)

### Leaderboard timeframes
- **MVP**: All time only
- **v2.1+**: Add 7d / 30d filters

## Estimated Effort
~10 development days

## Dependencies
- v2.0-α + v2.0-β + v2.0-γ merged
- Board plugin working (for Feedback Feed)
- gnolove API available (for Leaderboard)
