import { describe, it, expect, vi } from "vitest"
import { createReactionsLoader, REACTIONS_BATCH_MAX, type ReactionsFetcher } from "./feedReactionsLoader"

type Req = Parameters<ReactionsFetcher>[0]

/** A fetcher that echoes one 👍 per requested post, count = post id. */
function echoFetcher() {
    return vi.fn<ReactionsFetcher>(async (req: Req) => ({
        posts: req.postIds.map(id => ({
            postId: id,
            reactions: [{ emoji: "👍", count: id, viewerReacted: req.viewer === "g1me" }],
        })),
    }))
}

describe("createReactionsLoader", () => {
    it("coalesces loads from the same tick into one request", async () => {
        const fetcher = echoFetcher()
        const load = createReactionsLoader(fetcher)

        const res = await Promise.all([load(1n, "g1me"), load(2n, "g1me"), load(3n, "g1me")])

        expect(fetcher).toHaveBeenCalledTimes(1)
        expect(fetcher.mock.calls[0][0]).toEqual({ postIds: [1n, 2n, 3n], viewer: "g1me" })
        expect(res.map(r => r[0].count)).toEqual([1, 2, 3])
        expect(res.every(r => r[0].viewerReacted)).toBe(true)
    })

    it("asks for a post only once when it is loaded twice in a window", async () => {
        const fetcher = echoFetcher()
        const load = createReactionsLoader(fetcher)

        const [a, b] = await Promise.all([load(5n, ""), load(5n, "")])

        expect(fetcher).toHaveBeenCalledTimes(1)
        expect(fetcher.mock.calls[0][0].postIds).toEqual([5n])
        expect(a).toEqual(b)
    })

    it("batches per viewer so viewerReacted stays scoped to the right wallet", async () => {
        const fetcher = echoFetcher()
        const load = createReactionsLoader(fetcher)

        const [mine, anon] = await Promise.all([load(1n, "g1me"), load(2n, "")])

        expect(fetcher).toHaveBeenCalledTimes(2)
        const reqs = fetcher.mock.calls.map(c => c[0])
        expect(reqs).toContainEqual({ postIds: [1n], viewer: "g1me" })
        expect(reqs).toContainEqual({ postIds: [2n], viewer: "" })
        expect(mine[0].viewerReacted).toBe(true)
        expect(anon[0].viewerReacted).toBe(false)
    })

    it("splits a batch above the server cap into chunks", async () => {
        const fetcher = echoFetcher()
        const load = createReactionsLoader(fetcher)
        const ids = Array.from({ length: REACTIONS_BATCH_MAX * 2 + 5 }, (_, i) => BigInt(i + 1))

        const res = await Promise.all(ids.map(id => load(id, "")))

        expect(fetcher).toHaveBeenCalledTimes(3)
        const sizes = fetcher.mock.calls.map(c => c[0].postIds.length)
        expect(sizes).toEqual([REACTIONS_BATCH_MAX, REACTIONS_BATCH_MAX, 5])
        expect(sizes.every(n => n <= REACTIONS_BATCH_MAX)).toBe(true)
        // Every post still gets its own counts back.
        expect(res.map(r => r[0].count)).toEqual(ids.map(Number))
    })

    it("gives an empty list to a post the server returned nothing for", async () => {
        const fetcher = vi.fn<ReactionsFetcher>(async () => ({ posts: [] }))
        const load = createReactionsLoader(fetcher)

        await expect(load(9n, "")).resolves.toEqual([])
    })

    it("rejects every post in a failed chunk, and only that chunk", async () => {
        const fetcher = vi.fn<ReactionsFetcher>(async (req: Req) => {
            if (req.postIds.includes(1n)) throw new Error("rate limited")
            return { posts: req.postIds.map(id => ({ postId: id, reactions: [] })) }
        })
        const load = createReactionsLoader(fetcher, { maxBatch: 2 })

        const res = await Promise.allSettled([load(1n, ""), load(2n, ""), load(3n, "")])

        expect(res.map(r => r.status)).toEqual(["rejected", "rejected", "fulfilled"])
    })

    it("starts a fresh request for a load after the batch was sent (refresh after reacting)", async () => {
        const fetcher = echoFetcher()
        const load = createReactionsLoader(fetcher)

        await Promise.all([load(1n, "g1me"), load(2n, "g1me")])
        await load(1n, "g1me")

        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(fetcher.mock.calls[1][0].postIds).toEqual([1n])
    })
})
