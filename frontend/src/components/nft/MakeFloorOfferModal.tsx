import { useState } from "react"
import { buildMakeFloorOfferMsg } from "../../lib/nftMarketplace"
import { useAdena } from "../../hooks/useAdena"
import { friendlyError } from "../../lib/errorMessages"
import { X } from "@phosphor-icons/react"
import "./TradeModal.css" // Reuse existing modal styles

// Hardcoded for Phase 10 — normally would read from config or indexer
const OFFERS_V1_REALM = "gno.land/r/samcrew/memba_nft_offers_v1"

export interface MakeFloorOfferModalProps {
    collectionID: string
    onClose: () => void
    onSuccess: () => void
}

export function MakeFloorOfferModal({ collectionID, onClose, onSuccess }: MakeFloorOfferModalProps) {
    const adena = useAdena()
    const [amountStr, setAmountStr] = useState("")
    const [durationDays, setDurationDays] = useState("3")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleMakeOffer = async () => {
        setError(null)
        const amtNum = parseFloat(amountStr)
        if (isNaN(amtNum) || amtNum <= 0) {
            setError("Please enter a valid amount.")
            return
        }

        const days = parseInt(durationDays, 10)
        if (isNaN(days) || days < 1) {
            setError("Please enter a valid duration (minimum 1 day).")
            return
        }

        // 1 day ~ 43200 blocks (assuming 2s block time)
        const durationBlks = days * 43200
        const offerUgnot = Math.floor(amtNum * 1_000_000)

        if (offerUgnot < 1_000_000) {
            setError("Minimum floor offer is 1 GNOT.")
            return
        }

        setSubmitting(true)
        try {
            const msg = buildMakeFloorOfferMsg(
                adena.address,
                OFFERS_V1_REALM,
                collectionID,
                offerUgnot,
                durationBlks
            )
            const { doContractBroadcast } = await import("../../lib/grc20")
            await doContractBroadcast([msg], `Make Floor Offer on ${collectionID}`)
            onSuccess()
        } catch (err: unknown) {
            console.error("MakeFloorOffer error:", err)
            setError(friendlyError(err instanceof Error ? err.message : String(err)))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="trade-modal-overlay">
            <div className="trade-modal">
                <div className="trade-modal-header">
                    <h2>Make Collection Offer</h2>
                    <button className="k-btn-icon" onClick={onClose} aria-label="Close">
                        <X weight="bold" />
                    </button>
                </div>
                
                <div className="trade-modal-body">
                    <p className="k-text-muted" style={{ marginBottom: "16px", fontSize: "14px", lineHeight: 1.5 }}>
                        Escrow GNOT to bid on <strong>any</strong> token in this collection. 
                        Any current holder can accept your offer and sell their token to you.
                    </p>

                    {error && (
                        <div className="k-error-banner" style={{ marginBottom: "16px" }}>
                            {error}
                        </div>
                    )}

                    <div className="k-input-group" style={{ marginBottom: "16px" }}>
                        <label className="k-label">Offer Amount (GNOT)</label>
                        <div className="k-input-wrapper">
                            <input
                                type="number"
                                className="k-input"
                                placeholder="e.g. 5.5"
                                value={amountStr}
                                onChange={(e) => setAmountStr(e.target.value)}
                                min="1"
                                step="0.1"
                                disabled={submitting}
                            />
                            <span className="k-input-suffix">GNOT</span>
                        </div>
                    </div>

                    <div className="k-input-group" style={{ marginBottom: "24px" }}>
                        <label className="k-label">Duration (Days)</label>
                        <div className="k-input-wrapper">
                            <input
                                type="number"
                                className="k-input"
                                value={durationDays}
                                onChange={(e) => setDurationDays(e.target.value)}
                                min="1"
                                max="30"
                                disabled={submitting}
                            />
                        </div>
                    </div>

                    <button
                        className="k-btn k-btn--primary"
                        style={{ width: "100%", justifyContent: "center" }}
                        onClick={handleMakeOffer}
                        disabled={submitting || !amountStr}
                    >
                        {submitting ? "Submitting..." : "Escrow Offer"}
                    </button>
                </div>
            </div>
        </div>
    )
}
