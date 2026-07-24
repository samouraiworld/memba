/**
 * Chain Abstraction Layer (CAL) — ChainProvider Interface
 *
 * The core abstraction that decouples the Memba frontend from the underlying
 * blockchain. UI components call ChainProvider methods; implementations
 * (GnoProvider, EvmProvider) handle chain-specific details.
 *
 * Design principles:
 * 1. Every method returns platform-agnostic types (from ./types.ts)
 * 2. No chain-specific imports leak into UI components
 * 3. Both providers are unit-testable independently
 * 4. Errors are normalized to ChainError (not chain-native errors)
 *
 * @module lib/chain/provider
 */

import type {
    ChainFamily,
    ChainAddress,
    TxResult,
    ContractRef,
    TokenInfo,
    CALMember,
    CALProposal,
    CALDAOConfig,
    CALNFT,
    CALEscrowContract,
    CALNetworkConfig,
} from "./types"

// ── Error Types ──────────────────────────────────────────────

/** Normalized chain error. */
export class ChainError extends Error {
    constructor(
        message: string,
        public readonly code: ChainErrorCode,
        public readonly family: ChainFamily,
        public readonly raw?: unknown,
    ) {
        super(message)
        this.name = "ChainError"
    }
}

export type ChainErrorCode =
    | "WALLET_NOT_CONNECTED"
    | "USER_REJECTED"
    | "INSUFFICIENT_FUNDS"
    | "CONTRACT_REVERT"
    | "NETWORK_ERROR"
    | "TIMEOUT"
    | "UNKNOWN"

// ── Wallet State ─────────────────────────────────────────────

/** Current wallet connection state. */
export interface WalletState {
    /** Whether a wallet is connected. */
    connected: boolean
    /** The connected address (null if not connected). */
    address: ChainAddress | null
    /** Chain family of the connected wallet. */
    family: ChainFamily
    /** Display name (ENS, Gno username, etc.). */
    displayName?: string
}

// ── ChainProvider Interface ──────────────────────────────────

/**
 * The main abstraction interface.
 *
 * Implementations:
 * - GnoProvider (wraps existing useAdena + ABCI queries)
 * - EvmProvider (wagmi + viem)
 */
export interface ChainProvider {
    /** Which chain family this provider serves. */
    readonly family: ChainFamily

    /** Active network configuration. */
    readonly network: CALNetworkConfig

    // ── Wallet ───────────────────────────────────────────────

    /** Connect wallet. Returns the connected address. */
    connect(): Promise<ChainAddress>

    /** Disconnect wallet. */
    disconnect(): Promise<void>

    /** Get current wallet state. */
    getWalletState(): WalletState

    /** Check if wallet is connected. */
    isConnected(): boolean

    // ── Auth ─────────────────────────────────────────────────

    /**
     * Sign a login challenge.
     * Gno: ADR-036 sign doc
     * EVM: SIWE (EIP-4361) message
     *
     * @param challenge - Server-issued nonce or challenge string
     * @returns Signature string (base64 for Gno, hex for EVM)
     */
    signLoginChallenge(challenge: string): Promise<string>

    // ── Reads (DAO) ──────────────────────────────────────────

    /** Get DAO configuration. */
    getDAOConfig(dao: ContractRef): Promise<CALDAOConfig>

    /** Get DAO members. */
    getDAOMembers(dao: ContractRef): Promise<CALMember[]>

    /** Get DAO proposals. */
    getDAOProposals(dao: ContractRef): Promise<CALProposal[]>

    /** Get a single proposal. */
    getDAOProposal(dao: ContractRef, proposalId: number): Promise<CALProposal | null>

    /** Check if an address is a DAO member. */
    isDAOMember(dao: ContractRef, address: ChainAddress): Promise<boolean>

    // ── Writes (DAO) ─────────────────────────────────────────

    /** Create a proposal. Returns tx result. */
    propose(dao: ContractRef, title: string, description: string, category: string): Promise<TxResult>

    /** Vote on a proposal. */
    vote(dao: ContractRef, proposalId: number, support: "yes" | "no" | "abstain"): Promise<TxResult>

    /** Execute a passed proposal. */
    executeProposal(dao: ContractRef, proposalId: number): Promise<TxResult>

    /** Add a member (admin only). */
    addMember(dao: ContractRef, address: ChainAddress, votingPower: number, roles: string[]): Promise<TxResult>

    /** Remove a member (admin only). */
    removeMember(dao: ContractRef, address: ChainAddress): Promise<TxResult>

    // ── Reads (Tokens) ───────────────────────────────────────

    /** Get token info. */
    getTokenInfo(token: ContractRef): Promise<TokenInfo | null>

    /** Get token balance for an address. */
    getTokenBalance(token: ContractRef, address: ChainAddress): Promise<string>

    /** List tokens created by the factory. */
    listTokens(): Promise<TokenInfo[]>

    // ── Writes (Tokens) ──────────────────────────────────────

    /** Create a new token via the factory. */
    createToken(name: string, symbol: string, decimals: number, initialSupply: string): Promise<TxResult>

    /** Mint tokens (token admin only). */
    mintTokens(token: ContractRef, to: ChainAddress, amount: string): Promise<TxResult>

    // ── Reads (NFT) ──────────────────────────────────────────

    /** Get NFTs owned by an address. */
    getNFTsByOwner(collection: ContractRef, owner: ChainAddress): Promise<CALNFT[]>

    /** Get NFT info. */
    getNFT(collection: ContractRef, tokenId: string): Promise<CALNFT | null>

    // ── Reads (Escrow) ───────────────────────────────────────

    /** Get escrow contract details. */
    getEscrowContract(escrow: ContractRef, contractId: number): Promise<CALEscrowContract | null>

    // ── Writes (Escrow) ──────────────────────────────────────

    /** Create a new escrow contract. */
    createEscrowContract(
        escrow: ContractRef,
        seller: ChainAddress,
        title: string,
        milestoneTitles: string[],
        milestoneAmounts: string[],
    ): Promise<TxResult>

    /** Fund a milestone. */
    fundMilestone(escrow: ContractRef, contractId: number, milestoneIdx: number, amount: string): Promise<TxResult>

    /** Complete a milestone (seller). */
    completeMilestone(escrow: ContractRef, contractId: number, milestoneIdx: number): Promise<TxResult>

    /** Release funds for a milestone (buyer). */
    releaseFunds(escrow: ContractRef, contractId: number, milestoneIdx: number): Promise<TxResult>

    // ── Utilities ────────────────────────────────────────────

    /** Get block explorer URL for a transaction. */
    getExplorerTxUrl(txHash: string): string

    /** Get block explorer URL for an address. */
    getExplorerAddressUrl(address: ChainAddress): string

    /** Parse an address string into a ChainAddress. */
    parseAddress(raw: string): ChainAddress

    /** Get the native token balance. */
    getNativeBalance(address: ChainAddress): Promise<string>
}
