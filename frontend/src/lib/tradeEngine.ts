/**
 * tradeEngine.ts — Route trade operations to the correct NFT market engine.
 *
 * The caller passes the known source (genesis reads → "v2";
 * memba_collections launchpad collections → "v3"). No ID sniffing.
 *
 * @module lib/tradeEngine
 */

import {
    NFT_MARKETPLACE_PATH,
    NFT_COLLECTION_PATH,
    NFT_MARKET_ADDR,
    NFT_MARKETPLACE_V3_PATH,
    NFT_COLLECTIONS_PATH,
    NFT_MARKET_V3_ADDR,
    PLATFORM_FEE_BPS_V2,
    PLATFORM_FEE_BPS_V3,
} from "./nftConfig"

/** Which market engine a collection trades on. */
export type TradeEngine = "v2" | "v3"

/** Resolved paths and metadata for a trade engine. */
export interface EnginePaths {
    /** Engine identifier. */
    engine: TradeEngine
    /** On-chain path to the marketplace realm. */
    marketPath: string
    /** On-chain path to the collection/registry realm (approval target). */
    collectionPath: string
    /** Bech32 address of the marketplace realm (operator for SetApprovalForAll). */
    marketAddr: string
    /** Platform fee in basis points. */
    feeBps: number
}

/**
 * Return the resolved paths and fee for the given engine.
 *
 * @param source - "v2" for genesis / memba_nft_v2 collections;
 *                 "v3" for memba_collections launchpad collections.
 */
export function tradeEngineFor(source: TradeEngine): EnginePaths {
    if (source === "v3") {
        return {
            engine: "v3",
            marketPath: NFT_MARKETPLACE_V3_PATH,
            collectionPath: NFT_COLLECTIONS_PATH,
            marketAddr: NFT_MARKET_V3_ADDR,
            feeBps: PLATFORM_FEE_BPS_V3,
        }
    }

    // Default: v2
    return {
        engine: "v2",
        marketPath: NFT_MARKETPLACE_PATH,
        collectionPath: NFT_COLLECTION_PATH,
        marketAddr: NFT_MARKET_ADDR,
        feeBps: PLATFORM_FEE_BPS_V2,
    }
}
