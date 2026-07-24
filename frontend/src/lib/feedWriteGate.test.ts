/**
 * feedWriteGate — the backstop that stops a feed write going to a chain the
 * backend does not index.
 *
 * This is the class of bug it exists to prevent: the feed realm path is the
 * same on every allowlisted network, but the indexer tails exactly one chain.
 * On any other network a write succeeds on-chain, costs gas, is permanent, and
 * is never visible in the product. Every feed write funnels through
 * `submitFeedMsg`, so guarding there covers all six builders (post, reply,
 * edit, delete, flag, react) including any future caller.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const broadcast = vi.fn(async () => ({ hash: "0xdeadbeef" }))
vi.mock("./grc20", () => ({ doContractBroadcast: (...a: unknown[]) => broadcast(...(a as [])) }))

// isFeedWritable is the single lever; mocking it keeps this a pure unit test of
// the guard rather than a test of localStorage/network resolution.
const writable = vi.fn(() => true)
vi.mock("./config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./config")>()),
    isFeedWritable: () => writable(),
}))

const { submitFeedMsg, buildCreatePostMsg, buildFlagPostMsg, buildDeletePostMsg } = await import("./feed")

const CALLER = "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

beforeEach(() => {
    broadcast.mockClear()
    writable.mockReturnValue(true)
})
afterEach(() => vi.clearAllMocks())

describe("feed write gate", () => {
    it("broadcasts normally on the indexed network", async () => {
        const hash = await submitFeedMsg(buildCreatePostMsg(CALLER, "hello"), "feed post")
        expect(hash).toBe("0xdeadbeef")
        expect(broadcast).toHaveBeenCalledTimes(1)
    })

    it("refuses to broadcast on a non-indexed network", async () => {
        writable.mockReturnValue(false)
        await expect(submitFeedMsg(buildCreatePostMsg(CALLER, "hello"), "feed post")).rejects.toThrow(
            /not indexed/i,
        )
    })

    it("never reaches the wallet on a non-indexed network", async () => {
        // The point of the guard: no popup, no gas, no permanent invisible post.
        writable.mockReturnValue(false)
        await expect(submitFeedMsg(buildCreatePostMsg(CALLER, "hi"), "feed post")).rejects.toThrow()
        expect(broadcast).not.toHaveBeenCalled()
    })

    it("guards every write path, not just posting", async () => {
        // flag/delete write post IDs that mean something different on another
        // chain — arguably worse than a lost post, since they'd hit an
        // unrelated post that happens to share the id.
        writable.mockReturnValue(false)
        for (const msg of [
            buildFlagPostMsg(CALLER, 1n),
            buildDeletePostMsg(CALLER, 1n),
        ]) {
            await expect(submitFeedMsg(msg, "x")).rejects.toThrow(/not indexed/i)
        }
        expect(broadcast).not.toHaveBeenCalled()
    })
})
