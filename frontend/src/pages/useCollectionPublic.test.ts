/**
 * useCollectionPublic — unit tests.
 *
 * Covers:
 *  - Returns merged { detail, stats, tokens, listings, activity }
 *  - A token's listing is resolvable via listingKey(id, tokenId)
 *  - A rejected core load (fetchCollectionDetail) → loading=false + error set (no wedge)
 *  - Non-core failures (stats/activity) are graceful — hook still resolves
 *  - reload() re-runs the fetch
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { useCollectionPublic } from "./useCollectionPublic"
import { listingKey } from "../lib/v3TokenGrid"

// ── Constants ────────────────────────────────────────────────────────────────

const COL_ID = "creator/cool-nft"
const TOKEN_ID = "0"

const BASE_DETAIL = {
    id: COL_ID,
    creator: "g1samourai000000000000000000000000001",
    admin: "g1samourai000000000000000000000000001",
    name: "Cool NFT",
    symbol: "COOL",
    royaltyBps: 500,
    royaltyRecip: "g1samourai000000000000000000000000001",
    phase: 2,
    mintPrice: 1_000_000,
    payDenom: "ugnot",
    minted: 3,
    maxSupply: 100,
    paused: false,
}

const BASE_STATS = {
    name: "Cool NFT",
    symbol: "COOL",
    supply: 3n,
    floorPriceUgnot: 1_000_000n,
    totalVolumeUgnot: 5_000_000n,
    totalSales: 2n,
    activeListings: 1n,
    royaltyBps: 500n,
}

const BASE_TOKENS = [
    { tokenId: "0", owner: "g1owner000000000000000000000000000001", uri: "ipfs://token0" },
    { tokenId: "1", owner: "g1owner000000000000000000000000000002", uri: "ipfs://token1" },
    { tokenId: "2", owner: "g1owner000000000000000000000000000003", uri: "ipfs://token2" },
]

const BASE_LISTINGS = new Map([
    [listingKey(COL_ID, TOKEN_ID), { priceUgnot: 2_000_000, seller: "g1owner000000000000000000000000000001" }],
])

const BASE_ACTIVITY = [
    {
        saleNo: 1n,
        tokenId: "0",
        kind: "sale",
        priceUgnot: 2_000_000n,
        seller: "g1owner000000000000000000000000000001",
        buyer: "g1buyer00000000000000000000000000001",
        createdAt: "2024-01-01T00:00:00Z",
    },
]

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFetchCollectionDetail = vi.fn()
const mockFetchNFTCollection = vi.fn()
const mockFetchV3Tokens = vi.fn()
const mockFetchV3Listings = vi.fn()
const mockFetchNFTActivity = vi.fn()
const mockFetchOffersForToken = vi.fn()

vi.mock("../lib/marketplace/v3Reads", () => ({
    fetchOffersForToken: (...args: unknown[]) => mockFetchOffersForToken(...args),
}))

const mockIsCollectionVerified = vi.fn()

vi.mock("../lib/launchpadReads", () => ({
    fetchCollectionDetail: (...args: unknown[]) => mockFetchCollectionDetail(...args),
    isCollectionVerified: (...args: unknown[]) => mockIsCollectionVerified(...args),
}))

vi.mock("../lib/nftApi", () => ({
    fetchNFTCollection: (...args: unknown[]) => mockFetchNFTCollection(...args),
    fetchNFTActivity: (...args: unknown[]) => mockFetchNFTActivity(...args),
}))

vi.mock("../lib/v3TokenGrid", async (orig) => ({
    ...(await orig<typeof import("../lib/v3TokenGrid")>()),
    fetchV3Tokens: (...args: unknown[]) => mockFetchV3Tokens(...args),
    fetchV3Listings: (...args: unknown[]) => mockFetchV3Listings(...args),
}))

// tradeEngineFor is called at module level — stub it so it doesn't blow up in tests
vi.mock("../lib/tradeEngine", () => ({
    tradeEngineFor: () => ({
        engine: "v3",
        marketPath: "gno.land/r/memba/nft_market_v3",
        collectionPath: "gno.land/r/memba/collections",
        marketAddr: "g1market00000000000000000000000000001",
        feeBps: 250,
    }),
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

// Offers fire for listed tokens in every scenario (BASE_LISTINGS lists token "0"), so
// give a clean default for all tests; the offers-specific describe overrides it.
beforeEach(() => {
    mockFetchOffersForToken.mockReset()
    mockFetchOffersForToken.mockResolvedValue([])
    mockIsCollectionVerified.mockReset()
    mockIsCollectionVerified.mockResolvedValue(false)
})

describe("useCollectionPublic — happy path", () => {
    beforeEach(() => {
        mockFetchCollectionDetail.mockResolvedValue({ ...BASE_DETAIL })
        mockFetchNFTCollection.mockResolvedValue({ ...BASE_STATS })
        mockFetchV3Tokens.mockResolvedValue([...BASE_TOKENS])
        mockFetchV3Listings.mockResolvedValue(new Map(BASE_LISTINGS))
        mockFetchNFTActivity.mockResolvedValue([...BASE_ACTIVITY])
    })

    it("resolves with detail, stats, tokens, listings, activity", async () => {
        const { result } = renderHook(() => useCollectionPublic(COL_ID))

        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.error).toBeNull()
        expect(result.current.detail).toMatchObject({ id: COL_ID, minted: 3 })
        expect(result.current.stats).toMatchObject({ supply: 3n })
        expect(result.current.tokens).toHaveLength(3)
        expect(result.current.activity).toHaveLength(1)
    })

    it("a token's listing is resolvable via listingKey pattern", async () => {
        const { result } = renderHook(() => useCollectionPublic(COL_ID))

        await waitFor(() => expect(result.current.loading).toBe(false))

        // The Map key uses the real listingKey(collectionID, tokenId)
        const key = listingKey(COL_ID, TOKEN_ID)
        const listing = result.current.listings.get(key)

        expect(listing).toBeDefined()
        expect(listing?.priceUgnot).toBe(2_000_000)
        expect(listing?.seller).toBe("g1owner000000000000000000000000000001")

        // Pin arity/arg: fetchV3Listings must be called with (COL_ID, marketPath)
        expect(mockFetchV3Listings).toHaveBeenCalledWith(COL_ID, expect.any(String))
    })

    it("passes supply (minted) to fetchV3Tokens", async () => {
        const { result } = renderHook(() => useCollectionPublic(COL_ID))

        await waitFor(() => expect(result.current.loading).toBe(false))

        // supply = detail.minted = 3
        expect(mockFetchV3Tokens).toHaveBeenCalledWith(COL_ID, 3, expect.anything())
    })

    it("exposes the on-chain verified flag (true when the collection is verified)", async () => {
        mockIsCollectionVerified.mockResolvedValue(true)
        const { result } = renderHook(() => useCollectionPublic(COL_ID))
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.verified).toBe(true)
    })

    it("defaults verified to false when the read fails (never fabricates a badge)", async () => {
        mockIsCollectionVerified.mockRejectedValue(new Error("verify read down"))
        const { result } = renderHook(() => useCollectionPublic(COL_ID))
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.verified).toBe(false)
        expect(result.current.error).toBeNull()
    })
})

describe("useCollectionPublic — offers (every windowed token)", () => {
    // BASE_LISTINGS lists token "0"; BASE_TOKENS[1] (token "1") is owned by OWNER2, unlisted.
    const OWNER2 = "g1owner000000000000000000000000000002"

    beforeEach(() => {
        mockFetchCollectionDetail.mockResolvedValue({ ...BASE_DETAIL })
        mockFetchNFTCollection.mockResolvedValue({ ...BASE_STATS })
        mockFetchV3Tokens.mockResolvedValue([...BASE_TOKENS])
        mockFetchV3Listings.mockResolvedValue(new Map(BASE_LISTINGS))
        mockFetchNFTActivity.mockResolvedValue([...BASE_ACTIVITY])
        mockFetchOffersForToken.mockReset()
        mockFetchOffersForToken.mockResolvedValue([
            { buyer: "g1buyer00000000000000000000000000009", amountUgnot: 3_000_000, createdBlk: 100 },
        ])
    })

    it("reads offers for EVERY windowed token (owner accept · buyer badge · offerer's own)", async () => {
        // BASE_TOKENS has 3 tokens — all get an offer read so all three roles resolve,
        // incl. the offerer seeing their own standing offer on an unlisted token they
        // don't own (the previous listed∪owned scoping left the offerer blind).
        const { result } = renderHook(() => useCollectionPublic(COL_ID, OWNER2))
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(mockFetchOffersForToken).toHaveBeenCalledTimes(3)
        for (const tid of ["0", "1", "2"]) {
            expect(mockFetchOffersForToken).toHaveBeenCalledWith(COL_ID, tid, expect.any(String))
            expect(result.current.offers.get(tid)).toHaveLength(1)
        }
    })

    it("reads offers for all tokens even when logged out (buyer badges)", async () => {
        const { result } = renderHook(() => useCollectionPublic(COL_ID))
        await waitFor(() => expect(result.current.loading).toBe(false))

        // No viewer, but offers still power the public best-offer badges.
        expect(mockFetchOffersForToken).toHaveBeenCalledTimes(3)
        expect(result.current.offers.get("0")).toHaveLength(1)
    })

    it("a failed offer read degrades to no offers (never errors)", async () => {
        mockFetchOffersForToken.mockReset()
        mockFetchOffersForToken.mockRejectedValue(new Error("offers read down"))

        const { result } = renderHook(() => useCollectionPublic(COL_ID, OWNER2))
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.error).toBeNull()
        expect(result.current.offers.size).toBe(0)
    })
})

describe("useCollectionPublic — error handling", () => {
    it("rejected fetchCollectionDetail → loading=false and error set (no perpetual loader)", async () => {
        mockFetchCollectionDetail.mockRejectedValue(new Error("network error"))
        mockFetchNFTCollection.mockResolvedValue(null)
        mockFetchV3Listings.mockResolvedValue(new Map())
        mockFetchNFTActivity.mockResolvedValue([])

        const { result } = renderHook(() => useCollectionPublic(COL_ID))

        // Must NOT get stuck loading forever
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.error).not.toBeNull()
        expect(result.current.detail).toBeNull()
    })

    it("failed stats/activity fetch does not blank the whole hook", async () => {
        mockFetchCollectionDetail.mockResolvedValue({ ...BASE_DETAIL })
        // stats and activity fail — but these are resilient fetches
        mockFetchNFTCollection.mockResolvedValue(null)  // null = graceful degradation
        mockFetchV3Tokens.mockResolvedValue([...BASE_TOKENS])
        mockFetchV3Listings.mockResolvedValue(new Map(BASE_LISTINGS))
        mockFetchNFTActivity.mockResolvedValue([]) // [] = graceful degradation

        const { result } = renderHook(() => useCollectionPublic(COL_ID))

        await waitFor(() => expect(result.current.loading).toBe(false))

        // Core data still present; no error set from non-core failures
        expect(result.current.error).toBeNull()
        expect(result.current.detail).not.toBeNull()
        expect(result.current.stats).toBeNull()
        expect(result.current.tokens).toHaveLength(3)
        expect(result.current.activity).toHaveLength(0)
    })

    it("REJECTED stats/activity (not just null/[]) still degrade gracefully via .catch()", async () => {
        // This locks the .catch(() => null) / .catch(() => []) branches in the hook.
        // If those branches are removed, this test fails because the Promise.all rejects.
        mockFetchCollectionDetail.mockResolvedValue({ ...BASE_DETAIL })
        mockFetchNFTCollection.mockRejectedValue(new Error("stats down"))
        mockFetchV3Tokens.mockResolvedValue([...BASE_TOKENS])
        mockFetchV3Listings.mockResolvedValue(new Map(BASE_LISTINGS))
        mockFetchNFTActivity.mockRejectedValue(new Error("activity down"))

        const { result } = renderHook(() => useCollectionPublic(COL_ID))

        await waitFor(() => expect(result.current.loading).toBe(false))

        // Core still resolves; non-core rejections are swallowed by .catch()
        expect(result.current.error).toBeNull()
        expect(result.current.detail).not.toBeNull()
        expect(result.current.stats).toBeNull()
        expect(result.current.activity).toHaveLength(0)
        expect(result.current.loading).toBe(false)
    })
})

describe("useCollectionPublic — reload()", () => {
    beforeEach(() => {
        mockFetchCollectionDetail.mockResolvedValue({ ...BASE_DETAIL })
        mockFetchNFTCollection.mockResolvedValue({ ...BASE_STATS })
        mockFetchV3Tokens.mockResolvedValue([...BASE_TOKENS])
        mockFetchV3Listings.mockResolvedValue(new Map(BASE_LISTINGS))
        mockFetchNFTActivity.mockResolvedValue([...BASE_ACTIVITY])
    })

    it("reload() re-runs the fetch", async () => {
        mockFetchCollectionDetail.mockReset()
        mockFetchCollectionDetail.mockResolvedValue({ ...BASE_DETAIL })
        mockFetchNFTCollection.mockReset()
        mockFetchNFTCollection.mockResolvedValue({ ...BASE_STATS })
        mockFetchV3Tokens.mockReset()
        mockFetchV3Tokens.mockResolvedValue([...BASE_TOKENS])
        mockFetchV3Listings.mockReset()
        mockFetchV3Listings.mockResolvedValue(new Map(BASE_LISTINGS))
        mockFetchNFTActivity.mockReset()
        mockFetchNFTActivity.mockResolvedValue([...BASE_ACTIVITY])

        const { result } = renderHook(() => useCollectionPublic(COL_ID))
        await waitFor(() => expect(result.current.loading).toBe(false))

        // fetchCollectionDetail called once on mount
        expect(mockFetchCollectionDetail).toHaveBeenCalledTimes(1)

        await act(async () => {
            result.current.reload()
        })

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(mockFetchCollectionDetail).toHaveBeenCalledTimes(2)
    })
})
