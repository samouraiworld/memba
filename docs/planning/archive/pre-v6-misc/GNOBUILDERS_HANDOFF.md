# GnoBuilders — Session Handoff

> **Date:** 2026-04-08
> **PRs:** samouraiworld/Memba#274 (4 commits), samouraiworld/samcrew-deployer#8 (1 commit)
> **Branches:** `feat/gnobuilders-quest-system` (Memba), `feat/security-fixes-and-badges` (deployer)
> **Status:** All code pushed. Awaiting merge approval + realm deployment on test11.

---

## What Was Shipped (Complete)

### Phase 0 — Security Fixes (samcrew-deployer#8)

| Realm | Fix |
|-------|-----|
| `memba_dao_candidature` | Admin allowlist for MarkApproved/MarkRejected, deposit overflow guard (MaxApplyCount=10), zero-address validation |
| `memba_dao_channels` | Role-based membership ACL on all write ops, UnhideThread, PostReply blocked on deleted/hidden threads, channel name validation |
| `gnobuilders_badges` | NEW — GRC721 badge collection, soulbound rank badges, admin-only minting, UpdateTokenURI, ownerIndex, GetUserBadgeDetails bulk query |

### Phase 1 — GnoBuilders Quest System (Memba#274)

| Item | Status | Details |
|------|--------|---------|
| Quest engine (85 quests, 8 ranks) | Done | `gnobuilders.ts`, `quest_rpc.go`, migration 010 |
| Verification layer | Done | `questVerifier.ts` — on-chain, off-chain, social, self-report |
| Quest Hub page | Done | `/quests` — catalog with tabs, filters, search |
| Quest Detail page | Done | `/quests/:questId` — verification flow, prerequisite chain |
| Leaderboard | Done | `/leaderboard` — global ranking with usernames from profiles |
| Badge data layer | Done | `badges.ts` — bulk ABCI query, localStorage cache |
| Badge minting queue | Done | `CompleteQuest` queues `badge_mints`, auto-detects rank-ups |
| Admin review RPCs | Done | `ReviewQuestClaim` + `ListPendingClaims` (admin-gated) |
| Candidature threshold | Done | 100→350 XP with per-wallet legacy grandfathering |
| Quest toast | Done | `QuestToast.tsx` — slide-in animation on completion |
| AchievementGrid | Done | On-chain badge display with localStorage fallback |
| Trackers | Done | Konami code, daily login streak, network visit |
| Sidebar + Cmd+K | Done | 2 nav items + 2 commands + route wiring |

### Test Results

| Metric | Value |
|--------|-------|
| Frontend tests | **1,580** (72 files) |
| Backend tests | **87** (4 packages) |
| TypeScript errors | **0** |
| Go build errors | **0** |
| Build size | **501 KB** |

---

## What Remains

### Immediate Next Step: test11 Deployment

**test12 is stale** (stuck at block 234,887 since April 3). **test11 is live** (block 1,152,190+). **gnoland1 (betanet) is also live** (block 479,135+).

The samcrew-deployer already supports test11 with automatic import path adaptation:
- Strips `/v0` from versioned imports (`gno.land/p/nt/avl/v0` → `gno.land/p/nt/avl`)
- Uses `/v2` suffix for gnodaokit packages (genesis has outdated v1)
- Different profile dependency: `gno.land/r/demo/profile` (from genesis)
- Deploy key needs funds on test11

### Post-Deployment Items

| Item | Effort | Description |
|------|--------|-------------|
| Admin review UI page | 4-8h | Frontend page for reviewing pending quest claims (RPCs exist, need UI) |
| Badge artwork | 8h | SVG badge images for each category + rank, upload to IPFS |
| Seasonal quest toggle | 2h | `enabled` field in quest registry for Season 2 rotation |
| E2E quest tests | 4h | Playwright tests for quest completion flow |

---

## Network Status (as of 2026-04-08)

| Network | Chain ID | Block Height | Status | Deploy Ready? |
|---------|----------|-------------|--------|---------------|
| test11 | `test11` | 1,152,190+ | Active | Yes |
| test12 | `test12` | 234,887 | STALE (5 days) | No |
| gnoland1 | `gnoland1` | 479,135+ | Active | Yes (after test11 validation) |

---

## Architecture Reference

```
Frontend (gnobuilders.ts)         Backend (quest_rpc.go)         On-Chain (gnobuilders_badges.gno)
──────────────────────────        ─────────────────────────      ────────────────────────────────
85 quest definitions              87 validQuests + 10 selfReport GRC721 badge collection
RANK_TIERS[8]                     rankThresholds[8]              Quest badges (transferable)
_findQuest() unified lookup       user_ranks cache table         Rank badges (soulbound)
questVerifier.ts                  badge_mints queue table        ownerIndex secondary index
badges.ts (bulk ABCI)             adminAddresses auth gate       GetUserBadgeDetails (bulk)
QuestHub + QuestDetail pages      ReviewQuestClaim RPC           UpdateTokenURI (admin)
Leaderboard page                  ListPendingClaims RPC
QuestToast component              GetLeaderboard (JOIN profiles)
```

**XP authority:** Backend is source of truth. Frontend localStorage is offline-first cache.

**Deployer adaptation:** Automatic for test11 (import path stripping, /v2 suffixes). Zero realm code changes needed.

---

## File Map

### samcrew-deployer (branch: `feat/security-fixes-and-badges`)

| File | Change |
|------|--------|
| `realms/memba_dao_candidature/memba_dao_candidature.gno` | +ACL, +admin mgmt, +overflow guard (384 LOC) |
| `realms/memba_dao_candidature/memba_dao_candidature_test.gno` | 70→390 LOC |
| `realms/memba_dao_channels/memba_dao_channels.gno` | +RBAC, +moderation, +channel validation (780 LOC) |
| `realms/memba_dao_channels/memba_dao_channels_test.gno` | 135→478 LOC |
| `realms/gnobuilders_badges/gnobuilders_badges.gno` | NEW — GRC721 (540 LOC) |
| `realms/gnobuilders_badges/gnobuilders_badges_test.gno` | NEW (294 LOC) |
| `realms/gnobuilders_badges/gnomod.toml` | NEW |

### Memba (branch: `feat/gnobuilders-quest-system`, 4 commits)

**New files:**
- `frontend/src/lib/gnobuilders.ts` — 85 quests, ranks
- `frontend/src/lib/gnobuilders.test.ts` — 45 tests
- `frontend/src/lib/questVerifier.ts` — verification engine
- `frontend/src/lib/questVerifier.test.ts` — 27 tests
- `frontend/src/lib/badges.ts` — badge data layer
- `frontend/src/lib/badges.test.ts` — 12 tests
- `frontend/src/pages/QuestHub.tsx` — quest catalog
- `frontend/src/pages/QuestDetail.tsx` — quest detail + verification
- `frontend/src/pages/Leaderboard.tsx` — leaderboard
- `frontend/src/pages/questhub.css` — all quest CSS
- `frontend/src/pages/leaderboard.css` — leaderboard CSS
- `frontend/src/components/quests/QuestCard.tsx` — quest card (links to detail)
- `frontend/src/components/quests/RankBadge.tsx` — rank display
- `frontend/src/components/quests/AchievementGrid.tsx` — profile badges
- `frontend/src/components/quests/QuestToast.tsx` — completion toast
- `backend/internal/db/migrations/010_gnobuilders.sql` — 4 tables
- `docs/planning/MEMBA_V4_PROPOSAL.md` — full proposal

**Modified files:**
- `api/memba/v1/memba.proto` — +5 RPCs, +10 message types
- `backend/internal/service/quest_rpc.go` — badge minting, admin review, leaderboard
- `frontend/src/lib/quests.ts` — threshold 350, grandfathering, _findQuest()
- `frontend/src/lib/quests.test.ts` — updated for new threshold
- `frontend/src/App.tsx` — +3 routes
- `frontend/src/components/layout/Layout.tsx` — toast, trackers, legacy check
- `frontend/src/components/layout/TopBar.tsx` — network visit tracking
- `frontend/src/components/layout/Sidebar.tsx` — +2 nav items
- `frontend/src/components/ui/commands.ts` — +2 Cmd+K commands
- `ROADMAP.md`, `docs/planning/MASTER_ROADMAP.md`, `docs/MAINNET_PREPARATION.md`

---

## Review Trail

7 rounds of deep review across 25+ expert perspectives. All CRITICAL and HIGH findings fixed. Final review: **APPROVED with 0 blockers**.
