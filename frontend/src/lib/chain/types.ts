/**
 * Chain Abstraction Layer (CAL) — Type Definitions
 *
 * Platform-agnostic types used across the entire Memba frontend.
 * These types abstract away chain-specific details (Gno ABCI vs EVM JSON-RPC)
 * so UI components work identically regardless of active chain.
 *
 * @module lib/chain/types
 */

// ── Chain Family ─────────────────────────────────────────────

/** Discriminator for the underlying blockchain technology. */
export type ChainFamily = "gno" | "evm"

/** Canonical chain identifiers known to Memba. */
export type ChainId =
    // Gno chains
    | "test-13"
    | "topaz-1"
    | "gnoland1"
    // EVM chains (Robinhood Chain / Arbitrum Nitro)
    | "rh-mainnet-4663"
    | "rh-testnet-46630"

// ── Address Abstraction ──────────────────────────────────────

/**
 * A chain-agnostic address wrapper.
 *
 * Gno:  bech32 "g1..." (e.g. g1abc123def456...)
 * EVM:  hex "0x..." (e.g. 0x1234...abcd)
 */
export interface ChainAddress {
    /** Raw address string (bech32 or hex). */
    readonly raw: string
    /** Which family this address belongs to. */
    readonly family: ChainFamily
}

/** Type guard: is this a Gno address? */
export function isGnoAddress(addr: ChainAddress): boolean {
    return addr.family === "gno" && addr.raw.startsWith("g1")
}

/** Type guard: is this an EVM address? */
export function isEvmAddress(addr: ChainAddress): boolean {
    return addr.family === "evm" && addr.raw.startsWith("0x")
}

/**
 * Format an address for display.
 * - Full: g1abc...xyz or 0x1234...abcd
 * - Truncated: g1abc...xyz → g1abc...xyz (Gno already short)
 *              0x1234567890abcdef... → 0x1234...cdef
 */
export function formatAddress(addr: ChainAddress, truncate = true): string {
    if (!truncate || addr.raw.length <= 20) return addr.raw
    return `${addr.raw.slice(0, 6)}...${addr.raw.slice(-4)}`
}

// ── Transaction Abstraction ──────────────────────────────────

/** Chain-agnostic transaction result. */
export interface TxResult {
    /** Transaction hash (hex, with or without 0x prefix). */
    hash: string
    /** Was the transaction successful? */
    success: boolean
    /** Block height/number at which the tx was included. */
    blockHeight: number
    /** Gas used (if available). */
    gasUsed?: bigint
    /** Any error message from the chain. */
    error?: string
    /** Chain-specific raw result (for debugging). */
    raw?: unknown
}

/** Status of a pending transaction. */
export type TxStatus = "pending" | "confirmed" | "failed"

// ── Contract/Realm Reference ─────────────────────────────────

/**
 * Unified contract reference.
 *
 * Gno:  realm path (e.g. "gno.land/r/samcrew/memba_dao")
 * EVM:  contract address (e.g. "0x1234...abcd")
 */
export interface ContractRef {
    /** The contract identifier — realm path (Gno) or contract address (EVM). */
    readonly id: string
    /** Chain family. */
    readonly family: ChainFamily
}

// ── Token Abstraction ────────────────────────────────────────

/** Chain-agnostic token representation. */
export interface TokenInfo {
    /** Token identifier: realm path (Gno) or contract address (EVM). */
    id: string
    /** Display name. */
    name: string
    /** Ticker symbol. */
    symbol: string
    /** Decimal places. */
    decimals: number
    /** Total supply (as bigint string for precision). */
    totalSupply: string
    /** Creator/deployer address. */
    creator?: ChainAddress
}

/** Native gas token (GNOT on Gno, ETH on EVM). */
export interface NativeToken {
    /** Display name. */
    name: string
    /** Ticker symbol. */
    symbol: string
    /** Smallest unit name. */
    microUnit: string
    /** Decimals (6 for GNOT/ugnot, 18 for ETH/wei). */
    decimals: number
}

// ── DAO Abstraction ──────────────────────────────────────────

/** Chain-agnostic DAO member. */
export interface CALMember {
    address: ChainAddress
    roles: string[]
    votingPower: number
    username?: string
}

/** Chain-agnostic proposal. */
export interface CALProposal {
    id: number
    title: string
    description: string
    category: string
    status: "open" | "passed" | "rejected" | "executed"
    proposer: ChainAddress
    yesVotes: number
    noVotes: number
    abstainVotes: number
    totalVoters: number
    createdAt?: string
}

/** Chain-agnostic DAO configuration. */
export interface CALDAOConfig {
    name: string
    description: string
    /** Basis points (5100 = 51%). `null` when the chain does not report it —
     *  never substitute a default: basedao's own 60% is wrong for any DAO that
     *  overrides it (memba_dao runs at 66%), and a fabricated threshold silently
     *  misstates whether a proposal passes. */
    threshold: number | null
    quorum: number              // basis points (0 = disabled)
    memberCount: number
}

// ── NFT Abstraction ──────────────────────────────────────────

/** Chain-agnostic NFT item. */
export interface CALNFT {
    /** Token ID (string for both chains). */
    tokenId: string
    /** Owner address. */
    owner: ChainAddress
    /** Token URI (IPFS or HTTP). */
    tokenURI: string
    /** Collection reference. */
    collection: ContractRef
    /** Parsed metadata (if available). */
    metadata?: {
        name: string
        description: string
        image: string
        attributes?: { trait_type: string; value: string }[]
    }
}

// ── Escrow Abstraction ───────────────────────────────────────

export type EscrowContractStatus = "active" | "completed" | "cancelled" | "disputed"
export type EscrowMilestoneStatus = "pending" | "funded" | "completed" | "released" | "refunded" | "disputed"

export interface CALEscrowContract {
    id: number
    buyer: ChainAddress
    seller: ChainAddress
    title: string
    status: EscrowContractStatus
    milestones: CALMilestone[]
    createdAt: number
}

export interface CALMilestone {
    title: string
    amount: string              // bigint string for precision
    status: EscrowMilestoneStatus
}

// ── Network Configuration ────────────────────────────────────

/** Extended network config that includes chain family. */
export interface CALNetworkConfig {
    /** Unique chain identifier. */
    chainId: ChainId
    /** gno or evm. */
    family: ChainFamily
    /** Human-readable label. */
    label: string
    /** Primary RPC endpoint. */
    rpcUrl: string
    /** Fallback RPC endpoints. */
    fallbackRpcUrls: string[]
    /** Block explorer URL template. `{hash}` is replaced with tx hash. */
    explorerTxUrl: string
    /** Block explorer URL template for addresses. */
    explorerAddressUrl: string
    /** Native gas token. */
    nativeToken: NativeToken
    /** Whether the chain is a testnet. */
    isTestnet: boolean

    // ── Gno-specific (optional) ──
    /** Gno faucet URL. */
    faucetUrl?: string
    /** Gno user registry realm path. */
    userRegistryPath?: string
    /** Tx-indexer GraphQL endpoint. */
    indexerUrl?: string

    // ── EVM-specific (optional) ──
    /** EVM chain ID (numeric). */
    evmChainId?: number
    /** Contract registry address (MembaRegistry). */
    registryAddress?: string
}
