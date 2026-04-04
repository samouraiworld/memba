/**
 * MakeOfferModal — Modal for placing an offer (bid) on an NFT.
 *
 * User enters a custom amount to escrow. Funds are held by the
 * marketplace realm until the offer is accepted or cancelled.
 *
 * @module components/nft/MakeOfferModal
 */

import { useState, useEffect } from "react"
import type { NFTListing } from "../../lib/nftMarketplace"
import { buildMakeOfferMsg } from "../../lib/nftMarketplace"
import { NFT_MARKETPLACE_PATH } from "../../lib/nftConfig"

interface Props {
    listing: NFTListing
    callerAddress: string
    onClose: () => void
    onSuccess: () => void
}

export function MakeOfferModal({ listing, callerAddress, onClose, onSuccess }: Props) {
    const [amount, setAmount] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose() }
        document.addEventListener("keydown", handler)
        return () => document.removeEventListener("keydown", handler)
    }, [submitting, onClose])

    const amountUgnot = Math.floor(parseFloat(amount || "0") * 1_000_000)
    const isValid = amountUgnot > 0

    const handleSubmit = async () => {
        if (!isValid) return
        setSubmitting(true)
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msg = buildMakeOfferMsg(
                callerAddress,
                NFT_MARKETPLACE_PATH,
                listing.nftRealm,
                listing.tokenId,
                amountUgnot,
            )
            await doContractBroadcast([msg], `Offer on NFT: ${listing.tokenId}`)
            onSuccess()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Offer failed")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="nft-modal-overlay" onClick={onClose}>
            <div className="nft-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Make Offer">
                <h3 className="nft-modal__title">Make Offer</h3>

                <div className="nft-modal__info">
                    <div><strong>Collection:</strong> {listing.nftRealm}</div>
                    <div><strong>Token:</strong> {listing.tokenId}</div>
                    <div><strong>Listed Price:</strong> {(listing.priceUgnot / 1_000_000).toFixed(2)} GNOT</div>
                </div>

                <div className="nft-modal__field">
                    <label htmlFor="offer-amount">Your Offer (GNOT)</label>
                    <input
                        id="offer-amount"
                        type="number"
                        min="0.000001"
                        step="0.1"
                        placeholder="0.00"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        className="nft-modal__input"
                    />
                    <p className="nft-modal__hint">
                        Funds will be held in escrow by the marketplace. You can cancel anytime to reclaim.
                    </p>
                </div>

                {error && <p className="nft-modal__error" role="alert">{error}</p>}

                <div className="nft-modal__actions">
                    <button className="nft-modal__cancel" onClick={onClose} disabled={submitting}>
                        Cancel
                    </button>
                    <button className="nft-modal__confirm" onClick={handleSubmit} disabled={submitting || !isValid}>
                        {submitting ? "Submitting..." : `Offer ${isValid ? (amountUgnot / 1_000_000).toFixed(2) : "0.00"} GNOT`}
                    </button>
                </div>
            </div>
        </div>
    )
}
