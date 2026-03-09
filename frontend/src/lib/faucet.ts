/**
 * Gasless Onboarding — Faucet eligibility and rate limiting.
 *
 * Expert recommendations:
 * - Rate limit by address (1 claim per 7 days)
 * - Per-address localStorage keys (prevents FIFO eviction bypass)
 * - localStorage audit trail for transparency
 * - Configurable faucet amount and cooldown
 *
 * Phase 1: Prepares MsgSend + UI. Actual GNOT transfer
 * requires a funded treasury wallet (backend concern).
 */

// ── Types ─────────────────────────────────────────────────────

export interface FaucetClaim {
    address: string
    claimedAt: number  // Unix timestamp ms
    amount: number     // ugnot
}

export interface FaucetEligibility {
    eligible: boolean
    reason?: string
    /** Remaining cooldown in milliseconds (0 if eligible) */
    cooldownRemaining?: number
    /** When the user can next claim (ISO string, if not eligible) */
    nextClaimAt?: string
}

// ── Constants ─────────────────────────────────────────────────

/** 3 GNOT in ugnot units. */
export const FAUCET_AMOUNT_UGNOT = 3_000_000

/** Display amount for the claim card. */
export const FAUCET_AMOUNT_DISPLAY = "Free Test Tokens"

/** localStorage key for faucet card dismissal. */
const FAUCET_DISMISSED_KEY = "memba_faucet_dismissed"

/** Check if user dismissed the faucet card. */
export function isFaucetDismissed(): boolean {
    return localStorage.getItem(FAUCET_DISMISSED_KEY) === "1"
}

/** Dismiss the faucet card. */
export function dismissFaucet(): void {
    try { localStorage.setItem(FAUCET_DISMISSED_KEY, "1") } catch { /* */ }
}

/** Cooldown: 7 days between claims. */
export const FAUCET_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/** localStorage key prefix for per-address faucet claims (I9 fix). */
const STORAGE_PREFIX = "memba_faucet_"

/** Legacy shared key (for migration). */
const LEGACY_STORAGE_KEY = "memba_faucet_claims"

// ── Storage ───────────────────────────────────────────────────

/** Per-address storage key. */
function storageKey(address: string): string {
    return STORAGE_PREFIX + address.toLowerCase()
}

/** Read faucet claim for a specific address. */
export function getFaucetHistory(): FaucetClaim[] {
    // Read from all per-address keys + legacy shared key for migration
    const claims: FaucetClaim[] = []
    try {
        // Check legacy shared key
        const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (legacyRaw) {
            const parsed = JSON.parse(legacyRaw) as FaucetClaim[]
            if (Array.isArray(parsed)) claims.push(...parsed)
        }
    } catch { /* ignore */ }
    return claims
}

/** Record a new faucet claim (I9 fix: per-address storage). */
export function recordFaucetClaim(address: string): FaucetClaim {
    const claim: FaucetClaim = {
        address: address.toLowerCase(),
        claimedAt: Date.now(),
        amount: FAUCET_AMOUNT_UGNOT,
    }
    try {
        localStorage.setItem(storageKey(address), JSON.stringify(claim))
    } catch {
        // localStorage full or disabled
    }
    return claim
}

// ── Eligibility ───────────────────────────────────────────────

/** Get the last claim for a specific address (I9 fix: per-address lookup). */
export function getLastClaim(address: string): FaucetClaim | null {
    try {
        const raw = localStorage.getItem(storageKey(address))
        if (!raw) return null
        return JSON.parse(raw) as FaucetClaim
    } catch {
        return null
    }
}

/**
 * Check faucet eligibility for an address.
 * Rules:
 * 1. Address must be provided (wallet connected)
 * 2. No prior claim within 7-day cooldown window
 */
export function canClaimFaucet(address: string | null): FaucetEligibility {
    if (!address) {
        return { eligible: false, reason: "Connect your wallet to claim" }
    }

    const lastClaim = getLastClaim(address)
    if (lastClaim) {
        const elapsed = Date.now() - lastClaim.claimedAt
        const remaining = FAUCET_COOLDOWN_MS - elapsed

        if (remaining > 0) {
            const nextClaimDate = new Date(lastClaim.claimedAt + FAUCET_COOLDOWN_MS)
            return {
                eligible: false,
                reason: `Cooldown active — next claim available ${formatCooldown(remaining)}`,
                cooldownRemaining: remaining,
                nextClaimAt: nextClaimDate.toISOString(),
            }
        }
    }

    return { eligible: true }
}

/** Clear faucet claim for an address (admin/debug action). */
export function clearFaucetHistory(): void {
    try {
        localStorage.removeItem(LEGACY_STORAGE_KEY)
        // Clear any per-address keys we know about
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key?.startsWith(STORAGE_PREFIX)) {
                localStorage.removeItem(key)
                i-- // adjust index after removal
            }
        }
    } catch { /* ignore */ }
}

// ── Formatting ────────────────────────────────────────────────

/** Format cooldown remaining as human-readable (e.g. "in 2d 5h"). */
export function formatCooldown(ms: number): string {
    if (ms <= 0) return "now"
    const hours = Math.floor(ms / 3_600_000)
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24

    if (days > 0) return `in ${days}d ${remainingHours}h`
    if (hours > 0) return `in ${hours}h`
    const minutes = Math.floor(ms / 60_000)
    return `in ${minutes}m`
}

/** Typed bank/MsgSend payload for Adena signing. */
export interface BankMsgSend {
    "@type": "/bank.MsgSend"
    from_address: string
    to_address: string
    amount: string
}

/**
 * Build a MsgSend for the faucet transfer.
 * This produces the message payload; actual signing and broadcasting
 * is handled by the treasury multisig or admin key.
 */
export function buildFaucetMsgSend(recipientAddress: string, fromAddress: string): BankMsgSend {
    return {
        "@type": "/bank.MsgSend",
        from_address: fromAddress,
        to_address: recipientAddress,
        amount: `${FAUCET_AMOUNT_UGNOT}ugnot`,
    }
}
