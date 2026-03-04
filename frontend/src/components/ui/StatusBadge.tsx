import { type ReactNode } from "react"
import type { BadgeStatus } from "./txStatus"

interface StatusBadgeProps {
    status: BadgeStatus
    sigCount?: number
    threshold?: number
    hash?: string
}

const config: Record<BadgeStatus, { color: string; bg: string; label: string }> = {
    pending: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", label: "Pending" },
    signing: { color: "#00d4aa", bg: "rgba(0,212,170,0.08)", label: "Signing" },
    ready: { color: "#22c55e", bg: "rgba(34,197,94,0.08)", label: "Ready" },
    complete: { color: "#22c55e", bg: "rgba(34,197,94,0.08)", label: "Complete" },
}

export function StatusBadge({ status, sigCount, threshold, hash }: StatusBadgeProps) {
    const c = config[status]
    let label: ReactNode = c.label

    if (status === "signing" && sigCount !== undefined && threshold !== undefined) {
        label = `${sigCount}/${threshold} Signed`
    }
    if (status === "complete" && hash) {
        label = (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {hash.slice(0, 8)}…
            </span>
        )
    }

    return (
        <span
            aria-label={`Status: ${c.label}${sigCount !== undefined && threshold !== undefined ? `, ${sigCount} of ${threshold} signatures` : ""}`}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 10px",
                borderRadius: 6,
                fontSize: 11,
                fontFamily: "JetBrains Mono, monospace",
                fontWeight: 500,
                color: c.color,
                background: c.bg,
                border: `1px solid ${c.color}22`,
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
            }}
        >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
            {label}
        </span>
    )
}
