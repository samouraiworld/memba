/**
 * tokenOtcToCard.test.ts — live OTC listing → CardModel (marketplace-v2 Phase 7.3).
 */
import { describe, it, expect } from "vitest"
import { tokenOtcToCard } from "./tokenOtcToCard"
import type { OtcListing } from "../codec"

const listing: OtcListing = {
    id: "7",
    seller: "g1seller000000000000000000000000000000z",
    symbol: "FORGE",
    expectedUnitPrice: 1_500_000n,
    amountAvailable: 1_200_000_000n,
}

describe("tokenOtcToCard", () => {
    it("maps an OTC listing to a token CardModel", () => {
        const c = tokenOtcToCard(listing, "test13")
        expect(c.lane).toBe("token")
        expect(c.title).toBe("FORGE")
        expect(c.seller.address).toBe(listing.seller)
        expect(c.seller.reputation).toBeNull()
        expect(c.priceLabel).toBe("1.5 GNOT/ea")
        expect(c.priceLabel).not.toMatch(/GNOT\s+GNOT/) // no doubled unit
        expect(c.stats.some((s) => s.label === "Available")).toBe(true)
        expect(c.href).toBe("/test13/tokens/FORGE")
    })

    it("does not mark OTC listings verified (no curation flag on OTC)", () => {
        expect(tokenOtcToCard(listing, "test13").verified).toBe(false)
    })
})
