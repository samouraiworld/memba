/**
 * Gasless Onboarding — Faucet eligibility and rate limiting.
 *
 * Expert recommendations:
 * - Rate limit by address (1 claim per 7 days)
 * - Require MembaDAO membership for eligibility
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
export const FAUCET_AMOUNT_DISPLAY = "3 GNOT"

/** Cooldown: 7 days between claims. */
export const FAUCET_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/** localStorage key for faucet claim history. */
const STORAGE_KEY = "memba_faucet_claims"

/** Maximum stored claims in history (FIFO). */
const MAX_HISTORY = 200

// ── Storage ───────────────────────────────────────────────────

/** Read all faucet claims from localStorage. */
export function getFaucetHistory(): FaucetClaim[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw) as FaucetClaim[]
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

/** Record a new faucet claim. */
export function recordFaucetClaim(address: string): FaucetClaim {
    const claim: FaucetClaim = {
        address: address.toLowerCase(),
        claimedAt: Date.now(),
        amount: FAUCET_AMOUNT_UGNOT,
    }
    const history = getFaucetHistory()
    const updated = [claim, ...history].slice(0, MAX_HISTORY)
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    } catch {
        // localStorage full or disabled
    }
    return claim
}

// ── Eligibility ───────────────────────────────────────────────

/** Get the last claim for a specific address. */
export function getLastClaim(address: string): FaucetClaim | null {
    const history = getFaucetHistory()
    return history.find(c => c.address === address.toLowerCase()) || null
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

/** Clear all faucet history (admin/debug action). */
export function clearFaucetHistory(): void {
    try {
        localStorage.removeItem(STORAGE_KEY)
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

/**
 * Build a MsgSend for the faucet transfer.
 * This produces the message payload; actual signing and broadcasting
 * is handled by the treasury multisig or admin key.
 */
export function buildFaucetMsgSend(recipientAddress: string, fromAddress: string): object {
    return {
        "@type": "/bank.MsgSend",
        from_address: fromAddress,
        to_address: recipientAddress,
        amount: `${FAUCET_AMOUNT_UGNOT}ugnot`,
    }
}
