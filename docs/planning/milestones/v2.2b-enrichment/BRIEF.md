# v2.2b BRIEF — Directory Enrichment

> **Status:** SCOPED
> **Branch:** `feat/v2.2b-enrichment` (to create)
> **Predecessor:** v2.2a Organization Directory (PR #76 → merged)
> **Goal:** Complete all deferred HANDOFF items from v2.1b + v2.2a

## Scope

### Small (< 1 hour each)

#### 1. DAO Category Tags
- Add `governance` / `community` / `treasury` labels to DAO cards
- Source: heuristic from realm path or manual seed config
- UI: colored badge on `DAOCard.tsx`

#### 2. User IPFS Avatars
- Display IPFS avatar thumbnails in directory user cards
- Reuse existing `resolveAvatarUrl()` from `lib/profile.ts`
- Fallback: hex-colored circle with initial (already in place)

#### 3. Token Detail Navigation
- Click token card → navigate to existing `/tokens/:symbol` page
- Wire `onClick` / `onKeyDown` on token list items

### Medium (2-4 hours each)

#### 4. Per-DAO Notification View
- DAOHome shows DAO-specific notification count
- Filter notifications by `daoPath` in existing reducer
- Badge on DAO sidebar nav item

#### 5. Contribution Scores
- Proposal activity metric on user cards in directory
- Count: proposals voted on / created per user
- Source: ABCI query on user's DAO participation

### Medium-Large (4-8 hours)

#### 6. DAO Auto-Discovery
- Scan on-chain DAO factories to find all deployed DAOs
- Use `vm/qrender` on `gno.land/r/demo/dao_registry` (or equivalent)
- Merge discovered DAOs with seed list + saved DAOs
- Performance: cache results, paginated fetch

## Dependencies

- No new npm packages expected
- Reuses existing `queryRender`, `parseDAORender`, `resolveAvatarUrl`
- No backend changes needed

## Testing Plan

- Unit tests for each new parser/utility
- E2E: update directory spec with new assertions
- Target: 650+ unit tests, 240+ E2E tests

## Deferred to Later (Not in v2.2b)

| Feature | Reason |
|---------|--------|
| Validator monikers | Needs upstream support |
| Faucet Phase 3 (treasury signing) | Backend concern |
| AI Facilitator | Requires LLM integration design |
