/**
 * NFTActivityFeed — Recent marketplace activity.
 * v2: reads from GetNFTActivity (backend indexer) with fallback to on-chain
 * Render("sales") when the endpoint is absent.
 *
 * Shows formatted GNOT, relative time, truncated addresses (copy on click),
 * kind (sale/offer-accepted), newest first.
 *
 * @module components/nft/NFTActivityFeed
 */

import { useState, useEffect } from "react"
import { fetchNFTActivity } from "../../lib/nftApi"
import { parseSalesRender } from "../../lib/nftMarketplace"
import { queryRender } from "../../lib/dao/shared"
import { GNO_RPC_URL } from "../../lib/config"
import { NFT_MARKETPLACE_PATH, DEFAULT_COLLECTION_ID } from "../../lib/nftConfig"
import { formatGnot, truncateAddr, relativeTime } from "../../lib/format"

type FeedItem = {
    id: string
    tokenId: string
    kind: string
    priceUgnot: bigint
    seller: string
    buyer: string
    createdAt: string
}

async function loadActivity(): Promise<FeedItem[]> {
    // 1. Try backend indexer
    const items = await fetchNFTActivity(DEFAULT_COLLECTION_ID, 50)
    if (items.length > 0) {
        return items.map(item => ({
            id: String(item.saleNo),
            tokenId: item.tokenId,
            kind: item.kind,
            priceUgnot: item.priceUgnot,
            seller: item.seller,
            buyer: item.buyer,
            createdAt: item.createdAt,
        }))
    }
    // 2. Fallback: on-chain Render("sales")
    try {
        const raw = await queryRender(GNO_RPC_URL, NFT_MARKETPLACE_PATH, "sales")
        if (raw) {
            const sales = parseSalesRender(raw)
            return sales.map(s => {
                // Parse "1.000000 GNOT" → ugnot bigint, with safe fallback
                const gnotMatch = s.priceFormatted.match(/([\d.]+)/)
                const gnot = gnotMatch ? parseFloat(gnotMatch[1]) : 0
                const ugnot = BigInt(Math.round(gnot * 1_000_000))
                return {
                    id: String(s.saleId),
                    tokenId: s.tokenId,
                    kind: "sale",
                    priceUgnot: ugnot,
                    seller: s.seller,
                    buyer: s.buyer,
                    createdAt: "",
                }
            })
        }
    } catch { /* ignore */ }
    return []
}

export function NFTActivityFeed() {
    const [items, setItems] = useState<FeedItem[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        loadActivity().then(data => {
            if (!cancelled) {
                setItems(data)
                setLoading(false)
            }
        })
        return () => { cancelled = true }
    }, [])

    const copyAddr = (addr: string) => {
        navigator.clipboard?.writeText(addr).catch(() => {})
    }

    if (loading) {
        return <div className="nft-activity"><p className="nft-activity__loading">Loading activity…</p></div>
    }

    if (items.length === 0) {
        return (
            <div className="nft-activity">
                <p className="nft-activity__empty">No sales yet. Be the first to trade!</p>
            </div>
        )
    }

    return (
        <div className="nft-activity">
            <div className="nft-activity__list">
                {items.map(item => (
                    <div key={item.id} className="nft-activity__item">
                        <span className="nft-activity__icon" title={item.kind}>
                            {item.kind === "offer-accepted" ? "🤝" : "💰"}
                        </span>
                        <div className="nft-activity__detail">
                            <span className="nft-activity__token">
                                Token #{item.tokenId}
                                {item.kind === "offer-accepted" && <span className="nft-activity__kind"> offer accepted</span>}
                            </span>
                            <span className="nft-activity__price">{formatGnot(item.priceUgnot)}</span>
                        </div>
                        <div className="nft-activity__parties">
                            <button
                                className="nft-addr-btn"
                                title={item.seller}
                                onClick={() => copyAddr(item.seller)}
                            >
                                {truncateAddr(item.seller)}
                            </button>
                            <span className="nft-activity__arrow">→</span>
                            <button
                                className="nft-addr-btn"
                                title={item.buyer}
                                onClick={() => copyAddr(item.buyer)}
                            >
                                {truncateAddr(item.buyer)}
                            </button>
                        </div>
                        {item.createdAt && (
                            <div className="nft-activity__time">{relativeTime(item.createdAt)}</div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
