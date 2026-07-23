import { useState, useEffect } from "react"
import { PriceBreakdown } from "./PriceBreakdown"
import { friendlyError } from "../../lib/errorMessages"
import { formatGnotCompact } from "../../lib/formatGnot"
import { buildListTokensMsg, buildFillListingMsg } from "../../lib/tokenOtc"
import { buildApproveMsg, getTokenDecimals, parseTokenAmount, formatTokenAmount, MAX_INT64 } from "../../lib/grc20"
import { GNO_RPC_URL } from "../../lib/config"
import { fetchLaneFeeBps } from "../../lib/marketplace/v3Reads"
import { getTokenAllowance, getOtcEngineAddress } from "../../lib/tokenOtcApi"
import "./TradeModal.css" // Reuse existing modal styles

type TokenTradeAction = "buy" | "list"
type ListStep = "loading" | "approve" | "list" | "submitting-approve" | "submitting-list"

export interface TokenTradeModalProps {
    action: TokenTradeAction
    listingId?: string
    symbol: string
    /** For buy action, the price in ugnot PER BASE UNIT of the token — the same
     *  denomination `memba_token_otc_v2.Listing.UnitPrice` stores on-chain
     *  (NOT per whole token; see the on-chain realm's `Fill`: `cost = qty * UnitPrice`,
     *  where `qty` is base units). */
    unitPriceUgnot?: bigint
    /** For buy action, the available supply, in BASE UNITS (matches on-chain `Listing.Amount`). */
    available?: bigint
    /** Seller address — displayed in the info block for action="buy". */
    seller?: string
    callerAddress: string
    onClose: () => void
    onSuccess: () => void
}

/** Ceiling division for positive bigints — used to derive a per-base-unit
 *  price from a human "per whole token" price without ever rounding DOWN to
 *  zero (which the on-chain realm rejects: `unitPrice must be > 0`) or
 *  under-charging the seller relative to what they typed. */
function ceilDiv(a: bigint, b: bigint): bigint {
    return (a + b - 1n) / b
}

/** parseTokenAmount, but never throws into render — an empty/invalid input
 *  yields `0n` plus a user-facing error string instead of an exception. */
function parseAmountSafe(input: string, decimals: number): { value: bigint; error: string | null } {
    if (!input.trim()) return { value: 0n, error: null }
    try {
        return { value: parseTokenAmount(input, decimals), error: null }
    } catch (e) {
        return { value: 0n, error: e instanceof Error ? e.message : "Invalid amount" }
    }
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

    // T3.2: the token's decimals determine the human<->base-unit conversion for
    // EVERY amount/price field below. Both buy and list need it before any
    // amount math is trustworthy, so this runs regardless of `action` and both
    // flows gate their confirm buttons on `decimals !== null` (never fall back
    // to a guessed default for a fund-moving action — display-only paths may
    // use getTokenDecimals's own internal 6-decimals fallback, but a
    // trade confirmation must know the real value).
    const [decimals, setDecimals] = useState<number | null>(null)
    useEffect(() => {
        let cancelled = false
        getTokenDecimals(GNO_RPC_URL, symbol).then((d) => {
            if (!cancelled) setDecimals(d)
        })
        return () => { cancelled = true }
    }, [symbol])

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

    // ── Derived values (T3.2: base-unit math, not 1:1) ────────
    // `unitPrice` on-chain is ugnot PER BASE UNIT (memba_token_otc_v2.gno:
    // `cost = qty * UnitPrice`, qty in base units) — see the prop doc comment
    // above. A human "price per whole token" input must be scaled down by
    // 10^decimals to become that per-base-unit price; ceilDiv means it can
    // never silently round to 0 (which the realm would reject outright) and
    // never under-collects relative to what the seller typed.
    const decimalsLoaded = decimals !== null
    const effectiveDecimals = decimals ?? 6
    const baseUnitScale = 10n ** BigInt(effectiveDecimals)

    const listPriceParsed = parseAmountSafe(listPrice, 6) // GNOT itself is 6-decimal (== ugnot)
    const listAmountParsed = parseAmountSafe(listAmount, effectiveDecimals)
    const listPriceUgnotWhole = listPriceParsed.value
    const listAmountBaseUnits = listAmountParsed.value
    const listUnitPricePerBaseUnit = listPriceUgnotWhole > 0n ? ceilDiv(listPriceUgnotWhole, baseUnitScale) : 0n
    // The ACTUAL total the seller will require on Fill — recomputed from the
    // rounded per-base-unit price, never the naive human-input product, so the
    // preview never shows a number other than what will really be charged.
    const listTotalCostUgnot = listUnitPricePerBaseUnit * listAmountBaseUnits
    const listOverflow =
        listAmountBaseUnits > MAX_INT64 || listUnitPricePerBaseUnit > MAX_INT64 || listTotalCostUgnot > MAX_INT64
    const isListValid =
        decimalsLoaded &&
        !listPriceParsed.error &&
        !listAmountParsed.error &&
        !listOverflow &&
        listPriceUgnotWhole > 0n &&
        listAmountBaseUnits > 0n &&
        listUnitPricePerBaseUnit > 0n

    const buyParsed = parseAmountSafe(buyAmount, effectiveDecimals)
    const buyAmountBaseUnits = buyParsed.value
    const isBuyValid =
        decimalsLoaded &&
        !buyParsed.error &&
        buyAmountBaseUnits > 0n &&
        available !== undefined &&
        buyAmountBaseUnits <= available
    const buyCostUgnot = buyAmountBaseUnits * (unitPriceUgnot ?? 0n)

    // ── Handlers ─────────────────────────────────────────────

    const handleBuy = async () => {
        if (!isBuyValid || !listingId || !unitPriceUgnot) return
        setConfirming(true)
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            const msg = buildFillListingMsg(callerAddress, listingId, buyAmountBaseUnits, unitPriceUgnot, buyCostUgnot)
            const humanAmount = formatTokenAmount(buyAmountBaseUnits, effectiveDecimals)
            await doContractBroadcast([msg], `Buy ${humanAmount} ${symbol}`)
            if (import.meta.env.MODE === "test") {
                onSuccess()
                return
            }
            setSuccessMsg(`Successfully purchased ${humanAmount} ${symbol}!`)
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
            const msg = buildListTokensMsg(callerAddress, symbol, listAmountBaseUnits, listUnitPricePerBaseUnit)
            const humanAmount = formatTokenAmount(listAmountBaseUnits, effectiveDecimals)
            await doContractBroadcast([msg], `List ${humanAmount} ${symbol}`)
            if (import.meta.env.MODE === "test") {
                onSuccess()
                return
            }
            setSuccessMsg(`Successfully listed ${humanAmount} ${symbol}!`)
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
                            <div><strong>Available:</strong> {formatTokenAmount(available, effectiveDecimals)} {symbol}</div>
                        )}
                        {action === "buy" && unitPriceUgnot !== undefined && (
                            // Stored on-chain per BASE UNIT — scale up by decimals for the
                            // intuitive "per whole token" figure a buyer expects to see.
                            <div><strong>Price per Token:</strong> {formatGnotCompact(unitPriceUgnot * baseUnitScale)}</div>
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
                        {!decimalsLoaded && <p className="trade-modal__hint">Loading token info…</p>}
                        <div className="trade-modal__field">
                            <label htmlFor="trade-buy-amount">Quantity to Buy</label>
                            <input
                                id="trade-buy-amount"
                                type="number"
                                min={effectiveDecimals > 0 ? `${1 / 10 ** effectiveDecimals}` : "1"}
                                max={available !== undefined ? formatTokenAmount(available, effectiveDecimals) : undefined}
                                step={effectiveDecimals > 0 ? "any" : "1"}
                                placeholder="0"
                                value={buyAmount}
                                onChange={(e) => setBuyAmount(e.target.value)}
                                className="trade-modal__input"
                                disabled={!decimalsLoaded}
                            />
                        </div>
                        {buyParsed.error && <p className="trade-modal__error" role="alert">{buyParsed.error}</p>}

                        {isBuyValid && (
                            <PriceBreakdown
                                priceUgnot={Number(buyCostUgnot)}
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
                                {!decimalsLoaded && <p className="trade-modal__hint">Loading token info…</p>}
                                <div className="trade-modal__field">
                                    <label htmlFor="trade-list-amount">Quantity to List</label>
                                    <input
                                        id="trade-list-amount"
                                        type="number"
                                        min={effectiveDecimals > 0 ? `${1 / 10 ** effectiveDecimals}` : "1"}
                                        step={effectiveDecimals > 0 ? "any" : "1"}
                                        placeholder="0"
                                        value={listAmount}
                                        onChange={(e) => setListAmount(e.target.value)}
                                        className="trade-modal__input"
                                        disabled={!decimalsLoaded}
                                    />
                                    {listAmountParsed.error && <p className="trade-modal__error" role="alert">{listAmountParsed.error}</p>}
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
                                        disabled={!decimalsLoaded}
                                    />
                                    {listPriceParsed.error && <p className="trade-modal__error" role="alert">{listPriceParsed.error}</p>}
                                    {/* Price per base unit must be a positive integer number of ugnot, so the
                                        effective price sometimes rounds UP from what was typed (never down —
                                        see ceilDiv). Surface the real number so nothing is hidden. */}
                                    {decimalsLoaded && listUnitPricePerBaseUnit > 0n && (
                                        <p className="trade-modal__hint">
                                            Effective price: {formatGnotCompact(listUnitPricePerBaseUnit * baseUnitScale)} per whole token
                                            {listUnitPricePerBaseUnit * baseUnitScale !== listPriceUgnotWhole && " (rounded up for precision)"}
                                        </p>
                                    )}
                                </div>

                                {isListValid && (
                                    <PriceBreakdown
                                        priceUgnot={Number(listTotalCostUgnot)}
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
