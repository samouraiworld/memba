/**
 * errorLog — Structured error logging for chain-critical operations.
 *
 * Use for operations where silent failure could hide real problems:
 * vote, sign, broadcast, join multisig, token mint/burn.
 *
 * DO NOT use for: localStorage, optional profile fetches, cache operations.
 *
 * Forwards critical/error to Sentry (when configured).
 */

import * as Sentry from "@sentry/react"

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
 * Errors are stored in-memory, logged to console.error for dev debugging,
 * and forwarded to Sentry for critical/error severity.
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

    // Forward to Sentry for critical and error severities
    if (severity === "critical" || severity === "error") {
        const sentryError = error instanceof Error ? error : new Error(msg)
        Sentry.captureException(sentryError, {
            tags: {
                severity,
                context,
            },
            // Don't send raw wallet address — already redacted by beforeSend
        })
    }
}

/** Get recent errors (for debugging / support) */
export function getRecentErrors(): readonly ErrorEntry[] {
    return ERROR_BUFFER
}

/** Clear the error buffer */
export function clearErrorBuffer(): void {
    ERROR_BUFFER.length = 0
}

