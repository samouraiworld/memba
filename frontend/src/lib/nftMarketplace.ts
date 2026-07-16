/**
 * NFT Marketplace data layer — ABCI queries, parsers, and message builders.
 *
 * v4.0: Repointed to live test13 realms (memba_nft_market_v2, memba_nft_v2).
 * Builders now take `collectionID` (e.g. "genesis") instead of a realm path
 * as the first collection argument, matching the on-chain ABI exactly.
 *
 * On-chain ABI (memba_nft_market_v2):
 *   ListNFT(collectionID, tid, price)   — no send
 *   DelistNFT(collectionID, tid)        — no send
 *   BuyNFT(collectionID, tid)           — send = priceUgnot + "ugnot"
 *   MakeOffer(collectionID, tid)        — send = offerUgnot + "ugnot"
 *   CancelOffer(collectionID, tid)      — no send
 *   AcceptOffer(collectionID, tid, buyer)
 *   ClaimExpiredOffer(collectionID, buyer)
 *
 * On-chain ABI (memba_nft_v2 — approve-before-list):
 *   SetApprovalForAll(collectionID, operator, approved)
 *   Approve(collectionID, operator, tid)
 *
 * @module lib/nftMarketplace
 */

import type { AminoMsg } from "./grc20"

// ── Types ────────────────────────────────────────────────────

export interface NFTListing {
    /** Listing index (1-based) */
    index: number
    /** NFT collection realm path */
    nftRealm: string
    /** Token ID within the collection */
    tokenId: string
    /** Asking price in ugnot */
    priceUgnot: number
    /** Seller address (possibly truncated from Render output) */
    seller: string
    /** Type discriminator for future GRC1155 support */
    type: "grc721" | "grc1155"
}

export interface NFTSale {
    /** Sale ID */
    saleId: number
    /** Collection realm path (possibly truncated) */
    collection: string
    /** Token ID */
    tokenId: string
    /** Sale price formatted (e.g. "1.500000 GNOT") */
    priceFormatted: string
    /** Seller (possibly truncated) */
    seller: string
    /** Buyer (possibly truncated) */
    buyer: string
}

export interface MarketplaceStats {
    /** Number of active listings */
    activeListings: number
}

// ── Render() Parsers ─────────────────────────────────────────

/**
 * Parse marketplace Render("") output into listing array.
 *
 * Expected format (markdown table):
 * | # | Collection | Token | Price | Seller |
 * |---|-----------|-------|-------|--------|
 * | 1 | my_nft | token1 | 1.000000 GNOT | g1abc12345... |
 */
export function parseMarketplaceRender(data: string): { listings: NFTListing[]; stats: MarketplaceStats } {
    const listings: NFTListing[] = []
    let activeListings = 0

    // Extract active listings count
    const countMatch = data.match(/\*\*Active Listings:\*\*\s*(\d+)/)
    if (countMatch) {
        activeListings = parseInt(countMatch[1], 10)
    }

    // Parse table rows: | N | collection | tokenId | price GNOT | seller |
    const rowRe = /\|\s*(\d+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*([\d.]+)\s*GNOT\s*\|\s*(\S+)\s*\|/g
    let match: RegExpExecArray | null
    while ((match = rowRe.exec(data)) !== null) {
        const priceStr = match[4]
        // Convert "1.500000" GNOT → ugnot. The fractional part is scaled to 6 decimal
        // places (1 GNOT = 1_000_000 ugnot): right-pad to 6 so "1.5" → 500000 (not the
        // raw 5 → 1_000_005 bug), and take the first 6 digits. The realm always emits
        // exactly %06d, so the slice is a no-op in practice; a (never-emitted) >6-digit
        // fraction would be TRUNCATED toward zero, not rounded — so this stays SAFE
        // (never over-charges) for the realm's format, but is not a general decimal parser.
        const [whole, frac = ""] = priceStr.split(".")
        const fracUgnot = parseInt(frac.padEnd(6, "0").slice(0, 6), 10) || 0
        const ugnot = (parseInt(whole, 10) || 0) * 1_000_000 + fracUgnot

        listings.push({
            index: parseInt(match[1], 10),
            nftRealm: match[2], // may be truncated (just pkg name)
            tokenId: match[3],
            priceUgnot: ugnot,
            seller: match[5],
            type: "grc721",
        })
    }

    return { listings, stats: { activeListings } }
}

/**
 * Parse sales history from Render("sales").
 *
 * Expected format:
 * | Sale | Collection | Token | Price | Seller | Buyer |
 * |------|-----------|-------|-------|--------|-------|
 * | 1 | my_nft | token1 | 1.000000 GNOT | g1abc... | g1def... |
 */
export function parseSalesRender(data: string): NFTSale[] {
    const sales: NFTSale[] = []

    const rowRe = /\|\s*(\d+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*([\d.]+\s*GNOT)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|/g
    let match: RegExpExecArray | null
    while ((match = rowRe.exec(data)) !== null) {
        sales.push({
            saleId: parseInt(match[1], 10),
            collection: match[2],
            tokenId: match[3],
            priceFormatted: match[4].trim(),
            seller: match[5],
            buyer: match[6],
        })
    }

    return sales
}

// ── MsgCall Builders — Marketplace (memba_nft_market_v2) ─────

/**
 * Build MsgCall for ListNFT(collectionID, tid, price).
 * Caller must have SetApprovalForAll or Approve on the collection realm first.
 */
export function buildListForSaleMsg(
    caller: string,
    marketplacePath: string,
    collectionID: string,
    tokenId: string,
    priceUgnot: number,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: marketplacePath,
            func: "ListNFT",
            args: [collectionID, tokenId, String(priceUgnot)],
        },
    }
}

/**
 * Build MsgCall for DelistNFT(collectionID, tid).
 */
export function buildDelistMsg(
    caller: string,
    marketplacePath: string,
    collectionID: string,
    tokenId: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: marketplacePath,
            func: "DelistNFT",
            args: [collectionID, tokenId],
        },
    }
}

/**
 * Build MsgCall for BuyNFT(collectionID, tid).
 * Sends the price amount in ugnot as payment.
 */
export function buildBuyNFTMsg(
    caller: string,
    marketplacePath: string,
    collectionID: string,
    tokenId: string,
    priceUgnot: number,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: `${priceUgnot}ugnot`,
            pkg_path: marketplacePath,
            func: "BuyNFT",
            args: [collectionID, tokenId],
        },
    }
}

/**
 * Build MsgCall for MakeOffer(collectionID, tid).
 * Sends the offer amount in ugnot (held in escrow).
 */
export function buildMakeOfferMsg(
    caller: string,
    marketplacePath: string,
    collectionID: string,
    tokenId: string,
    offerAmountUgnot: number,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: `${offerAmountUgnot}ugnot`,
            pkg_path: marketplacePath,
            func: "MakeOffer",
            args: [collectionID, tokenId],
        },
    }
}

/**
 * Build MsgCall for CancelOffer(collectionID, tid).
 * Returns escrowed funds to the offerer.
 */
export function buildCancelOfferMsg(
    caller: string,
    marketplacePath: string,
    collectionID: string,
    tokenId: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: marketplacePath,
            func: "CancelOffer",
            args: [collectionID, tokenId],
        },
    }
}

/**
 * Build MsgCall for AcceptOffer(collectionID, tid, buyer) — seller action.
 */
export function buildAcceptOfferMsg(
    caller: string,
    marketplacePath: string,
    collectionID: string,
    tokenId: string,
    buyerAddr: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: marketplacePath,
            func: "AcceptOffer",
            args: [collectionID, tokenId, buyerAddr],
        },
    }
}

/**
 * Build MsgCall for ClaimExpiredOffer(collectionID, buyer) — reclaim funds after expiry.
 */
export function buildClaimExpiredOfferMsg(
    caller: string,
    marketplacePath: string,
    collectionID: string,
    buyerAddr: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: marketplacePath,
            func: "ClaimExpiredOffer",
            args: [collectionID, buyerAddr],
        },
    }
}

// ── MsgCall Builders — Collection (memba_nft_v2) ─────────────

/**
 * Build MsgCall for SetApprovalForAll(collectionID, operator, approved).
 * pkg_path = collection realm path (NOT the marketplace).
 * Use this to approve the marketplace to transfer ALL tokens in a collection.
 */
export function buildSetApprovalForAllMsg(
    caller: string,
    collectionPath: string,
    collectionID: string,
    operatorAddr: string,
    approved: boolean,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: collectionPath,
            func: "SetApprovalForAll",
            args: [collectionID, operatorAddr, String(approved)],
        },
    }
}

/**
 * Build MsgCall for Approve(collectionID, operator, tid) — per-token approval.
 * pkg_path = collection realm path (NOT the marketplace).
 * Alternative to SetApprovalForAll for single-token approval before listing.
 */
export function buildApproveMsg(
    caller: string,
    collectionPath: string,
    collectionID: string,
    operatorAddr: string,
    tokenId: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: collectionPath,
            func: "Approve",
            args: [collectionID, operatorAddr, tokenId],
        },
    }
}

// NFT collection floor-offers were removed: the target offers realm was
// undeployed and pre-interrealm-v2 (won't compile), and the UI fabricated
// offer depth. Reintroduce against a deployed, fund-safe offers engine
// (e.g. the memba_nft_market_v3_2 escrowed-offer pattern).
