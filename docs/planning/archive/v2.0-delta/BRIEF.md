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

- [x] Leaderboard plugin: sortable table (gnolove + vote data), All time timeframe (MVP)
- [x] Settings page: `/settings` with network, gas defaults, profile link, advanced sections
- [x] Settings links to profile page (not duplicated)
- [x] Memba Feedback Feed: `FeedbackFeed` component (board parser for `r/samcrew/memba_feedback`)
- [~] Feedback Feed linked from footer + Settings (component ready, footer link deferred)
- [~] Basic network info: chain status visible in Settings (block height deferred to v2.1)
- [~] E2E tests expanded: unit tests expanded (+73 new), E2E deferred to post-merge
- [x] CI pipeline: all quality gates pass on dev/v2
- [x] All docs updated, CHANGELOG complete for v2.0
- [x] 11-perspective cross-audit documented

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
