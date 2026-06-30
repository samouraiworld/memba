import { useState, useEffect } from "react"
import { useAdena } from "../../hooks/useAdena"
import { isApprovedForAll } from "../../lib/grc721"
import { buildSetApprovalForAllV3Msg } from "../../lib/nftMarketplaceV3"
import { buildAcceptFloorOfferMsg } from "../../lib/nftMarketplace"
import { formatGnotCompact } from "../../lib/formatGnot"
import { friendlyError } from "../../lib/errorMessages"
import { NFT_COLLECTIONS_PATH } from "../../lib/nftConfig"
import { X } from "@phosphor-icons/react"
import "./TradeModal.css" // Reuse existing modal styles

const OFFERS_V1_REALM = "gno.land/r/samcrew/memba_nft_offers_v1"

export interface AcceptFloorOfferModalProps {
    collectionID: string
    offer: { buyer: string; priceUgnot: number }
    availableTokens: { tokenId: string; uri: string }[]
    onClose: () => void
    onSuccess: () => void
}

type Step = "loading-approval" | "approve" | "submitting-approve" | "select-token" | "submitting-accept"

export function AcceptFloorOfferModal({ collectionID, offer, availableTokens, onClose, onSuccess }: AcceptFloorOfferModalProps) {
    const adena = useAdena()
    const [step, setStep] = useState<Step>("loading-approval")
    const [selectedTokenId, setSelectedTokenId] = useState<string>(availableTokens[0]?.tokenId || "")
    const [error, setError] = useState<string | null>(null)

    // Calculate platform fee (2%) + royalty (for preview)
    const platformFee = Math.floor(offer.priceUgnot * 0.02)
    // We mock royalty to 5% for now since we don't have it in props
    const estimatedRoyalty = Math.floor(offer.priceUgnot * 0.05)
    const netProceeds = offer.priceUgnot - platformFee - estimatedRoyalty

    useEffect(() => {
        let mounted = true
        isApprovedForAll(NFT_COLLECTIONS_PATH, collectionID, adena.address, OFFERS_V1_REALM).then(approved => {
            if (mounted) {
                setStep(approved ? "select-token" : "approve")
            }
        }).catch(err => {
            console.warn("Failed to check approval:", err)
            if (mounted) setStep("approve") // Default to prompt if check fails
        })
        return () => { mounted = false }
    }, [collectionID, adena.address])

    const handleApprove = async () => {
        setStep("submitting-approve")
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            // Reusing the V3 SetApprovalForAll builder as it targets the collection realm correctly
            const msg = buildSetApprovalForAllV3Msg(adena.address, collectionID, OFFERS_V1_REALM, true)
            await doContractBroadcast([msg], "Approve Offers Engine")
            setStep("select-token")
        } catch (err: unknown) {
            setError(friendlyError(err))
            setStep("approve")
        }
    }

    const handleAccept = async () => {
        if (!selectedTokenId) {
            setError("Please select a token to sell.")
            return
        }
        setStep("submitting-accept")
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msg = buildAcceptFloorOfferMsg(
                adena.address,
                OFFERS_V1_REALM,
                collectionID,
                selectedTokenId,
                offer.buyer
            )
            await doContractBroadcast([msg], `Accept Floor Offer on ${collectionID}/${selectedTokenId}`)
            onSuccess()
        } catch (err: unknown) {
            setError(friendlyError(err))
            setStep("select-token")
        }
    }

    return (
        <div className="trade-modal-overlay">
            <div className="trade-modal">
                <div className="trade-modal-header">
                    <h2>Accept Collection Offer</h2>
                    <button className="k-btn-icon" onClick={onClose} aria-label="Close">
                        <X weight="bold" />
                    </button>
                </div>
                
                <div className="trade-modal-body">
                    {error && (
                        <div className="k-error-banner" style={{ marginBottom: "16px" }}>
                            {error}
                        </div>
                    )}

                    {step === "loading-approval" && (
                        <div className="k-text-muted" style={{ padding: "20px", textAlign: "center" }}>
                            Checking approvals...
                        </div>
                    )}

                    {(step === "approve" || step === "submitting-approve") && (
                        <>
                            <p className="k-text-muted" style={{ marginBottom: "16px" }}>
                                To accept this offer, you must first approve the Offers Engine to transfer your NFT. 
                                This is a one-time transaction per collection.
                            </p>
                            <button
                                className="k-btn k-btn--primary"
                                style={{ width: "100%", justifyContent: "center" }}
                                onClick={handleApprove}
                                disabled={step === "submitting-approve"}
                            >
                                {step === "submitting-approve" ? "Approving..." : "Approve Collection"}
                            </button>
                        </>
                    )}

                    {(step === "select-token" || step === "submitting-accept") && (
                        <>
                            <div className="trade-modal-info">
                                <div className="info-row">
                                    <span className="info-label">Offer Amount</span>
                                    <span className="info-value k-text-primary" style={{ fontSize: "16px", fontWeight: 700 }}>
                                        {formatGnotCompact(BigInt(offer.priceUgnot))} GNOT
                                    </span>
                                </div>
                                <div className="info-row">
                                    <span className="info-label">Buyer</span>
                                    <span className="info-value">{offer.buyer.slice(0, 10)}...</span>
                                </div>
                                <div className="info-row">
                                    <span className="info-label">Est. Net Proceeds</span>
                                    <span className="info-value">
                                        ~{formatGnotCompact(BigInt(netProceeds))} GNOT
                                    </span>
                                </div>
                            </div>

                            <div className="k-input-group" style={{ marginBottom: "24px" }}>
                                <label className="k-label">Select Token to Sell</label>
                                <select 
                                    className="k-input" 
                                    value={selectedTokenId} 
                                    onChange={e => setSelectedTokenId(e.target.value)}
                                    disabled={step === "submitting-accept"}
                                >
                                    {availableTokens.map(t => (
                                        <option key={t.tokenId} value={t.tokenId}>
                                            Token #{t.tokenId}
                                        </option>
                                    ))}
                                </select>
                                <p className="k-text-muted" style={{ fontSize: "12px", marginTop: "8px" }}>
                                    You are accepting a collection-wide floor offer. You may choose which token to sell. It defaults to your least rare token.
                                </p>
                            </div>

                            <button
                                className="k-btn k-btn--primary"
                                style={{ width: "100%", justifyContent: "center" }}
                                onClick={handleAccept}
                                disabled={step === "submitting-accept" || !selectedTokenId}
                            >
                                {step === "submitting-accept" ? "Accepting..." : "Confirm & Accept Offer"}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
