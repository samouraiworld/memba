/**
 * NFT Marketplace data layer — ABCI queries, parsers, and message builders.
 *
 * v3.1: Integrates with the nft_market realm for:
 * - Listing browsing via Render("") parsing
 * - Individual listing detail via Render("listing/realm:tokenId")
 * - Sales history via Render("sales")
 * - MsgCall builders for List, Delist, Buy, MakeOffer, CancelOffer
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
        // Convert "1.500000" GNOT to ugnot
        const [whole, frac] = priceStr.split(".")
        const ugnot = (parseInt(whole, 10) || 0) * 1_000_000 + (parseInt(frac || "0", 10) || 0)

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

// ── MsgCall Builders ─────────────────────────────────────────

/**
 * Build MsgCall for nft_market.ListNFT().
 * Caller must have Approve(marketplace, tokenId) on the NFT realm first.
 */
export function buildListForSaleMsg(
    caller: string,
    marketplacePath: string,
    nftRealm: string,
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
            args: [nftRealm, tokenId, String(priceUgnot)],
        },
    }
}

/**
 * Build MsgCall for nft_market.DelistNFT().
 */
export function buildDelistMsg(
    caller: string,
    marketplacePath: string,
    nftRealm: string,
    tokenId: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: marketplacePath,
            func: "DelistNFT",
            args: [nftRealm, tokenId],
        },
    }
}

/**
 * Build MsgCall for nft_market.BuyNFT().
 * Sends the price amount in ugnot.
 */
export function buildBuyNFTMsg(
    caller: string,
    marketplacePath: string,
    nftRealm: string,
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
            args: [nftRealm, tokenId],
        },
    }
}

/**
 * Build MsgCall for nft_market.MakeOffer().
 * Sends the offer amount in ugnot (held in escrow).
 */
export function buildMakeOfferMsg(
    caller: string,
    marketplacePath: string,
    nftRealm: string,
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
            args: [nftRealm, tokenId],
        },
    }
}

/**
 * Build MsgCall for nft_market.CancelOffer().
 * Returns escrowed funds to the offerer.
 */
export function buildCancelOfferMsg(
    caller: string,
    marketplacePath: string,
    nftRealm: string,
    tokenId: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: marketplacePath,
            func: "CancelOffer",
            args: [nftRealm, tokenId],
        },
    }
}

/** Build MsgCall to accept an offer on a listed NFT (seller action). */
export function buildAcceptOfferMsg(
    caller: string,
    marketplacePath: string,
    nftRealm: string,
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
            args: [nftRealm, tokenId, buyerAddr],
        },
    }
}
