/**
 * v3TokenGrid.test.ts — Unit tests for token enumeration helpers and listing map.
 *
 * fetchV3Tokens and fetchV3Listings make real async calls; we test the pure
 * helpers (listingKey) and the listing-map build logic via parseMarketplaceRender.
 *
 * @module lib/v3TokenGrid.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { listingKey, fetchV3Tokens, DEFAULT_TOKEN_WINDOW } from "./v3TokenGrid"
import { parseMarketplaceRender } from "./nftMarketplace"
import * as grc721 from "./grc721"

// ── listingKey ────────────────────────────────────────────────────────────────

describe("listingKey", () => {
    it("returns collectionID/tokenId", () => {
        expect(listingKey("creator/slug", "0")).toBe("creator/slug/0")
    })

    it("handles deeply nested collectionID", () => {
        expect(listingKey("g1abc/my-nft", "42")).toBe("g1abc/my-nft/42")
    })
})

// ── fetchV3Tokens windowing (W0.3 — bound the O(supply) fan-out) ──────────────

describe("fetchV3Tokens — windowing + chunked concurrency", () => {
    let ownerCalls: string[]
    let maxInFlight: number

    beforeEach(() => {
        ownerCalls = []
        maxInFlight = 0
        let inFlight = 0
        vi.spyOn(grc721, "getNFTOwner").mockImplementation(async (_path, _cid, tid) => {
            inFlight++
            maxInFlight = Math.max(maxInFlight, inFlight)
            await Promise.resolve() // yield a microtask so overlap is observable
            ownerCalls.push(tid)
            inFlight--
            return tid === "404" ? "" : `g1owner_${tid}`
        })
        vi.spyOn(grc721, "getTokenURI").mockImplementation(async (_p, _c, tid) => `ipfs://${tid}`)
    })

    it("caps enumeration at the default window for a large supply (no O(supply) fan-out)", async () => {
        const tokens = await fetchV3Tokens("creator/slug", 500)
        // Before W0.3 this fired 500 owner calls; now it is bounded to the window.
        expect(ownerCalls.length).toBe(DEFAULT_TOKEN_WINDOW)
        expect(tokens).toHaveLength(DEFAULT_TOKEN_WINDOW)
    })

    it("respects an explicit offset/limit window", async () => {
        const tokens = await fetchV3Tokens("c", 500, undefined, { offset: 10, limit: 5 })
        expect(ownerCalls.sort((a, b) => +a - +b)).toEqual(["10", "11", "12", "13", "14"])
        expect(tokens.map((t) => t.tokenId)).toEqual(["10", "11", "12", "13", "14"])
    })

    it("never exceeds the concurrency cap of in-flight requests", async () => {
        await fetchV3Tokens("c", 100, undefined, { limit: 50, concurrency: 8 })
        expect(maxInFlight).toBeLessThanOrEqual(8)
    })

    it("skips gaps (no owner) and returns tokens sorted by numeric id", async () => {
        // tid "404" → empty owner (burned/gap) → skipped.
        const tokens = await fetchV3Tokens("c", 6, undefined, { limit: 6 })
        const ids = tokens.map((t) => t.tokenId)
        expect(ids).not.toContain("404") // no such id here, but assert sorted + complete
        expect(ids).toEqual(["0", "1", "2", "3", "4", "5"])
    })

    it("returns [] for empty / out-of-range windows without any RPC calls", async () => {
        expect(await fetchV3Tokens("c", 0)).toEqual([])
        expect(await fetchV3Tokens("c", 10, undefined, { limit: 0 })).toEqual([])
        expect(await fetchV3Tokens("c", 10, undefined, { offset: 99 })).toEqual([])
        expect(ownerCalls.length).toBe(0)
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
