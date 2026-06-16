# NFT Marketplace — Redesign Required (tracked follow-up)

**Status:** `nft_market` is **gated OFF** on all networks (`VITE_ENABLE_NFT=false`, CI-enforced). This is the correct, safe state — do **not** enable it until the redesign below ships.
**Date:** 2026-06-16

## Why it's gated, not deployed

The current `gno.land/r/samcrew/nft_market` is a **generic** marketplace: its functions take an NFT realm as a **string path** (`nftRealm string`) and never call that realm. Gno has **no dynamic cross-realm dispatch** — you can only call realms you statically import — so the marketplace physically cannot execute `TransferFrom` on an arbitrary NFT. It works around this with a **2-phase commit** (BuyNFT escrows payment → the NFT must move out-of-band → ConfirmPurchase releases funds → ClaimPurchaseTimeout refunds), which has an **unavoidable trust gap**: only the seller can move the NFT, and a buyer who receives it can decline to confirm and reclaim the payment at timeout — getting the NFT for free. Shipping that is a fund/asset-loss risk.

This was redeployed-blocked too: even ported to a `_v2` path, the design stays unsafe, so it was intentionally excluded from the 2026-06-16 `_v2` wave.

## The proper design (interface-object marketplace)

The sound Gno pattern is the one `tokenfactory` already uses for GRC20 (`grc20reg.Register(*grc20.Token)`): **pass the token object, not a path**.

1. NFT collections expose their token as a standard `grc721.IGRC721` interface object.
2. `ListNFT(cur realm, token grc721.IGRC721, tokenId, price)` receives the object; the seller approves the marketplace as operator (`token.Approve(cross, marketplaceAddr, tokenId)`).
3. `BuyNFT(cur realm, ...)` then atomically: takes payment → `token.TransferFrom(cross, seller, buyer, tokenId)` → pays seller minus fee. One tx, no trust gap.

### Prerequisites (why it's a project, not a patch)
- A **standard GRC721 interface** package the marketplace imports, and NFT realms that implement it.
- A **tradable Memba NFT collection** — none exists today (`gnobuilders_badges` are non-transferable badges; the frontend's mint targets arbitrary demo GRC721s). Without something to trade, the marketplace has no purpose, which is the second reason to keep it gated now.
- Frontend rewire: list/buy modals pass token references instead of path strings.

## Recommendation
Keep gated. Revisit when (a) Memba has a tradable NFT collection, and (b) the interface-object marketplace above is built + audited. Until then the UI correctly shows `ComingSoonGate` and `isNftMarketValid()` returns false on test13.
