/**
 * NFT Marketplace shared configuration constants.
 *
 * Single source of truth for marketplace/collection paths, addresses, and fee settings.
 * All NFT components import from here instead of hardcoding values.
 *
 * Live test13 realms (deployed 2026-06-16):
 *   Marketplace: gno.land/r/samcrew/memba_nft_market_v2
 *   Collection:  gno.land/r/samcrew/memba_nft_v2
 *
 * @module lib/nftConfig
 */

/** On-chain path to the NFT marketplace realm (memba_nft_market_v2). */
export const NFT_MARKETPLACE_PATH = "gno.land/r/samcrew/memba_nft_market_v2"

/** On-chain path to the NFT collection realm (memba_nft_v2). */
export const NFT_COLLECTION_PATH = "gno.land/r/samcrew/memba_nft_v2"

/**
 * On-chain path to the canonical multi-collection registry (Phase 2 launchpad).
 * Creators register collections INTO this shared realm (Model A); the market
 * trades every launch. NOT YET DEPLOYED — gated by isNftLaunchpadValid().
 */
export const NFT_COLLECTIONS_PATH = "gno.land/r/samcrew/memba_collections"

/**
 * Bech32 address of the marketplace realm.
 * Used as `operator` in SetApprovalForAll / Approve calls on the collection.
 */
export const NFT_MARKET_ADDR = "g15unfxh9zfm75puw2lqmsun2lv8c397e0efkp2u"

/** On-chain path to the v3 NFT marketplace realm (memba_nft_market_v3). */
export const NFT_MARKETPLACE_V3_PATH = "gno.land/r/samcrew/memba_nft_market_v3"

/**
 * Bech32 address of the v3 marketplace realm.
 * Used as `operator` in SetApprovalForAll calls on memba_collections.
 */
export const NFT_MARKET_V3_ADDR = "g1pucv5exvs0pxlfe39qlyu4pge47llcx78nx5nj"

/**
 * Default collection ID for the live genesis drop.
 * Name: "Memba Genesis", symbol: MGEN, 3 tokens minted to the multisig.
 */
export const DEFAULT_COLLECTION_ID = "genesis"

/** Platform fee in basis points (250 = 2.5%) — v2 engine. */
export const PLATFORM_FEE_BPS = 250

/** Platform fee in basis points for v2 engine (alias for PLATFORM_FEE_BPS). */
export const PLATFORM_FEE_BPS_V2 = 250

/** Platform fee in basis points for v3 engine (200 = 2.0%). */
export const PLATFORM_FEE_BPS_V3 = 200
