import type { BadgeStatus } from "./txStatus"

interface StatusBadgeProps {
    status: BadgeStatus
    sigCount?: number
    threshold?: number
}

const config: Record<BadgeStatus, { color: string; bg: string; label: string }> = {
    pending: { color: "var(--color-warning)", bg: "rgba(245,158,11,0.08)", label: "Pending" },
    signing: { color: "var(--color-primary)", bg: "rgba(0,212,170,0.08)", label: "Signing" },
    ready: { color: "var(--color-success)", bg: "rgba(34,197,94,0.08)", label: "Ready" },
    verified: { color: "var(--color-success)", bg: "rgba(34,197,94,0.08)", label: "Verified on chain" },
    failed: { color: "var(--color-danger, #ef4444)", bg: "rgba(239,68,68,0.1)", label: "Failed on chain" },
    unconfirmed: { color: "var(--color-k-warning, #ffc107)", bg: "rgba(255,193,7,0.12)", label: "Hash recorded · unconfirmed" },
    "legacy-hash": { color: "var(--color-k-warning, #ffc107)", bg: "rgba(255,193,7,0.12)", label: "Legacy hash recorded" },
    "read-only": { color: "var(--color-text-secondary)", bg: "rgba(128,128,128,0.12)", label: "Read-only history" },
    "on-hold": { color: "var(--color-text-secondary)", bg: "rgba(128,128,128,0.12)", label: "Native activation on hold" },
}

export function StatusBadge({ status, sigCount, threshold }: StatusBadgeProps) {
    const c = config[status]
    const label = status === "signing" && sigCount !== undefined && threshold !== undefined
        ? `${sigCount}/${threshold} Signed`
        : c.label

    return (
        <span
            aria-label={`Status: ${c.label}${sigCount !== undefined && threshold !== undefined ? `, ${sigCount} of ${threshold} signatures` : ""}`}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 10px",
                borderRadius: 6,
                fontSize: "var(--pro-caption, 11px)",
                fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
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
