/**
 * foundingSupply.seed.test.ts — invariants for the Founding-Supply seed catalog
 * (marketplace-v2 Phase 0.4). Guards the counts and the trust invariants so the
 * seed can safely drive fixtures now and convert to real on-chain listings later.
 */
import { describe, it, expect } from "vitest"
import { seedNfts, seedServices, seedTokens, foundingSupply } from "./foundingSupply.seed"

describe("Founding-Supply seed catalog", () => {
    it("has the required counts per lane", () => {
        expect(seedNfts).toHaveLength(12)
        expect(seedServices).toHaveLength(12)
        expect(seedTokens).toHaveLength(10)
        expect(foundingSupply.nft).toBe(seedNfts)
        expect(foundingSupply.service).toBe(seedServices)
        expect(foundingSupply.token).toBe(seedTokens)
    })

    it("never fabricates reviews (rating + reviewsCount are null everywhere)", () => {
        for (const l of [...seedNfts, ...seedServices, ...seedTokens]) {
            expect(l.rating).toBeNull()
            expect(l.reviewsCount).toBeNull()
        }
    })

    it("uses stable slug ids and well-formed g1 addresses", () => {
        const all = [...seedNfts, ...seedServices, ...seedTokens]
        const ids = new Set<string>()
        for (const l of all) {
            expect(l.id).toMatch(/^[a-z0-9-]+$/)
            expect(ids.has(l.id)).toBe(false)
            ids.add(l.id)
            expect(l.seller.address).toMatch(/^g1[a-z0-9]{6,}$/)
        }
    })

    it("keeps NFT royalties within the 10% cap", () => {
        for (const n of seedNfts) {
            expect(n.royaltyBps).toBeGreaterThanOrEqual(0)
            expect(n.royaltyBps).toBeLessThanOrEqual(1000)
        }
    })

    it("gives every service three tiered packages", () => {
        for (const s of seedServices) {
            expect(s.packages).toHaveLength(3)
            expect(s.packages.map((p) => p.name)).toEqual(["Basic", "Standard", "Premium"])
        }
    })
})
