/**
 * seedToCard.test.ts — Founding-Supply seed → CardModel adapters (marketplace-v2 Phase 2).
 * These drive the design fixtures now; the same CardModel target is produced from real
 * UnifiedListings later. Uses the real seed data as fixtures.
 */
import { describe, it, expect } from "vitest"
import { seedNftToCard, seedServiceToCard, seedTokenToCard } from "./seedToCard"
import { seedNfts, seedServices, seedTokens } from "../seed/foundingSupply.seed"

describe("seedToCard adapters", () => {
    it("maps an NFT seed to a CardModel with floor stats + price", () => {
        const c = seedNftToCard(seedNfts[0])
        expect(c.lane).toBe("nft")
        expect(c.title.length).toBeGreaterThan(0)
        expect(c.priceLabel).toMatch(/GNOT/)
        expect(c.seller.address).toBe(seedNfts[0].seller.address)
        expect(c.stats.some((s) => s.label === "Floor")).toBe(true)
    })

    it("maps a service seed with a 'From <price>' label", () => {
        const c = seedServiceToCard(seedServices[0])
        expect(c.lane).toBe("service")
        expect(c.priceLabel).toMatch(/^From .*GNOT/)
    })

    it("maps a token seed with a per-unit price", () => {
        const c = seedTokenToCard(seedTokens[0])
        expect(c.lane).toBe("token")
        expect(c.priceLabel).toMatch(/\/ea$/)
    })

    it("NEVER emits fabricated reputation for any seed row", () => {
        const all = [
            ...seedNfts.map(seedNftToCard),
            ...seedServices.map(seedServiceToCard),
            ...seedTokens.map(seedTokenToCard),
        ]
        for (const c of all) {
            expect(c.seller.reputation).toBeNull()
            expect(c.media.kind === "art" || c.media.kind === "monogram").toBe(true)
        }
    })
})
