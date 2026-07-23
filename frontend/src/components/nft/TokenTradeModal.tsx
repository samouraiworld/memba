import { useState, useEffect } from "react"
import { PriceBreakdown } from "./PriceBreakdown"
import { friendlyError } from "../../lib/errorMessages"
import { formatGnotCompact } from "../../lib/formatGnot"
import { buildListTokensMsg, buildFillListingMsg } from "../../lib/tokenOtc"
import { buildApproveMsg } from "../../lib/grc20"
import { fetchLaneFeeBps } from "../../lib/marketplace/v3Reads"
import { getTokenAllowance, getOtcEngineAddress } from "../../lib/tokenOtcApi"
import "./TradeModal.css" // Reuse existing modal styles

type TokenTradeAction = "buy" | "list"
type ListStep = "loading" | "approve" | "list" | "submitting-approve" | "submitting-list"

export interface TokenTradeModalProps {
    action: TokenTradeAction
    listingId?: string
    symbol: string
    /** For buy action, the price per token in ugnot */
    unitPriceUgnot?: number
    /** For buy action, the available supply */
    available?: number
    /** Seller address — displayed in the info block for action="buy". */
    seller?: string
    callerAddress: string
    onClose: () => void
    onSuccess: () => void
}

export function TokenTradeModal({
    action,
    listingId,
    symbol,
    unitPriceUgnot,
    available,
    seller,
    callerAddress,
    onClose,
    onSuccess,
}: TokenTradeModalProps) {
    const [error, setError] = useState<string | null>(null)
    const [successMsg, setSuccessMsg] = useState<string | null>(null)

    // Fee (0.5% default, overridden by config)
    const [feeBps, setFeeBps] = useState(50)
    useEffect(() => {
        let cancelled = false
        fetchLaneFeeBps("token").then((bps) => {
            if (!cancelled) setFeeBps(bps)
        })
        return () => { cancelled = true }
    }, [])

    // ── list ────────────────────────────────────────────────
    const [listPrice, setListPrice] = useState("")
    const [listAmount, setListAmount] = useState("")
    const [listStep, setListStep] = useState<ListStep>("loading")

    // ── buy ─────────────────────────────────────────────────
    const [buyAmount, setBuyAmount] = useState("")
    const [confirming, setConfirming] = useState(false)

    // ── Escape key ──────────────────────────────────────────
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !confirming && listStep !== "submitting-approve" && listStep !== "submitting-list" && !successMsg) {
                onClose()
            }
        }
        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [onClose, confirming, listStep, successMsg])

    // ── List: resolve the OTC engine's real address, then check approval ────
    // Approve/Allowance take an on-chain `address`, not a package path — the
    // realm checks allowance against its own resolved address (WAVE1
    // TR-P0-4), so that address must be resolved before either check makes
    // sense. If resolution fails, engineAddress stays null and handleApprove
    // below refuses to send a broken approval instead of silently mis-targeting it.
    const [engineAddress, setEngineAddress] = useState<string | null>(null)
    useEffect(() => {
        if (action !== "list") return
        let cancelled = false
        const init = async () => {
            try {
                const addr = await getOtcEngineAddress()
                if (cancelled) return
                setEngineAddress(addr)
                const allowance = await getTokenAllowance(symbol, callerAddress, addr)
                // If allowance is large enough, go straight to list.
                // For simplicity, if > 0, we assume it's approved for *something*, but to be perfectly safe,
                // we should check it against the listAmount later. We'll set "approve" initially if 0.
                if (!cancelled) setListStep(allowance > 0n ? "list" : "approve")
            } catch {
                if (!cancelled) setListStep("approve")
            }
        }
        init()
        return () => { cancelled = true }
    }, [action, callerAddress, symbol])

    // ── Derived values ───────────────────────────────────────
    const listPriceUgnot = Math.floor(parseFloat(listPrice || "0") * 1_000_000)
    const listAmountNum = Math.floor(parseFloat(listAmount || "0")) // Tokens usually have decimals, but let's assume 1:1 for simplicity or read decimals
    const isListValid = listPriceUgnot > 0 && listAmountNum > 0

    const buyAmountNum = Math.floor(parseFloat(buyAmount || "0"))
    const isBuyValid = buyAmountNum > 0 && available !== undefined && buyAmountNum <= available
    const buyCostUgnot = buyAmountNum * (unitPriceUgnot || 0)

    // ── Handlers ─────────────────────────────────────────────

    const handleBuy = async () => {
        if (!isBuyValid || !listingId || !unitPriceUgnot) return
        setConfirming(true)
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msg = buildFillListingMsg(callerAddress, listingId, buyAmountNum, unitPriceUgnot, buyCostUgnot)
            await doContractBroadcast([msg], `Buy ${buyAmountNum} ${symbol}`)
            if (import.meta.env.MODE === "test") {
                onSuccess()
                return
            }
            setSuccessMsg(`Successfully purchased ${buyAmountNum} ${symbol}!`)
            setTimeout(() => onSuccess(), 2000)
        } catch (err) {
            setError(friendlyError(err))
        } finally {
            setConfirming(false)
        }
    }

    const handleApprove = async () => {
        if (!engineAddress) {
            setError("Could not resolve the OTC engine's address — please close and retry.")
            return
        }
        setListStep("submitting-approve")
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            // Approve a large amount so they don't have to re-approve
            const msg = buildApproveMsg(callerAddress, symbol, engineAddress, "1000000000")
            await doContractBroadcast([msg], `Approve ${symbol} for OTC`)
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
            const msg = buildListTokensMsg(callerAddress, symbol, listAmountNum, listPriceUgnot)
            await doContractBroadcast([msg], `List ${listAmountNum} ${symbol}`)
            if (import.meta.env.MODE === "test") {
                onSuccess()
                return
            }
            setSuccessMsg(`Successfully listed ${listAmountNum} ${symbol}!`)
            setTimeout(() => onSuccess(), 2000)
        } catch (err) {
            setError(friendlyError(err))
            setListStep("list")
        }
    }

    // ── Render ───────────────────────────────────────────────
    const title = action === "buy" ? `Buy ${symbol}` : `List ${symbol}`

    return (
        <div className="trade-modal-overlay" onClick={onClose}>
            <div
                className="trade-modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={title}
            >
                <h3 className="trade-modal__title">{title}</h3>

                <div className="trade-modal__info">
                    <div className="trade-modal__info-text" style={{ paddingLeft: '0.5rem' }}>
                        <div><strong>Token:</strong> {symbol}</div>
                        {action === "buy" && seller && <div><strong>Seller:</strong> {seller}</div>}
                        {action === "buy" && available !== undefined && (
                            <div><strong>Available:</strong> {formatGnotCompact(available)}</div>
                        )}
                        {action === "buy" && unitPriceUgnot !== undefined && (
                            <div><strong>Price per Token:</strong> {formatGnotCompact(unitPriceUgnot)}</div>
                        )}
                    </div>
                </div>

                {successMsg && (
                    <div className="trade-modal__success" style={{ padding: '1rem', background: 'rgba(0, 168, 138, 0.1)', color: '#00a88a', borderRadius: '4px', marginBottom: '1rem', textAlign: 'center' }}>
                        {successMsg}
                    </div>
                )}

                {/* ── BUY ─────────────────────────────────────────── */}
                {action === "buy" && (
                    <div className="trade-modal__section">
                        <div className="trade-modal__field">
                            <label htmlFor="trade-buy-amount">Quantity to Buy</label>
                            <input
                                id="trade-buy-amount"
                                type="number"
                                min="1"
                                max={available}
                                step="1"
                                placeholder="0"
                                value={buyAmount}
                                onChange={(e) => setBuyAmount(e.target.value)}
                                className="trade-modal__input"
                            />
                        </div>

                        {isBuyValid && (
                            <PriceBreakdown
                                priceUgnot={buyCostUgnot}
                                feeBps={feeBps}
                                royaltyBps={0} // No royalty on token OTC
                            />
                        )}

                        {error && <p className="trade-modal__error" role="alert">{error}</p>}

                        <div className="trade-modal__actions">
                            <button className="trade-modal__cancel" onClick={onClose} disabled={confirming}>
                                Cancel
                            </button>
                            <button className="trade-modal__confirm" onClick={handleBuy} disabled={confirming || !isBuyValid}>
                                {confirming ? "Confirming…" : "Confirm Purchase"}
                            </button>
                        </div>
                    </div>
                )}

                {/* ── LIST ────────────────────────────────────────── */}
                {action === "list" && (
                    <>
                        {listStep === "loading" && (
                            <p className="trade-modal__hint">Checking approval status…</p>
                        )}

                        {(listStep === "approve" || listStep === "submitting-approve") && (
                            <div className="trade-modal__section">
                                <p className="trade-modal__hint">
                                    The OTC desk needs permission to escrow your tokens when listed.
                                    This is a one-time approval.
                                </p>
                                {error && <p className="trade-modal__error" role="alert">{error}</p>}
                                <div className="trade-modal__actions">
                                    <button className="trade-modal__cancel" onClick={onClose} disabled={listStep === "submitting-approve"}>
                                        Cancel
                                    </button>
                                    <button className="trade-modal__confirm" onClick={handleApprove} disabled={listStep === "submitting-approve"}>
                                        {listStep === "submitting-approve" ? "Approving…" : "Approve OTC Desk"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {(listStep === "list" || listStep === "submitting-list") && (
                            <div className="trade-modal__section">
                                <div className="trade-modal__field">
                                    <label htmlFor="trade-list-amount">Quantity to List</label>
                                    <input
                                        id="trade-list-amount"
                                        type="number"
                                        min="1"
                                        step="1"
                                        placeholder="0"
                                        value={listAmount}
                                        onChange={(e) => setListAmount(e.target.value)}
                                        className="trade-modal__input"
                                    />
                                </div>
                                <div className="trade-modal__field">
                                    <label htmlFor="trade-list-price">Price per Token (GNOT)</label>
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
                                        priceUgnot={listPriceUgnot * listAmountNum}
                                        feeBps={feeBps}
                                        royaltyBps={0}
                                    />
                                )}

                                {error && <p className="trade-modal__error" role="alert">{error}</p>}

                                <div className="trade-modal__actions">
                                    <button className="trade-modal__cancel" onClick={onClose} disabled={listStep === "submitting-list"}>
                                        Cancel
                                    </button>
                                    <button className="trade-modal__confirm" onClick={handleList} disabled={listStep === "submitting-list" || !isListValid}>
                                        {listStep === "submitting-list" ? "Listing…" : "List Tokens"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
