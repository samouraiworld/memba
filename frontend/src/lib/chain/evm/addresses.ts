/**
 * EVM Contract Addresses — per-network deployment addresses.
 *
 * Populated after deployment (Phase 6/7). Used by EvmProvider
 * to route contract calls to the correct addresses.
 *
 * @module lib/chain/evm/addresses
 */

import type { ChainId } from "../types"

/** All known Memba contract addresses for a single network. */
export interface EvmContractAddresses {
    /** MembaDAO proxy (or factory address for multi-DAO). */
    daoFactory: `0x${string}`
    /** MembaCandidature proxy. */
    candidature: `0x${string}`
    /** MembaTokenFactory proxy. */
    tokenFactory: `0x${string}`
    /** MembaEscrow proxy. */
    escrow: `0x${string}`
    /** MembaNFT proxy (shared instance). */
    nft: `0x${string}`
    /** MembaCollections proxy. */
    collections: `0x${string}`
    /** MembaTokenOTC proxy. */
    tokenOTC: `0x${string}`
    /** MembaChannels proxy. */
    channels: `0x${string}`
    /** MembaReviews proxy. */
    reviews: `0x${string}`
    /** MembaBadges proxy. */
    badges: `0x${string}`
    /** MembaQuests proxy. */
    quests: `0x${string}`
    /** MembaPoints proxy. */
    points: `0x${string}`
    /** MembaAppStore proxy. */
    appStore: `0x${string}`
    /** MembaRegistry proxy. */
    registry: `0x${string}`
}

/** Zero address placeholder for pre-deployment. */
const ZERO = "0x0000000000000000000000000000000000000000" as const

/**
 * Contract addresses indexed by ChainId.
 *
 * NOTE: Addresses are placeholders until deployment.
 * After `forge script Deploy.s.sol`, update these with the proxy addresses
 * from the deployment output.
 */
export const EVM_CONTRACT_ADDRESSES: Partial<Record<ChainId, EvmContractAddresses>> = {
    "rh-testnet-46630": {
        daoFactory: ZERO,
        candidature: ZERO,
        tokenFactory: ZERO,
        escrow: ZERO,
        nft: ZERO,
        collections: ZERO,
        tokenOTC: ZERO,
        channels: ZERO,
        reviews: ZERO,
        badges: ZERO,
        quests: ZERO,
        points: ZERO,
        appStore: ZERO,
        registry: ZERO,
    },
    "rh-mainnet-4663": {
        daoFactory: ZERO,
        candidature: ZERO,
        tokenFactory: ZERO,
        escrow: ZERO,
        nft: ZERO,
        collections: ZERO,
        tokenOTC: ZERO,
        channels: ZERO,
        reviews: ZERO,
        badges: ZERO,
        quests: ZERO,
        points: ZERO,
        appStore: ZERO,
        registry: ZERO,
    },
}

/** Get contract addresses for the current network. */
export function getContractAddresses(chainId: ChainId): EvmContractAddresses | null {
    return EVM_CONTRACT_ADDRESSES[chainId] ?? null
}
