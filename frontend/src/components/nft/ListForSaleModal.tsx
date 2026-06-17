/**
 * ListForSaleModal — Guided 2-step flow for listing an owned NFT for sale.
 *
 * Step 1 (conditional): SetApprovalForAll if marketplace is not yet approved.
 * Step 2: ListNFT with the chosen price.
 *
 * Price-split preview shows: platform fee (2.5%) + royalty (from collection,
 * default 5% / 500 BPS) so the seller knows exactly what they'll receive.
 *
 * @module components/nft/ListForSaleModal
 */

import { useState, useEffect } from "react"
import { buildListForSaleMsg, buildSetApprovalForAllMsg } from "../../lib/nftMarketplace"
import {
    isApprovedForAll,
    getCollectionInfo,
} from "../../lib/grc721"
import {
    NFT_MARKETPLACE_PATH,
    NFT_COLLECTION_PATH,
    NFT_MARKET_ADDR,
    DEFAULT_COLLECTION_ID,
    PLATFORM_FEE_BPS,
} from "../../lib/nftConfig"

interface Props {
    nftRealm: string
    tokenId: string
    callerAddress: string
    onClose: () => void
    onSuccess: () => void
}

type Step = "loading" | "approve" | "list" | "submitting-approve" | "submitting-list"

export function ListForSaleModal({ tokenId, callerAddress, onClose, onSuccess }: Props) {
    const [price, setPrice] = useState("")
    const [step, setStep] = useState<Step>("loading")
    const [error, setError] = useState<string | null>(null)
    const [royaltyBPS, setRoyaltyBPS] = useState(500) // default 5%

    const submitting = step === "submitting-approve" || step === "submitting-list"

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose() }
        document.addEventListener("keydown", handler)
        return () => document.removeEventListener("keydown", handler)
    }, [submitting, onClose])

    // On mount: check approval state + load royalty from collection
    useEffect(() => {
        let cancelled = false
        const init = async () => {
            const [approved, collInfo] = await Promise.all([
                isApprovedForAll(NFT_COLLECTION_PATH, DEFAULT_COLLECTION_ID, callerAddress, NFT_MARKET_ADDR),
                getCollectionInfo(NFT_COLLECTION_PATH, DEFAULT_COLLECTION_ID),
            ])
            if (cancelled) return
            if (collInfo && collInfo.royaltyBPS !== undefined) {
                setRoyaltyBPS(collInfo.royaltyBPS)
            }
            setStep(approved ? "list" : "approve")
        }
        init()
        return () => { cancelled = true }
    }, [callerAddress])

    const priceUgnot = Math.floor(parseFloat(price || "0") * 1_000_000)
    const isValid = priceUgnot > 0
    const platformFee = Math.floor((priceUgnot * PLATFORM_FEE_BPS) / 10000)
    const royaltyFee = Math.floor((priceUgnot * royaltyBPS) / 10000)
    const sellerReceives = priceUgnot - platformFee - royaltyFee

    const handleApprove = async () => {
        setStep("submitting-approve")
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msg = buildSetApprovalForAllMsg(
                callerAddress,
                NFT_COLLECTION_PATH,
                DEFAULT_COLLECTION_ID,
                NFT_MARKET_ADDR,
                true,
            )
            await doContractBroadcast([msg], "Approve marketplace for all tokens")
            setStep("list")
        } catch (err) {
            setError(err instanceof Error ? err.message : "Approval failed")
            setStep("approve")
        }
    }

    const handleList = async () => {
        if (!isValid) return
        setStep("submitting-list")
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msg = buildListForSaleMsg(
                callerAddress,
                NFT_MARKETPLACE_PATH,
                DEFAULT_COLLECTION_ID,
                tokenId,
                priceUgnot,
            )
            await doContractBroadcast([msg], `List NFT for sale: ${tokenId}`)
            onSuccess()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Listing failed")
            setStep("list")
        }
    }

    // Step indicator — only shown when approval is needed
    const needsApproval = step === "approve" || step === "submitting-approve"
    const showSteps = needsApproval || (step === "list" && !submitting)

    return (
        <div className="nft-modal-overlay" onClick={onClose}>
            <div className="nft-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="List for Sale">
                <h3 className="nft-modal__title">List for Sale</h3>

                <div className="nft-modal__info">
                    <div><strong>Collection:</strong> {DEFAULT_COLLECTION_ID}</div>
                    <div><strong>Token:</strong> {tokenId}</div>
                </div>

                {/* 2-step progress indicator */}
                {showSteps && (
                    <div className="nft-modal__steps">
                        <div className={`nft-modal__step${needsApproval ? " active" : " done"}`}>
                            <span className="nft-modal__step-num">{needsApproval ? "1" : "✓"}</span>
                            Approve marketplace
                        </div>
                        <div className="nft-modal__step-sep">→</div>
                        <div className={`nft-modal__step${!needsApproval ? " active" : " pending"}`}>
                            <span className="nft-modal__step-num">2</span>
                            List for sale
                        </div>
                    </div>
                )}

                {step === "loading" && (
                    <p className="nft-modal__hint">Checking approval status…</p>
                )}

                {/* Approve step */}
                {(step === "approve" || step === "submitting-approve") && (
                    <div className="nft-modal__section">
                        <p className="nft-modal__hint">
                            The marketplace needs permission to transfer your NFTs when a sale completes.
                            This is a one-time approval for all your tokens in this collection.
                        </p>
                        {error && <p className="nft-modal__error" role="alert">{error}</p>}
                        <div className="nft-modal__actions">
                            <button className="nft-modal__cancel" onClick={onClose} disabled={submitting}>
                                Cancel
                            </button>
                            <button
                                className="nft-modal__confirm"
                                onClick={handleApprove}
                                disabled={step === "submitting-approve"}
                            >
                                {step === "submitting-approve" ? "Approving…" : "Approve Marketplace"}
                            </button>
                        </div>
                    </div>
                )}

                {/* List step */}
                {(step === "list" || step === "submitting-list") && (
                    <div className="nft-modal__section">
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
                                    <span>−{(platformFee / 1_000_000).toFixed(6)} GNOT</span>
                                </div>
                                <div className="nft-modal__row nft-modal__row--fee">
                                    <span>Creator Royalty ({royaltyBPS / 100}%)</span>
                                    <span>−{(royaltyFee / 1_000_000).toFixed(6)} GNOT</span>
                                </div>
                                <div className="nft-modal__row nft-modal__row--total">
                                    <span>You Receive</span>
                                    <span>{(sellerReceives / 1_000_000).toFixed(6)} GNOT</span>
                                </div>
                            </div>
                        )}

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
                            <button className="nft-modal__cancel" onClick={onClose} disabled={submitting}>
                                Cancel
                            </button>
                            <button
                                className="nft-modal__confirm"
                                onClick={handleList}
                                disabled={submitting || !isValid}
                            >
                                {step === "submitting-list" ? "Listing…" : "List for Sale"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
