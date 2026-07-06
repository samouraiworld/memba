import { describe, it, expect } from "vitest"
import { countNewer } from "./feedPaging"
import type { FeedPost } from "./feedApi"

const post = (id: bigint): FeedPost => ({
    id, author: "g1a", body: "x", replyTo: 0n, blockH: 0n, blockTs: 0n,
    editedAt: 0n, flagCount: 0, hidden: false, deleted: false, replyCount: 0,
} as FeedPost)

describe("countNewer", () => {
    it("counts head posts strictly newer than the newest loaded id", () => {
        const head = [post(9n), post(8n), post(7n)]
        expect(countNewer(7n, head)).toBe(2) // 9 and 8
    })

    it("is 0 when nothing is newer", () => {
        expect(countNewer(9n, [post(9n), post(8n)])).toBe(0)
    })

    it("counts everything when nothing has been loaded yet (newest = 0)", () => {
        expect(countNewer(0n, [post(3n), post(2n)])).toBe(2)
    })

    it("is 0 for an empty head", () => {
        expect(countNewer(5n, [])).toBe(0)
    })
})
