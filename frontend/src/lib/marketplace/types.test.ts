import { describe, it, expect } from "vitest"
import {
    isNftListing,
    isServiceListing,
    isTokenListing,
    isAgentListing,
    type UnifiedListing,
    type UnifiedNft,
    type UnifiedService,
} from "./types"

const baseEngine = { path: "gno.land/r/samcrew/x", addr: "g1x" }

const nft: UnifiedNft = {
    assetType: "nft",
    id: "alice/cats/7",
    title: "Cat #7",
    verified: true,
    seller: "g1seller",
    feeBps: 200,
    source: "chain",
    engine: baseEngine,
    price: { amount: 124_000_000n, denom: "ugnot" },
    royaltyBps: 500,
    actions: ["buy", "offer"],
}

const service: UnifiedService = {
    assetType: "service",
    id: "svc-1",
    title: "Realm audit",
    verified: false,
    seller: "g1freelancer",
    feeBps: 200,
    source: "backend",
    engine: baseEngine,
    milestones: [
        { title: "Scope", amount: 100_000_000n },
        { title: "Delivery", amount: 400_000_000n },
    ],
    actions: ["hire", "fund", "release", "dispute"],
}

describe("UnifiedListing type guards", () => {
    it("narrows nft listings", () => {
        const l: UnifiedListing = nft
        expect(isNftListing(l)).toBe(true)
        expect(isServiceListing(l)).toBe(false)
        if (isNftListing(l)) {
            // narrowed: nft-only fields are accessible + typed
            expect(l.price.amount).toBe(124_000_000n)
            expect(l.royaltyBps).toBe(500)
        }
    })

    it("narrows service listings to milestones (not a unit price)", () => {
        const l: UnifiedListing = service
        expect(isServiceListing(l)).toBe(true)
        expect(isNftListing(l)).toBe(false)
        if (isServiceListing(l)) {
            expect(l.milestones).toHaveLength(2)
            expect(l.milestones[1].amount).toBe(400_000_000n)
        }
    })

    it("guards are mutually exclusive over the union", () => {
        for (const l of [nft, service] as UnifiedListing[]) {
            const hits = [isNftListing(l), isServiceListing(l), isTokenListing(l), isAgentListing(l)].filter(
                Boolean,
            )
            expect(hits).toHaveLength(1)
        }
    })
})
