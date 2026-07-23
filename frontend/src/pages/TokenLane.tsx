import { useState, useEffect, useCallback } from "react"
import { fetchOtcListings, type OtcListing } from "../lib/tokenOtcApi"
import { EmptyState } from "../components/ui/EmptyState"
import { formatGnotCompact } from "../lib/formatGnot"
import { getTokenDecimals, formatTokenAmount } from "../lib/grc20"
import { GNO_RPC_URL } from "../lib/config"
import { useAuth } from "../hooks/useAuth"
import { TokenTradeModal, type TokenTradeModalProps } from "../components/nft/TokenTradeModal"
import { ErrorToast } from "../components/ui/ErrorToast"
import "./marketplace-v2.css"

export function TokenLane() {
    const { address } = useAuth()
    const [listings, setListings] = useState<OtcListing[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // T3.2: amountAvailable/expectedUnitPrice are BASE UNITS / ugnot-per-base-unit
    // on the wire — decimals-per-symbol is needed to display them honestly (and
    // to seed the trade modal's own lookup with a warm cache). Keyed by symbol
    // since multiple listings can share one; missing entries mean "not loaded
    // yet" and fall back to raw-unit display rather than guessing.
    const [decimalsBySymbol, setDecimalsBySymbol] = useState<Record<string, number>>({})

    // Modal state
    const [modalProps, setModalProps] = useState<Omit<TokenTradeModalProps, "onClose" | "onSuccess"> | null>(null)
    const [toast, setToast] = useState<string | null>(null)

    // Loads (or reloads) the OTC book. Called on mount and after a successful
    // trade — replacing the old window.location.reload() (Phase 2 will move this
    // to a TanStack Query invalidation).
    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            setListings(await fetchOtcListings())
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    // Resolve decimals for every distinct symbol currently listed. Best-effort:
    // a lookup failure for one symbol doesn't block the others (allSettled),
    // and getTokenDecimals itself never throws (falls back to 6 internally) —
    // this loop exists purely to WARM the shared cache + populate display state.
    useEffect(() => {
        const symbols = [...new Set(listings.map((l) => l.symbol))].filter((s) => !(s in decimalsBySymbol))
        if (symbols.length === 0) return
        let cancelled = false
        Promise.allSettled(symbols.map((s) => getTokenDecimals(GNO_RPC_URL, s).then((d) => [s, d] as const))).then(
            (results) => {
                if (cancelled) return
                const next: Record<string, number> = {}
                for (const r of results) {
                    if (r.status === "fulfilled") next[r.value[0]] = r.value[1]
                }
                if (Object.keys(next).length > 0) setDecimalsBySymbol((prev) => ({ ...prev, ...next }))
            },
        )
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- decimalsBySymbol read only to compute the diff, not a dependency (avoids a refetch loop)
    }, [listings])

    if (loading) return <p className="mhub-loading">Loading token listings…</p>
    if (error) return <div className="mhub-error" role="alert">Failed to load: {error}</div>

    return (
        <section className="mhub-collections">
            <div className="mhub-lane-toolbar" style={{ justifyContent: "flex-end" }}>
                <button 
                    className="mhub-launch-link"
                    onClick={() => {
                        // TODO(marketplace-v2 Phase 5): replace the toast with a connect-then-continue flow.
                        if (!address) { setToast("Please connect your wallet first."); return }
                        setModalProps({
                            action: "list",
                            // TODO(marketplace-v2 Phase 7.3): replace hardcoded symbol with a real token select (OTC Block Desk rebuild).
                            symbol: "MEMBATEST",
                            callerAddress: address,
                        })
                    }}
                >
                    List Tokens
                </button>
            </div>
            
            <h2 className="mhub-section-title">Token OTC Listings</h2>
            
            {listings.length === 0 ? (
                <EmptyState
                    icon="ti-coin"
                    title="No tokens listed"
                    body="Be the first to list tokens on the OTC desk."
                />
            ) : (
                <div className="mhub-grid">
                    {listings.map((item) => {
                        // T3.2: amountAvailable is BASE UNITS, expectedUnitPrice is ugnot PER
                        // BASE UNIT — formatGnotCompact (a ugnot/1e6 formatter) was previously
                        // misapplied to amountAvailable, which isn't ugnot-denominated at all.
                        const decimals = decimalsBySymbol[item.symbol]
                        const decimalsLoaded = decimals !== undefined
                        const amountLabel = decimalsLoaded
                            ? `${formatTokenAmount(item.amountAvailable, decimals)} ${item.symbol}`
                            : `${item.amountAvailable.toString()} (base units) ${item.symbol}` // honest placeholder, never a wrong number
                        const priceLabel = decimalsLoaded
                            ? formatGnotCompact(item.expectedUnitPrice * 10n ** BigInt(decimals))
                            : formatGnotCompact(item.expectedUnitPrice) // per-base-unit fallback pre-load
                        return (
                        <div key={item.id} className="mhub-collection-card" style={{ cursor: 'default' }}>
                            <div className="mhub-collection-card__body">
                                <div className="mhub-collection-card__name-row">
                                    <span className="mhub-collection-card__name">{item.symbol}</span>
                                </div>
                                <div className="mhub-collection-card__stats">
                                    {amountLabel} available @ {priceLabel}/ea
                                </div>
                                <div style={{ marginTop: '1rem' }}>
                                    <button 
                                        className="trade-modal__confirm" 
                                        style={{ width: '100%', padding: '0.5rem' }}
                                        onClick={() => {
                                            if (!address) { setToast("Please connect your wallet first."); return }
                                            setModalProps({
                                                action: "buy",
                                                listingId: item.id,
                                                symbol: item.symbol,
                                                unitPriceUgnot: item.expectedUnitPrice,
                                                available: item.amountAvailable,
                                                seller: item.seller,
                                                callerAddress: address,
                                            })
                                        }}
                                    >
                                        Buy
                                    </button>
                                </div>
                            </div>
                        </div>
                        )
                    })}
                </div>
            )}

            {modalProps && (
                <TokenTradeModal
                    {...modalProps}
                    onClose={() => setModalProps(null)}
                    onSuccess={() => {
                        setModalProps(null)
                        void load()
                    }}
                />
            )}
            <ErrorToast message={toast} onDismiss={() => setToast(null)} />
        </section>
    )
}
