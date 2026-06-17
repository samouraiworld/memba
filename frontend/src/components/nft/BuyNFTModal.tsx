/**
 * BuyNFTModal — Confirmation modal for purchasing an NFT at listed price.
 *
 * Shows full price breakdown: what you pay, platform fee (2.5%), creator royalty,
 * and what the seller actually receives. Royalty BPS is loaded from the collection.
 *
 * @module components/nft/BuyNFTModal
 */

import { useState, useEffect } from "react"
import type { NFTListing } from "../../lib/nftMarketplace"
import { buildBuyNFTMsg } from "../../lib/nftMarketplace"
import { getCollectionInfo } from "../../lib/grc721"
import { NFT_MARKETPLACE_PATH, NFT_COLLECTION_PATH, DEFAULT_COLLECTION_ID, PLATFORM_FEE_BPS } from "../../lib/nftConfig"

interface Props {
    listing: NFTListing
    callerAddress: string
    onClose: () => void
    onSuccess: () => void
}

export function BuyNFTModal({ listing, callerAddress, onClose, onSuccess }: Props) {
    const [buying, setBuying] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [royaltyBPS, setRoyaltyBPS] = useState(500) // default 5%

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !buying) onClose() }
        document.addEventListener("keydown", handler)
        return () => document.removeEventListener("keydown", handler)
    }, [buying, onClose])

    // Load collection royalty so the breakdown is accurate
    useEffect(() => {
        let cancelled = false
        getCollectionInfo(NFT_COLLECTION_PATH, DEFAULT_COLLECTION_ID).then(info => {
            if (!cancelled && info && info.royaltyBPS !== undefined) {
                setRoyaltyBPS(info.royaltyBPS)
            }
        })
        return () => { cancelled = true }
    }, [])

    const p = listing.priceUgnot
    const platformFee = Math.floor((p * PLATFORM_FEE_BPS) / 10000)
    const royaltyFee = Math.floor((p * royaltyBPS) / 10000)
    const sellerReceives = p - platformFee - royaltyFee

    const fmt = (ugnot: number) => (ugnot / 1_000_000).toFixed(6)

    const handleBuy = async () => {
        setBuying(true)
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msg = buildBuyNFTMsg(
                callerAddress,
                NFT_MARKETPLACE_PATH,
                DEFAULT_COLLECTION_ID,
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
                    <div className="nft-modal__row nft-modal__row--total">
                        <span>You Pay</span>
                        <span>{fmt(p)} GNOT</span>
                    </div>
                    <div className="nft-modal__row nft-modal__row--fee">
                        <span>Platform Fee (2.5%)</span>
                        <span>{fmt(platformFee)} GNOT</span>
                    </div>
                    <div className="nft-modal__row nft-modal__row--fee">
                        <span>Creator Royalty ({royaltyBPS / 100}%)</span>
                        <span>{fmt(royaltyFee)} GNOT</span>
                    </div>
                    <div className="nft-modal__row nft-modal__row--seller">
                        <span>Seller Receives</span>
                        <span>{fmt(sellerReceives)} GNOT</span>
                    </div>
                </div>

                {royaltyBPS > 0 && (
                    <div
                        className="nft-royalty-notice"
                        title={`${royaltyBPS / 100}% goes to the creator on every sale — enforced atomically in the gno.land realm; no marketplace can bypass it.`}
                    >
                        ⬡ {royaltyBPS / 100}% royalty enforced on-chain
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
