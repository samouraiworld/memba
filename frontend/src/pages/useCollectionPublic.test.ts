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
    [`${COL_ID}/0`, { priceUgnot: 2_000_000, seller: "g1owner000000000000000000000000000001" }],
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

vi.mock("../lib/launchpadReads", () => ({
    fetchCollectionDetail: (...args: unknown[]) => mockFetchCollectionDetail(...args),
}))

vi.mock("../lib/nftApi", () => ({
    fetchNFTCollection: (...args: unknown[]) => mockFetchNFTCollection(...args),
    fetchNFTActivity: (...args: unknown[]) => mockFetchNFTActivity(...args),
}))

vi.mock("../lib/v3TokenGrid", () => ({
    fetchV3Tokens: (...args: unknown[]) => mockFetchV3Tokens(...args),
    fetchV3Listings: (...args: unknown[]) => mockFetchV3Listings(...args),
    listingKey: (collectionID: string, tokenId: string) => `${collectionID}/${tokenId}`,
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

        // The Map key mirrors listingKey(id, tokenId)
        const key = `${COL_ID}/${TOKEN_ID}`
        const listing = result.current.listings.get(key)

        expect(listing).toBeDefined()
        expect(listing?.priceUgnot).toBe(2_000_000)
        expect(listing?.seller).toBe("g1owner000000000000000000000000000001")
    })

    it("passes supply (minted) to fetchV3Tokens", async () => {
        const { result } = renderHook(() => useCollectionPublic(COL_ID))

        await waitFor(() => expect(result.current.loading).toBe(false))

        // supply = detail.minted = 3
        expect(mockFetchV3Tokens).toHaveBeenCalledWith(COL_ID, 3, expect.anything())
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
