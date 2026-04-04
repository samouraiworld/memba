/**
 * NFTActivityFeed — Recent sales and marketplace activity.
 *
 * Fetches and displays recent sales from the marketplace realm's
 * Render("sales") output.
 *
 * @module components/nft/NFTActivityFeed
 */

import { useState, useEffect } from "react"
import { parseSalesRender, type NFTSale } from "../../lib/nftMarketplace"
import { queryRender } from "../../lib/dao/shared"
import { GNO_RPC_URL } from "../../lib/config"
import { NFT_NFT_MARKETPLACE_PATH } from "../../lib/nftConfig"

export function NFTActivityFeed() {
    const [sales, setSales] = useState<NFTSale[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            try {
                const raw = await queryRender(GNO_RPC_URL, NFT_MARKETPLACE_PATH, "sales")
                if (!cancelled && raw) {
                    setSales(parseSalesRender(raw))
                }
            } catch {
                // Realm may not be deployed yet
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [])

    if (loading) {
        return <div className="nft-activity"><p className="nft-activity__loading">Loading activity...</p></div>
    }

    if (sales.length === 0) {
        return (
            <div className="nft-activity">
                <p className="nft-activity__empty">No sales yet. Be the first to trade!</p>
            </div>
        )
    }

    return (
        <div className="nft-activity">
            <div className="nft-activity__list">
                {sales.map(sale => (
                    <div key={sale.saleId} className="nft-activity__item">
                        <span className="nft-activity__icon">💰</span>
                        <div className="nft-activity__detail">
                            <span className="nft-activity__token">
                                {sale.collection} / {sale.tokenId}
                            </span>
                            <span className="nft-activity__price">{sale.priceFormatted}</span>
                        </div>
                        <div className="nft-activity__parties">
                            <span>{sale.seller} → {sale.buyer}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
