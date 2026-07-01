import { useState } from "react"
import { formatGnotCompact } from "../../lib/formatGnot"
import { X } from "@phosphor-icons/react"
import "../nft/TradeModal.css" // Reuse existing modal styles

export interface Service {
    id: string
    title: string
    freelancer: string
    description: string
    priceUgnot: number
    milestones: string
    category: string
    image: string
}

export interface HireServiceModalProps {
    service: Service
    onClose: () => void
    onSuccess: () => void
}

export function HireServiceModal({ service, onClose }: HireServiceModalProps) {
    const [submitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleHire = () => {
        // Fail closed (W0.2): the services escrow flow is not production-ready. The only
        // in-repo escrow realm (`memba_escrow_v1`) is not deployable on test13, and the
        // CreateContract builder attaches no coins while the realm requires exactly one
        // ugnot — so a broadcast here would revert on-chain after the user signs (gas
        // burned). Never broadcast a placeholder tx; surface an honest state instead.
        setError("Service escrow is not available yet — the services lane is being finalized.")
    }

    return (
        <div className="trade-modal-overlay">
            <div className="trade-modal">
                <div className="trade-modal-header">
                    <h2>Hire Freelancer</h2>
                    <button className="k-btn-icon" onClick={onClose} aria-label="Close" disabled={submitting}>
                        <X weight="bold" />
                    </button>
                </div>
                
                <div className="trade-modal-body">
                    <p className="k-text-muted" style={{ marginBottom: "24px", fontSize: "14px", lineHeight: 1.5 }}>
                        You are about to initiate an escrow contract with <strong>{service.freelancer}</strong>. 
                        Funds will be locked securely until the milestones are met and approved by you.
                    </p>

                    {error && (
                        <div className="k-error-banner" style={{ marginBottom: "16px" }}>
                            {error}
                        </div>
                    )}

                    <div style={{ background: "var(--color-bg-tertiary)", padding: "16px", borderRadius: "12px", marginBottom: "24px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                            <span style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>Service</span>
                            <strong style={{ color: "var(--color-text)", fontSize: "14px", textAlign: "right" }}>{service.title}</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                            <span style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>Milestones</span>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                                {service.milestones.split(",").map((m, i) => {
                                    const [name, amount] = m.split(":")
                                    return (
                                        <div key={i} style={{ fontSize: "12px", color: "var(--color-text)", background: "var(--color-bg-secondary)", padding: "4px 8px", borderRadius: "4px" }}>
                                            {name} — {formatGnotCompact(parseInt(amount, 10))} GNOT
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--color-border)", paddingTop: "12px", marginTop: "12px" }}>
                            <span style={{ color: "var(--color-text)", fontWeight: 600 }}>Total Escrow</span>
                            <strong style={{ color: "var(--color-primary)", fontSize: "18px" }}>
                                {formatGnotCompact(service.priceUgnot)} GNOT
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
                            onClick={handleHire}
                            disabled={submitting}
                        >
                            {submitting ? "Signing..." : "Sign Escrow Tx"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
