type BadgeStatus = "pending" | "signing" | "ready" | "complete"

/** Derive badge status from transaction data. */
export function getTxStatus(
    finalHash: string,
    sigCount: number,
    threshold: number,
): BadgeStatus {
    if (finalHash) return "complete"
    if (sigCount >= threshold) return "ready"
    if (sigCount > 0) return "signing"
    return "pending"
}
