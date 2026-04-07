# GnoBuilders — Session Handoff

> **Date:** 2026-04-08
> **PRs:** samouraiworld/samcrew-deployer#8, samouraiworld/Memba#274
> **Status:** Pushed to feature branches, awaiting merge approval

---

## What Was Shipped

### Phase 0 — Security Fixes (samcrew-deployer#8)

| Realm | Fix | Impact |
|-------|-----|--------|
| `memba_dao_candidature` | Admin allowlist for MarkApproved/MarkRejected | Closes issue #2 |
| `memba_dao_candidature` | Deposit overflow guard (MaxApplyCount=10) | Prevents int64 overflow at 12+ re-applications |
| `memba_dao_channels` | Role-based membership ACL on all write ops | Closes issue #3 |
| `memba_dao_channels` | UnhideThread, channel name validation | Moderation + security hardening |
| `gnobuilders_badges` | New GRC721 badge collection realm | Quest + rank badges, soulbound support |

### Phase 1 — GnoBuilders Quest System (Memba#274)

| Sprint | What | Files |
|--------|------|-------|
| 1.1 | Quest engine: 85 quests, 8 ranks, 3 RPCs, DB migration | gnobuilders.ts, quest_rpc.go, 010_gnobuilders.sql, memba.proto |
| 1.2 | Verification layer: on-chain, off-chain, social, self-report | questVerifier.ts |
| 1.3 | Quest Hub UI: catalog page with tabs, filters, search | QuestHub.tsx, questhub.css |
| 1.4 | Rank & Leaderboard: ranking page, RankBadge component | Leaderboard.tsx, leaderboard.css, RankBadge.tsx |
| 1.5 | Badge NFTs: realm, data layer, AchievementGrid | gnobuilders_badges.gno, badges.ts, AchievementGrid.tsx |
| 1.6 | Integration: sidebar, Cmd+K, routes, docs | App.tsx, Sidebar.tsx, commands.ts |

---

## What Is NOT Yet Done (Next Sessions)

### P0 — Must Do Before Feature Launch

| Item | Effort | Description |
|------|--------|-------------|
| **Realm redeployment** | 1-2h | Deploy all 7 realms on test12 when chain stabilizes. Use samcrew-deployer `make deploy-all NETWORK=test12`. Order: gnodaokit → tokenfactory → memba_dao → candidature → channels → nft_market → gnobuilders_badges |
| **Badge minting wiring** | 4-8h | Connect quest completion to badge minting. When `CompleteQuest` succeeds and user has auth, call `MintQuestBadge` on the badge realm via gnokey MsgCall. Queue in `badge_mints` table when chain is down. |
| **Admin review UI** | 4-8h | Build admin page to review `quest_claims` (pending self-report proofs). RPC: `ReviewQuestClaim(claimId, approved, reviewerAddress)`. Simple table with approve/reject buttons. |
| **Candidature threshold migration** | 1h | Update `CANDIDATURE_XP_THRESHOLD` in `quests.ts` from 100 → 350 (Gold rank). Add grandfathering: existing users with 100+ XP keep eligibility via a backend flag. |

### P1 — Should Do Before Production

| Item | Effort | Description |
|------|--------|-------------|
| **Leaderboard username population** | 2h | In `GetLeaderboard` RPC, join with `profiles` table to populate `username` and `avatar_url` fields. Currently always empty. |
| **Quest completion toast** | 2h | When `completeQuest()` returns non-null, show a toast notification: "Quest Completed! +{xp} XP". Use existing toast infrastructure. |
| **AchievementGrid on-chain badges** | 4h | `AchievementGrid.tsx` currently uses only localStorage. Wire to `fetchUserBadges()` from `badges.ts` for on-chain badge display. |
| **Quest detail page** | 4-8h | Create `/quests/:questId` route with full quest description, verification flow, and badge preview. Currently, QuestCard shows inline info only. |
| **Rate limiting on SubmitQuestClaim** | 1h | Add rate limit middleware or per-user throttle (1 claim per minute). Currently bounded to 10 valid quests but no rate limit. |
| **Konami code wiring** | 1h | Call `setupKonamiDetector()` in Layout.tsx to detect the Konami code and complete the `easter-egg-konami` quest. |
| **Login streak tracking** | 1h | Call `trackDailyLogin(address)` in Layout.tsx on auth. The helper exists in `questVerifier.ts` but isn't wired. |
| **Network visit tracking** | 1h | Call `trackNetworkVisit(address, networkId)` in TopBar.tsx on network switch. Helper exists but isn't wired. |

### P2 — Nice To Have

| Item | Effort | Description |
|------|--------|-------------|
| **Badge metadata/images** | 8h | Design SVG badge artwork for each quest category + rank tier. Upload to IPFS. Pass CID to `MintQuestBadge`/`MintRankBadge`. |
| **Seasonal quests** | 4h | Add `enabled` toggle to quest registry. Season 2 quests for post-mainnet. DB `quest_registry` table exists but unused. |
| **Quest progress widget** | 2h | Replace the old `QuestProgress.tsx` 10-quest widget with a mini version of the new GnoBuilders stats (rank badge + XP bar + quest count). |
| **Integration tests** | 4h | Frontend ↔ backend quest ID sync test (compare `buildQuestXPMap()` output against Go `validQuests`). Snapshot test to catch drift. |
| **E2E quest tests** | 4h | Playwright tests: navigate to /quests, filter by category, complete a quest, verify XP updates. |

---

## Architecture Quick Reference

```
Frontend (gnobuilders.ts)         Backend (quest_rpc.go)         On-Chain (gnobuilders_badges.gno)
──────────────────────────        ─────────────────────────      ────────────────────────────────
85 quest definitions              87 validQuests entries          GRC721 badge collection
RANK_TIERS[8]                     rankThresholds[8]              Quest badges (transferable)
calculateRank(xp)                 calculateRankTier(xp)          Rank badges (soulbound)
questVerifier.ts                  user_ranks cache table         ownerIndex secondary index
badges.ts                         badge_mints queue table        GetUserBadgeDetails (bulk)
QuestHub + Leaderboard pages      GetUserRank RPC                UpdateTokenURI (admin)
                                  GetLeaderboard RPC
                                  SubmitQuestClaim RPC
```

**XP authority:** Backend is the source of truth. Frontend localStorage is offline-first cache. Server recalculates XP from `quest_completions` table on every read.

**Backward compat:** Legacy v1 quest IDs (`view-profile`, `directory-tabs`) are in the backend `validQuests` map. Existing completions count toward XP.

---

## File Map

### New Files (Memba)

| File | Purpose |
|------|---------|
| `frontend/src/lib/gnobuilders.ts` | 85 quest definitions, rank system, query helpers |
| `frontend/src/lib/gnobuilders.test.ts` | 45 tests for quest registry |
| `frontend/src/lib/questVerifier.ts` | Quest verification engine (on-chain, off-chain, social) |
| `frontend/src/lib/questVerifier.test.ts` | 27 tests for verifiers |
| `frontend/src/lib/badges.ts` | Badge data layer (ABCI queries, cache, mintable helpers) |
| `frontend/src/lib/badges.test.ts` | 12 tests for badge helpers |
| `frontend/src/pages/QuestHub.tsx` | Quest catalog page |
| `frontend/src/pages/Leaderboard.tsx` | Global leaderboard page |
| `frontend/src/pages/questhub.css` | Quest hub + achievement grid CSS |
| `frontend/src/pages/leaderboard.css` | Leaderboard CSS |
| `frontend/src/components/quests/QuestCard.tsx` | Quest display card |
| `frontend/src/components/quests/RankBadge.tsx` | Rank badge component (8 tiers, 3 sizes) |
| `frontend/src/components/quests/AchievementGrid.tsx` | Profile badge gallery |
| `backend/internal/db/migrations/010_gnobuilders.sql` | 4 new DB tables |
| `docs/planning/MEMBA_V4_PROPOSAL.md` | Full implementation proposal |

### Modified Files (Memba)

| File | Change |
|------|--------|
| `api/memba/v1/memba.proto` | +3 RPCs, +6 message types |
| `backend/internal/service/quest_rpc.go` | 87-entry validQuests, rank cache, leaderboard, claims |
| `frontend/src/App.tsx` | +2 lazy routes (quests, leaderboard) |
| `frontend/src/components/layout/Sidebar.tsx` | +2 nav items (GameController, Trophy icons) |
| `frontend/src/components/ui/commands.ts` | +2 Cmd+K commands |
| `ROADMAP.md` | Updated to v4.0-beta |
| `docs/planning/MASTER_ROADMAP.md` | Updated quality gates, added v4.0-beta milestone |
| `docs/MAINNET_PREPARATION.md` | Updated version reference |

### New Files (samcrew-deployer)

| File | Purpose |
|------|---------|
| `realms/gnobuilders_badges/gnobuilders_badges.gno` | GRC721 badge realm (524 LOC) |
| `realms/gnobuilders_badges/gnobuilders_badges_test.gno` | Realm tests (294 LOC) |
| `realms/gnobuilders_badges/gnomod.toml` | Module definition |

### Modified Files (samcrew-deployer)

| File | Change |
|------|--------|
| `realms/memba_dao_candidature/memba_dao_candidature.gno` | +ACL, +admin mgmt, +overflow guard |
| `realms/memba_dao_candidature/memba_dao_candidature_test.gno` | 70 → 390 LOC |
| `realms/memba_dao_channels/memba_dao_channels.gno` | +RBAC, +moderation, +channel validation |
| `realms/memba_dao_channels/memba_dao_channels_test.gno` | 135 → 478 LOC |

---

## Known Risks & Decisions

| Risk | Mitigation | Status |
|------|-----------|--------|
| test12 not stable for realm deployment | All code is chain-independent. Deploy when stable. | Waiting |
| Quest prerequisites client-only | Backend XP authority prevents XP inflation. Documented in code. | Accepted |
| localStorage quests cheatable | Low-XP quests only. Backend recalculates XP. Documented. | Accepted |
| `computeLeaderboard` loads all users | Cache table is the primary path. Cold-start is one-time. | Acceptable at scale |
| Badge minting not wired | Infrastructure ready. P0 for next session. | Planned |
| Admin review not built | P0 for next session. Self-report quests (10) wait for this. | Planned |

---

## Review Trail

This work went through **6 rounds of deep review** across 25+ expert perspectives:

1. **Per-sprint reviews** (after each of 6 sprints): CSO, Smart Contract Hacker, Gno Engineer, QA, Fullstack
2. **Full deep review** (all files): CRITICAL/HIGH/MEDIUM/LOW findings cataloged and fixed
3. **CTO strategic review**: Architecture coherence, upgrade path, deployment risk, scalability, feature completeness
4. **Final pre-push review**: FSE + Gno Core Engineer + Backend + CSO + CTO — all APPROVED

All CRITICAL and HIGH findings were fixed. MEDIUM findings were either fixed or documented as accepted trade-offs.
