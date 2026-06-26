import { describe, it, expect } from "vitest"
import {
    unwrapQeval,
    parseReviews,
    sortByTrust,
    parseReputationScalar,
} from "./reviews"

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

describe("sortByTrust", () => {
    it("orders by reputation desc then recency", () => {
        const a = { id: 1, reputation: 1, createdAt: 100 } as any
        const b = { id: 2, reputation: 5, createdAt: 50 } as any
        const c = { id: 3, reputation: 5, createdAt: 90 } as any
        expect(sortByTrust([a, b, c]).map((r) => r.id)).toEqual([3, 2, 1])
    })
    it("does not mutate the input array", () => {
        const arr = [
            { id: 1, reputation: 0, createdAt: 10 } as any,
            { id: 2, reputation: 5, createdAt: 5 } as any,
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
