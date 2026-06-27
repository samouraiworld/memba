/**
 * nftAdapter.ts — map the v3 NFT lane's on-chain data into the UnifiedListing model.
 *
 * The shell reads every lane through an adapter that returns UnifiedListing[]; this is
 * the NFT one. It composes the windowed token enumeration (fetchV3Tokens, W0.3) with
 * the parsed listing map (fetchV3Listings) into UnifiedNft variants.
 *
 * Seller is taken from the token's on-chain owner (the FULL address), not the
 * marketplace render's truncated seller — v3 listings are non-custodial, so
 * OwnerOf(listedToken) === seller. This sidesteps the truncation hazard (W0.2) until
 * the v3.1 structured getter lands (W1.2).
 *
 * @module lib/marketplace/nftAdapter
 */

import { tradeEngineFor } from "../tradeEngine"
import { listingKey, type V3Token, type V3ListingMap } from "../v3TokenGrid"
import { PLATFORM_FEE_BPS_V3 } from "../nftConfig"
import type { NftAction, UnifiedNft } from "./types"

export interface NftAdapterInput {
    /** Collection id, e.g. "creator/slug". */
    collectionID: string
    /** Windowed token set from fetchV3Tokens. */
    tokens: V3Token[]
    /** Listing map from fetchV3Listings (key = collectionID/tokenId). */
    listings: V3ListingMap
    /** Viewer address ("" when disconnected) — decides the action set. */
    me: string
    /** Collection verified badge. */
    verified: boolean
    /** Collection royalty in bps. */
    royaltyBps: number
    /**
     * Per-lane protocol fee in bps, read from memba_market_config on chain. Falls back
     * to the v3 engine constant until the config realm is live (so the fee row is never
     * blank). Pass the chain value once v3.1 + config are deployed.
     */
    feeBps?: number
}

/**
 * Action set for a token. Offers are structural here; the panel gates whether to render
 * them (offers go live with v3.1). Note:
 *  - the OWNER of a LISTED token gets `delist` (not `list`) — listed owners must be able
 *    to remove the listing (review finding H1);
 *  - `buy` is tied STRICTLY to a buyable listing (priced > 0), never inferred from
 *    "listed" alone, so a 0-price record can never surface a buy button (review H2).
 */
function actionsFor(isOwner: boolean, isListed: boolean, isBuyable: boolean): NftAction[] {
    if (isOwner) return isListed ? ["delist"] : ["list"]
    if (isBuyable) return ["buy", "offer"]
    return ["offer"]
}

/** Map v3 tokens + listings into UnifiedNft listings for the shell. */
export function toUnifiedNftListings(input: NftAdapterInput): UnifiedNft[] {
    const engine = tradeEngineFor("v3")
    const feeBps = input.feeBps ?? PLATFORM_FEE_BPS_V3
    return input.tokens.map((tok) => {
        const listing = input.listings.get(listingKey(input.collectionID, tok.tokenId))
        const priceUgnot = listing?.priceUgnot ?? 0
        const isOwner = input.me !== "" && tok.owner === input.me
        const isListed = listing !== undefined
        const isBuyable = isListed && priceUgnot > 0
        return {
            assetType: "nft",
            id: `${input.collectionID}/${tok.tokenId}`,
            title: `#${tok.tokenId}`,
            image: tok.uri,
            verified: input.verified,
            seller: tok.owner, // full address (non-custodial: owner === seller)
            feeBps,
            source: "chain",
            engine: { path: engine.marketPath, addr: engine.marketAddr },
            price: { amount: BigInt(priceUgnot), denom: "ugnot" },
            royaltyBps: input.royaltyBps,
            actions: actionsFor(isOwner, isListed, isBuyable),
        }
    })
}
