/**
 * marketplace/types.ts — Shared types for the Memba marketplace ecosystem.
 *
 * Sprint 6: Consolidates freelance, AI agent, and NFT marketplace types
 * into a single extensible architecture.
 *
 * Design decisions:
 * - PaymentConfig supports multi-token (GNOT today, GRC20 + IBC2/USDC future)
 * - MarketplaceListing is polymorphic via `type` discriminator
 * - EscrowState tracks milestone-based payments with optional dispute timeout
 */

// ── Payment ─────────────────────────────────────────────────

/** Payment configuration — extensible for future GRC20 + IBC2 tokens. */
export interface PaymentConfig {
    /** Token denomination: "ugnot" | GRC20 realm path | IBC denom (future) */
    denom: string
    /** Amount in smallest unit (e.g., ugnot for GNOT) */
    amount: bigint
    /** Platform fee percentage (default 2.5%) */
    feePercent: number
    /** Fee recipient address (Samourai Coop multisig) */
    feeRecipient: string
}

/** Default payment config for GNOT. */
export const DEFAULT_PAYMENT_CONFIG: Omit<PaymentConfig, "amount"> = {
    denom: "ugnot",
    feePercent: 2.5,
    feeRecipient: "", // Set per-deployment
}

/** Supported token denominations. */
export type TokenDenom = "ugnot" | string // string = GRC20 path or IBC denom

/** Check if a denom is the native GNOT token. */
export function isNativeToken(denom: string): boolean {
    return denom === "ugnot"
}

// ── Listings ────────────────────────────────────────────────

/** Marketplace listing type discriminator. */
export type ListingType = "service" | "agent" | "nft"

/** Marketplace listing status. */
export type ListingStatus = "active" | "paused" | "completed" | "disputed"

/** Marketplace listing — shared across freelance/agent/NFT. */
export interface MarketplaceListing {
    id: string
    type: ListingType
    title: string
    description: string
    creator: string          // gno address
    creatorUsername?: string
    pricing: PaymentConfig
    status: ListingStatus
    realmPath: string        // On-chain realm for this listing
    metadata: Record<string, string>
    createdAt: number        // Block height
}

// ── Escrow ──────────────────────────────────────────────────

/** Milestone within an escrow contract. */
export interface Milestone {
    id: number
    title: string
    amount: bigint
    status: "pending" | "funded" | "completed" | "disputed"
}

/** Escrow state — shared by all marketplace transactions. */
export interface EscrowState {
    contractId: string
    buyer: string
    seller: string
    payment: PaymentConfig
    milestones: Milestone[]
    status: "funded" | "in_progress" | "completed" | "disputed" | "cancelled"
    /** DAO address for dispute resolution (optional). */
    disputeResolver?: string
    /** Auto-resolve after N blocks without buyer/seller action. */
    autoResolveBlocks?: number
}

/**
 * Minimum auto-resolve blocks (~3.5 days at 3s/block).
 * Prevents griefing via instant auto-resolution.
 */
export const MIN_AUTO_RESOLVE_BLOCKS = 100_800

/** Validate autoResolveBlocks is above minimum or disabled (0/undefined). */
export function isValidAutoResolve(blocks: number | undefined): boolean {
    if (blocks === undefined || blocks === 0) return true
    return blocks >= MIN_AUTO_RESOLVE_BLOCKS
}

// ── Type Guards ─────────────────────────────────────────────

/** Validate a PaymentConfig has required fields. */
export function isValidPaymentConfig(config: unknown): config is PaymentConfig {
    if (typeof config !== "object" || config === null) return false
    const c = config as Record<string, unknown>
    return (
        typeof c.denom === "string" && c.denom.length > 0 &&
        typeof c.amount === "bigint" && c.amount >= 0n &&
        typeof c.feePercent === "number" && c.feePercent >= 0 && c.feePercent <= 100 &&
        typeof c.feeRecipient === "string"
    )
}

/** Validate a listing type is known. */
export function isValidListingType(type: unknown): type is ListingType {
    return type === "service" || type === "agent" || type === "nft"
}

/** Calculate platform fee for a given amount and fee percentage. */
export function calculatePlatformFee(amount: bigint, feePercent: number): bigint {
    if (feePercent <= 0) return 0n
    // Integer math: (amount * feePercent * 100) / 10000
    return (amount * BigInt(Math.round(feePercent * 100))) / 10000n
}
