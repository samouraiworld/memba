/**
 * validatorHealthHelpers.ts
 *
 * Pure helper functions for ValidatorHealthGrid and unit tests.
 * Extracted to satisfy react-refresh/only-export-components lint rule.
 */

import { ValidatorHealthStatus } from "../../lib/validatorHealth"

/** Map health status to display label + CSS className */
export function healthBadge(status: ValidatorHealthStatus): { label: string; className: string } {
    switch (status) {
        case ValidatorHealthStatus.Healthy:
            return { label: "✅ Healthy", className: "vh-badge--healthy" }
        case ValidatorHealthStatus.Degraded:
            return { label: "🟡 Degraded", className: "vh-badge--degraded" }
        case ValidatorHealthStatus.Down:
            return { label: "🔴 Down", className: "vh-badge--down" }
        case ValidatorHealthStatus.Unknown:
        default:
            return { label: "⚪ Unknown", className: "vh-badge--unknown" }
    }
}

/** Map missed blocks count to severity CSS class */
export function missedBlocksColor(n: number | null): string {
    if (n === null || n === 0) return ""
    if (n <= 5) return "vh-missed--low"
    if (n <= 20) return "vh-missed--med"
    return "vh-missed--high"
}

/** Format number as percentage string, with null fallback */
export function formatPct(val: number | null | undefined): string {
    if (val === null || val === undefined) return "—"
    return `${val.toFixed(1)}%`
}
