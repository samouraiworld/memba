import { describe, it, expect } from "vitest"
import {
    unwrapQeval,
    parseReviews,
    sortByTrust,
    parseReputationScalar,
    buildPostReviewMsg,
    buildEditReviewMsg,
    buildDeleteReviewMsg,
    buildReactMsg,
    buildCommentMsg,
    buildEditCommentMsg,
    buildDeleteCommentMsg,
    buildFlagMsg,
    buildHideReviewMsg,
    REVIEWS_PKG_PATH,
    mergeReviewsByAuthor,
    summaryFromReviews,
    makeOptimisticReview,
    upsertReviewByAuthor,
    type OnChainReview,
} from "./reviews"

function review(over: Partial<OnChainReview>): OnChainReview {
    return {
        id: 1, subject: "g1op", author: "g1a", rating: 5, body: "ok",
        createdAt: 100, editedAt: 0, deleted: false, likes: 0, dislikes: 0,
        flags: 0, reputation: 0, ...over,
    }
}

describe("mergeReviewsByAuthor", () => {
    const OP = "g1op", SIGN = "g1sign"

    it("merges two subjects and prefers the canonical-subject review when an author is on both", () => {
        const opList = [review({ id: 3, subject: OP, author: "g1alice", body: "new", createdAt: 491 })]
        const signList = [
            review({ id: 1, subject: SIGN, author: "g1alice", body: "old", createdAt: 478 }),
            review({ id: 2, subject: SIGN, author: "g1bob", body: "awesome", createdAt: 479 }),
        ]
        const merged = mergeReviewsByAuthor([opList, signList], OP)
        // alice kept on canonical (id 3), bob recovered from signing (id 2)
        expect(merged.map((r) => r.id).sort()).toEqual([2, 3])
        expect(merged.find((r) => r.author === "g1alice")!.body).toBe("new")
        expect(merged.find((r) => r.author === "g1bob")!.body).toBe("awesome")
    })

    it("keeps the most recent when an author has reviews on two non-canonical subjects", () => {
        const a = review({ id: 1, subject: "g1x", author: "g1a", createdAt: 10 })
        const b = review({ id: 2, subject: "g1y", author: "g1a", createdAt: 20 })
        expect(mergeReviewsByAuthor([[a], [b]], OP).map((r) => r.id)).toEqual([2])
    })

    it("drops deleted reviews", () => {
        const merged = mergeReviewsByAuthor([[review({ author: "g1a", deleted: true })]], OP)
        expect(merged).toHaveLength(0)
    })
})

describe("summaryFromReviews", () => {
    it("computes count / sum / average over live reviews", () => {
        const s = summaryFromReviews([review({ rating: 5 }), review({ author: "g1b", rating: 3 })])
        expect(s).toEqual({ count: 2, sum: 8, average: 4 })
    })
    it("is zero for an empty list", () => {
        expect(summaryFromReviews([])).toEqual({ count: 0, sum: 0, average: 0 })
    })
})

describe("optimistic helpers", () => {
    it("makeOptimisticReview marks a pending review (id<0, createdAt 0)", () => {
        const o = makeOptimisticReview("g1a", 4, "hi", "g1op")
        expect(o.id).toBeLessThan(0)
        expect(o.createdAt).toBe(0)
        expect(o).toMatchObject({ author: "g1a", rating: 4, body: "hi", subject: "g1op" })
    })
    it("upsertReviewByAuthor replaces the same author's review (realm edits on re-post)", () => {
        const existing = [review({ id: 1, author: "g1a", body: "old" }), review({ id: 2, author: "g1b" })]
        const next = upsertReviewByAuthor(existing, makeOptimisticReview("g1a", 5, "new", "g1op"))
        expect(next.filter((r) => r.author === "g1a")).toHaveLength(1)
        expect(next.find((r) => r.author === "g1a")!.body).toBe("new")
        expect(next.find((r) => r.author === "g1b")).toBeDefined()
    })
})

describe("unwrapQeval", () => {
    it('strips the gno ("..." string) wrapper and unquotes', () => {
        // qeval returns a string-typed value wrapped like: ("[...]" string)
        expect(unwrapQeval('("[{\\"id\\":1}]" string)')).toBe('[{"id":1}]')
    })
    it("passes through a bare JSON string", () => {
        expect(unwrapQeval('[{"id":1}]')).toBe('[{"id":1}]')
    })
    it("unescapes backslashes inside the wrapper", () => {
        // `("foo\\bar" string)` → the inner gno string literal `foo\\bar` unescapes to `foo\bar`
        expect(unwrapQeval('("foo\\\\bar" string)')).toBe("foo\\bar")
    })
    it("handles nested quotes in the wrapped payload", () => {
        expect(unwrapQeval('("hello \\"world\\"" string)')).toBe('hello "world"')
    })
})

describe("parseReviews", () => {
    it("parses the realm JSON array", () => {
        const out = parseReviews(
            '[{"id":1,"subject":"g1x","author":"g1a","rating":5,"body":"hi","createdAt":10,"editedAt":0,"deleted":false,"likes":2,"dislikes":0,"flags":0,"reputation":3}]',
        )
        expect(out).toHaveLength(1)
        expect(out[0].rating).toBe(5)
        expect(out[0].reputation).toBe(3)
    })
    it("returns [] on empty array", () => {
        expect(parseReviews("[]")).toEqual([])
    })
    it("returns [] on garbage input", () => {
        expect(parseReviews("not json")).toEqual([])
    })
    it("returns [] on non-array JSON", () => {
        expect(parseReviews('{"id":1}')).toEqual([])
    })
})

type TrustItem = { id: number; reputation: number; createdAt: number }

describe("sortByTrust", () => {
    it("orders by reputation desc then recency", () => {
        const a: TrustItem = { id: 1, reputation: 1, createdAt: 100 }
        const b: TrustItem = { id: 2, reputation: 5, createdAt: 50 }
        const c: TrustItem = { id: 3, reputation: 5, createdAt: 90 }
        expect(sortByTrust([a, b, c]).map((r) => r.id)).toEqual([3, 2, 1])
    })
    it("does not mutate the input array", () => {
        const arr: TrustItem[] = [
            { id: 1, reputation: 0, createdAt: 10 },
            { id: 2, reputation: 5, createdAt: 5 },
        ]
        const sorted = sortByTrust(arr)
        expect(arr[0].id).toBe(1) // original unchanged
        expect(sorted[0].id).toBe(2)
    })
})

describe("parseReputationScalar", () => {
    it("parses positive int64 scalar", () => {
        expect(parseReputationScalar("(3 int64)")).toBe(3)
    })
    it("parses negative int64 scalar", () => {
        expect(parseReputationScalar("(-2 int64)")).toBe(-2)
    })
    it("parses zero", () => {
        expect(parseReputationScalar("(0 int64)")).toBe(0)
    })
    it("returns 0 on unrecognized format", () => {
        expect(parseReputationScalar("not a scalar")).toBe(0)
        expect(parseReputationScalar("")).toBe(0)
    })
})

// ── Write builder tests ──────────────────────────────────────

describe("buildPostReviewMsg", () => {
    it("builds a PostReview MsgCall", () => {
        const m = buildPostReviewMsg("g1caller", "g1subject", 5, "great")
        expect(m.type).toBe("vm/MsgCall")
        expect(m.value.func).toBe("PostReview")
        expect(m.value.pkg_path).toBe(REVIEWS_PKG_PATH)
        expect(m.value.args).toEqual(["g1subject", "5", "great"])
        expect(m.value.caller).toBe("g1caller")
    })
    it("coerces rating to string", () => {
        const m = buildPostReviewMsg("g1c", "g1s", 3, "ok")
        expect(typeof (m.value.args as string[])[1]).toBe("string")
        expect((m.value.args as string[])[1]).toBe("3")
    })
    it("sets send to empty string", () => {
        expect(buildPostReviewMsg("g1c", "g1s", 4, "nice").value.send).toBe("")
    })
})

describe("buildEditReviewMsg", () => {
    it("builds an EditReview MsgCall", () => {
        const m = buildEditReviewMsg("g1c", 99, 4, "updated")
        expect(m.value.func).toBe("EditReview")
        expect(m.value.args).toEqual(["99", "4", "updated"])
        expect(m.value.caller).toBe("g1c")
    })
})

describe("buildDeleteReviewMsg", () => {
    it("builds a DeleteReview MsgCall", () => {
        const m = buildDeleteReviewMsg("g1c", 7)
        expect(m.value.func).toBe("DeleteReview")
        expect(m.value.args).toEqual(["7"])
    })
})

describe("buildReactMsg", () => {
    it("builds a like React MsgCall", () => {
        expect(buildReactMsg("g1c", 42, "like").value.args).toEqual(["42", "like"])
    })
    it("builds a dislike React MsgCall", () => {
        const m = buildReactMsg("g1c", 10, "dislike")
        expect(m.value.func).toBe("React")
        expect(m.value.args).toEqual(["10", "dislike"])
    })
})

describe("buildCommentMsg", () => {
    it("targets PostComment (not Comment)", () => {
        const m = buildCommentMsg("g1c", 7, "nice")
        expect(m.value.func).toBe("PostComment")
        expect(m.value.args).toEqual(["7", "nice"])
    })
    it("sets pkg_path to REVIEWS_PKG_PATH", () => {
        expect(buildCommentMsg("g1c", 1, "x").value.pkg_path).toBe(REVIEWS_PKG_PATH)
    })
})

describe("buildEditCommentMsg", () => {
    it("builds an EditComment MsgCall", () => {
        const m = buildEditCommentMsg("g1c", 3, "edited")
        expect(m.value.func).toBe("EditComment")
        expect(m.value.args).toEqual(["3", "edited"])
    })
})

describe("buildDeleteCommentMsg", () => {
    it("builds a DeleteComment MsgCall", () => {
        const m = buildDeleteCommentMsg("g1c", 5)
        expect(m.value.func).toBe("DeleteComment")
        expect(m.value.args).toEqual(["5"])
    })
})

describe("buildFlagMsg", () => {
    it("builds a Flag MsgCall", () => {
        const m = buildFlagMsg("g1c", 12)
        expect(m.value.func).toBe("Flag")
        expect(m.value.args).toEqual(["12"])
        expect(m.value.caller).toBe("g1c")
    })
})

describe("buildHideReviewMsg", () => {
    it("builds a HideReview MsgCall with correct func name and args", () => {
        const m = buildHideReviewMsg("g1mod", 99)
        expect(m.type).toBe("vm/MsgCall")
        expect(m.value.func).toBe("HideReview")
        expect(m.value.args).toEqual(["99"])
        expect(m.value.caller).toBe("g1mod")
        expect(m.value.pkg_path).toBe(REVIEWS_PKG_PATH)
    })
})
