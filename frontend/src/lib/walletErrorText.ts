/**
 * The line to show when a wallet write fails: "" for the person's own cancel,
 * otherwise what actually failed (the node's reason, a guard's refusal, the
 * realm's panic), and `fallback` only when the error says nothing.
 *
 * @module lib/walletErrorText
 */
import { isUserCancellation } from "./userCancellation"

const MAX_LENGTH = 200

export function walletErrorText(error: unknown, fallback: string): string {
    if (isUserCancellation(error)) return ""
    const raw = typeof error === "string" ? error
        : error instanceof Error ? (chainReason(error) ?? error.message)
            : ""
    const line = raw.replace(/^.*?panic:\s*/i, "").trim()
    if (!line) return fallback
    return line.length > MAX_LENGTH ? `${line.slice(0, MAX_LENGTH - 1)}…` : line
}

/** ChainRejectedError's own sentence from the node (grc20.ts), without importing the signing module. */
function chainReason(error: Error): string | undefined {
    const reason = error.name === "ChainRejectedError" ? (error as Error & { reason?: unknown }).reason : undefined
    return typeof reason === "string" && reason !== "no reason given" ? reason : undefined
}
