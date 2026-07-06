import { describe, it, expect } from "vitest"
import { makeOptimisticPost, sameContent } from "./feedTypes"

describe("makeOptimisticPost", () => {
    it("builds a top-level optimistic post with a negative id", () => {
        const p = makeOptimisticPost("g1alice", "gm", 0n, 0)
        expect(p.optimistic).toBe(true)
        expect(p.author).toBe("g1alice")
        expect(p.body).toBe("gm")
        expect(p.replyTo).toBe(0n)
        expect(p.id < 0n).toBe(true) // never collides with a real (positive) id
    })

    it("carries replyTo for a reply", () => {
        expect(makeOptimisticPost("g1bob", "re", 42n, 1).replyTo).toBe(42n)
    })

    it("distinct nonces yield distinct ids (no rapid-post collision)", () => {
        const a = makeOptimisticPost("g1a", "x", 0n, 0)
        const b = makeOptimisticPost("g1a", "x", 0n, 1)
        expect(a.id).not.toBe(b.id)
    })
})

describe("sameContent", () => {
    const opt = makeOptimisticPost("g1alice", "hello", 0n, 0)
    it("matches the indexed row by author+body (confirmation)", () => {
        expect(sameContent(opt, { ...opt, id: 5n, optimistic: false })).toBe(true)
    })
    it("does not match a different author or body", () => {
        expect(sameContent(opt, { ...opt, author: "g1bob" })).toBe(false)
        expect(sameContent(opt, { ...opt, body: "world" })).toBe(false)
    })
})
