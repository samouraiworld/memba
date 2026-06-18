/**
 * V3ListForSaleModal — Guided 2-step list flow for memba_collections (v3 engine).
 *
 * Step 1 (conditional): SetApprovalForAll on memba_collections if the v3 market
 *   is not yet approved as operator.
 * Step 2: ListNFT on memba_nft_market_v3.
 *
 * All paths/addresses/feeBps come from the EnginePaths router — nothing is
 * hardcoded in this component.
 *
 * @module components/nft/V3ListForSaleModal
 */

import { useState, useEffect } from "react"
import { buildSetApprovalForAllV3Msg, buildListForSaleV3Msg } from "../../lib/nftMarketplaceV3"
import { isApprovedForAll } from "../../lib/grc721"
import type { EnginePaths } from "../../lib/tradeEngine"

interface Props {
    collectionID: string
    tokenId: string
    royaltyBps: number
    callerAddress: string
    engine: EnginePaths
    onClose: () => void
    onSuccess: () => void
}

type Step = "loading" | "approve" | "list" | "submitting-approve" | "submitting-list"

export function V3ListForSaleModal({
    collectionID,
    tokenId,
    royaltyBps,
    callerAddress,
    engine,
    onClose,
    onSuccess,
}: Props) {
    const [price, setPrice] = useState("")
    const [step, setStep] = useState<Step>("loading")
    const [error, setError] = useState<string | null>(null)

    const submitting = step === "submitting-approve" || step === "submitting-list"

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !submitting) onClose()
        }
        document.addEventListener("keydown", handler)
        return () => document.removeEventListener("keydown", handler)
    }, [submitting, onClose])

    // Check whether the v3 market is already approved as operator
    useEffect(() => {
        let cancelled = false
        const init = async () => {
            try {
                const approved = await isApprovedForAll(
                    engine.collectionPath,
                    collectionID,
                    callerAddress,
                    engine.marketAddr,
                )
                if (!cancelled) setStep(approved ? "list" : "approve")
            } catch {
                if (!cancelled) setStep("approve")
            }
        }
        init()
        return () => {
            cancelled = true
        }
    }, [callerAddress, collectionID, engine.collectionPath, engine.marketAddr])

    const priceUgnot = Math.floor(parseFloat(price || "0") * 1_000_000)
    const isValid = priceUgnot > 0
    const platformFee = Math.floor((priceUgnot * engine.feeBps) / 10000)
    const royaltyFee = Math.floor((priceUgnot * royaltyBps) / 10000)
    const sellerReceives = priceUgnot - platformFee - royaltyFee

    const handleApprove = async () => {
        setStep("submitting-approve")
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msg = buildSetApprovalForAllV3Msg(callerAddress, collectionID, engine.marketAddr, true)
            await doContractBroadcast([msg], "Approve v3 marketplace for all tokens")
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
            const msg = buildListForSaleV3Msg(callerAddress, collectionID, tokenId, priceUgnot)
            await doContractBroadcast([msg], `List ${collectionID}/${tokenId} for sale`)
            onSuccess()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Listing failed")
            setStep("list")
        }
    }

    const needsApproval = step === "approve" || step === "submitting-approve"
    const showSteps = needsApproval || (step === "list" && !submitting)

    return (
        <div className="nft-modal-overlay" onClick={onClose}>
            <div className="nft-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="List for Sale">
                <h3 className="nft-modal__title">List for Sale</h3>

                <div className="nft-modal__info">
                    <div><strong>Collection:</strong> {collectionID}</div>
                    <div><strong>Token:</strong> {tokenId}</div>
                </div>

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

                {step === "loading" && <p className="nft-modal__hint">Checking approval status…</p>}

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

                {(step === "list" || step === "submitting-list") && (
                    <div className="nft-modal__section">
                        <div className="nft-modal__field">
                            <label htmlFor="v3-list-price">Asking Price (GNOT)</label>
                            <input
                                id="v3-list-price"
                                type="number"
                                min="0.000001"
                                step="0.1"
                                placeholder="0.00"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
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
                                    <span>Platform Fee ({engine.feeBps / 100}%)</span>
                                    <span>−{(platformFee / 1_000_000).toFixed(6)} GNOT</span>
                                </div>
                                <div className="nft-modal__row nft-modal__row--fee">
                                    <span>Creator Royalty ({royaltyBps / 100}%)</span>
                                    <span>−{(royaltyFee / 1_000_000).toFixed(6)} GNOT</span>
                                </div>
                                <div className="nft-modal__row nft-modal__row--total">
                                    <span>You Receive</span>
                                    <span>{(sellerReceives / 1_000_000).toFixed(6)} GNOT</span>
                                </div>
                            </div>
                        )}

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
