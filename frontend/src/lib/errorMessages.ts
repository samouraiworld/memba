/**
 * User-friendly error message translation layer.
 *
 * Translates raw Gno chain, ABCI, Adena, and network errors into
 * user-friendly messages that non-technical users can understand.
 *
 * Usage:
 *   import { friendlyError } from "./errorMessages"
 *   catch (err) { showToast(friendlyError(err)) }
 */

// ── Error Pattern Map ─────────────────────────────────────────

interface ErrorPattern {
    /** Regex or string to match against error message. */
    match: RegExp | string
    /** User-friendly message to display. */
    message: string
    /** Optional action hint for the user. */
    hint?: string
}

const ERROR_PATTERNS: ErrorPattern[] = [
    // ── Chain / ABCI errors ──────────────────────────────
    {
        match: /could not import (\S+)/i,
        message: "This realm uses an unsupported import. It may need updating.",
        hint: "Check if the realm code is compatible with the current chain version.",
    },
    {
        match: /unknown import path/i,
        message: "The realm code references a module that doesn't exist on this chain.",
        hint: "The chain may have been upgraded. Try redeploying with updated code.",
    },
    {
        match: /out of gas/i,
        message: "Transaction ran out of gas before completing.",
        hint: "Try increasing the gas limit in settings.",
    },
    {
        match: /insufficient funds/i,
        message: "Not enough GNOT in your wallet to complete this transaction.",
        hint: "Top up your wallet or reduce the transaction amount.",
    },
    {
        match: /unauthorized/i,
        message: "You don't have permission to perform this action.",
        hint: "Check that you're connected with the correct wallet.",
    },
    {
        match: /not a member/i,
        message: "You're not a member of this DAO.",
        hint: "Ask a DAO admin to add you as a member.",
    },
    {
        match: /already voted/i,
        message: "You've already voted on this proposal.",
    },
    {
        match: /proposal is not active/i,
        message: "This proposal is no longer open for voting.",
    },
    {
        match: /invalid proposal ID/i,
        message: "This proposal doesn't exist or has been removed.",
    },
    {
        match: /admin role required/i,
        message: "Only DAO admins can perform this action.",
    },
    {
        match: /DAO is archived/i,
        message: "This DAO has been archived and is read-only.",
        hint: "Archived DAOs cannot accept new proposals or votes.",
    },
    {
        match: /rate limited/i,
        message: "You're posting too quickly. Please wait before trying again.",
    },
    {
        match: /realm not found/i,
        message: "This DAO or realm doesn't exist on the chain.",
        hint: "It may not have been deployed yet or the path is incorrect.",
    },
    {
        match: /package already exists/i,
        message: "A realm with this name already exists on the chain.",
        hint: "Choose a different name for your DAO.",
    },

    // ── Adena / Wallet errors ────────────────────────────
    {
        match: /user rejected/i,
        message: "Transaction cancelled — you rejected the request in your wallet.",
    },
    {
        match: /user denied/i,
        message: "Transaction cancelled — you denied the request in your wallet.",
    },
    {
        match: /not connected/i,
        message: "Wallet not connected. Please connect your Adena wallet.",
        hint: "Click the wallet icon in the top bar to connect.",
    },
    {
        match: /network mismatch/i,
        message: "Your wallet is connected to a different chain.",
        hint: "Switch your wallet to the correct network.",
    },
    {
        match: /adena not found/i,
        message: "Adena wallet extension not detected.",
        hint: "Install Adena from adena.app and refresh the page.",
    },

    // ── Network errors ───────────────────────────────────
    {
        match: /failed to fetch/i,
        message: "Can't reach the chain. Check your internet connection.",
        hint: "The RPC endpoint may be temporarily down.",
    },
    {
        match: /network error/i,
        message: "Network error — couldn't connect to the chain.",
        hint: "Try again in a moment or switch to a different network.",
    },
    {
        match: /timeout/i,
        message: "The request timed out. The chain may be congested.",
        hint: "Try again in a few seconds.",
    },
    {
        match: /aborted/i,
        message: "The request was interrupted.",
        hint: "Try again.",
    },
]

// ── Public API ────────────────────────────────────────────────

/**
 * Translate a raw error into a user-friendly message.
 *
 * @param error - Error object, string, or unknown
 * @returns User-friendly error message string
 */
export function friendlyError(error: unknown): string {
    const raw = extractMessage(error)
    if (!raw) return "Something went wrong. Please try again."

    for (const pattern of ERROR_PATTERNS) {
        const match = typeof pattern.match === "string"
            ? raw.toLowerCase().includes(pattern.match.toLowerCase())
            : pattern.match.test(raw)

        if (match) {
            return pattern.hint
                ? `${pattern.message} ${pattern.hint}`
                : pattern.message
        }
    }

    // Fallback: if the error looks technical, wrap it
    if (raw.includes("panic:") || raw.includes("Error:") || raw.includes("0x")) {
        return `An unexpected error occurred. Details: ${raw.slice(0, 120)}`
    }

    return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw
}

/**
 * Extract a readable error message from any error type.
 */
export function extractMessage(error: unknown): string {
    if (typeof error === "string") return error
    if (error instanceof Error) return error.message
    if (typeof error === "object" && error !== null) {
        const obj = error as Record<string, unknown>
        if (typeof obj.message === "string") return obj.message
        if (typeof obj.error === "string") return obj.error
        if (typeof obj.data === "string") return obj.data
    }
    return ""
}

/**
 * Check if an error indicates the user intentionally cancelled.
 * Useful for suppressing error UI on user-initiated cancellations.
 */
export function isUserCancellation(error: unknown): boolean {
    const msg = extractMessage(error).toLowerCase()
    return msg.includes("user rejected") || msg.includes("user denied") || msg.includes("cancelled")
}
