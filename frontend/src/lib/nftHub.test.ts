/**
 * nftHub.test.ts — TDD for the nftHub data-aggregation layer.
 *
 * Mocks both upstream modules so tests are fully isolated; no network calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// --- mocks (hoisted; must appear before the import under test) ---

const mockFetchCollectionList = vi.fn()
const mockIsCollectionVerified = vi.fn()

vi.mock("./launchpadReads", () => ({
    fetchCollectionList: (...a: unknown[]) => mockFetchCollectionList(...a),
    isCollectionVerified: (...a: unknown[]) => mockIsCollectionVerified(...a),
}))

const mockFetchNFTCollection = vi.fn()
const mockFetchNFTActivity = vi.fn()

vi.mock("./nftApi", () => ({
    fetchNFTCollection: (...a: unknown[]) => mockFetchNFTCollection(...a),
    fetchNFTActivity: (...a: unknown[]) => mockFetchNFTActivity(...a),
}))

import { fetchVerifiedCollections, fetchRecentActivity, type HubCollection } from "./nftHub"
import type { NFTActivityItem } from "./nftApi"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COL_A = { id: "g1creator/alpha", name: "Alpha", creator: "g1creator", slug: "alpha", phase: 2, minted: 10 }
const COL_B = { id: "g1creator/beta",  name: "Beta",  creator: "g1creator", slug: "beta",  phase: 1, minted: 5  }

const STATS_A = {
    name: "Alpha", symbol: "ALF", supply: 10n, floorPriceUgnot: 500_000n,
    totalVolumeUgnot: 2_000_000n, totalSales: 8n, activeListings: 3n, royaltyBps: 250n,
}

const act = (collectionId: string, saleNo: bigint, createdAt: string): NFTActivityItem => ({
    saleNo,
    tokenId: `#${saleNo}`,
    kind: "sale",
    priceUgnot: 100_000n,
    seller: "g1seller",
    buyer: "g1buyer",
    createdAt,
})

beforeEach(() => {
    vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// fetchVerifiedCollections
// ---------------------------------------------------------------------------

describe("fetchVerifiedCollections", () => {
    it("returns all collections with verified=true for verified ones, false for others", async () => {
        mockFetchCollectionList.mockResolvedValue([COL_A, COL_B])
        mockIsCollectionVerified.mockImplementation((id: string) =>
            Promise.resolve(id === "g1creator/alpha"),
        )
        mockFetchNFTCollection.mockResolvedValue(null)

        const result = await fetchVerifiedCollections()

        // both collections returned (not filtered to verified-only)
        expect(result).toHaveLength(2)

        const alpha = result.find((c) => c.id === "g1creator/alpha")!
        const beta  = result.find((c) => c.id === "g1creator/beta")!

        expect(alpha.verified).toBe(true)
        expect(beta.verified).toBe(false)
    })

    it("enriches with floor + volume from stats; defaults to 0n when stats is null", async () => {
        mockFetchCollectionList.mockResolvedValue([COL_A, COL_B])
        mockIsCollectionVerified.mockResolvedValue(false)
        mockFetchNFTCollection.mockImplementation((id: string) =>
            id === "g1creator/alpha" ? Promise.resolve(STATS_A) : Promise.resolve(null),
        )

        const result = await fetchVerifiedCollections()

        const alpha = result.find((c) => c.id === "g1creator/alpha")!
        expect(alpha.floorUgnot).toBe(500_000n)
        expect(alpha.volumeUgnot).toBe(2_000_000n)

        const beta = result.find((c) => c.id === "g1creator/beta")!
        expect(beta.floorUgnot).toBe(0n)
        expect(beta.volumeUgnot).toBe(0n)
    })

    it("preserves id, name, creator, slug fields", async () => {
        mockFetchCollectionList.mockResolvedValue([COL_A])
        mockIsCollectionVerified.mockResolvedValue(true)
        mockFetchNFTCollection.mockResolvedValue(STATS_A)

        const [c] = await fetchVerifiedCollections()

        expect(c.id).toBe("g1creator/alpha")
        expect(c.name).toBe("Alpha")
        expect(c.creator).toBe("g1creator")
        expect(c.slug).toBe("alpha")
    })

    it("returns empty array when collection list is empty", async () => {
        mockFetchCollectionList.mockResolvedValue([])
        expect(await fetchVerifiedCollections()).toEqual([])
    })

    it("respects limit — truncates the list", async () => {
        mockFetchCollectionList.mockResolvedValue([COL_A, COL_B])
        mockIsCollectionVerified.mockResolvedValue(false)
        mockFetchNFTCollection.mockResolvedValue(null)

        const result = await fetchVerifiedCollections(1)
        expect(result).toHaveLength(1)
    })

    it("parallelises stat + verified fetches (both called for each collection)", async () => {
        mockFetchCollectionList.mockResolvedValue([COL_A, COL_B])
        mockIsCollectionVerified.mockResolvedValue(false)
        mockFetchNFTCollection.mockResolvedValue(null)

        await fetchVerifiedCollections()

        expect(mockFetchNFTCollection).toHaveBeenCalledTimes(2)
        expect(mockIsCollectionVerified).toHaveBeenCalledTimes(2)
    })

    it("graceful failure: one collection's isCollectionVerified rejecting does not reject the batch", async () => {
        mockFetchCollectionList.mockResolvedValue([COL_A, COL_B])
        // Alpha's verified-check throws; Beta resolves normally
        mockIsCollectionVerified.mockImplementation((id: string) =>
            id === "g1creator/alpha"
                ? Promise.reject(new Error("RPC timeout"))
                : Promise.resolve(true),
        )
        mockFetchNFTCollection.mockResolvedValue(null)

        // Must resolve (not reject) even when one collection errors
        const result = await fetchVerifiedCollections()

        expect(result).toHaveLength(2)

        // The failing collection falls back to safe defaults
        const alpha = result.find((c) => c.id === "g1creator/alpha")!
        expect(alpha.verified).toBe(false)
        expect(alpha.floorUgnot).toBe(0n)

        // The passing collection is unaffected
        const beta = result.find((c) => c.id === "g1creator/beta")!
        expect(beta.verified).toBe(true)
    })

    it("logs cap message after enrichment with the actual collection count", async () => {
        const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {})

        // Provide 3 collections but cap at 2 → cap message should fire
        const COL_C = { id: "g1creator/gamma", name: "Gamma", creator: "g1creator", slug: "gamma", phase: 1, minted: 2 }
        mockFetchCollectionList.mockResolvedValue([COL_A, COL_B, COL_C])
        mockIsCollectionVerified.mockResolvedValue(false)
        mockFetchNFTCollection.mockResolvedValue(null)

        await fetchVerifiedCollections(2)

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("2 of 3"),
        )

        consoleSpy.mockRestore()
    })
})

// ---------------------------------------------------------------------------
// fetchRecentActivity
// ---------------------------------------------------------------------------

describe("fetchRecentActivity", () => {
    it("merges activity from both collections and sorts by createdAt descending", async () => {
        const itemsA: NFTActivityItem[] = [
            act("a", 1n, "2024-06-01T10:00:00Z"),
            act("a", 2n, "2024-06-01T08:00:00Z"),
        ]
        const itemsB: NFTActivityItem[] = [
            act("b", 10n, "2024-06-01T09:00:00Z"),
        ]

        mockFetchNFTActivity.mockImplementation((id: string) =>
            Promise.resolve(id === "a" ? itemsA : itemsB),
        )

        const result = await fetchRecentActivity(["a", "b"])

        expect(result).toHaveLength(3)
        // Descending order: 10:00 > 09:00 > 08:00
        expect(result[0].createdAt).toBe("2024-06-01T10:00:00Z")
        expect(result[1].createdAt).toBe("2024-06-01T09:00:00Z")
        expect(result[2].createdAt).toBe("2024-06-01T08:00:00Z")
    })

    it("calls fetchNFTActivity for each collection id", async () => {
        mockFetchNFTActivity.mockResolvedValue([])

        await fetchRecentActivity(["a", "b"])

        expect(mockFetchNFTActivity).toHaveBeenCalledWith("a", expect.any(Number))
        expect(mockFetchNFTActivity).toHaveBeenCalledWith("b", expect.any(Number))
        expect(mockFetchNFTActivity).toHaveBeenCalledTimes(2)
    })

    it("handles empty collectionIds", async () => {
        const result = await fetchRecentActivity([])
        expect(result).toEqual([])
        expect(mockFetchNFTActivity).not.toHaveBeenCalled()
    })

    it("handles empty results from individual collections gracefully", async () => {
        mockFetchNFTActivity.mockResolvedValue([])
        const result = await fetchRecentActivity(["a", "b"])
        expect(result).toEqual([])
    })

    it("respects perCollection cap", async () => {
        const manyItems: NFTActivityItem[] = Array.from({ length: 20 }, (_, i) =>
            act("a", BigInt(i), new Date(Date.now() - i * 1000).toISOString()),
        )
        mockFetchNFTActivity.mockResolvedValue(manyItems)

        await fetchRecentActivity(["a"], 5)

        // The perCollection limit should be forwarded to fetchNFTActivity
        expect(mockFetchNFTActivity).toHaveBeenCalledWith("a", 5)
    })
})
