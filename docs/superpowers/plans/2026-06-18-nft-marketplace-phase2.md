# NFT Marketplace (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the collector-facing Marketplace — a discovery hub, a redesigned public collection page, ONE consolidated trade modal, robust media, and a minimal read-only viewer for legacy v1 collections — in the editorial-calm design language.

**Architecture:** Pure frontend refactor on top of existing, frozen on-chain ABIs and the existing ConnectRPC NFT endpoints (`GetNFTCollection`, `GetNFTActivity`, `ListNFTTokens`, `GetNFTPortfolio`). The triplicated v1/v2/v3 trade modals collapse into one `TradeModal` driven by `tradeEngineFor`. A new discovery hub replaces `NFTGallery`'s tabbed gallery/marketplace. The public collection page (`/nft/collection/:creator/:slug`) is redesigned; the admin path stays in the Studio (Phase 1). `NFTCollectionView` is stripped to a read-only legacy viewer.

**Tech Stack:** React + TypeScript + React Router, Vite, Vitest + @testing-library/react, Adena via `doContractBroadcast`, ConnectRPC client (`nftApi.ts`). Styling via Memba `tokens.css`.

## Global Constraints

- **Frontend-only.** Do NOT modify `lib/*` builders or the backend. Reuse the existing builders verbatim (their arg arrays are the on-chain ABI). Reuse the existing ConnectRPC clients in `lib/nftApi.ts`.
- **Branch:** `feat/nft-marketplace-phase2`, branched off `feat/nft-creator-studio` (Phase 1, unmerged). Never commit to `main`. Commit subjects concise — NO `Co-Authored-By`, NO "Generated with Claude", no trailers.
- **Aesthetic:** editorial-calm — only Memba `tokens.css` variables (`--color-*`, `--space-*`, `--radius-*`, `--font-mono`, `--text-*`). No purple `#8b5cf6` / green `#4caf50`.
- **Engine routing:** v2-vs-v3 is chosen by an explicit `source: "v2" | "v3"` discriminator passed to `tradeEngineFor(source)` → `{ engine, marketPath, collectionPath, marketAddr, feeBps }`. Collections from `memba_collections` (launchpad, ids `creator/slug`) are v3; genesis (`memba_nft_v2`) is v2. Never sniff the id format.
- **Fee is per-engine** (v2 250 bps, v3 200 bps) — always from `engine.feeBps`, never hardcoded.
- **Trade builders + their arg orders** (verbatim; v3 unless noted):
  - `buildBuyNFTV3Msg(caller, collectionID, tokenId, priceUgnot)` — send `${priceUgnot}ugnot`.
  - `buildListForSaleV3Msg(caller, collectionID, tokenId, priceUgnot)`.
  - `buildMakeOfferV3Msg(caller, collectionID, tokenId, offerUgnot)` — send `${offerUgnot}ugnot`.
  - `buildAcceptOfferV3Msg(caller, collectionID, tokenId, buyerAddr)`.
  - `buildDelistV3Msg / buildCancelOfferV3Msg / buildClaimExpiredOfferV3Msg`.
  - `buildSetApprovalForAllV3Msg(caller, collectionID, operatorAddr, approved)` — approval targets `engine.collectionPath`.
  - v2 equivalents in `nftMarketplace.ts` take `(caller, marketplacePath, collectionID, …)` explicitly.
- **Tests:** Vitest; component tests wrap in `<MemoryRouter>`, mock libs with `vi.mock()`.

## File Structure

**Create:**
- `frontend/src/components/nft/NFTMedia.tsx` — hardened media (replaces ad-hoc `NFTImage` usage; metadata→image fallback chain).
- `frontend/src/components/nft/PriceBreakdown.tsx` — shared price/fee/royalty/seller-receives breakdown (per-engine, live).
- `frontend/src/components/nft/TradeModal.tsx` — ONE modal: action ∈ buy|list|offer|accept, engine-routed; replaces the 5 existing modals.
- `frontend/src/lib/nftHub.ts` — hub data: verified collections + global recent activity (built on `fetchCollectionList`/`fetchNFTCollection`/`fetchNFTActivity`).
- `frontend/src/pages/MarketplaceHub.tsx` — `/nft` discovery hub.
- `frontend/src/pages/CollectionPublic.tsx` — redesigned public collection page (collector view).
- `frontend/src/pages/LegacyCollectionView.tsx` — minimal read-only v1 viewer (refactored from `NFTCollectionView`).
- `frontend/src/pages/marketplace-v2.css` (or extend `studio.css` patterns) — editorial-calm styles for hub + collection + modal.
- Test files alongside each.

**Modify:**
- `frontend/src/App.tsx` — `/nft` → `MarketplaceHub`; `/nft/collection/:creator/:slug` → `CollectionPublic`; `/nft/:realmPath` → `LegacyCollectionView`; redirect `/nft/create/advanced` → `/nft/create`.

**Delete (after TradeModal lands, T10):** `BuyNFTModal.tsx`, `V3BuyNFTModal.tsx`, `ListForSaleModal.tsx`, `V3ListForSaleModal.tsx`, `MakeOfferModal.tsx`, the old `NFTGallery` tab body — once no longer referenced.

---

## Task 1: `NFTMedia` component

**Files:** Create `frontend/src/components/nft/NFTMedia.tsx`; Test `…/NFTMedia.test.tsx`.

**Interfaces:**
- Consumes: `nftImageUrl(uriOrCid: string): string` from `lib/nftApi` (returns the backend image-proxy URL).
- Produces: `NFTMedia({ uri, alt, className }: { uri: string; alt: string; className?: string })`.

Behavior (harden the existing `NFTImage`): empty `uri` → a styled placeholder immediately (no `<img>`); otherwise `<img loading="lazy" src={nftImageUrl(uri)}>` with `loading|loaded|error` states; on `error` → the placeholder (a neutral tile with an icon, NOT an emoji — use a tabler-style inline SVG or a CSS placeholder). The placeholder must look intentional (the "empty NFT" fix).

- [ ] Step 1: Write failing tests — empty uri renders the placeholder (no img); a non-empty uri renders an `<img>` whose `src` is `nftImageUrl(uri)`; simulating the img `onError` swaps to the placeholder. (Mock `nftImageUrl`.)
- [ ] Step 2: Run → fail.
- [ ] Step 3: Implement per the behavior above (model on `components/nft/NFTImage.tsx`, but replace the emoji fallback with a clean CSS/SVG placeholder and keep `loading="lazy"`).
- [ ] Step 4: Run → pass; `npx tsc --noEmit` clean.
- [ ] Step 5: Commit `feat(nft): NFTMedia component with graceful fallback`.

---

## Task 2: `PriceBreakdown` component

**Files:** Create `frontend/src/components/nft/PriceBreakdown.tsx`; Test alongside.

**Interfaces:**
- Produces: `PriceBreakdown({ priceUgnot, feeBps, royaltyBps }: { priceUgnot: number; feeBps: number; royaltyBps: number })`.
- Pure derivation (mirror the existing modals): `platformFee = Math.floor(priceUgnot * feeBps / 10000)`; `royaltyFee = Math.floor(priceUgnot * royaltyBps / 10000)`; `sellerReceives = priceUgnot - platformFee - royaltyFee`. Render rows (price, platform fee with the % , creator royalty, seller receives) using GNOT display (`/ 1_000_000`).

- [ ] Step 1: Failing test — for `priceUgnot=2_000_000, feeBps=200, royaltyBps=500`: platform fee row shows `0.04 GNOT` (2.0%), royalty `0.1 GNOT`, seller receives `1.86 GNOT`. Assert the computed numbers.
- [ ] Step 2: Run → fail.
- [ ] Step 3: Implement the pure component.
- [ ] Step 4: Run → pass; tsc clean.
- [ ] Step 5: Commit `feat(nft): shared PriceBreakdown (per-engine fee)`.

---

## Task 3: Consolidated `TradeModal`

**Files:** Create `frontend/src/components/nft/TradeModal.tsx`; Test alongside.

**Interfaces:**
- Consumes: `tradeEngineFor(source)` → `EnginePaths`; the v3 builders (and v2 builders for `source==="v2"`); `doContractBroadcast(msgs, memo)`; `isApprovedForAll(collectionPath, collectionID, owner, operator)` (from the existing modal code path — reuse the same helper the v3 list modal uses); `PriceBreakdown` (T2); `friendlyError`.
- Produces: `TradeModal({ action, source, collectionID, tokenId, priceUgnot, seller, royaltyBps, callerAddress, onClose, onSuccess }: { action: "buy" | "list" | "offer" | "accept"; source: "v2" | "v3"; collectionID: string; tokenId: string; priceUgnot?: number; seller?: string; royaltyBps: number; callerAddress: string; onClose: () => void; onSuccess: () => void })`.

Behavior — `const engine = tradeEngineFor(source)`, then per `action`:
- **buy**: show `PriceBreakdown(priceUgnot, engine.feeBps, royaltyBps)`; confirm → `engine.engine==="v3" ? buildBuyNFTV3Msg(caller, collectionID, tokenId, priceUgnot) : buildBuyNFTMsg(caller, engine.marketPath, collectionID, tokenId, priceUgnot)`.
- **list**: a price input (GNOT). Two-step: if `!isApprovedForAll(engine.collectionPath, collectionID, caller, engine.marketAddr)` show Approve (`buildSetApprovalForAll…`); then list (`buildListForSale…V3 / v2`). Live `PriceBreakdown` from the entered price + `engine.feeBps`.
- **offer**: an offer-amount input (GNOT); escrow note (funds held, 7-day window, cancel/claim) — copy from `MakeOfferModal`; build `buildMakeOffer…`.
- **accept**: confirm accepting the best offer on `tokenId` from `seller`/buyer; build `buildAcceptOffer…(caller, …, collectionID, tokenId, buyerAddr)`. (This is the previously-missing AcceptOffer UI.)
- All broadcasts via `doContractBroadcast([msg], memo)`; errors → `friendlyError`; success → `onSuccess()`.

- [ ] Step 1: Failing tests (mock builders + `doContractBroadcast` + `isApprovedForAll`): (a) `action="buy", source="v3"` → confirm calls `buildBuyNFTV3Msg` with `[collectionID, tokenId]`+send and broadcasts; (b) `action="buy", source="v2"` → calls `buildBuyNFTMsg` with the v2 path; (c) `action="list"` when not approved → first click builds the approval msg, not the listing; (d) `action="accept"` → builds `buildAcceptOfferV3Msg` with `[collectionID, tokenId, buyer]`. Assert via the mocked builder call args.
- [ ] Step 2: Run → fail.
- [ ] Step 3: Implement, reusing the structure of the existing modals (`V3BuyNFTModal`, `V3ListForSaleModal`, `MakeOfferModal`) but unified + engine-routed. Use `PriceBreakdown`.
- [ ] Step 4: Run → pass; tsc clean.
- [ ] Step 5: Commit `feat(nft): unified engine-routed TradeModal (buy/list/offer/accept)`.

---

## Task 4: `nftHub` data layer

**Files:** Create `frontend/src/lib/nftHub.ts`; Test alongside.

**Interfaces:**
- Consumes: `fetchCollectionList()` → `CollectionListRow[]`; `isCollectionVerified(id)`; `fetchNFTCollection(collectionId)` → stats `{ floorPriceUgnot, totalVolumeUgnot, … }`; `fetchNFTActivity(collectionId, limit)` → `NFTActivityItem[]`.
- Produces:
  - `fetchVerifiedCollections(limit?): Promise<HubCollection[]>` where `HubCollection = { id, name, creator, slug, verified, floorUgnot, volumeUgnot }` — list collections, mark verified, enrich with stats.
  - `fetchRecentActivity(collectionIds: string[], perCollection?): Promise<NFTActivityItem[]>` — aggregate `fetchNFTActivity` across the top collections, merge + sort by `createdAt` desc (there is no global-activity endpoint; aggregate client-side and `log` the cap).

- [ ] Step 1: Failing tests (mock the nftApi + launchpadReads): `fetchVerifiedCollections` returns enriched rows with `verified`/`floorUgnot`; `fetchRecentActivity(["a","b"])` merges both collections' items sorted by `createdAt` desc.
- [ ] Step 2: Run → fail.
- [ ] Step 3: Implement (parallelize the per-collection stat/activity fetches; cap the aggregation breadth and document the cap).
- [ ] Step 4: Run → pass; tsc clean.
- [ ] Step 5: Commit `feat(nft): nftHub data (verified collections + aggregated activity)`.

---

## Task 5: Discovery hub page (`/nft`)

**Files:** Create `frontend/src/pages/MarketplaceHub.tsx`; Test alongside. (Routing wired in T9.)

**Interfaces:** Consumes `fetchVerifiedCollections`, `fetchRecentActivity` (T4); `useNetworkPath`; `NFTMedia` (T1) for activity thumbnails.

Behavior (per the approved mockup): header with a search field (client-side filter over loaded collections) + a "Launch a collection" link to `np("nft/create")`; a "Verified collections" grid (cards: avatar/media, name + verified tick, `Floor · Vol`) linking to `np(\`nft/collection/${id}\`)`; a "Recent activity" list (thumbnail, token, kind, price, relative time). Loading + error + empty states (reuse the robust pattern: a `.catch` that surfaces an error state, never a wedge).

- [ ] Step 1: Failing test — renders verified collection cards (mock T4) + a search input that filters; renders activity rows; an error state on rejected load (not a wedge).
- [ ] Step 2: Run → fail.
- [ ] Step 3: Implement.
- [ ] Step 4: Run → pass; tsc clean.
- [ ] Step 5: Commit `feat(nft): marketplace discovery hub`.

---

## Task 6: Collection page data hook

**Files:** Create `frontend/src/pages/useCollectionPublic.ts`; Test alongside.

**Interfaces:**
- Consumes: `fetchCollectionDetail(id)` (stats/admin/royalty from chain) + `fetchNFTCollection(id)` (indexer stats: floor/volume/owners/listed) + `fetchV3Tokens(id, supply)` + `fetchV3Listings(id)` + `fetchNFTActivity(id, limit)`.
- Produces: `useCollectionPublic(id): { detail, stats, tokens, listings, activity, loading, error, reload }` with the listing for a token looked up via `listingKey(id, tokenId)`.

- [ ] Step 1: Failing test (mock the reads): returns merged `{ detail, stats, tokens, listings, activity }`; a token's listing is resolvable; rejected load → `loading=false` + `error` set (no wedge).
- [ ] Step 2: Run → fail.
- [ ] Step 3: Implement (parallel fetches; cancelled-flag guard; error path).
- [ ] Step 4: Run → pass; tsc clean.
- [ ] Step 5: Commit `feat(nft): useCollectionPublic data hook`.

---

## Task 7: Redesigned public collection page

**Files:** Create `frontend/src/pages/CollectionPublic.tsx`; Test alongside.

**Interfaces:** Consumes `useCollectionPublic` (T6); `TradeModal` (T3); `NFTMedia` (T1); `useNetworkPath`; the connected address (`useOutletContext<LayoutContext>`).

Behavior (per the approved mockup): header (avatar/media + name + verified + `by …`); understated stats strip (Floor/Volume/Owners/Listed from `stats`); tabs **Items · Activity · About**; Items = a token grid (`NFTMedia` + `#id` + price-or-"Not listed") with an inline action that opens `TradeModal` (`buy` if listed; `offer` if not — and `list`/`accept` when the viewer owns the token / has an offer). `source="v3"` for these `memba_collections` collections. Activity = the activity list (reuse the hub's activity row style). About = collection meta. Editorial-calm. An admin viewing their own collection sees the existing "Manage in Studio →" link (Phase 1) — keep it.

- [ ] Step 1: Failing test (mock T6 + a render-spy on TradeModal): renders header + stats + the three tabs; a listed token's "Buy" opens TradeModal with `action="buy", source="v3"`; an unlisted token shows "Make offer" → TradeModal `action="offer"`.
- [ ] Step 2: Run → fail.
- [ ] Step 3: Implement. (Replaces the collector view of `CollectionDetail.tsx`. Decide in implementation whether to retire `CollectionDetail.tsx` entirely or have the route point here — see T9; the public mint forms move into the Items/owner flow or are dropped for collectors, since minting is in the Studio.)
- [ ] Step 4: Run → pass; tsc clean.
- [ ] Step 5: Commit `feat(nft): redesigned public collection page`.

---

## Task 8: Read-only legacy v1 viewer

**Files:** Create `frontend/src/pages/LegacyCollectionView.tsx` (refactored from `NFTCollectionView.tsx`); Test alongside.

**Interfaces:** Consumes `getCollectionInfo(realmPath)` + `queryRender(GNO_RPC_URL, realmPath, "")` (as the current `NFTCollectionView` does).

Behavior: a minimal READ-ONLY view for any `:realmPath` — collection header + the sanitized on-chain Render output. **Strip** the mint form and any trade/approval logic (legacy v1 gets no new trading). Add a one-line "Legacy collection — read only" banner.

- [ ] Step 1: Failing test — renders the collection header + render output for a mocked realm; asserts NO mint form / NO trade buttons are present.
- [ ] Step 2: Run → fail.
- [ ] Step 3: Implement (port `NFTCollectionView`'s read path; remove mint/trade).
- [ ] Step 4: Run → pass; tsc clean.
- [ ] Step 5: Commit `feat(nft): read-only legacy v1 collection viewer`.

---

## Task 9: Routing + legacy redirects

**Files:** Modify `frontend/src/App.tsx`; Test (a routing test or extend existing).

Changes (preserve the catch-all-last ordering):
- `/nft` → `MarketplaceHub` (was `NFTGallery`).
- `/nft/collection/:creator/:slug` → `CollectionPublic` (was `CollectionDetail`).
- `/nft/:realmPath` → `LegacyCollectionView` (was `NFTCollectionView`), still LAST.
- `/nft/create/advanced` → `<Navigate>` redirect to `nft/create` (retire the code-gen wizard).
- Keep the Studio routes (Phase 1) and `/nft/create`, `/nft/creator/...` as-is.

- [ ] Step 1: Failing/added test — navigating `/test13/nft` renders the hub; `/nft/collection/a/b` renders the public page; `/nft/create/advanced` redirects to `/nft/create`.
- [ ] Step 2: Run → fail.
- [ ] Step 3: Implement the route swaps + redirect + lazy imports.
- [ ] Step 4: Run → pass; tsc clean.
- [ ] Step 5: Commit `feat(nft): route hub/collection/legacy; retire advanced wizard`.

---

## Task 10: Retire the old modals + gallery; clean up

**Files:** Delete `BuyNFTModal.tsx`, `V3BuyNFTModal.tsx`, `ListForSaleModal.tsx`, `V3ListForSaleModal.tsx`, `MakeOfferModal.tsx` and the old `NFTGallery` tab/`NFTCollectionView` once unreferenced; remove now-dead imports/exports. Modify any remaining referrers to use `TradeModal`.

- [ ] Step 1: Grep for references to each deleted component; confirm only the new surfaces remain (and migrate any stragglers to `TradeModal`).
- [ ] Step 2: Delete the dead files; remove dead imports.
- [ ] Step 3: Run the FULL suite + `tsc --noEmit` + `npm run lint` → all green (resolves anything that referenced the removed files).
- [ ] Step 4: Commit `refactor(nft): remove superseded modals + legacy gallery`.

---

## Task 11: Editorial-calm styling + final review

**Files:** Create/extend the marketplace stylesheet (hub + collection + TradeModal + media + legacy banner) on Memba tokens; import where needed.

- [ ] Step 1: Grep the new components' classNames; define every class on `--color-*`/`--space-*`/`--radius-*` (no purple/green). Self-contained per page (don't depend on a stylesheet the page doesn't import — the Phase-1 lesson).
- [ ] Step 2: `npm run lint` + `npx tsc --noEmit` + `npx vitest run` + `npm run build` → all green.
- [ ] Step 3: Commit `feat(nft): editorial-calm marketplace styling`.
- [ ] Step 4: (Controller) dev-server visual check of `/nft` (hub) and a collection page, starting from a hard nav; confirm media renders + the editorial-calm look + the TradeModal opens. Then the whole-branch opus review.

---

## Self-Review (author)

- **Spec coverage (§4.1, §5):** hub (T4–T5), collection page (T6–T7), one TradeModal (T2–T3, replacing 5 modals; +AcceptOffer), NFTMedia (T1), legacy read-only viewer (T8), retire advanced wizard (T9), cleanup (T10), styling (T11). Activity/stats use the existing ConnectRPC endpoints — no backend work.
- **Known constraint surfaced (not hidden):** there is NO global-activity endpoint — the hub aggregates per-collection `GetNFTActivity` client-side across the top verified collections and `log`s the cap (T4). If a global feed is wanted later, that's a small backend rpc (out of this frontend-only phase).
- **Placeholder scan:** novel logic (NFTMedia, PriceBreakdown, TradeModal, nftHub) has concrete behavior + test cases; UI assembly references the approved mockups + existing components by file. No "TBD".
- **Type/interface consistency:** builder signatures + `tradeEngineFor` shape taken verbatim from the reference; `TradeModal` action/source enums are the single discriminator; `EnginePaths.feeBps` is the only fee source.
- **Stacking note:** this branches off Phase 1 (`feat/nft-creator-studio`, unmerged). Merge order: Phase 1 then Phase 2 (or squash both). Flagged for the merge step.
