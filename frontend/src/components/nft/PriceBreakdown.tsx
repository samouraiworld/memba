/**
 * PriceBreakdown.tsx — buyer-first NFT price breakdown (marketplace-v2 Phase 1.5c).
 *
 * Leads with the all-in "You pay" total — the buyer pays exactly the listed price
 * (+ network gas); the platform fee and creator royalty are deducted from the
 * SELLER's proceeds. The fee/royalty/seller rows are shown as informational
 * ("where it goes"), followed by an honest no-refund recourse line.
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
            {/* Buyer's all-in cost is the headline. Platform fee + creator royalty are
                deducted from the SELLER's proceeds, so the buyer pays exactly the listed
                price (+ network gas). Leading with "Seller Receives" hid this. */}
            <div className="price-breakdown__row price-breakdown__row--total price-breakdown__youpay">
                <span>You pay</span>
                <span>{formatGnotCompact(priceUgnot)}</span>
            </div>
            <p className="price-breakdown__note">+ network gas fee</p>

            <div className="price-breakdown__where">Where it goes</div>
            <div className="price-breakdown__row price-breakdown__row--fee">
                <span>Platform Fee ({feePercent}%)</span>
                <span>{formatGnotCompact(platformFee)}</span>
            </div>
            <div className="price-breakdown__row price-breakdown__row--fee">
                <span>Creator Royalty ({royaltyPercent}%)</span>
                <span>{formatGnotCompact(royaltyFee)}</span>
            </div>
            <div className="price-breakdown__row price-breakdown__row--seller">
                <span>Seller Receives</span>
                <span>{formatGnotCompact(sellerReceives)}</span>
            </div>

            <p className="price-breakdown__recourse">On-chain sales are final — no refunds.</p>
        </div>
    )
}
