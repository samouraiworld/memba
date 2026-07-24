/**
 * tokenOtcToCard.test.ts — live OTC listing → CardModel (marketplace-v2 Phase 7.3).
 */
import { describe, it, expect } from "vitest"
import { tokenOtcToCard } from "./tokenOtcToCard"
import type { OtcListing } from "../codec"

// expectedUnitPrice is ugnot PER BASE UNIT, not per whole token (T3.2) — the
// card must scale it up by 10^decimals before display.
const listing: OtcListing = {
    id: "7",
    seller: "g1seller000000000000000000000000000000z",
    symbol: "FORGE",
    expectedUnitPrice: 1_500_000n,
    amountAvailable: 1_200_000_000n,
}

describe("tokenOtcToCard", () => {
    it("maps an OTC listing to a token CardModel, scaling amount/price by decimals", () => {
        const c = tokenOtcToCard(listing, "test13", 6)
        expect(c.lane).toBe("token")
        expect(c.title).toBe("FORGE")
        expect(c.seller.address).toBe(listing.seller)
        expect(c.seller.reputation).toBeNull()
        expect(c.priceLabel).not.toMatch(/GNOT\s+GNOT/) // no doubled unit
        // Available: 1_200_000_000n base units / 10^6 decimals = 1200 whole tokens.
        expect(c.stats.find((s) => s.label === "Available")?.value).toBe("1200 FORGE")
        expect(c.href).toBe("/test13/tokens/FORGE")
    })

    it("does not mark OTC listings verified (no curation flag on OTC)", () => {
        expect(tokenOtcToCard(listing, "test13", 6).verified).toBe(false)
    })

    it("a 0-decimal token displays amount/price unscaled (no phantom precision)", () => {
        const zeroDec: OtcListing = { ...listing, expectedUnitPrice: 2n, amountAvailable: 50n }
        const c = tokenOtcToCard(zeroDec, "test13", 0)
        expect(c.stats.find((s) => s.label === "Available")?.value).toBe("50 FORGE")
        expect(c.priceLabel).toBe("0.000002 GNOT/ea")
    })
})
