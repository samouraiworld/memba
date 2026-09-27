import { describe, expect, it, vi } from "vitest"

vi.mock("./api", () => ({ api: { getFeedTimeline: vi.fn(), getUserFeed: vi.fn(), getFeedThread: vi.fn() } }))

import { api } from "./api"
import { fetchFeedTimeline, fetchFeedThread, fetchUserFeed } from "./feedApi"

const getTimeline = vi.mocked(api.getFeedTimeline)

describe("fetchFeedTimeline", () => {
    it("surfaces a failed request instead of passing it off as an empty feed", async () => {
        getTimeline.mockRejectedValueOnce(new Error("[unavailable] backend down"))
        await expect(fetchFeedTimeline()).rejects.toThrow("backend down")
    })

    it("returns the page on success", async () => {
        getTimeline.mockResolvedValueOnce({ posts: [], nextCursor: 7n, indexerLastBlock: 9n } as never)
        await expect(fetchFeedTimeline(0n, 20, "g1viewer")).resolves.toEqual({ posts: [], nextCursor: 7n, indexerLastBlock: 9n })
        expect(getTimeline).toHaveBeenCalledWith({ cursor: 0n, limit: 20, viewerAddress: "g1viewer" })
    })
})

describe("Feed detail readers", () => {
    it("does not turn a failed author read into an empty profile", async () => {
        vi.mocked(api.getUserFeed).mockRejectedValueOnce(new Error("offline"))
        await expect(fetchUserFeed("g1author")).rejects.toThrow("offline")
    })

    it("does not turn a failed thread read into a missing post", async () => {
        vi.mocked(api.getFeedThread).mockRejectedValueOnce(new Error("offline"))
        await expect(fetchFeedThread(12n)).rejects.toThrow("offline")
    })
})
