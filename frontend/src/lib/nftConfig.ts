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

/**
 * On-chain path to the ACTIVE NFT marketplace engine.
 * 2026-07-10 ceremony: repointed v3.1 → v3.2 (solvency getters, 2-step ownership,
 * sealed salesLog seeded with v3.1's history). v3.1 is PAUSED but stays registered
 * on memba_collections until its 2 open offers drain (wind-down — cancel via CLI).
 *
 * v3.1 is a NEW path: the original memba_nft_market_v3 (g1pucv5…) is occupied + was
 * never registered, and gno paths are immutable, so the config-reading engine deploys
 * fresh here. This path is deliberately NOT in REALM_ALLOWLIST.test13 until v3.1 is
 * deployed + registered — so isNftMarketV3Valid() stays false and the trade surface
 * stays dark. Flip the constant + the allowlist entry TOGETHER at go-live (runbook §5.2).
 */
export const NFT_MARKETPLACE_V3_PATH = "gno.land/r/samcrew/memba_nft_market_v3_2"

/**
 * Bech32 address of the ACTIVE (v3.2) marketplace engine (deterministic from the
 * path; verified live via memba_nft_market_v3_2.MarketAddress() at the 2026-07-10
 * ceremony). Used as `operator` in SetApprovalForAll calls on memba_collections —
 * this MUST move in lockstep with NFT_MARKETPLACE_V3_PATH or approvals authorize
 * the wrong engine.
 */
export const NFT_MARKET_V3_ADDR = "g1y4y37dvtvj7vgnt93pxq2typjcwdf62kdlg8u7"

/**
 * DAO fee spine — the per-lane protocol fee + treasury every engine reads at settlement.
 * The frontend reads GetFeeBPS("nft") from here so the fee row mirrors the on-chain rate
 * (never a hardcoded constant). Deployed before the engine (deploy runbook).
 */
export const MEMBA_MARKET_CONFIG_PATH = "gno.land/r/samcrew/memba_market_config"

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
