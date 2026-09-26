import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("./feedApi", () => ({ fetchFeedTimeline: vi.fn() }))
const { fetchFeedTimeline } = await import("./feedApi")
const { fetchJoinCandidates, isJoinPost, JOIN_TEMPLATE } = await import("./feedJoin")
const { feedBodyLength, MAX_FEED_BODY } = await import("./feedConstants")

const post = (id: number, author: string, body: string, flags = {}) => ({
    id: BigInt(id), author, body, hidden: false, deleted: false, blockTs: 0n, ...flags,
})

beforeEach(() => vi.mocked(fetchFeedTimeline).mockReset())

describe("public #join applications", () => {
    it("matches only a separate tag and keeps the template within the realm limit", () => {
        expect(isJoinPost("Hi #join me")).toBe(true)
        expect(isJoinPost("#JOIN")).toBe(true)
        expect(isJoinPost("#joined yesterday")).toBe(false)
        expect(isJoinPost("x#join")).toBe(false)
        expect(isJoinPost(JOIN_TEMPLATE)).toBe(true)
        expect(feedBodyLength(JOIN_TEMPLATE)).toBeLessThan(MAX_FEED_BODY)
    })

    it("keeps each author's newest visible application and discloses a bounded scan", async () => {
        vi.mocked(fetchFeedTimeline)
            .mockResolvedValueOnce({ posts: [post(9, "g1a", "#join again"), post(8, "g1b", "hello"), post(7, "g1c", "#join", { hidden: true })], nextCursor: 7n, indexerLastBlock: 0n } as never)
            .mockResolvedValueOnce({ posts: [post(6, "g1a", "#join first"), post(5, "g1d", "#join me")], nextCursor: 5n, indexerLastBlock: 0n } as never)
            .mockResolvedValueOnce({ posts: [post(4, "g1e", "#join")], nextCursor: 4n, indexerLastBlock: 0n } as never)
        const result = await fetchJoinCandidates()
        expect(result.posts.map(x => x.id)).toEqual([9n, 5n, 4n])
        expect(result).toMatchObject({ scanned: 6, complete: false })
        expect(fetchFeedTimeline).toHaveBeenCalledTimes(3)
        expect(fetchFeedTimeline).toHaveBeenNthCalledWith(2, 7n, 100)
    })

    it("stops when the last page is reached", async () => {
        vi.mocked(fetchFeedTimeline).mockResolvedValue({ posts: [], nextCursor: 0n, indexerLastBlock: 0n })
        expect(await fetchJoinCandidates()).toMatchObject({ scanned: 0, complete: true })
        expect(fetchFeedTimeline).toHaveBeenCalledTimes(1)
    })
})
