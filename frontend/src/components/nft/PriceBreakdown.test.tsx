/**
 * PriceBreakdown.test.tsx — the buyer-first price breakdown (marketplace-v2 Phase 1.5c).
 *
 * Leads with the all-in "You pay" total (the buyer pays exactly the listed price;
 * platform fee + creator royalty come out of the SELLER's proceeds). The fee/royalty/
 * seller rows are informational ("where it goes"), plus a no-refund recourse line.
 */

import { describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { PriceBreakdown } from "./PriceBreakdown"

describe("PriceBreakdown", () => {
    it("leads with the all-in 'You pay' total and shows where the payment goes", () => {
        const priceUgnot = 2_000_000
        const feeBps = 200 // 2.0%
        const royaltyBps = 500 // 5.0%

        // platformFee = 40000 (0.04 GNOT); royaltyFee = 100000 (0.1 GNOT);
        // sellerReceives = 1_860_000 (1.86 GNOT); buyer all-in = price = 2 GNOT.
        render(<PriceBreakdown priceUgnot={priceUgnot} feeBps={feeBps} royaltyBps={royaltyBps} />)

        // Headline: the buyer's all-in cost.
        expect(screen.getByText("You pay")).toBeInTheDocument()
        expect(screen.getByText("2 GNOT")).toBeInTheDocument() // unique — only the You-pay total

        // Informational breakdown.
        expect(screen.getByText(/Platform Fee/)).toBeInTheDocument()
        expect(screen.getByText(/2\.0%/)).toBeInTheDocument()
        expect(screen.getByText(/Creator Royalty/)).toBeInTheDocument()
        expect(screen.getByText("Seller Receives")).toBeInTheDocument()
        expect(screen.getByText("0.04 GNOT")).toBeInTheDocument() // platform fee
        expect(screen.getByText("0.1 GNOT")).toBeInTheDocument() // royalty
        expect(screen.getByText("1.86 GNOT")).toBeInTheDocument() // seller receives

        // Honest recourse copy (CTO review #5).
        expect(screen.getByText(/no refunds/i)).toBeInTheDocument()
    })

    it("handles zero fees correctly", () => {
        const { container } = render(<PriceBreakdown priceUgnot={1_000_000} feeBps={0} royaltyBps={0} />)
        const view = within(container)

        expect(view.getByText("You pay")).toBeInTheDocument()
        expect(view.getByText("Seller Receives")).toBeInTheDocument()
        // You-pay total and Seller-receives are both 1 GNOT when there are no fees.
        expect(view.getAllByText("1 GNOT")).toHaveLength(2)
        expect(view.getAllByText("0 GNOT")).toHaveLength(2) // platform fee + royalty
    })

    it("displays fee percentages correctly in labels", () => {
        render(<PriceBreakdown priceUgnot={1_000_000} feeBps={250} royaltyBps={1000} />)
        expect(screen.getByText(/2\.5%/)).toBeInTheDocument()
        expect(screen.getByText(/10\.0%/)).toBeInTheDocument()
    })
})
