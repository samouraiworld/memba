/**
 * errorLog — Structured error logging for chain-critical operations.
 *
 * Use for operations where silent failure could hide real problems:
 * vote, sign, broadcast, join multisig, token mint/burn.
 *
 * DO NOT use for: localStorage, optional profile fetches, cache operations.
 */

/** Error severity levels */
type Severity = "warning" | "error" | "critical"

interface ErrorEntry {
    severity: Severity
    context: string
    error: unknown
    timestamp: string
    userAddress?: string
}

// In-memory ring buffer (last 50 errors) — avoids localStorage quota issues
const ERROR_BUFFER: ErrorEntry[] = []
const MAX_BUFFER = 50

/**
 * Log a chain-critical error with structured context.
 * Errors are stored in-memory and logged to console.error for dev debugging.
 */
export function logChainError(
    context: string,
    error: unknown,
    severity: Severity = "error",
    userAddress?: string,
): void {
    const entry: ErrorEntry = {
        severity,
        context,
        error,
        timestamp: new Date().toISOString(),
        userAddress,
    }

    // Ring buffer — drop oldest when full
    if (ERROR_BUFFER.length >= MAX_BUFFER) ERROR_BUFFER.shift()
    ERROR_BUFFER.push(entry)

    // Structured console output for dev debugging
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[memba:${severity}] ${context}: ${msg}`)
}

/** Get recent errors (for debugging / support) */
export function getRecentErrors(): readonly ErrorEntry[] {
    return ERROR_BUFFER
}

/** Clear the error buffer */
export function clearErrorBuffer(): void {
    ERROR_BUFFER.length = 0
}
