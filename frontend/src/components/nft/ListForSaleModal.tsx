/**
 * ListForSaleModal — Modal for listing an owned NFT for sale.
 *
 * User sets a price, sees the fee breakdown (price - 2.5% fee = seller receives),
 * then broadcasts ListNFT MsgCall. Requires prior Approve() on the NFT realm.
 *
 * @module components/nft/ListForSaleModal
 */

import { useState } from "react"
import { buildListForSaleMsg } from "../../lib/nftMarketplace"

const MARKETPLACE_PATH = "gno.land/r/samcrew/nft_market"
const PLATFORM_FEE_BPS = 250

interface Props {
    nftRealm: string
    tokenId: string
    callerAddress: string
    onClose: () => void
    onSuccess: () => void
}

export function ListForSaleModal({ nftRealm, tokenId, callerAddress, onClose, onSuccess }: Props) {
    const [price, setPrice] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const priceUgnot = Math.floor(parseFloat(price || "0") * 1_000_000)
    const isValid = priceUgnot > 0
    const fee = (priceUgnot * PLATFORM_FEE_BPS) / 10000
    const sellerReceives = priceUgnot - fee

    const handleList = async () => {
        if (!isValid) return
        setSubmitting(true)
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msg = buildListForSaleMsg(
                callerAddress,
                MARKETPLACE_PATH,
                nftRealm,
                tokenId,
                priceUgnot,
            )
            await doContractBroadcast([msg], `List NFT for sale: ${tokenId}`)
            onSuccess()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Listing failed")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="nft-modal-overlay" onClick={onClose}>
            <div className="nft-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="List for Sale">
                <h3 className="nft-modal__title">List for Sale</h3>

                <div className="nft-modal__info">
                    <div><strong>Collection:</strong> {nftRealm}</div>
                    <div><strong>Token:</strong> {tokenId}</div>
                </div>

                <div className="nft-modal__field">
                    <label htmlFor="list-price">Asking Price (GNOT)</label>
                    <input
                        id="list-price"
                        type="number"
                        min="0.000001"
                        step="0.1"
                        placeholder="0.00"
                        value={price}
                        onChange={e => setPrice(e.target.value)}
                        className="nft-modal__input"
                    />
                </div>

                {isValid && (
                    <div className="nft-modal__breakdown">
                        <div className="nft-modal__row">
                            <span>Asking Price</span>
                            <span>{(priceUgnot / 1_000_000).toFixed(6)} GNOT</span>
                        </div>
                        <div className="nft-modal__row nft-modal__row--fee">
                            <span>Platform Fee (2.5%)</span>
                            <span>-{(fee / 1_000_000).toFixed(6)} GNOT</span>
                        </div>
                        <div className="nft-modal__row nft-modal__row--total">
                            <span>You Receive</span>
                            <span>{(sellerReceives / 1_000_000).toFixed(6)} GNOT</span>
                        </div>
                    </div>
                )}

                <p className="nft-modal__hint">
                    You must first approve the marketplace to transfer this NFT.
                </p>

                {error && <p className="nft-modal__error" role="alert">{error}</p>}

                <div className="nft-modal__actions">
                    <button className="nft-modal__cancel" onClick={onClose} disabled={submitting}>
                        Cancel
                    </button>
                    <button className="nft-modal__confirm" onClick={handleList} disabled={submitting || !isValid}>
                        {submitting ? "Listing..." : "List for Sale"}
                    </button>
                </div>
            </div>
        </div>
    )
}
