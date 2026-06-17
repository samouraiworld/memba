/**
 * CollectionStatsBar — Collection header metrics strip.
 * Fetches from GetNFTCollection endpoint; falls back to on-chain data.
 */

import { useState, useEffect } from "react"
import { fetchNFTCollection, type NFTCollectionStats } from "../../lib/nftApi"
import { formatGnot } from "../../lib/format"
import type { NFTCollectionV2 } from "../../lib/grc721"

interface Props {
    collectionId: string
    /** On-chain fallback collection info */
    fallback?: NFTCollectionV2 | null
    /** On-chain listings count fallback */
    onChainListingCount?: number
    onRoyaltyBpsChange?: (bps: number) => void
}

export function CollectionStatsBar({ collectionId, fallback, onChainListingCount, onRoyaltyBpsChange }: Props) {
    const [stats, setStats] = useState<NFTCollectionStats | null>(null)

    useEffect(() => {
        let cancelled = false
        fetchNFTCollection(collectionId).then(s => {
            if (!cancelled && s) {
                setStats(s)
                if (onRoyaltyBpsChange) onRoyaltyBpsChange(Number(s.royaltyBps))
            }
        })
        return () => { cancelled = true }
    }, [collectionId, onRoyaltyBpsChange])

    const royaltyBps = stats ? Number(stats.royaltyBps) : (fallback?.royaltyBPS ?? 0)
    const royaltyPct = royaltyBps > 0 ? `${(royaltyBps / 100).toFixed(2).replace(/\.?0+$/, "")}%` : null

    const items: { label: string; value: string }[] = stats
        ? [
            { label: "Floor", value: stats.floorPriceUgnot > 0n ? formatGnot(stats.floorPriceUgnot) : "—" },
            { label: "Volume", value: stats.totalVolumeUgnot > 0n ? formatGnot(stats.totalVolumeUgnot) : "—" },
            { label: "Items", value: String(stats.supply) },
            { label: "Listed", value: String(stats.activeListings) },
        ]
        : fallback
            ? [
                { label: "Items", value: String(fallback.totalSupply) },
                { label: "Listed", value: onChainListingCount != null ? String(onChainListingCount) : "—" },
            ]
            : []

    if (items.length === 0) return null

    return (
        <div className="nft-stats-bar">
            {items.map(item => (
                <div key={item.label} className="nft-stats-bar__stat">
                    <span className="nft-stats-bar__value">{item.value}</span>
                    <span className="nft-stats-bar__label">{item.label}</span>
                </div>
            ))}
            {royaltyPct && (
                <div className="nft-stats-bar__royalty" title={`${royaltyPct} goes to the creator on every sale — enforced atomically in the gno.land realm; no marketplace can bypass it.`}>
                    <span className="nft-royalty-enforced-icon">⬡</span>
                    {royaltyPct} royalty enforced on-chain
                </div>
            )}
        </div>
    )
}
