# Expert 5 — Frontend Architecture, Perf & Code Quality Audit
**Lens:** Staff frontend (React perf + architecture). **Date:** 2026-07-08.
**Scope:** Memba Marketplace shell + 3 lanes + data layer. Repo `Memba/frontend`.

## Verdict (one line)
The **shell is genuinely good** (lazy lanes, live-lane gating, discriminated-union type model, splat-redirect correctness). The **lanes are not** — three near-duplicate card components built from ~120 lines of inline styles + JS mouse handlers each, raw `useEffect` fetch loops that bypass TanStack Query entirely, and a data layer that string-parses pipe/CSV/markdown from `qeval` with zero schema validation. It reads as three engineers who never shared a `ListingCard`. Tier-1 bar (OpenSea/Blur/Linear) is one card primitive + one query layer away, but the current code will not scale to a real 3-lane book.

---

## Top findings

### P0 — architectural / will-not-scale

**P0-1. No shared `ListingCard`; three hand-rolled cards diverge already.**
`NftLane.tsx:106-162`, `ServiceLane.tsx:38-69`, `AgentLane.tsx:36-83`, `TokenLane.tsx:69-101` each render a bespoke card. Different markup, different padding (16/20/24px), different price treatment, different hover, different image aspect (200px vs 140px). There is no reuse. Adding a 4th lane = a 4th copy; changing card chrome = 4 edits. Benchmark: OpenSea/Blur/Magic Eden all render **one** `AssetCard` with a per-collection adapter. **Fix:** one `<ListingCard>` fed by the `UnifiedListing` union + a per-lane `toCardModel()` adapter. This is the single highest-leverage change in the codebase.

**P0-2. Inline styles + JS hover handlers instead of CSS (the flagged anti-pattern).**
`NftLane.tsx:111-127` sets `transform`/`boxShadow`/`borderColor` imperatively in `onMouseEnter`/`onMouseLeave`; `:181-182` does it again on every activity row. Every card ships a fresh style object literal each render (new object identity → defeats any future `React.memo`), and hover state lives in the DOM instead of `:hover`. Hardcoded `rgba(255,255,255,0.05)` also violates the tokens-only constraint (brief §29). Benchmark: Linear/Stripe hover is 100% CSS `:hover` + transitions, zero JS. **Fix:** move all of it to `.listing-card` / `.listing-card:hover` in CSS; delete the handlers. Immediate paint + interaction-latency win and removes the JS-per-frame style thrash behind the "15s-per-card" note.

**P0-3. Lanes bypass TanStack Query — a QueryClient exists but the lanes don't use it.**
`queryClient.ts` is configured (`staleTime 30s`, `gcTime` set). Yet `NftLane` (`:26-50`), `TokenLane` (`:18-36`), `AgentLane` (`:11-23`) all fetch via raw `useEffect`+`setState`+manual `cancelled` flags. Only `MyListingsView` uses `useQuery`. Consequences: no caching (every tab switch refetches the whole book from chain), no dedup, no background refresh, no shared loading/error semantics, and a hand-rolled cancellation flag per component that is easy to get wrong. `NftLane` also does an N+1 fan-out (`nftHub.fetchVerifiedCollections` → `Promise.all` of 2 reads **per collection**, up to 100 collections = 200 sequential-ish ABCI round-trips) on **every mount**, uncached. Benchmark: any modern marketplace keys the book by `[lane, filters, page]` in the query cache. **Fix:** all lane reads → `useQuery`/`useInfiniteQuery` with per-lane keys; kill the manual effect loops.

**P0-4. `TokenLane` reloads the whole page after a trade.**
`TokenLane.tsx:111` `window.location.reload()` on trade success. Full document reload, re-download, re-auth, lost scroll/tab state. This is a 2010-era pattern. **Fix:** `queryClient.invalidateQueries(['token-otc'])`.

### P1 — data-layer fragility & correctness

**P1-1. `qeval` string-scraping with no schema/validation across the whole data layer.**
`tokenOtcApi.ts:17-31` strips quotes with a regex then `split(",")` then `split("|")` and blindly `BigInt(expectedUnitPriceStr)` — a symbol containing `,` or `|`, or any missing field, throws an uncaught `SyntaxError` that sinks the lane. No length check (unlike `v3Reads.parseListingsPage`, which at least guards `p.length < 5`). `agentRegistry.ts:158-325` hand-parses a **markdown table and a markdown detail doc** with a dozen regexes and positional `cols[]` — extraordinarily brittle; any realm render tweak breaks it silently (falls back to seed). `v3Reads.unwrapQevalString` even admits the on-wire encoding is "confirmed at go-live" (`:44`) — i.e. unverified. Benchmark: Stripe/tier-1 never parse presentation strings for trade data. **Fix:** realms should expose a machine format (JSON or a versioned delimited record with escaping); frontend parses through **one** validated codec (zod/valibot) that returns `Result<T>` and never throws into render. At minimum, harden `tokenOtcApi` with a field-count guard + try/catch per row.

**P1-2. Pagination is a client-side full-table scan.**
`myListings.ts:40-71` pages the **global** v3 book (`NFT_PAGE 100 × NFT_MAX_PAGES 20` = 2000 rows) client-side and filters by seller, because there's no per-seller server query — and warns when it silently truncates. `NftLane`/`TokenLane` fetch the entire listing set with no pagination or windowing at all. This is fine at 10 listings, a cold-start crisis at 10k. Benchmark: Blur/OpenSea server-paginate + cursor. **Fix (frontend side):** `useInfiniteQuery` + a real "load more"/virtualized grid; **flag for realm team:** need `GetListingsBySeller` and server-side filter/sort.

**P1-3. No virtualization for the grids.**
`react-window`/`@tanstack/react-virtual` not installed. Every collection/listing card mounts at once. With `NFTMedia` generating a deterministic canvas/data-URI fallback per card, a 100-card grid mounts 100 image nodes + 100 memoized generators. This is the concrete driver of the "15s-per-card unmemoized" note. **Fix:** virtualize any grid that can exceed ~50 items.

**P1-4. Error handling swallows silently in the aggregators.**
`NftLane.tsx:34-38` catches activity errors with an empty block; `nftHub.ts:83-94` degrades a failed collection to zeros (a collection with a real floor shows `0 GNOT` — indistinguishable from genuinely-zero). `agentRegistry` falls back to `SEED_AGENTS` on any parse miss, so a parser regression looks like "1 agent exists" forever. Benchmark: tier-1 surfaces partial-failure ("stats unavailable") rather than fabricating zeros. **Fix:** distinguish `unknown` from `0`; surface degraded state.

### P2 — hygiene / correctness / a11y

**P2-1. Dead code: 1,320 lines orphaned.** `Marketplace.tsx` (318), `MarketplaceHub.tsx` (292), `FreelanceServices.tsx` (710) are **not imported by `App.tsx`** (verified) — `App.tsx:256` redirects `/nft`→`/marketplace/nfts`, `UnifiedMarketplace` is the only mount. Their **tests still run** (`MarketplaceHub.test.tsx` ~360 lines) testing a page users can't reach. Delete all three + `MarketplaceHub.test.tsx`.

**P2-2. Stale routing test drift.** `App.routes.test.tsx:8,17,38,56` asserts `/nft → MarketplaceHub` — the exact route that no longer exists (now a redirect). The test passes only because it re-declares stub routes inline, so it validates a **fiction**. Rewrite against the real `/marketplace/*` shell or delete.

**P2-3. Existing primitives not adopted.** `EmptyState`, `LoadingSkeleton`, `StatStrip`, `CopyableAddress`, `StatusBadge` all exist in `components/ui/` — but `NftLane` inlines its own loading text (`:64`), stat blocks (`:146-158`), and address truncation (`:193` `slice(0,8)`). `TokenLane` uses a different `mhub-*` CSS namespace. The primitives exist; the lanes just don't use them. Adopt them.

**P2-4. Accessibility gaps.** Cards are `<Link>`/`<div>` with no `aria-label` summarizing price/floor; the sort `<select>` (`NftLane:73`) has no label; `verifiedOnly` checkbox label isn't programmatically tied; hover-only affordances have no focus-visible equivalent; emoji tab icons (`UnifiedMarketplace:36-41`) aren't `aria-hidden`. Search input has `defaultValue`+`onChange` (uncontrolled but URL-syncing) with no debounce → a `setSearchParams` per keystroke.

**P2-5. Type-model gap.** `types.ts` `UnifiedListing` is excellent, but **no lane actually produces it** — `NftLane` uses `HubCollection`, `TokenLane` uses `OtcListing`, `AgentLane` uses `AgentListing`. The unifying type is aspirational; the shared card can't exist until the adapters do.

---

## Proposed component + data architecture (new version)

**Component layer — one card, many adapters:**
```
components/marketplace/
  ListingCard.tsx        // pure, presentational, memoized; consumes CardModel
  ListingGrid.tsx        // virtualized (react-virtual), skeleton + empty states
  LaneToolbar.tsx        // shared search/sort/filter UI, controlled by useMarketFilters
  card/CardModel.ts      // { image, title, subtitle, stats: Stat[], price, badges, href, cta }
  adapters/
    nftToCard.ts  serviceToCard.ts  tokenToCard.ts  agentToCard.ts
```
- `ListingCard` = 100% CSS (`.listing-card:hover`), zero inline style objects, zero JS hover, `React.memo` + stable props. Tokens-only colors.
- Each lane = `useLaneQuery()` → `data.map(adapter)` → `<ListingGrid items={models}/>`. Lanes shrink to ~30 lines.
- Reuse existing `EmptyState`/`LoadingSkeleton`/`StatStrip`/`CopyableAddress` inside the card; add a real `<Price>` and `<VerifiedBadge>` (exists).

**Data layer — one codec, one query surface:**
```
lib/marketplace/
  codec.ts       // validated decoders (zod), Result<T>, never throw into render
  reads/         // fetchNftBook, fetchTokenBook, fetchServiceBook, fetchAgentBook
  useMarket.ts   // useInfiniteQuery wrappers, keys: ['market', lane, filters, cursor]
  useMarketFilters.ts  // URL-synced {q, sort, verifiedOnly, page} — one hook, all lanes
```
- All reads go through TanStack Query (`useInfiniteQuery`), keyed by lane+filters+cursor; trades `invalidateQueries`, never `location.reload`.
- One `useMarketFilters` owns unified search/sort/filter state in the URL (debounced), shared across lanes instead of each lane's ad-hoc toolbar.
- Realm asks (flag for chain team): machine-readable (JSON) reads, `GetListingsBySeller`, server-side sort/filter/pagination.

**Rendering:** virtualize grids >50; `ListingCard` memoized; `NFTMedia` fallback generator memoized by seed (already is) but only mount visible cards.

---

## Tier-1 bar & the gap
| Dimension | Tier-1 (OpenSea/Blur/Linear/Stripe) | Memba today | Gap |
|---|---|---|---|
| Card | one `AssetCard` + adapters | 3–4 hand-rolled copies | **P0-1** |
| Styling | CSS `:hover`, tokens | inline + JS hover, raw rgba | **P0-2** |
| Data | cached, keyed, infinite | raw `useEffect`, uncached, full-scan | **P0-3, P1-2** |
| Parsing | typed/JSON, validated | markdown/CSV/pipe scraping | **P1-1** |
| Large lists | virtualized | mount-all | **P1-3** |
| Refresh | cache invalidation | `window.location.reload()` | **P0-4** |
| Dead code | none | 1,320 orphan lines + stale tests | **P2-1/2** |

## Quick wins (≤1 day each)
- Delete `Marketplace.tsx`, `MarketplaceHub.tsx`, `FreelanceServices.tsx`, `MarketplaceHub.test.tsx`; fix/retire `App.routes.test.tsx`.
- `TokenLane` `location.reload()` → `invalidateQueries`.
- Move `NftLane` inline styles + hover to `unified-marketplace.css`; drop hardcoded rgba.
- Debounce the shell search input.
- Harden `tokenOtcApi` parse (field-count guard + per-row try/catch).

## Deeper rework (the new version)
- Build `ListingCard` + `CardModel` + 4 adapters; migrate all lanes onto it.
- Move every lane read to TanStack `useInfiniteQuery`; delete manual effect loops.
- Add `zod` codec layer for all `qeval` reads; `Result<T>` everywhere.
- Add virtualization; unify filter/sort/search into `useMarketFilters`.

## CTO must-fixes before shipping the new version
1. **One `ListingCard` + adapters** — do not ship a 3rd/4th hand-rolled card (P0-1).
2. **All lane data through TanStack Query** (P0-3) and **kill `location.reload`** (P0-4).
3. **Validated codec for qeval reads** — trade data must not depend on unescaped markdown/CSV scraping that throws into render (P1-1).
4. **Delete the 1,320 lines of dead marketplace pages + rewrite the lying routing test** before it misleads the next engineer (P2-1/2).
5. Server-side pagination/filter contract with the realm team before the book grows (P1-2) — the client full-scan is a cold-start-only illusion of working.
