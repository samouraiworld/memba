import { useState, useEffect } from "react"
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

    useEffect(() => {
        let cancelled = false
        fetchOtcListings()
            .then((res) => {
                if (!cancelled) {
                    setListings(res)
                    setLoading(false)
                }
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : String(err))
                    setLoading(false)
                }
            })
        return () => {
            cancelled = true
        }
    }, [])

    if (loading) return <p className="mhub-loading">Loading token listings…</p>
    if (error) return <div className="mhub-error" role="alert">Failed to load: {error}</div>

    return (
        <section className="mhub-collections">
            <div className="mhub-lane-toolbar" style={{ justifyContent: "flex-end" }}>
                <button 
                    className="mhub-launch-link"
                    onClick={() => {
                        if (!address) return alert("Please connect your wallet first.")
                        setModalProps({
                            action: "list",
                            symbol: "MEMBATEST", // Defaulting for v1.1
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
                        // Trigger a reload
                        window.location.reload()
                    }}
                />
            )}
        </section>
    )
}
