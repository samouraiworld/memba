/**
 * PriceBreakdown.tsx — Pure presentational component for NFT price breakdown.
 *
 * Task 2: Displays a price breakdown with:
 * - Price (priceUgnot in GNOT)
 * - Platform fee (with percentage)
 * - Creator royalty
 * - Seller receives
 *
 * Imports its own PriceBreakdown.css for layout and token-based styling.
 */

import { formatGnotCompact } from "../../lib/formatGnot"
import "./PriceBreakdown.css"

interface PriceBreakdownProps {
    priceUgnot: number
    feeBps: number // basis points (e.g., 200 = 2.0%)
    royaltyBps: number // basis points (e.g., 500 = 5.0%)
}

export function PriceBreakdown({ priceUgnot, feeBps, royaltyBps }: PriceBreakdownProps) {
    // Pure derivation (mirror existing modals)
    const platformFee = Math.floor((priceUgnot * feeBps) / 10000)
    const royaltyFee = Math.floor((priceUgnot * royaltyBps) / 10000)
    const sellerReceives = priceUgnot - platformFee - royaltyFee

    // Compute percentages for display
    const feePercent = (feeBps / 100).toFixed(1)
    const royaltyPercent = (royaltyBps / 100).toFixed(1)

    return (
        <div className="price-breakdown">
            <div className="price-breakdown__row">
                <span>Price</span>
                <span>{formatGnotCompact(priceUgnot)}</span>
            </div>
            <div className="price-breakdown__row price-breakdown__row--fee">
                <span>Platform Fee ({feePercent}%)</span>
                <span>{formatGnotCompact(platformFee)}</span>
            </div>
            <div className="price-breakdown__row price-breakdown__row--fee">
                <span>Creator Royalty ({royaltyPercent}%)</span>
                <span>{formatGnotCompact(royaltyFee)}</span>
            </div>
            <div className="price-breakdown__row price-breakdown__row--seller price-breakdown__row--total">
                <span>Seller Receives</span>
                <span>{formatGnotCompact(sellerReceives)}</span>
            </div>
        </div>
    )
}
