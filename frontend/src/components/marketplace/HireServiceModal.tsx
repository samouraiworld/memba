import { useState } from "react"
import { useAdena } from "../../hooks/useAdena"
import { buildCreateContractMsg } from "../../lib/marketplace/builders"
import type { AminoMsg } from "../../lib/grc20"
import { friendlyError } from "../../lib/errorMessages"
import { formatGnotCompact } from "../../lib/formatGnot"
import { X } from "@phosphor-icons/react"
import "../nft/TradeModal.css" // Reuse existing modal styles

// Currently using the escrow v1 realm for MVP
const ESCROW_V1_REALM = "gno.land/r/samcrew/memba_escrow_v1"

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

export function HireServiceModal({ service, onClose, onSuccess }: HireServiceModalProps) {
    const adena = useAdena()
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleHire = async () => {
        if (!adena.connected || !adena.address) {
            setError("Please connect your wallet first.")
            return
        }

        setError(null)
        setSubmitting(true)

        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            
            const msg = buildCreateContractMsg(
                adena.address,
                ESCROW_V1_REALM,
                service.freelancer,
                service.title,
                service.description,
                service.milestones
            )

            await doContractBroadcast([msg as unknown as AminoMsg], `Hire ${service.freelancer} for ${service.title}`)
            onSuccess()
        } catch (err: unknown) {
            console.error("HireService error:", err)
            setError(friendlyError(err instanceof Error ? err.message : String(err)))
        } finally {
            setSubmitting(false)
        }
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
