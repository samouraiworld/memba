/**
 * V3BuyNFTModal — Confirmation modal for purchasing a v3-listed NFT.
 *
 * Shows full price breakdown: what you pay, platform fee (v3 = 2.0%), creator
 * royalty, and what the seller actually receives. feeBps comes from the
 * EnginePaths router — nothing is hardcoded.
 *
 * @module components/nft/V3BuyNFTModal
 */

import { useState, useEffect } from "react"
import { buildBuyNFTV3Msg } from "../../lib/nftMarketplaceV3"
import type { EnginePaths } from "../../lib/tradeEngine"

interface Props {
    collectionID: string
    tokenId: string
    priceUgnot: number
    seller: string
    royaltyBps: number
    callerAddress: string
    engine: EnginePaths
    onClose: () => void
    onSuccess: () => void
}

export function V3BuyNFTModal({
    collectionID,
    tokenId,
    priceUgnot,
    seller,
    royaltyBps,
    callerAddress,
    engine,
    onClose,
    onSuccess,
}: Props) {
    const [buying, setBuying] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !buying) onClose()
        }
        document.addEventListener("keydown", handler)
        return () => document.removeEventListener("keydown", handler)
    }, [buying, onClose])

    const platformFee = Math.floor((priceUgnot * engine.feeBps) / 10000)
    const royaltyFee = Math.floor((priceUgnot * royaltyBps) / 10000)
    const sellerReceives = priceUgnot - platformFee - royaltyFee

    const fmt = (ugnot: number) => (ugnot / 1_000_000).toFixed(6)

    const handleBuy = async () => {
        setBuying(true)
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msg = buildBuyNFTV3Msg(callerAddress, collectionID, tokenId, priceUgnot)
            await doContractBroadcast([msg], `Buy ${collectionID}/${tokenId}`)
            onSuccess()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Purchase failed")
        } finally {
            setBuying(false)
        }
    }

    return (
        <div className="nft-modal-overlay" onClick={onClose}>
            <div className="nft-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Buy NFT">
                <h3 className="nft-modal__title">Buy NFT</h3>

                <div className="nft-modal__info">
                    <div><strong>Collection:</strong> {collectionID}</div>
                    <div><strong>Token:</strong> {tokenId}</div>
                    <div><strong>Seller:</strong> {seller}</div>
                </div>

                <div className="nft-modal__breakdown">
                    <div className="nft-modal__row nft-modal__row--total">
                        <span>You Pay</span>
                        <span>{fmt(priceUgnot)} GNOT</span>
                    </div>
                    <div className="nft-modal__row nft-modal__row--fee">
                        <span>Platform Fee ({engine.feeBps / 100}%)</span>
                        <span>{fmt(platformFee)} GNOT</span>
                    </div>
                    <div className="nft-modal__row nft-modal__row--fee">
                        <span>Creator Royalty ({royaltyBps / 100}%)</span>
                        <span>{fmt(royaltyFee)} GNOT</span>
                    </div>
                    <div className="nft-modal__row nft-modal__row--seller">
                        <span>Seller Receives</span>
                        <span>{fmt(sellerReceives)} GNOT</span>
                    </div>
                </div>

                {royaltyBps > 0 && (
                    <div
                        className="nft-royalty-notice"
                        title={`${royaltyBps / 100}% goes to the creator on every sale — enforced atomically in the gno.land realm; no marketplace can bypass it.`}
                    >
                        ⬡ {royaltyBps / 100}% royalty enforced on-chain
                    </div>
                )}

                {error && <p className="nft-modal__error" role="alert">{error}</p>}

                <div className="nft-modal__actions">
                    <button className="nft-modal__cancel" onClick={onClose} disabled={buying}>
                        Cancel
                    </button>
                    <button className="nft-modal__confirm" onClick={handleBuy} disabled={buying}>
                        {buying ? "Confirming…" : "Confirm Purchase"}
                    </button>
                </div>
            </div>
        </div>
    )
}
