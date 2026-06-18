/**
 * v3TokenGrid.test.ts — Unit tests for token enumeration helpers and listing map.
 *
 * fetchV3Tokens and fetchV3Listings make real async calls; we test the pure
 * helpers (listingKey) and the listing-map build logic via parseMarketplaceRender.
 *
 * @module lib/v3TokenGrid.test
 */

import { describe, it, expect } from "vitest"
import { listingKey } from "./v3TokenGrid"
import { parseMarketplaceRender } from "./nftMarketplace"

// ── listingKey ────────────────────────────────────────────────────────────────

describe("listingKey", () => {
    it("returns collectionID/tokenId", () => {
        expect(listingKey("creator/slug", "0")).toBe("creator/slug/0")
    })

    it("handles deeply nested collectionID", () => {
        expect(listingKey("g1abc/my-nft", "42")).toBe("g1abc/my-nft/42")
    })
})

// ── listing map build logic (via parseMarketplaceRender) ─────────────────────

describe("fetchV3Listings — listing map build logic", () => {
    const RENDER_OUTPUT = `
## NFT Marketplace v3

**Active Listings:** 2

| # | Collection | Token | Price | Seller |
|---|-----------|-------|-------|--------|
| 1 | creator/slug | 0 | 1.500000 GNOT | g1seller1234 |
| 2 | creator/slug | 3 | 0.500000 GNOT | g1seller5678 |
| 3 | other/collection | 1 | 2.000000 GNOT | g1sellerother |
`

    it("parses v3 render output into listings", () => {
        const { listings } = parseMarketplaceRender(RENDER_OUTPUT)
        expect(listings).toHaveLength(3)
    })

    it("builds a map filtered to collectionID", () => {
        const { listings } = parseMarketplaceRender(RENDER_OUTPUT)
        const collectionID = "creator/slug"
        const map = new Map<string, { priceUgnot: number; seller: string }>()
        for (const l of listings) {
            if (l.nftRealm === collectionID) {
                map.set(listingKey(collectionID, l.tokenId), {
                    priceUgnot: l.priceUgnot,
                    seller: l.seller,
                })
            }
        }
        expect(map.size).toBe(2)
        expect(map.has(listingKey("creator/slug", "0"))).toBe(true)
        expect(map.has(listingKey("creator/slug", "3"))).toBe(true)
        expect(map.has(listingKey("other/collection", "1"))).toBe(false)
    })

    it("converts GNOT price to ugnot correctly", () => {
        const { listings } = parseMarketplaceRender(RENDER_OUTPUT)
        const listing = listings.find((l) => l.tokenId === "0")
        // 1.500000 GNOT = 1*1_000_000 + 500_000 = 1_500_000 ugnot
        expect(listing?.priceUgnot).toBe(1_500_000)
    })

    it("maps seller address correctly", () => {
        const { listings } = parseMarketplaceRender(RENDER_OUTPUT)
        const listing = listings.find((l) => l.tokenId === "0")
        expect(listing?.seller).toBe("g1seller1234")
    })
})
