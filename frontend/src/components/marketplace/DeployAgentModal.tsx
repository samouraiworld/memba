import { useState, useMemo } from "react"
import { formatGnotCompact } from "../../lib/formatGnot"
import { X } from "@phosphor-icons/react"
import type { AgentListing } from "../../lib/agentRegistry"
import "../nft/TradeModal.css"

export interface DeployAgentModalProps {
    agent: AgentListing
    onClose: () => void
    onSuccess: () => void
}

export function DeployAgentModal({ agent, onClose }: DeployAgentModalProps) {
    const [callsStr, setCallsStr] = useState("100")
    const [submitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const callsCount = parseInt(callsStr, 10) || 0
    const totalUgnot = useMemo(() => {
        if (agent.pricing === "free") return 0
        return callsCount * agent.pricePerCall * 1_000_000 // Convert GNOT to uGNOT
    }, [agent, callsCount])

    const handleDeploy = () => {
        // Fail closed (W0.2): the agent-credit purchase is NOT wired to the on-chain
        // registry from this modal yet — the real, guarded credit path is CreditSection
        // (RegisterAgentForm / doContractBroadcast). This modal must never fake success
        // or broadcast a placeholder tx. Surface an honest "not available" state instead.
        setError("Agent credit purchase is not available yet — use the agent’s credit panel once this lane is live.")
    }

    return (
        <div className="trade-modal-overlay">
            <div className="trade-modal">
                <div className="trade-modal-header">
                    <h2>Deploy AI Agent</h2>
                    <button className="k-btn-icon" onClick={onClose} aria-label="Close" disabled={submitting}>
                        <X weight="bold" />
                    </button>
                </div>
                
                <div className="trade-modal-body">
                    <p className="k-text-muted" style={{ marginBottom: "24px", fontSize: "14px", lineHeight: 1.5 }}>
                        Fund your usage credits for <strong>{agent.name}</strong>. 
                        The agent will be accessible via the API using your Adena wallet address.
                    </p>

                    {error && (
                        <div className="k-error-banner" style={{ marginBottom: "16px" }}>
                            {error}
                        </div>
                    )}

                    <div className="k-input-group" style={{ marginBottom: "24px" }}>
                        <label className="k-label">Number of Calls / Credits</label>
                        <div className="k-input-wrapper">
                            <input
                                type="number"
                                className="k-input"
                                value={callsStr}
                                onChange={(e) => setCallsStr(e.target.value)}
                                min="1"
                                disabled={submitting}
                            />
                        </div>
                    </div>

                    <div style={{ background: "var(--color-bg-tertiary)", padding: "16px", borderRadius: "12px", marginBottom: "24px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                            <span style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>Agent</span>
                            <strong style={{ color: "var(--color-text)", fontSize: "14px", textAlign: "right" }}>{agent.name}</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                            <span style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>Pricing</span>
                            <span style={{ color: "var(--color-text)", fontSize: "14px" }}>
                                {agent.pricing === "free" ? "Free" : `${agent.pricePerCall} GNOT / call`}
                            </span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--color-border)", paddingTop: "12px", marginTop: "12px" }}>
                            <span style={{ color: "var(--color-text)", fontWeight: 600 }}>Total Cost</span>
                            <strong style={{ color: "var(--color-primary)", fontSize: "18px" }}>
                                {totalUgnot === 0 ? "Free" : `${formatGnotCompact(totalUgnot)} GNOT`}
                            </strong>
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: "12px" }}>
                        <button
                            className="k-btn k-btn--secondary"
                            style={{ flex: 1, justifyContent: "center" }}
                            onClick={onClose}
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                        <button
                            className="k-btn k-btn--primary"
                            style={{ flex: 1, justifyContent: "center" }}
                            onClick={handleDeploy}
                            disabled={submitting || callsCount < 1}
                        >
                            {submitting ? "Deploying..." : "Purchase Credits"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
