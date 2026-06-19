/**
 * PriceBreakdown.test.tsx — Tests for the PriceBreakdown component.
 *
 * Task 2: Pure presentational component that displays price breakdown rows:
 * Price, Platform fee (with %), Creator royalty, Seller receives.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PriceBreakdown } from "./PriceBreakdown"

describe("PriceBreakdown", () => {
    it("computes and displays correct breakdown for priceUgnot=2_000_000, feeBps=200, royaltyBps=500", () => {
        const priceUgnot = 2_000_000
        const feeBps = 200 // 2.0%
        const royaltyBps = 500 // 5.0%

        // Expected computation:
        // platformFee = Math.floor(2_000_000 * 200 / 10000) = Math.floor(40000) = 40000 ugnot = 0.04 GNOT
        // royaltyFee = Math.floor(2_000_000 * 500 / 10000) = Math.floor(100000) = 100000 ugnot = 0.1 GNOT
        // sellerReceives = 2_000_000 - 40000 - 100000 = 1_860_000 ugnot = 1.86 GNOT

        render(<PriceBreakdown priceUgnot={priceUgnot} feeBps={feeBps} royaltyBps={royaltyBps} />)

        // Check that all rows are rendered with correct labels
        expect(screen.getByText("Price")).toBeInTheDocument()
        expect(screen.getByText(/Creator Royalty/)).toBeInTheDocument()
        expect(screen.getByText("Seller Receives")).toBeInTheDocument()

        // Check platform fee shows fee % in label
        expect(screen.getByText(/Platform Fee/)).toBeInTheDocument()
        expect(screen.getByText(/2\.0%/)).toBeInTheDocument()

        // Check exact amounts rendered: "0.04 GNOT", "0.1 GNOT", "1.86 GNOT", "2 GNOT"
        expect(screen.getByText("2 GNOT")).toBeInTheDocument() // Price
        expect(screen.getByText("0.04 GNOT")).toBeInTheDocument() // Platform fee
        expect(screen.getByText("0.1 GNOT")).toBeInTheDocument() // Royalty
        expect(screen.getByText("1.86 GNOT")).toBeInTheDocument() // Seller receives
    })

    it("handles zero fees correctly", () => {
        render(<PriceBreakdown priceUgnot={1_000_000} feeBps={0} royaltyBps={0} />)

        expect(screen.getByText("Price")).toBeInTheDocument()
        expect(screen.getByText(/Platform Fee/)).toBeInTheDocument()
        expect(screen.getByText("Seller Receives")).toBeInTheDocument()
        expect(screen.getAllByText("1 GNOT")).toHaveLength(2) // Price and Seller receives (both 1 GNOT)
        expect(screen.getAllByText("0 GNOT")).toHaveLength(2) // Platform fee and Creator royalty (both 0 GNOT)
    })

    it("displays fee percentages correctly in labels", () => {
        render(<PriceBreakdown priceUgnot={1_000_000} feeBps={250} royaltyBps={1000} />)

        // feeBps 250 = 2.5%, royaltyBps 1000 = 10%
        expect(screen.getByText(/2\.5%/)).toBeInTheDocument()
        expect(screen.getByText(/10\.0%/)).toBeInTheDocument()
    })
})
