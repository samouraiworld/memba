# NFT v3 Trading UI — Scope & Design

_Status: SCOPE (2026-06-18), awaiting decisions. Branch `feat/nft-v3-trading-ui`._

## Why
Everything is on v3 except the UI: `memba_nft_market_v3` is deployed + **registered** on `memba_collections`, the Phase-0 indexer ingests v3 `Sale` events, and the launchpad (create/mint) is now surfaced (#430). But the **trading UI still calls v2 only** (`memba_nft_market_v2` / `memba_nft_v2`). So a buy/sell in the app emits v2 events, not v3 `Sale` — and the v3 pipeline we just shipped can't be exercised through the UI. Wiring trading to v3 is the real "live on v3" step **and** makes the pipeline testable in-app (subsumes the v3 pipeline test).

## Current state (verified)
- `nftConfig.ts` → `NFT_MARKETPLACE_PATH = …memba_nft_market_v2`, `NFT_COLLECTION_PATH = …memba_nft_v2`. No v3.
- `nftMarketplace.ts` builders (List/Buy/Delist/MakeOffer/Cancel/Accept/Claim) all target v2.
- Launchpad already reads+writes `memba_collections` (`lib/launchpad.ts`, `launchpadReads.ts`, `CollectionDetail.tsx`): CreateCollection, Mint phases, admin ops, verified badge. **No v3 *trading* wiring exists.**
- `AcceptOffer` has **no UI** even in v2 (builder exists, no button/modal). Offers-sent/received tabs are stubs.

## v3 vs v2 — only what a frontend builder cares about
| | v2 | v3 | Frontend impact |
|---|---|---|---|
| Market realm | `memba_nft_market_v2` | `memba_nft_market_v3` | new `pkg_path` for all trade MsgCalls |
| Collection registry | `memba_nft_v2` | `memba_collections` | approvals (`SetApprovalForAll`/`Approve`) target this realm; collection IDs are `creator/slug` not `genesis` |
| Buy event | `PurchaseConfirmed` | `Sale{via:"buy", denom:"ugnot"}` | reads/activity key off `Sale`; indexer already handles it |
| Accept event | `OfferAccepted`+`TokenSold` (dual) | `Sale{via:"offer"}` (single) | no double-count; already handled |
| Platform fee | 250 bps (2.5%) | **200 bps (2.0%)** | fee/breakdown UI must be per-engine, not hardcoded |
| Trade fn signatures | `ListNFT/BuyNFT/MakeOffer/AcceptOffer(collectionID, tokenId[, buyer])` | **identical arg shapes** | builders are near-copies; only `pkg_path` + fee differ |

The `cur realm` crossing param is transparent to vm/MsgCall (not in args). No `[]string` args on the trade path (the `[]string` footgun is only on `MintAllowlist`, already handled).

## Design

**Routing (v2 vs v3): by source registry.** The UI already knows where a collection came from — genesis is read from `memba_nft_v2`, launchpad collections from `memba_collections`. So: collection from `memba_collections` → trade on v3; genesis (`memba_nft_v2`) → trade on v2. No ID-format sniffing, no on-chain field. A small `tradeEngineFor(collection)` helper centralizes it.

**Where to surface v3 trading (the main decision):**
- **Option A (recommended, MVP-first): on the `CollectionDetail` page** (the memba_collections collection page, already live via #430). It already shows a v3 collection + mint UI — add an approve→list / buy / offer section there for each token. Contained, ships v3 trading + the pipeline test fast, doesn't touch the v2 gallery.
- **Option B (bigger): make the existing Gallery/Marketplace tabs multi-engine** — one unified surface showing v2 + v3 collections, routing per-collection. Better UX long-term, more surface area + risk.

**Builders/reads:** add `lib/nftMarketplaceV3.ts` (List/Buy/MakeOffer/AcceptOffer/Delist/Cancel targeting `memba_nft_market_v3`, approvals targeting `memba_collections`) + `nftMarketplaceV3Reads.ts` (reuse the existing v2 Render parsers — the table format is identical). Add v3 paths + the v3 market address (`g1pucv5exvs0pxlfe39qlyu4pge47llcx78nx5nj`) + `memba_collections` to the trading config/allowlist.

**Fill the AcceptOffer gap** for v3 (build the missing accept-offer button/modal), since offers aren't usable without it.

## Decisions for you
1. **Surface: Option A (CollectionDetail MVP) or Option B (multi-engine gallery)?** — I recommend **A** first, B as a follow-up.
2. **First-cut scope:** Phase 1 = **approve → list → buy** only (this alone emits a v3 `Sale` and proves the pipeline). Phase 2 = offers (make/accept/cancel) incl. the missing AcceptOffer UI. OK to split this way?
3. **Process:** straight to TDD build, or a quick design audit first? (Frontend wiring is reversible/iterable, so I lean **straight to TDD** — unlike the irreversible realm ABIs that warranted panels.)

## Phased plan (TDD, subagent-driven)
- **P1 — v3 trade core + Buy (proves the pipeline):** config + `nftMarketplaceV3.ts` builders + `tradeEngineFor` router + approve→list→buy on CollectionDetail + per-engine fee display. Vitest on builders/router. → a UI buy emits a real v3 `Sale`.
- **P2 — offers:** MakeOffer/CancelOffer + **AcceptOffer UI** (new) on v3; wire offers-sent/received.
- **P3 (optional) — unify:** multi-engine Gallery/Marketplace (Option B), v2 + v3 in one surface.

## Prereqs (status)
- v3 registered on memba_collections ✅ (done today). `memba_collections` allowlisted ✅ (#430).
- A **collection minted in memba_collections** to trade — none yet; create one via the launchpad (`/nft/create`) → mint → then P1's buy is testable end-to-end (needs a 2nd funded test13 key for the buyer).

## Testability payoff
After P1, a buy through the UI on a memba_collections collection emits `Sale{via:"buy"}` on v3 → the deployed Phase-0 indexer ingests it into `nft_sales`/`nft_raw_events` → confirms the whole pipeline in-app. This is the clean replacement for the throwaway CLI proof.
