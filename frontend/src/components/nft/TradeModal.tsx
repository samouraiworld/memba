/**
 * TradeModal — Unified, engine-routed trade modal (buy / list / offer / accept).
 *
 * Replaces the per-engine per-action modals (V3BuyNFTModal, V3ListForSaleModal,
 * MakeOfferModal, BuyNFTModal, ListForSaleModal) with a single component.
 * The engine is selected via `tradeEngineFor(source)` — NEVER sniffed from the ID.
 *
 * Plumbing (approval check, broadcast call, coin attachment, error handling) is
 * taken verbatim from the existing modals. See those files for original patterns.
 *
 * Props:
 *  - `seller`    — displayed as "Seller" for buy, omit or leave for accept.
 *  - `buyerAddr` — for action="accept": the address of the buyer whose offer is
 *                  being accepted; passed directly to buildAcceptOfferV3Msg /
 *                  buildAcceptOfferMsg as the buyer argument.
 *
 * @module components/nft/TradeModal
 */

import { useState, useEffect } from "react"
import { tradeEngineFor } from "../../lib/tradeEngine"
import { buildSetApprovalForAllV3Msg } from "../../lib/nftMarketplaceV3"
import { buildBuyNFTMsg, buildListForSaleMsg, buildMakeOfferMsg, buildAcceptOfferMsg, buildSetApprovalForAllMsg } from "../../lib/nftMarketplace"
import { routeNftV3 } from "../../lib/marketplace/router"
import { fetchLaneFeeBps } from "../../lib/marketplace/v3Reads"
import { isApprovedForAll } from "../../lib/grc721"
import { friendlyError } from "../../lib/errorMessages"
import { PriceBreakdown } from "./PriceBreakdown"
import "./TradeModal.css"

// ── Types ─────────────────────────────────────────────────────

export type TradeAction = "buy" | "list" | "offer" | "accept"
type TradeSource = "v2" | "v3"

export interface TradeModalProps {
    action: TradeAction
    source: TradeSource
    collectionID: string
    tokenId: string
    priceUgnot?: number
    /** Seller address — displayed in the info block for action="buy". */
    seller?: string
    /** For action="accept": the buyer address whose offer is being accepted. */
    buyerAddr?: string
    royaltyBps: number
    callerAddress: string
    onClose: () => void
    onSuccess: () => void
}

// ── List-step state machine (mirrors V3ListForSaleModal) ──────

type ListStep = "loading" | "approve" | "list" | "submitting-approve" | "submitting-list"

// ── Component ─────────────────────────────────────────────────

export function TradeModal({
    action,
    source,
    collectionID,
    tokenId,
    priceUgnot,
    seller,
    buyerAddr,
    royaltyBps,
    callerAddress,
    onClose,
    onSuccess,
}: TradeModalProps) {
    const engine = tradeEngineFor(source)

    // ── shared ──────────────────────────────────────────────
    const [error, setError] = useState<string | null>(null)

    // Fee row mirrors the on-chain rate. Start at the engine default (so the breakdown
    // is never blank) and, for v3, replace it with the DAO-set memba_market_config rate.
    // fetchLaneFeeBps is fail-safe (falls back to the default on any read error).
    const [feeBps, setFeeBps] = useState(engine.feeBps)
    useEffect(() => {
        if (engine.engine !== "v3") return
        let cancelled = false
        fetchLaneFeeBps("nft").then((bps) => {
            if (!cancelled) setFeeBps(bps)
        })
        return () => { cancelled = true }
    }, [engine.engine])

    // ── buy / accept ────────────────────────────────────────
    const [confirming, setConfirming] = useState(false)

    // ── list ────────────────────────────────────────────────
    const [listPrice, setListPrice] = useState("")
    const [listStep, setListStep] = useState<ListStep>("loading")

    // ── offer ───────────────────────────────────────────────
    const [offerAmount, setOfferAmount] = useState("")
    const [submittingOffer, setSubmittingOffer] = useState(false)

    // ── Escape key (mirrors existing modals) ────────────────
    useEffect(() => {
        const busy = confirming || listStep === "submitting-approve" || listStep === "submitting-list" || submittingOffer
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !busy) onClose()
        }
        document.addEventListener("keydown", handler)
        return () => document.removeEventListener("keydown", handler)
    }, [confirming, listStep, submittingOffer, onClose])

    // ── List: check approval on mount (mirrors V3ListForSaleModal) ──
    useEffect(() => {
        if (action !== "list") return
        let cancelled = false
        const init = async () => {
            try {
                const approved = await isApprovedForAll(
                    engine.collectionPath,
                    collectionID,
                    callerAddress,
                    engine.marketAddr,
                )
                if (!cancelled) setListStep(approved ? "list" : "approve")
            } catch {
                if (!cancelled) setListStep("approve")
            }
        }
        init()
        return () => { cancelled = true }
    }, [action, callerAddress, collectionID, engine.collectionPath, engine.marketAddr])

    // ── Derived values for list breakdown ───────────────────
    const listPriceUgnot = Math.floor(parseFloat(listPrice || "0") * 1_000_000)
    const isListValid = listPriceUgnot > 0

    // ── Derived values for offer ────────────────────────────
    const offerAmountUgnot = Math.floor(parseFloat(offerAmount || "0") * 1_000_000)
    const isOfferValid = offerAmountUgnot > 0

    // ── Handlers ─────────────────────────────────────────────

    const handleBuy = async () => {
        setConfirming(true)
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msgs =
                engine.engine === "v3"
                    ? routeNftV3({ collectionID, tokenId, action: "buy", caller: callerAddress, amountUgnot: priceUgnot! })
                    : [buildBuyNFTMsg(callerAddress, engine.marketPath, collectionID, tokenId, priceUgnot!)]
            await doContractBroadcast(msgs, `Buy ${collectionID}/${tokenId}`)
            onSuccess()
        } catch (err) {
            setError(friendlyError(err))
        } finally {
            setConfirming(false)
        }
    }

    const handleApprove = async () => {
        setListStep("submitting-approve")
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msg =
                engine.engine === "v3"
                    ? buildSetApprovalForAllV3Msg(callerAddress, collectionID, engine.marketAddr, true)
                    : buildSetApprovalForAllMsg(callerAddress, engine.collectionPath, collectionID, engine.marketAddr, true)
            await doContractBroadcast([msg], "Approve marketplace for all tokens")
            setListStep("list")
        } catch (err) {
            setError(friendlyError(err))
            setListStep("approve")
        }
    }

    const handleList = async () => {
        if (!isListValid) return
        setListStep("submitting-list")
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msgs =
                engine.engine === "v3"
                    ? routeNftV3({ collectionID, tokenId, action: "list", caller: callerAddress, amountUgnot: listPriceUgnot })
                    : [buildListForSaleMsg(callerAddress, engine.marketPath, collectionID, tokenId, listPriceUgnot)]
            await doContractBroadcast(msgs, `List ${collectionID}/${tokenId} for sale`)
            onSuccess()
        } catch (err) {
            setError(friendlyError(err))
            setListStep("list")
        }
    }

    const handleOffer = async () => {
        if (!isOfferValid) return
        setSubmittingOffer(true)
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msgs =
                engine.engine === "v3"
                    ? routeNftV3({ collectionID, tokenId, action: "offer", caller: callerAddress, amountUgnot: offerAmountUgnot })
                    : [buildMakeOfferMsg(callerAddress, engine.marketPath, collectionID, tokenId, offerAmountUgnot)]
            await doContractBroadcast(msgs, `Offer on ${collectionID}/${tokenId}`)
            onSuccess()
        } catch (err) {
            setError(friendlyError(err))
        } finally {
            setSubmittingOffer(false)
        }
    }

    const handleAccept = async () => {
        setConfirming(true)
        setError(null)
        const offerBuyer = buyerAddr ?? ""
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msgs =
                engine.engine === "v3"
                    ? routeNftV3({ collectionID, tokenId, action: "accept", caller: callerAddress, buyerAddr: offerBuyer })
                    : [buildAcceptOfferMsg(callerAddress, engine.marketPath, collectionID, tokenId, offerBuyer)]
            await doContractBroadcast(msgs, `Accept offer on ${collectionID}/${tokenId}`)
            onSuccess()
        } catch (err) {
            setError(friendlyError(err))
        } finally {
            setConfirming(false)
        }
    }

    // ── Title per action ─────────────────────────────────────

    const titles: Record<TradeAction, string> = {
        buy: "Buy NFT",
        list: "List for Sale",
        offer: "Make Offer",
        accept: "Accept Offer",
    }

    // ── List two-step: mirror V3ListForSaleModal ─────────────
    const listNeedsApproval = listStep === "approve" || listStep === "submitting-approve"
    const listSubmitting = listStep === "submitting-approve" || listStep === "submitting-list"
    const showListSteps = action === "list" && (listNeedsApproval || (listStep === "list" && !listSubmitting))

    // ── Render ───────────────────────────────────────────────

    return (
        <div className="trade-modal-overlay" onClick={onClose}>
            <div
                className="trade-modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={titles[action]}
            >
                <h3 className="trade-modal__title">{titles[action]}</h3>

                <div className="trade-modal__info">
                    <div><strong>Collection:</strong> {collectionID}</div>
                    <div><strong>Token:</strong> {tokenId}</div>
                    {action === "buy" && seller && <div><strong>Seller:</strong> {seller}</div>}
                    {action === "accept" && buyerAddr && <div><strong>Buyer:</strong> {buyerAddr}</div>}
                </div>

                {/* ── BUY ─────────────────────────────────────────── */}
                {action === "buy" && priceUgnot === undefined && (
                    <p className="trade-modal__error" role="alert">
                        Price unavailable — cannot complete this purchase.
                    </p>
                )}
                {action === "buy" && priceUgnot !== undefined && (
                    <>
                        <PriceBreakdown
                            priceUgnot={priceUgnot}
                            feeBps={feeBps}
                            royaltyBps={royaltyBps}
                        />

                        {royaltyBps > 0 && (
                            <div
                                className="trade-modal__royalty-notice"
                                title={`${royaltyBps / 100}% goes to the creator on every sale — enforced atomically in the gno.land realm.`}
                            >
                                ⬡ {royaltyBps / 100}% royalty enforced on-chain
                            </div>
                        )}

                        {error && <p className="trade-modal__error" role="alert">{error}</p>}

                        <div className="trade-modal__actions">
                            <button className="trade-modal__cancel" onClick={onClose} disabled={confirming}>
                                Cancel
                            </button>
                            <button className="trade-modal__confirm" onClick={handleBuy} disabled={confirming}>
                                {confirming ? "Confirming…" : "Confirm Purchase"}
                            </button>
                        </div>
                    </>
                )}

                {/* ── LIST ────────────────────────────────────────── */}
                {action === "list" && (
                    <>
                        {/* 2-step indicator */}
                        {showListSteps && (
                            <div className="trade-modal__steps">
                                <div className={`trade-modal__step${listNeedsApproval ? " active" : " done"}`}>
                                    <span className="trade-modal__step-num">{listNeedsApproval ? "1" : "✓"}</span>
                                    Approve marketplace
                                </div>
                                <div className="trade-modal__step-sep">→</div>
                                <div className={`trade-modal__step${!listNeedsApproval ? " active" : " pending"}`}>
                                    <span className="trade-modal__step-num">2</span>
                                    List for sale
                                </div>
                            </div>
                        )}

                        {listStep === "loading" && (
                            <p className="trade-modal__hint">Checking approval status…</p>
                        )}

                        {/* Approve step */}
                        {(listStep === "approve" || listStep === "submitting-approve") && (
                            <div className="trade-modal__section">
                                <p className="trade-modal__hint">
                                    The marketplace needs permission to transfer your NFTs when a sale completes.
                                    This is a one-time approval for all your tokens in this collection.
                                </p>
                                {error && <p className="trade-modal__error" role="alert">{error}</p>}
                                <div className="trade-modal__actions">
                                    <button
                                        className="trade-modal__cancel"
                                        onClick={onClose}
                                        disabled={listSubmitting}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="trade-modal__confirm"
                                        onClick={handleApprove}
                                        disabled={listStep === "submitting-approve"}
                                    >
                                        {listStep === "submitting-approve" ? "Approving…" : "Approve Marketplace"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* List step */}
                        {(listStep === "list" || listStep === "submitting-list") && (
                            <div className="trade-modal__section">
                                <div className="trade-modal__field">
                                    <label htmlFor="trade-list-price">Asking Price (GNOT)</label>
                                    <input
                                        id="trade-list-price"
                                        type="number"
                                        min="0.000001"
                                        step="0.1"
                                        placeholder="0.00"
                                        value={listPrice}
                                        onChange={(e) => setListPrice(e.target.value)}
                                        className="trade-modal__input"
                                    />
                                </div>

                                {isListValid && (
                                    <PriceBreakdown
                                        priceUgnot={listPriceUgnot}
                                        feeBps={feeBps}
                                        royaltyBps={royaltyBps}
                                    />
                                )}

                                {royaltyBps > 0 && (
                                    <div
                                        className="trade-modal__royalty-notice"
                                        title={`${royaltyBps / 100}% goes to the creator on every sale — enforced atomically.`}
                                    >
                                        ⬡ {royaltyBps / 100}% royalty enforced on-chain
                                    </div>
                                )}

                                {error && <p className="trade-modal__error" role="alert">{error}</p>}

                                <div className="trade-modal__actions">
                                    <button
                                        className="trade-modal__cancel"
                                        onClick={onClose}
                                        disabled={listSubmitting}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="trade-modal__confirm"
                                        onClick={handleList}
                                        disabled={listSubmitting || !isListValid}
                                    >
                                        {listStep === "submitting-list" ? "Listing…" : "List for Sale"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* ── OFFER ───────────────────────────────────────── */}
                {action === "offer" && (
                    <>
                        <div className="trade-modal__field">
                            <label htmlFor="trade-offer-amount">Your Offer (GNOT)</label>
                            <input
                                id="trade-offer-amount"
                                type="number"
                                min="0.000001"
                                step="0.1"
                                placeholder="0.00"
                                value={offerAmount}
                                onChange={(e) => setOfferAmount(e.target.value)}
                                className="trade-modal__input"
                            />
                        </div>

                        <div className="trade-modal__escrow-info">
                            <p className="trade-modal__hint">
                                Your offer amount is held in escrow by the marketplace realm.
                                The seller has ~7 days to accept. If they don't, cancel anytime to reclaim your funds —
                                or use "Claim Expired Offer" after the window closes.
                            </p>
                            <p className="trade-modal__hint">
                                Minimum offer: &gt;0 GNOT. Submitting a higher offer than the listed price will trigger an
                                immediate sale.
                            </p>
                        </div>

                        {error && <p className="trade-modal__error" role="alert">{error}</p>}

                        <div className="trade-modal__actions">
                            <button
                                className="trade-modal__cancel"
                                onClick={onClose}
                                disabled={submittingOffer}
                            >
                                Cancel
                            </button>
                            <button
                                className="trade-modal__confirm"
                                onClick={handleOffer}
                                disabled={submittingOffer || !isOfferValid}
                            >
                                {submittingOffer
                                    ? "Submitting…"
                                    : `Offer ${isOfferValid ? (offerAmountUgnot / 1_000_000).toFixed(2) : "0.00"} GNOT`}
                            </button>
                        </div>
                    </>
                )}

                {/* ── ACCEPT ──────────────────────────────────────── */}
                {action === "accept" && (
                    <>
                        <p className="trade-modal__hint">
                            Accept the best offer on this token. The trade will execute immediately and the NFT
                            will transfer to the buyer.
                        </p>

                        {error && <p className="trade-modal__error" role="alert">{error}</p>}

                        <div className="trade-modal__actions">
                            <button
                                className="trade-modal__cancel"
                                onClick={onClose}
                                disabled={confirming}
                            >
                                Cancel
                            </button>
                            <button
                                className="trade-modal__confirm"
                                onClick={handleAccept}
                                disabled={confirming}
                            >
                                {confirming ? "Accepting…" : "Accept Offer"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
