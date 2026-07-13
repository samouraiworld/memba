import { describe, it, expect } from "vitest"
import { makeOptimisticPost, sameContent, reconciles, isStaleOptimistic, OPTIMISTIC_TTL_MS } from "./feedTypes"

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

describe("reconciles (newer-than-baseline)", () => {
    // Optimistic row created when the newest loaded post id was 10.
    const opt: ReturnType<typeof makeOptimisticPost> = { ...makeOptimisticPost("g1alice", "gm", 0n, 0), sinceId: 10n }

    it("reconciles against a genuinely newer server row (id > sinceId)", () => {
        expect(reconciles(opt, { ...opt, id: 11n, optimistic: false })).toBe(true)
    })

    it("does NOT reconcile against an older identical post (the duplicate-vanish bug)", () => {
        // A pre-existing post by the same author with the same body (id 8 <= 10)
        // must NOT swallow the fresh optimistic row.
        expect(reconciles(opt, { ...opt, id: 8n, optimistic: false })).toBe(false)
    })

    it("treats a missing sinceId as no baseline (any same-content row reconciles)", () => {
        const noBaseline = makeOptimisticPost("g1a", "x", 0n, 0)
        expect(reconciles(noBaseline, { ...noBaseline, id: 1n, optimistic: false })).toBe(true)
    })
})

describe("isStaleOptimistic (TTL)", () => {
    it("is fresh within the TTL and stale past it", () => {
        const o = { ...makeOptimisticPost("g1a", "x", 0n, 0), optimisticAt: 1_000 }
        expect(isStaleOptimistic(o, 1_000 + OPTIMISTIC_TTL_MS - 1)).toBe(false)
        expect(isStaleOptimistic(o, 1_000 + OPTIMISTIC_TTL_MS + 1)).toBe(true)
    })
    it("without a stamp is never stale (legacy rows)", () => {
        expect(isStaleOptimistic(makeOptimisticPost("g1a", "x", 0n, 0), 9e12)).toBe(false)
    })
})
