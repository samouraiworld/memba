import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the per-lane readers + config predicates so we can drive the
// aggregation/filter/pagination logic deterministically.
vi.mock("./marketplace/v3Reads", () => ({ fetchListingsPage: vi.fn() }))
vi.mock("./tokenOtcApi", () => ({ fetchOtcListings: vi.fn() }))
vi.mock("./config", () => ({
    isNftEnabled: vi.fn(() => true),
    isNftMarketV3Valid: vi.fn(() => true),
    isTokensEnabled: vi.fn(() => true),
    isTokenOtcValid: vi.fn(() => true),
}))
// The builders + broadcast + nftConfig are imported by the module but not
// exercised by these read-path tests; stub them so the import graph resolves.
vi.mock("./nftMarketplace", () => ({ buildDelistMsg: vi.fn() }))
vi.mock("./tokenOtc", () => ({ buildCancelListingMsg: vi.fn() }))
vi.mock("./grc20", () => ({ doContractBroadcast: vi.fn() }))
vi.mock("./nftConfig", () => ({ NFT_MARKETPLACE_V3_PATH: "gno.land/r/samcrew/memba_nft_market_v3_1" }))

import { fetchMyListings, anyListingLaneLive } from "./myListings"
import * as v3 from "./marketplace/v3Reads"
import * as otc from "./tokenOtcApi"
import * as config from "./config"

const nftRow = (collectionID: string, tokenId: string, seller: string) => ({
    collectionID,
    tokenId,
    seller,
    priceUgnot: 1_000_000,
    createdBlk: 1,
})
const otcRow = (id: string, seller: string) => ({
    id,
    seller,
    symbol: "FOO",
    expectedUnitPrice: 5n,
    amountAvailable: 100n,
})

const ME = "g1me"
const OTHER = "g1other"

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(config.isNftEnabled).mockReturnValue(true)
    vi.mocked(config.isNftMarketV3Valid).mockReturnValue(true)
    vi.mocked(config.isTokensEnabled).mockReturnValue(true)
    vi.mocked(config.isTokenOtcValid).mockReturnValue(true)
})

describe("fetchMyListings", () => {
    it("returns only the caller's listings across both lanes", async () => {
        vi.mocked(v3.fetchListingsPage).mockResolvedValueOnce([
            nftRow("art", "1", ME),
            nftRow("art", "2", OTHER),
            nftRow("art", "3", ME),
        ])
        vi.mocked(otc.fetchOtcListings).mockResolvedValueOnce([
            otcRow("10", OTHER),
            otcRow("11", ME),
        ])

        const mine = await fetchMyListings(ME)
        expect(mine.map(l => l.key).sort()).toEqual(["nft:art/1", "nft:art/3", "token:11"])
        expect(mine.every(l => (l.kind === "nft" ? true : l.id === "11"))).toBe(true)
    })

    it("paginates the NFT book until a short page", async () => {
        // First full page (100 rows, all mine), then a short page → stop.
        const full = Array.from({ length: 100 }, (_, i) => nftRow("art", String(i), ME))
        vi.mocked(v3.fetchListingsPage)
            .mockResolvedValueOnce(full)
            .mockResolvedValueOnce([nftRow("art", "100", ME)])
        vi.mocked(otc.fetchOtcListings).mockResolvedValueOnce([])

        const mine = await fetchMyListings(ME)
        expect(mine).toHaveLength(101)
        expect(vi.mocked(v3.fetchListingsPage)).toHaveBeenCalledTimes(2)
        expect(vi.mocked(v3.fetchListingsPage)).toHaveBeenNthCalledWith(1, 0, 100)
        expect(vi.mocked(v3.fetchListingsPage)).toHaveBeenNthCalledWith(2, 100, 100)
    })

    it("skips a lane that is not live", async () => {
        vi.mocked(config.isTokensEnabled).mockReturnValue(false)
        vi.mocked(v3.fetchListingsPage).mockResolvedValueOnce([nftRow("art", "1", ME)])

        const mine = await fetchMyListings(ME)
        expect(mine).toHaveLength(1)
        expect(vi.mocked(otc.fetchOtcListings)).not.toHaveBeenCalled()
    })

    it("survives one lane throwing (allSettled)", async () => {
        vi.mocked(v3.fetchListingsPage).mockRejectedValueOnce(new Error("rpc down"))
        vi.mocked(otc.fetchOtcListings).mockResolvedValueOnce([otcRow("11", ME)])

        const mine = await fetchMyListings(ME)
        expect(mine.map(l => l.key)).toEqual(["token:11"])
    })

    it("returns empty for an empty address without hitting the network", async () => {
        const mine = await fetchMyListings("")
        expect(mine).toEqual([])
        expect(vi.mocked(v3.fetchListingsPage)).not.toHaveBeenCalled()
        expect(vi.mocked(otc.fetchOtcListings)).not.toHaveBeenCalled()
    })
})

describe("anyListingLaneLive", () => {
    it("is false when no managed lane is live", () => {
        vi.mocked(config.isNftEnabled).mockReturnValue(false)
        vi.mocked(config.isTokensEnabled).mockReturnValue(false)
        expect(anyListingLaneLive()).toBe(false)
    })
    it("is true when a lane is live", () => {
        vi.mocked(config.isTokensEnabled).mockReturnValue(false)
        expect(anyListingLaneLive()).toBe(true) // nft still live
    })
})
