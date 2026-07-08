/**
 * nftToCard.test.ts — live NFT collection → CardModel (marketplace-v2 Phase 7.1).
 */
import { describe, it, expect } from "vitest"
import { nftToCard } from "./nftToCard"
import type { HubCollection } from "../../nftHub"

const col: HubCollection = {
    id: "gnomes/genesis",
    name: "Gnomes Genesis",
    creator: "g1abcdef0000000000000000000000000000wxyz",
    slug: "genesis",
    verified: true,
    floorUgnot: 12_000_000n,
    volumeUgnot: 3_100_000_000n,
}

describe("nftToCard", () => {
    it("maps a HubCollection to a CardModel", () => {
        const c = nftToCard(col, "test13")
        expect(c.lane).toBe("nft")
        expect(c.title).toBe("Gnomes Genesis")
        expect(c.seller.address).toBe(col.creator)
        expect(c.href).toBe("/test13/nft/collection/gnomes/genesis")
        expect(c.stats.some((s) => s.label === "Floor")).toBe(true)
        expect(c.stats.some((s) => s.label === "Volume")).toBe(true)
        expect(c.priceLabel).toBe("12 GNOT")
        expect(c.priceLabel).not.toMatch(/GNOT\s+GNOT/) // no doubled unit
        expect(c.stats.find((s) => s.label === "Floor")?.value).not.toMatch(/GNOT\s+GNOT/)
        expect(c.priceValue).toBe(12_000_000)
    })

    it("reads verified from the authoritative collection flag, never fabricated reputation", () => {
        expect(nftToCard(col, "test13").verified).toBe(true)
        expect(nftToCard({ ...col, verified: false }, "test13").verified).toBe(false)
        expect(nftToCard(col, "test13").seller.reputation).toBeNull()
    })
})
