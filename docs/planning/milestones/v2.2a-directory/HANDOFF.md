# v2.2a Handoff — Organization Directory

> Branch: `feat/v2.2a-directory`
> Status: Phase 1 COMPLETE
> PR: #76 → `dev/v2`

## What Was Done

### Data Layer (2 files, 24 tests)
- **`lib/directory.ts`** — centralized DAO/token/user fetch functions
  - `getDirectoryDAOs()`: seed list + saved DAOs (deduplication by path)
  - `parseTokenRegistry()`: GRC20 Render markdown → typed entries
  - `parseUserRegistry()`: User registry Render → typed entries
  - `fetchTokens()` / `fetchUsers()`: ABCI fetch with sessionStorage cache (5-min TTL)
- **`lib/daoMetadata.ts`** — DAO Render("") parser
  - Extracts: description (first non-heading line), member count, proposal count, active status
  - `batchGetDAOMetadata()`: parallel fetch via `Promise.allSettled` (max 10)

### UI Components (3 files)
- **`components/directory/DAOCard.tsx`** — rich card with metadata (members/proposals), "Save to Memba" button, Phosphor icons
- **`components/directory/FeaturedDAOs.tsx`** — horizontal carousel of seed DAOs with live Render metadata
- **`pages/directory.css`** — 330 LOC glassmorphism, responsive grid (2-col → 1-col)

### Refactored
- **`Directory.tsx`** — inline styles → CSS classes, data layer, `useMemo` filtering, ARIA `role=tab`/`aria-selected`

### E2E Tests (1 file, 13 tests)
- `e2e/directory.spec.ts` — tabs, search, cards, featured carousel, ARIA, mobile

## What's NOT Done (Next Agent)

1. **Token detail page** — clicking a token card goes to `/tokens/:symbol` (page exists)
2. **User profile enrichment** — IPFS avatar display in user cards
3. **DAO auto-discovery** — scan on-chain factories (deferred to v2.2b for perf stability)
4. **Category tags** — governance/community/treasury labels on DAO cards
5. **Contribution scores** — proposal activity metric on user cards

## Technical Notes

### Caching Strategy
- Moved from module-level `cache` object → `sessionStorage` (per-tab, survives navigation)
- Keys: `memba_dir_tokens`, `memba_dir_users`
- TTL: 5 minutes (same as before)

### Dependencies
- No new npm packages
- Uses existing `@phosphor-icons/react` (Buildings, BookmarkSimple, ArrowRight)
- Reuses canonical `queryRender` from `lib/dao/shared.ts`
