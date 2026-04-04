/**
 * BuyNFTModal — Confirmation modal for purchasing an NFT at listed price.
 *
 * Shows price breakdown: price + platform fee = total.
 * Broadcasts BuyNFT MsgCall via Adena.
 *
 * @module components/nft/BuyNFTModal
 */

import { useState, useEffect } from "react"
import type { NFTListing } from "../../lib/nftMarketplace"
import { buildBuyNFTMsg } from "../../lib/nftMarketplace"
import { NFT_NFT_MARKETPLACE_PATH, PLATFORM_FEE_BPS } from "../../lib/nftConfig"

interface Props {
    listing: NFTListing
    callerAddress: string
    onClose: () => void
    onSuccess: () => void
}

export function BuyNFTModal({ listing, callerAddress, onClose, onSuccess }: Props) {
    const [buying, setBuying] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !buying) onClose() }
        document.addEventListener("keydown", handler)
        return () => document.removeEventListener("keydown", handler)
    }, [buying, onClose])

    const priceGnot = listing.priceUgnot / 1_000_000
    const fee = (listing.priceUgnot * PLATFORM_FEE_BPS) / 10000
    const feeGnot = fee / 1_000_000
    const sellerGnot = (listing.priceUgnot - fee) / 1_000_000

    const handleBuy = async () => {
        setBuying(true)
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msg = buildBuyNFTMsg(
                callerAddress,
                NFT_MARKETPLACE_PATH,
                listing.nftRealm,
                listing.tokenId,
                listing.priceUgnot,
            )
            await doContractBroadcast([msg], `Buy NFT: ${listing.tokenId}`)
            onSuccess()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Purchase failed")
        } finally {
            setBuying(false)
        }
    }

    return (
        <div className="nft-modal-overlay" onClick={onClose}>
            <div className="nft-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Buy NFT">
                <h3 className="nft-modal__title">Buy NFT</h3>

                <div className="nft-modal__info">
                    <div><strong>Collection:</strong> {listing.nftRealm}</div>
                    <div><strong>Token:</strong> {listing.tokenId}</div>
                    <div><strong>Seller:</strong> {listing.seller}</div>
                </div>

                <div className="nft-modal__breakdown">
                    <div className="nft-modal__row">
                        <span>Price</span>
                        <span>{priceGnot.toFixed(6)} GNOT</span>
                    </div>
                    <div className="nft-modal__row nft-modal__row--fee">
                        <span>Platform Fee (2.5%)</span>
                        <span>{feeGnot.toFixed(6)} GNOT</span>
                    </div>
                    <div className="nft-modal__row nft-modal__row--seller">
                        <span>Seller Receives</span>
                        <span>{sellerGnot.toFixed(6)} GNOT</span>
                    </div>
                    <div className="nft-modal__row nft-modal__row--total">
                        <span>You Pay</span>
                        <span>{priceGnot.toFixed(6)} GNOT</span>
                    </div>
                </div>

                {error && <p className="nft-modal__error" role="alert">{error}</p>}

                <div className="nft-modal__actions">
                    <button className="nft-modal__cancel" onClick={onClose} disabled={buying}>
                        Cancel
                    </button>
                    <button className="nft-modal__confirm" onClick={handleBuy} disabled={buying}>
                        {buying ? "Confirming..." : "Confirm Purchase"}
                    </button>
                </div>
            </div>
        </div>
    )
}
