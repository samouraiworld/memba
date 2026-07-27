# NFT Floor Offers — Engine Design (DRAFT, pre-panel)

_Status: DRAFT for 5-lens CTO panel (2026-06-17). Phase 2 of `NFT_MARKETPLACE_PHASE3_PLUS_PLAN.md` §7. Floor (collection-wide) offers only; sweep deferred per §7 (gated on real listing depth). To be hardened by the panel, then finalized + writing-plans + TDD build. Build is deploy-gated: it must not be `RegisterMarket`-ed until v3 is confirmed registered + indexer-tailing, and after an independent royalty-routing audit (§4 guardrails)._

## 1. What & why
A **collection-wide escrowed bid**: a buyer locks ugnot offering to buy *any* token in a collection; **any current holder** of a token in that collection can accept, choosing which token to sell. This manufactures a two-sided market at low listing depth (the volume flywheel that justifies sequencing it ahead of auctions).

Distinct from the live v3 per-token offers (`memba_nft_market_v3.MakeOffer`, which require an active listing to accept). This is **additive**: a new, separately-deployed, separately-registered engine realm. v3 stays the listings/buy/per-token-offers engine. `memba_collections` is **never touched**.

## 2. Architecture & boundaries
- **New realm:** `gno.land/r/samcrew/memba_nft_offers_v1` (versioned engine; a fix = a new `_vN` path).
- **Imports:** `p/samcrew/memba_market_core` (SplitProceeds + frozen event builders — the §5.3 conformance single-source-of-truth; we do NOT copy split math locally like v3 did), `p/samcrew/grc721` (TokenID), and `r/samcrew/memba_collections` for `RoyaltyInfo` + `MarketTransfer`.
- **State (avl trees, mirrors v3 caps):**
  - `offers: avl.Tree` — key `offerKey(collectionID, buyer)` → `*FloorOffer`. **One active floor offer per buyer per collection** (cancel + remake to change price). Prevents spam, keeps accept O(1).
  - `offerCount per buyer` enforced via bounded iterate (≤ `MaxOffersPerAddr`), global ≤ `MaxOffers`.
  - `totalVolume int64`, `salesLog`, `paused bool`, `feeRecipient`, **`locked bool`** (explicit reentrancy guard — see §5).
- **FloorOffer:** `{ CollectionID string; Buyer address; Amount int64 (escrowed ugnot); CreatedBlk int64; ExpiryBlk int64 }`.

## 3. ABI (public entrypoints — all scalar args; NO `[]string`)
1. `MakeFloorOffer(cur realm, collectionID string, durationBlks int64)`
   - `IsUserCall` guard; `paused` blocks (new escrow). Escrow = `sumUgnot(OriginSend())`, must be ≥ `MinPrice`, ≤ `MaxPrice`.
   - `durationBlks` clamped to `[MinOfferDurationBlk, MaxOfferDurationBlk]`; `ExpiryBlk = ChainHeight() + durationBlks`.
   - Caps: global `MaxOffers`, per-buyer `MaxOffersPerAddr`; reject if an offer for (collection, buyer) already exists ("cancel first").
   - Emit `OfferMade` via `market_core.OfferMadeArgs(collectionID, "", buyer, amount, "ugnot", ExpiryBlk)` — `tokenId=""` (collection-wide).
2. `CancelFloorOffer(cur realm, collectionID string)`
   - Buyer-only (key derives from caller). Pause-exempt (value-exit). `age ≥ MinOfferLifetimeBlk` (anti front-run). Effects (remove) → refund (pull from realm balance) → emit `OfferCancelled`.
3. `AcceptFloorOffer(cur realm, collectionID string, tid grc721.TokenID, buyer address)` — **the moat seam**
   - Caller = the holder/seller. Reentrancy guard (`locked`). `paused` blocks (new settlement).
   - Checks: offer exists for (collection, buyer); `ChainHeight() < ExpiryBlk` (not expired); `buyer != seller` (no self-accept); `nft.OwnerOf(collectionID, tid) == seller` (caller actually owns the token they're selling).
   - **Identical settlement to v3 BuyNFT:** `royRecip, royAmt := nft.RoyaltyInfo(collectionID, tid, amount)` → `fee, royalty, sellerAmt := market_core.SplitProceeds(amount, royAmt)` → **Effects** (remove offer, `recordSale`, `totalVolume += amount`) → **Interactions** `nft.MarketTransfer(cross(cur), collectionID, seller, buyer, tid)` → banker sends royalty, fee, **seller last** → `chain.Emit("Sale", market_core.SaleArgs("offer", collectionID, string(tid), seller, buyer, amount, fee, royalty, royRecip, sellerAmt, "ugnot")...)`.
   - **Prerequisite (2-step, like listing):** the holder must first call `memba_collections.SetApprovalForAll(collectionID, <offers_v1 addr>, true)` so `MarketTransfer` can move the token. UI surfaces approve→accept.
4. `ClaimExpiredFloorOffer(cur realm, collectionID string, buyer address)`
   - Anyone may call; refund always to `buyer`. Requires `ChainHeight() >= ExpiryBlk`. Pause-exempt safety valve (escrow never locks). Effects (remove) → refund → emit `OfferCancelled` (reuse; buyer/amount carried).
- **Admin** (mirror v3 `admin.gno`, `AdminAddress`-gated): `Pause`/`Unpause`, `SetFeeRecipient`. No `AdminDelist` analog needed (offers aren't content); optionally `AdminCancelOffer` for moderation → refunds buyer. **(panel: needed?)**
- **Reads/render:** `Render` with `:stats` (fee, totals, active-offer count) and `:collection/<id>` (offers sorted by amount desc = **executable depth**, not headline). `IsPaused()`.

## 4. Invariants honored (from §4 master guardrails)
- **Royalty moat:** the *only* token movement is `MarketTransfer`; the *only* settlement routes through `RoyaltyInfo` + `SplitProceeds`, CEI-ordered, under one guard. No transfer path that skips royalty. AcceptFloorOffer is byte-equivalent in money-math to v3 BuyNFT (conformance via shared `market_core`).
- **Fee/royalty conformance:** uses `market_core.SplitProceeds` (FeeBPS 200, MaxRoyaltyBPS 1000 clamp) — identical to v3, so no cheapest-path arbitrage between engines.
- **Frozen schema:** all events via `market_core` builders, `schemaVersion` stamped; indexer disambiguates by `pkg_path`.
- **Irreversibility:** registry untouched; engine is revocable via `memba_collections.UnregisterMarket` + global/per-collection `Pause` (kill-switch already exists).

## 5. Security analysis (pre-panel)
- **CEI + explicit reentrancy guard.** v3 relies on CEI alone (sound for ugnot — banker sends to EOAs can't reenter, MarketTransfer is to the trusted registry). For the accept path I add an explicit `locked` mutex as defense-in-depth (§4 guardrail #1 "under one reentrancy guard"), set/cleared around the interactions block.
- **Accept-race / double-settle:** offer removed from state (Effects) *before* MarketTransfer + sends. Two concurrent accepts of the same offer → the second finds no offer → panics. The escrow is consumed exactly once.
- **No self-deal:** `buyer != seller`. (Self/cluster wash excluded from points off-chain.)
- **Front-run on cancel:** `MinOfferLifetimeBlk` floor before cancel; accept checks expiry, not liveness, so a buyer can't instant-cancel to grief an in-flight accept beyond the lifetime floor.
- **Escrow safety:** funds always reclaimable — buyer cancels after lifetime floor, or anyone triggers `ClaimExpiredFloorOffer` after expiry. No path locks escrow permanently.
- **Ownership check:** `OwnerOf == seller` before settlement; `MarketTransfer` re-checks approval/ownership in the registry (`TransferFrom`), so a stale offer against a token the seller no longer holds fails cleanly.
- **Gas bounds:** per-buyer/global offer caps; bounded iteration; one-offer-per-(collection,buyer) keeps accept O(log n).

## 6. New params (others inherited from v3 values)
`MinOfferDurationBlk` (e.g. ~1h = 1800 blk), `MaxOfferDurationBlk` (e.g. ~30d = 1_296_000 blk). Reuse `MinPrice`, `MaxPrice`, `FeeBPS`, `MaxRoyaltyBPS`, `MinOfferLifetimeBlk`, `MaxOffers`, `MaxOffersPerAddr`, `AdminAddress`, `SettlementDenom` (via `market_core` where applicable).

## 7. Testing (TDD; v3 harness lessons)
- gno unit tests: IsUserCall wrapper + internal helper taking explicit caller+sentCoins (direct `cross(cur)` test calls can't toggle IsUserCall); `testing.IssueCoins` to back escrow; route caller-checked fns through in-package `do*` helpers with inlined `SetRealm`; `uassert.AbortsWithMessage(t, cur, msg, func(){...})` for abort tests.
- **Cross-realm dep gotcha:** to `gno test` an engine importing `memba_collections` + `memba_market_core`, both must be **REAL-DIR copies** in `examples/` (symlink resolves for `lint` only, not `test`); swap back after.
- Conformance test: AcceptFloorOffer payout == v3 BuyNFT payout for the same (price, royalty) triplet.
- Security-audit gate (multi-agent) on the accept/royalty-routing path before `RegisterMarket`.

## 8. Deploy & go-live choreography (§10 template — all user-gated)
1. Build + TDD green + lint clean (this engine), conformance + audit pass.
2. Add to deployer manifest (`--commerce-v2`, order after `memba_market_core`); wire CI classification.
3. Multisig deploy `memba_nft_offers_v1`.
4. **Indexer tails its `pkg_path` from deploy height; confirm a synthetic event ingests** (§4 guardrail #5) BEFORE registration.
5. Multisig `memba_collections.RegisterMarket(<offers_v1 addr>)` — post-audit.
6. Frontend: allowlist + multi-engine router entry (§5.6) routing `{collection, makeOffer/acceptOffer}` → offers_v1; approve→accept 2-step UX; offers inbox + executable-depth display.
7. Live 2-wallet end-to-end verification → enable discovery UI.

## 9. Out of scope (this engine)
Sweep (next, gated on listing depth), auctions (Phase 3, separate engine), GRC20 settlement (Phase 4), per-token offers (already live on v3), DAO-curated badge.

## 11. PANEL OUTCOME (2026-06-17) — VALIDATED · GO-WITH-FIXES (5/5 lenses) · PARKED behind Phase-0
All five lenses (security/crossing, economics, architecture, product/UX, data-infra) returned **GO-WITH-FIXES**. The core is sound: additive engine, settlement byte-identical to v3 `BuyNFT` via shared `market_core`, **no royalty-bypass seam**, fully wallet-callable ABI. This design is the engine spec, to be finalized once `NFT_PHASE0_DATA_FOUNDATION_DESIGN.md` ships (the data foundation is the hard gate — see that doc).

**Must-fix folded into the build (apply at writing-plans/TDD):**
- **Drop the `locked` reentrancy mutex** for ugnot settlement (security HIGH-1). CEI is the proven guard: the registry can't call back and ugnot sends can't reenter. The mutex adds a permanent-deadlock fund-availability risk for zero gain. Document "CEI is the reentrancy guard for ugnot"; reserve an explicit guard for the Phase-4 GRC20 desk where RealmTeller reentrancy is real.
- **Append two companion events to `market_core`** (schema is append-only): `OfferAccepted` carrying `offerCreatedBlk`/age (off-chain wash-detection signal — economics F3) and a distinct `OfferExpiredClaimed` (vs collapsing into `OfferCancelled` — security HIGH-3). `Sale` stays the ONLY volume row; `OfferAccepted` is metadata, never double-counted.
- **Resolve floor offers by `(collectionID, buyer, pkg_path)`, ignoring tokenId** (data-infra HIGH-1 / architecture). `tokenId=""` on `OfferMade`/`OfferCancelled` is the collection-scoped sentinel; the accept `Sale` carries the concrete `tid` the holder chose. Indexer branches on `pkg_path`.
- **`SaleArgs` call must `.String()` the address args** (architecture HIGH — won't compile otherwise; `market_core.SaleArgs` takes strings, v3's local `emitSale` took addresses).
- **Init `feeRecipient = address(AdminAddress)`** at declaration (security MEDIUM-4 — else the 2% fee sends to `""`).
- **Promote shared caps/lifetime/`AdminAddress` consts into `market_core`** to kill engine drift (architecture MEDIUM-2); only money-math conformance is guaranteed via core today.
- **Depth display: filter expired offers + show per-price unit counts** (economics F7 / data-infra). Single-fill, one-offer-per-buyer; multi-fill is sweep's job (document F6).
- **Stable, prefixed abort messages** (e.g. `offers: expired`, `offers: not_owner`) for the frontend errorMap (product D1) — don't make the UI regex prose.

**Decisions locked (CTO calls on split votes):**
- **`AdminCancelOffer`: OMIT for v1.** Security + architecture say omit (smaller audit surface, no new admin-moves-funds trust path); product wanted it for surgical moderation. `Pause` + per-collection pause + anyone-callable `ClaimExpiredFloorOffer` already give a complete escrow-exit + moderation surface. Revisit if abuse appears.
- **Adverse selection is owned, not fixed** (economics F1): a collection-wide bid buys the *worst* token a holder will part with — correct floor mechanics. UX must disclose ("collection floor bid — seller's choice of token"); trait-scoped bids are the future upgrade path. Default the holder's accept UI to their floor/least-rare token + show net-proceeds.
- **Maker/taker basis frozen as a via→role mapping** in Phase-0 (`offer` → maker=buyer, taker=seller) rather than new `Sale` attrs (Sale already live on v3) — see Phase-0 design §4.2.

**Product surface (the actual product):** the **holder-side "someone will pay X for any of your tokens → review & accept" prompt** (indexer join of active floor offers × wallet holdings, net-proceeds preview, default-to-floor-token) — NOT a buyer inbox. Needs indexer owner→tokens-in-collection enumeration (confirm capability in Phase-0/engine). Plus: `IsApprovedForAll` pre-check before the approve popup + a revoke affordance (approval footgun, product A1); per-collection cold-start gate behind ≥1 active offer + seed a credible team offer (product C1); **no implied points/$MEMBA** anywhere (non-binding, product E2).

## 10. Open questions for the panel
- Reentrancy mutex worth the added state/complexity vs v3's CEI-only (which passed audit)? Any deadlock/oversight risk?
- One-offer-per-(collection,buyer) vs allowing multiple concurrent floor offers at different prices — spam/UX trade-off.
- `AdminCancelOffer` moderation escape hatch — needed, or does `Pause` + per-collection pause + expiry suffice?
- Anti-cluster/wash on-chain hooks (vs all off-chain in points) — anything the engine should emit to help the points ledger detect self-dealing beyond `buyer != seller`?
- Same-NFT cross-engine consistency: a token offered here while also listed on v3 — `MarketTransfer` on the single registry serializes; confirm the loser fails gracefully (stale-listing on v3 BuyNFT after the token moved).
