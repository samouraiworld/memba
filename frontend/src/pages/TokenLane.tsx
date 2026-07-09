import { useState, useEffect, useCallback } from "react"
import { fetchOtcListings, type OtcListing } from "../lib/tokenOtcApi"
import { EmptyState } from "../components/ui/EmptyState"
import { formatGnotCompact } from "../lib/formatGnot"
import { useAuth } from "../hooks/useAuth"
import { TokenTradeModal, type TokenTradeModalProps } from "../components/nft/TokenTradeModal"
import "./marketplace-v2.css"

export function TokenLane() {
    const { address } = useAuth()
    const [listings, setListings] = useState<OtcListing[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Modal state
    const [modalProps, setModalProps] = useState<Omit<TokenTradeModalProps, "onClose" | "onSuccess"> | null>(null)

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

    if (loading) return <p className="mhub-loading">Loading token listings…</p>
    if (error) return <div className="mhub-error" role="alert">Failed to load: {error}</div>

    return (
        <section className="mhub-collections">
            <div className="mhub-lane-toolbar" style={{ justifyContent: "flex-end" }}>
                <button 
                    className="mhub-launch-link"
                    onClick={() => {
                        // TODO(marketplace-v2 Phase 5): replace alert() with connect-then-continue.
                        if (!address) return alert("Please connect your wallet first.")
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
                    {listings.map((item) => (
                        <div key={item.id} className="mhub-collection-card" style={{ cursor: 'default' }}>
                            <div className="mhub-collection-card__body">
                                <div className="mhub-collection-card__name-row">
                                    <span className="mhub-collection-card__name">{item.symbol}</span>
                                </div>
                                <div className="mhub-collection-card__stats">
                                    {formatGnotCompact(item.amountAvailable)} available @ {formatGnotCompact(item.expectedUnitPrice)}/ea
                                </div>
                                <div style={{ marginTop: '1rem' }}>
                                    <button 
                                        className="trade-modal__confirm" 
                                        style={{ width: '100%', padding: '0.5rem' }}
                                        onClick={() => {
                                            if (!address) return alert("Please connect your wallet first.")
                                            setModalProps({
                                                action: "buy",
                                                listingId: item.id,
                                                symbol: item.symbol,
                                                unitPriceUgnot: Number(item.expectedUnitPrice),
                                                available: Number(item.amountAvailable),
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
                    ))}
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
        </section>
    )
}
