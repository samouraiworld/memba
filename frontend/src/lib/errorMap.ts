/**
 * Error mapping layer — translates raw technical errors to user-friendly messages.
 *
 * All user-facing error display should go through `mapError()`.
 * Raw errors are still logged to `console.error` for debugging.
 */

// ── Types ─────────────────────────────────────────────────────

export interface UserError {
    title: string       // Short heading, e.g. "Connection failed"
    message: string     // Explanation, e.g. "Unable to reach the blockchain..."
    action?: string     // Suggested fix, e.g. "Check your network and try again"
    retry?: boolean     // If true, caller should show a "Retry" button
}

// ── Error Patterns ────────────────────────────────────────────

interface ErrorPattern {
    test: (msg: string) => boolean
    result: UserError
}

const ERROR_PATTERNS: ErrorPattern[] = [
    // Network errors
    {
        test: (m) => m.includes("Failed to fetch") || m.includes("NetworkError") || m.includes("ERR_NETWORK"),
        result: {
            title: "Connection failed",
            message: "Unable to reach the server. This usually means a network issue.",
            action: "Check your internet connection and try again.",
            retry: true,
        },
    },
    // Timeout
    {
        test: (m) => m.includes("timeout") || m.includes("DEADLINE_EXCEEDED") || m.includes("AbortError"),
        result: {
            title: "Request timed out",
            message: "The network is responding slowly.",
            action: "Please wait a moment and try again.",
            retry: true,
        },
    },
    // Auth errors
    {
        test: (m) => m.includes("UNAUTHENTICATED") || m.includes("401") || m.includes("token expired"),
        result: {
            title: "Session expired",
            message: "Your authentication session has ended.",
            action: "Reconnect your wallet to continue.",
        },
    },
    // Not found
    {
        test: (m) => m.includes("NOT_FOUND") || m.includes("404") || m.includes("not found"),
        result: {
            title: "Not found",
            message: "The requested resource doesn't exist or has been moved.",
        },
    },
    // Invalid input
    {
        test: (m) => m.includes("INVALID_ARGUMENT") || m.includes("invalid") || m.includes("validation"),
        result: {
            title: "Invalid input",
            message: "Some of the provided data is incorrect.",
            action: "Please check your input and try again.",
        },
    },
    // Insufficient funds
    {
        test: (m) => m.includes("insufficient") || m.includes("not enough"),
        result: {
            title: "Insufficient funds",
            message: "You don't have enough GNOT for this transaction.",
            action: "Add funds to your wallet and try again.",
        },
    },
    // ABCI / blockchain errors
    {
        test: (m) => m.includes("ABCI") || m.includes("abci_query"),
        result: {
            title: "Blockchain query failed",
            message: "Unable to read data from gno.land.",
            action: "The network may be temporarily unreachable. Try again in a few moments.",
            retry: true,
        },
    },
    // On-chain panic
    {
        test: (m) => m.includes("panic") || m.includes("VM error"),
        result: {
            title: "Transaction failed",
            message: "The on-chain function returned an error.",
            action: "Check your parameters and try again.",
        },
    },
    // Permission denied
    {
        test: (m) => m.includes("PERMISSION_DENIED") || m.includes("forbidden") || m.includes("not authorized"),
        result: {
            title: "Permission denied",
            message: "You don't have permission to perform this action.",
        },
    },
    // Adena wallet errors
    {
        test: (m) => m.includes("Adena") || m.includes("wallet") || m.includes("rejected"),
        result: {
            title: "Wallet error",
            message: "The transaction was rejected or the wallet is unavailable.",
            action: "Check your Adena wallet and try again.",
        },
    },
]

// ── Public API ────────────────────────────────────────────────

/**
 * Map a raw error to a user-friendly UserError.
 * Always logs the raw error to console for debugging.
 *
 * @param error — Error object, string, or unknown
 * @returns UserError with title, message, and optional action/retry
 */
export function mapError(error: unknown): UserError {
    const rawMessage = extractMessage(error)

    // Log raw error for debugging (never suppress)
    console.error("[errorMap] Raw error:", error)

    // Match against known patterns
    for (const pattern of ERROR_PATTERNS) {
        if (pattern.test(rawMessage.toLowerCase())) {
            return pattern.result
        }
    }

    // Default fallback
    return {
        title: "Something went wrong",
        message: rawMessage.length > 120
            ? rawMessage.slice(0, 117) + "..."
            : rawMessage || "An unexpected error occurred.",
        action: "Please try again or reload the page.",
        retry: true,
    }
}

/**
 * Extract a string message from any error type.
 */
function extractMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === "string") return error
    if (typeof error === "object" && error !== null) {
        const e = error as Record<string, unknown>
        if (typeof e.message === "string") return e.message
        if (typeof e.msg === "string") return e.msg
    }
    return "An unexpected error occurred"
}
