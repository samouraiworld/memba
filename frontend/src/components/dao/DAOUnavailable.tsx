/**
 * DAOUnavailable — shown instead of a DAO feature the contract or the network
 * does not support, including on direct navigation to its URL.
 */
import { useNetworkNav } from "../../hooks/useNetworkNav"

export function DAOUnavailable({ reason, backTo = "/dao" }: { reason: string; backTo?: string }) {
    const navigate = useNetworkNav()
    return (
        <div className="animate-fade-in k-card" role="status" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
            <h2 style={{ margin: 0, fontSize: "var(--pro-title, 18px)" }}>Not available for this DAO or network</h2>
            <p style={{ margin: 0, color: "var(--color-k-dim)" }}>{reason}</p>
            <button className="k-btn-secondary" onClick={() => navigate(backTo)}>← Back</button>
        </div>
    )
}
