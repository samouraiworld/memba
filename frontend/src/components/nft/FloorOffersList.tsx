import { useState, useEffect } from "react"
import { useAdena } from "../../hooks/useAdena"
import { formatGnotCompact } from "../../lib/formatGnot"

export interface FloorOffer {
    buyer: string
    priceUgnot: number
    expiryBlk: number
    createdBlk: number
}

// Temporary mock until the Go indexer exposes the endpoint
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function mockFetchFloorOffers(collectionId: string): Promise<FloorOffer[]> {
    return [
        { buyer: "g1fakebuyer01", priceUgnot: 25000000, createdBlk: 1000, expiryBlk: 9999999 },
        { buyer: "g1fakebuyer02", priceUgnot: 24000000, createdBlk: 1000, expiryBlk: 9999999 },
        { buyer: "g1fakebuyer03", priceUgnot: 22500000, createdBlk: 1000, expiryBlk: 9999999 }
    ]
}

export interface FloorOffersListProps {
    collectionId: string
    onAcceptRequest?: (offer: FloorOffer) => void
}

export function FloorOffersList({ collectionId, onAcceptRequest }: FloorOffersListProps) {
    const adena = useAdena()
    const [offers, setOffers] = useState<FloorOffer[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let mounted = true
        mockFetchFloorOffers(collectionId).then(data => {
            if (mounted) {
                setOffers(data)
                setLoading(false)
            }
        })
        return () => { mounted = false }
    }, [collectionId])

    if (loading) {
        return <div className="floor-offers-loading k-text-muted">Loading depth...</div>
    }

    if (offers.length === 0) {
        return (
            <div className="floor-offers-empty">
                <span className="k-text-muted">No active collection offers.</span>
            </div>
        )
    }

    return (
        <div className="floor-offers-list" data-testid="floor-offers-list">
            <div className="floor-offers-header">
                <h3 style={{ fontSize: "14px", fontWeight: 600, margin: "0 0 12px 0" }}>Executable Depth</h3>
            </div>
            <div className="floor-offers-grid" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {offers.map(offer => (
                    <div key={offer.buyer} className="k-card floor-offer-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px", border: "1px solid var(--color-border-subtle)" }}>
                        <div className="offer-info">
                            <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-primary)", display: "block" }}>
                                {formatGnotCompact(BigInt(offer.priceUgnot))} GNOT
                            </span>
                            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                                by {offer.buyer.slice(0, 8)}...
                            </span>
                        </div>
                        <div className="offer-action">
                            {adena.connected && offer.buyer !== adena.address ? (
                                <button 
                                    className="k-btn k-btn--secondary k-btn--sm"
                                    onClick={() => onAcceptRequest?.(offer)}
                                >
                                    Accept Offer
                                </button>
                            ) : (
                                <button className="k-btn k-btn--disabled k-btn--sm" disabled>
                                    {offer.buyer === adena.address ? "Your Offer" : "Accept"}
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
