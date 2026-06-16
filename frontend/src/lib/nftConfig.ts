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
 * Bech32 address of the marketplace realm.
 * Used as `operator` in SetApprovalForAll / Approve calls on the collection.
 */
export const NFT_MARKET_ADDR = "g15unfxh9zfm75puw2lqmsun2lv8c397e0efkp2u"

/**
 * Default collection ID for the live genesis drop.
 * Name: "Memba Genesis", symbol: MGEN, 3 tokens minted to the multisig.
 */
export const DEFAULT_COLLECTION_ID = "genesis"

/** Platform fee in basis points (250 = 2.5%). */
export const PLATFORM_FEE_BPS = 250
