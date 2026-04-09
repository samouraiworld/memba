/**
 * ActionRequiredStrip — Top notification for unvoted proposals and unsigned TXs.
 * Extracted from Dashboard.tsx for maintainability.
 */
import { useNetworkNav } from "../../hooks/useNetworkNav"

interface Props {
    unvotedCount: number
    unsignedCount: number
    unvotedLoading: boolean
}

export function ActionRequiredStrip({ unvotedCount, unsignedCount, unvotedLoading }: Props) {
    const navigate = useNetworkNav()
    const hasAction = unvotedCount > 0 || unsignedCount > 0

    return (
        <div className="k-action-banner" aria-live="polite" style={{
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            padding: "12px 18px", borderRadius: 10,
            background: hasAction
                ? "linear-gradient(135deg, rgba(245,166,35,0.06), rgba(245,166,35,0.02))"
                : "rgba(0,212,170,0.04)",
            border: `1px solid ${hasAction ? "rgba(245,166,35,0.15)" : "rgba(0,212,170,0.12)"}`,
        }}>
            {hasAction ? (
                <>
                    <span style={{ fontSize: 14 }}>⚡</span>
                    {unvotedCount > 0 && (
                        <span
                            onClick={() => navigate("/dao")}
                            style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "var(--color-warning)", cursor: "pointer" }}
                        >
                            🗳️ {unvotedCount} proposal{unvotedCount > 1 ? "s" : ""} need{unvotedCount === 1 ? "s" : ""} your vote
                        </span>
                    )}
                    {unvotedCount > 0 && unsignedCount > 0 && (
                        <span style={{ color: "var(--color-text)" }}>·</span>
                    )}
                    {unsignedCount > 0 && (
                        <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "var(--color-warning)" }}>
                            ✍️ {unsignedCount} signature{unsignedCount > 1 ? "s" : ""} needed
                        </span>
                    )}
                </>
            ) : (
                <>
                    <span style={{ fontSize: 14 }}>📋</span>
                    <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-secondary)" }}>
                        No pending actions
                    </span>
                </>
            )}
            {unvotedLoading && (
                <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-muted)", marginLeft: "auto" }}>
                    scanning...
                </span>
            )}
        </div>
    )
}
