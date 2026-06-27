import { describe, it, expect } from "vitest"
import { toUnifiedNftListings, type NftAdapterInput } from "./nftAdapter"
import type { V3ListingMap } from "../v3TokenGrid"
import { PLATFORM_FEE_BPS_V3 } from "../nftConfig"

const COLLECTION = "alice/cats"
const ME = "g1viewer"
const OTHER = "g1other"

function makeInput(over: Partial<NftAdapterInput> = {}): NftAdapterInput {
    const listings: V3ListingMap = new Map([
        [`${COLLECTION}/1`, { priceUgnot: 124_000_000, seller: "g1trunc..." }],
    ])
    return {
        collectionID: COLLECTION,
        tokens: [
            { tokenId: "0", owner: ME, uri: "ipfs://0" }, // owned, unlisted
            { tokenId: "1", owner: OTHER, uri: "ipfs://1" }, // listed by other
            { tokenId: "2", owner: OTHER, uri: "ipfs://2" }, // unlisted, not owned
        ],
        listings,
        me: ME,
        verified: true,
        royaltyBps: 500,
        ...over,
    }
}

describe("toUnifiedNftListings", () => {
    it("maps every token to a UnifiedNft with stable id + engine paths", () => {
        const out = toUnifiedNftListings(makeInput())
        expect(out).toHaveLength(3)
        expect(out[0].id).toBe("alice/cats/0")
        expect(out.every((l) => l.assetType === "nft")).toBe(true)
        expect(out[0].engine.path).toContain("memba_nft_market_v3")
    })

    it("owned UNLISTED token → list action, zero price", () => {
        const out = toUnifiedNftListings(makeInput())
        const owned = out.find((l) => l.id === "alice/cats/0")!
        expect(owned.actions).toEqual(["list"])
        expect(owned.price.amount).toBe(0n)
        expect(owned.seller).toBe(ME) // full owner address
    })

    it("owned LISTED token → delist (owner must be able to remove their listing)", () => {
        const listings: V3ListingMap = new Map([[`${COLLECTION}/0`, { priceUgnot: 50_000_000, seller: ME }]])
        const out = toUnifiedNftListings(makeInput({ listings }))
        const owned = out.find((l) => l.id === "alice/cats/0")!
        expect(owned.actions).toEqual(["delist"])
    })

    it("a 0-price listing is NOT buyable → offer only (no broken buy button)", () => {
        const listings: V3ListingMap = new Map([[`${COLLECTION}/1`, { priceUgnot: 0, seller: "g1trunc..." }]])
        const out = toUnifiedNftListings(makeInput({ listings }))
        const t1 = out.find((l) => l.id === "alice/cats/1")!
        expect(t1.actions).toEqual(["offer"])
        expect(t1.price.amount).toBe(0n)
    })

    it("listed token owned by another → buy + offer, real price, full seller", () => {
        const out = toUnifiedNftListings(makeInput())
        const listed = out.find((l) => l.id === "alice/cats/1")!
        expect(listed.actions).toEqual(["buy", "offer"])
        expect(listed.price.amount).toBe(124_000_000n)
        // seller is the on-chain owner (full), NOT the render's truncated value
        expect(listed.seller).toBe(OTHER)
    })

    it("unlisted token not owned → offer only", () => {
        const out = toUnifiedNftListings(makeInput())
        const unlisted = out.find((l) => l.id === "alice/cats/2")!
        expect(unlisted.actions).toEqual(["offer"])
        expect(unlisted.price.amount).toBe(0n)
    })

    it("passes through verified + royalty, and defaults feeBps to the v3 constant", () => {
        const out = toUnifiedNftListings(makeInput())
        expect(out[0].verified).toBe(true)
        expect(out[0].royaltyBps).toBe(500)
        expect(out[0].feeBps).toBe(PLATFORM_FEE_BPS_V3)
    })

    it("uses the chain-read feeBps when provided (per-lane fee from config)", () => {
        const out = toUnifiedNftListings(makeInput({ feeBps: 50 }))
        expect(out[0].feeBps).toBe(50)
    })

    it("a disconnected viewer owns nothing → listed tokens still buyable, owned-by-me gone", () => {
        const out = toUnifiedNftListings(makeInput({ me: "" }))
        // token 0 is owned by ME, but me="" so it is not 'owned' → offer only
        expect(out.find((l) => l.id === "alice/cats/0")!.actions).toEqual(["offer"])
        expect(out.find((l) => l.id === "alice/cats/1")!.actions).toEqual(["buy", "offer"])
    })
})
