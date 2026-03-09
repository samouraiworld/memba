# Gno Core PRs — Breaking Change Impact Assessment

> **Date:** 2026-03-09 · **Memba:** v2.9.1 · **Status:** Deferred — monitor and act when PRs merge

## Priority Matrix

| Prio | PR | Risk | Effort | When to act |
|------|-----|------|--------|-------------|
| 🔴 P0 | [#5037](https://github.com/gnolang/gno/pull/5037) boards2 safe functions + `hub` sub-realm | HIGH | 2-4h | When merged |
| 🔴 P0 | [#5222](https://github.com/gnolang/gno/pull/5222) govdao T1 multisig rewiring | MED-HIGH | 0-4h | When merged |
| 🟡 P1 | [#5139](https://github.com/gnolang/gno/pull/5139) boards2 members via GovDAO proposals | MED | 0-1h | When deployed |
| 🟡 P1 | [#5250](https://github.com/gnolang/gno/pull/5250) betanet config | MED | 1-2h | Betanet launch |
| 🟢 P2 | [#5244](https://github.com/gnolang/gno/pull/5244) remove ownable from r/sys/names | LOW | 0 | Monitor |
| 🟢 P2 | [#5039](https://github.com/gnolang/gno/pull/5039) realm.SentCoins() | NONE | 0 | Future feature |
| 🟢 P2 | [#5217](https://github.com/gnolang/gno/pull/5217) gas metering fix | LOW | 0 | Monitor |

## Memba Integration Surfaces at Risk

| Surface | Key files | What could break |
|---------|-----------|------------------|
| **boards2 Render()** | `plugins/board/parser.ts`, `ChannelsPage.tsx` | Board listing/thread format changes |
| **GovDAO functions** | `lib/dao/builders.ts` | `MustVoteOnProposalSimple` rename → voting breaks |
| **GovDAO memberstore** | `lib/dao/config.ts`, `members.ts`, `voteScanner.ts` | Tier table format, memberstore path changes |
| **GovDAO proposals** | `lib/dao/proposals.ts` | `# GovDAO` header format, proposal rendering |
| **r/sys/users** | `lib/dao/shared.ts`, `lib/config.ts` | Username resolution (safe for now) |
| **Betanet config** | `lib/config.ts` | New chain IDs, RPC URLs, trusted domains |

## P0 Details

### #5037 — boards2 safe functions
- Adds `gno.land/r/gnoland/boards2/v1/hub` sub-realm with read-only functions
- If Render() output format changes → `parser.ts` regex breaks
- If boards served from `hub` → `queryRender` board path needs updating
- **Test:** `queryRender(rpcUrl, "gno.land/r/gnoland/boards2/v1", "")` after merge

### #5222 — govdao T1 multisig
- Critical: `builders.ts` L28 calls `MustVoteOnProposalSimple` — if renamed, all voting breaks
- Check memberstore still at `gno.land/r/gov/dao/v3/memberstore`
- **Test:** `queryRender(rpcUrl, "gno.land/r/gov/dao", "")` after merge

## Post-Merge Regression Checklist

```bash
# Run after any P0/P1 PR merges to testnet
cd frontend && npm run build
cd frontend && npm test -- --run
cd frontend && npx playwright test --project=chromium --reporter=list
```

Manual checks:
1. Navigate to `/dashboard` → verify GovDAO voting works
2. Navigate to `/channels` → verify demo board loads
3. Navigate to any DAO → verify members list loads
4. Cast a test vote → verify tx broadcast succeeds
