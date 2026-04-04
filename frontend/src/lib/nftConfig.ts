/**
 * NFT Marketplace shared configuration constants.
 *
 * Single source of truth for marketplace path and fee settings.
 * All NFT components import from here instead of hardcoding values.
 *
 * @module lib/nftConfig
 */

/** On-chain path to the NFT marketplace realm */
export const NFT_MARKETPLACE_PATH = "gno.land/r/samcrew/nft_market"

/** Platform fee in basis points (250 = 2.5%) */
export const PLATFORM_FEE_BPS = 250
