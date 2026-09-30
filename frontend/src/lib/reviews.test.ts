import { describe, it, expect, vi, afterEach } from "vitest"
import {
    fetchSummaries,
    fetchSummary,
    fetchModerator,
    publisherNote,
    TEAM_MULTISIG_ADDRESS,
    fetchComments,
    fetchReviews,
    parseReviews,
    sortByTrust,
    buildPostReviewMsg,
    buildEditReviewMsg,
    buildDeleteReviewMsg,
    buildReactMsg,
    buildCommentMsg,
    buildEditCommentMsg,
    buildDeleteCommentMsg,
    buildFlagMsg,
    REVIEWS_PKG_PATH,
    REVIEW_GAS_WANTED,
    reviewStorageBytes,
    submitReview,
    mergeReviewsByAuthor,
    summaryFromReviews,
    makeOptimisticReview,
    upsertReviewByAuthor,
    type OnChainReview,
} from "./reviews"
import * as config from "./config"
import * as shared from "./dao/shared"
import * as grc20 from "./grc20"

/** A qeval string answer as the node prints it: Go's strconv.Quote, which is not always a JSON literal. */
function goQuoted(text: string): string {
    let out = '"'
    for (const ch of text) {
        const c = ch.codePointAt(0)!
        if (ch === '"') out += '\\"'
        else if (ch === "\\") out += "\\\\"
        else if (c === 0x7f) out += "\\x7f"
        else if (c === 0xf0000) out += "\\U000f0000"
        else out += ch
    }
    return `(${out}" string)`
}

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

describe("parseReviews", () => {
    it("takes the realm's JSON array", () => {
        const out = parseReviews([review({ rating: 5, reputation: 3 })])
        expect(out).toHaveLength(1)
        expect(out[0].reputation).toBe(3)
        expect(parseReviews([])).toEqual([])
    })
    it("throws on anything else, so an unread page never reads as no reviews", () => {
        for (const bad of [null, "[]", { id: 1 }, [review({ rating: 0 })], [review({ rating: 6 })], [{ ...review({}), author: 7 }], [{ ...review({}), id: -1 }]]) {
            expect(() => parseReviews(bad), JSON.stringify(bad)).toThrow("could not be read")
        }
    })
})

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
    it("caps the storage deposit at twice the estimate for this subject and text", () => {
        // 11,720 + 10 x 40 + 2,000 = 14,120 bytes; twice that at 100 ugnot per byte, rounded up to 0.01 GNOT.
        const subject = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
        expect(buildPostReviewMsg("g1c", subject, 4, "x".repeat(2000)).value.max_deposit).toBe("2830000ugnot")
        expect(buildPostReviewMsg("g1c", subject, 4, "").value.max_deposit).toBe("2430000ugnot")
    })
})

describe("reviewStorageBytes", () => {
    // Bytes the chain charged in simulations on gnoland-1 (2026-09-30): [subject length, body bytes, charged].
    const MEASURED = [[22, 0, 11_884], [38, 0, 12_030], [52, 0, 12_156], [100, 0, 12_601], [200, 0, 13_522], [40, 2000, 14_057], [200, 2000, 15_530]]

    it("is never under what the chain charged, and within 250 bytes of it", () => {
        for (const [subject, body, charged] of MEASURED) {
            const estimate = reviewStorageBytes("s".repeat(subject), "b".repeat(body))
            expect(estimate, `${subject}/${body}`).toBeGreaterThanOrEqual(charged)
            expect(estimate - charged, `${subject}/${body}`).toBeLessThanOrEqual(250)
        }
    })

    it("counts UTF-8 bytes, not characters", () => {
        expect(reviewStorageBytes("s", "é".repeat(1000)) - reviewStorageBytes("s", "")).toBe(2000)
    })

    it("keeps the gas limit at twice the most a review used", () => {
        // 7.55M for a new review, 0.58M more for a replacement.
        expect(REVIEW_GAS_WANTED).toBeGreaterThanOrEqual(2 * (7_550_000 + 580_000))
    })
})

describe("submitReview", () => {
    afterEach(() => vi.restoreAllMocks())

    it("sends one PostReview at the measured gas limit and the fee read now, without a retry", async () => {
        const fee = vi.spyOn(grc20, "freshFeeForGasWanted").mockResolvedValue(20_400)
        const send = vi.spyOn(grc20, "doContractBroadcast").mockResolvedValue({ hash: "h" })
        expect(await submitReview("g1c", "gno.land/r/x/app", 4, "ok")).toBe("h")
        expect(fee).toHaveBeenCalledWith(REVIEW_GAS_WANTED)
        expect(send).toHaveBeenCalledTimes(1)
        expect(send).toHaveBeenCalledWith([buildPostReviewMsg("g1c", "gno.land/r/x/app", 4, "ok")], "post review",
            { gasWanted: REVIEW_GAS_WANTED, gasFee: 20_400, beforeSign: expect.any(Function) })
    })

    it("stops before the wallet when the fee rose while the confirmation was open", async () => {
        const fee = vi.spyOn(grc20, "freshFeeForGasWanted").mockResolvedValueOnce(20_400)
        let beforeSign: (() => unknown) | undefined
        vi.spyOn(grc20, "doContractBroadcast").mockImplementation(async (_msgs, _memo, opts) => { beforeSign = opts?.beforeSign; return { hash: "h" } })
        await submitReview("g1c", "gno.land/r/x/app", 4, "ok")
        fee.mockResolvedValueOnce(20_400)
        await expect(beforeSign!()).resolves.toBeUndefined()
        fee.mockResolvedValueOnce(20_401)
        await expect(beforeSign!()).rejects.toThrow("The network fee increased since review. Post the review again to see the new fee.")
    })

    it("sends nothing the realm would refuse after charging the fee", async () => {
        const fee = vi.spyOn(grc20, "freshFeeForGasWanted").mockResolvedValue(20_400)
        const send = vi.spyOn(grc20, "doContractBroadcast").mockResolvedValue({ hash: "h" })
        // 2,000 bytes is the realm's limit: "é" is two bytes.
        await expect(submitReview("g1c", "gno.land/r/x/app", 4, "é".repeat(1001))).rejects.toThrow("Review text must be 2,000 bytes or fewer.")
        await expect(submitReview("g1c", "gno.land/r/x/app", 0, "ok")).rejects.toThrow("Select a rating from 1 to 5.")
        vi.spyOn(config, "isReviewsValid").mockReturnValue(false)
        await expect(submitReview("g1c", "gno.land/r/x/app", 4, "ok")).rejects.toThrow("Reviews are not available on this network.")
        expect(fee).not.toHaveBeenCalled()
        expect(send).not.toHaveBeenCalled()
        vi.mocked(config.isReviewsValid).mockReturnValue(true)
        expect(await submitReview("g1c", "gno.land/r/x/app", 4, "é".repeat(1000))).toBe("h")
    })

    it("opens no wallet when the fee cannot be read", async () => {
        vi.spyOn(grc20, "freshFeeForGasWanted").mockRejectedValue(new Error("offline"))
        const send = vi.spyOn(grc20, "doContractBroadcast")
        await expect(submitReview("g1c", "gno.land/r/x/app", 4, "ok")).rejects.toThrow("The network fee could not be read. Nothing was sent; try again in a moment.")
        expect(send).not.toHaveBeenCalled()
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

describe("fetchSummaries (batched per-card summaries, capped concurrency)", () => {
    afterEach(() => vi.restoreAllMocks())

    const summaryJSON = (count: number, average: number) =>
        `("{\\"count\\":${count},\\"average\\":${average},\\"sum\\":${count * average}}" string)`

    it("returns a map keyed by subject, deduplicating repeats", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockImplementation(async (_rpc, _realm, expr) => {
            const s = String(expr)
            if (s.includes("app-a")) return summaryJSON(4, 4.5)
            return summaryJSON(0, 0)
        })
        const out = await fetchSummaries(["gno.land/r/x/app-a", "gno.land/r/x/app-b", "gno.land/r/x/app-a"])
        expect(out.get("gno.land/r/x/app-a")).toEqual({ count: 4, average: 4.5, sum: 18 })
        expect(out.get("gno.land/r/x/app-b")).toEqual({ count: 0, average: 0, sum: 0 })
        expect(qe).toHaveBeenCalledTimes(2) // dedup: app-a fetched once
    })

    it("uses the exact onchain sum when the realm rounds its average", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue('("{\\"count\\":3,\\"average\\":4,\\"sum\\":13}" string)')
        const out = await fetchSummaries(["gno.land/r/x/app-a"])
        expect(out.get("gno.land/r/x/app-a")?.average).toBeCloseTo(13 / 3)
    })

    it("never runs more than `concurrency` fetches at once", async () => {
        let inFlight = 0
        let peak = 0
        vi.spyOn(shared, "queryEval").mockImplementation(async () => {
            inFlight++
            peak = Math.max(peak, inFlight)
            await new Promise((r) => setTimeout(r, 5))
            inFlight--
            return summaryJSON(1, 5)
        })
        const subjects = Array.from({ length: 9 }, (_, i) => `gno.land/r/x/app-${i}`)
        const out = await fetchSummaries(subjects, 3)
        expect(out.size).toBe(9)
        expect(peak).toBeLessThanOrEqual(3)
    })

    it("leaves out a subject whose summary cannot be read, without failing the batch", async () => {
        vi.spyOn(shared, "queryEval").mockImplementation(async (_rpc, _realm, expr) => {
            if (String(expr).includes("bad")) throw new Error("rpc down")
            return summaryJSON(3, 4)
        })
        const out = await fetchSummaries(["gno.land/r/x/good", "gno.land/r/x/bad"])
        expect(out.get("gno.land/r/x/good")).toEqual({ count: 3, average: 4, sum: 12 })
        expect(out.has("gno.land/r/x/bad")).toBe(false)
    })

    it("tells an unreadable summary from a well-formed zero", async () => {
        const read = vi.spyOn(shared, "queryEval")
        read.mockResolvedValue(summaryJSON(0, 0))
        await expect(fetchSummary("g1subject")).resolves.toEqual({ count: 0, average: 0, sum: 0 })
        const replies = [null, "", '("not json" string)', "true", '{"count":2,"sum":11}', '{"count":-1,"sum":0}', '{"count":null,"sum":null}',
            '{"count":true,"sum":true}', '{"count":"0x10","sum":"0x10"}', '{"count":[],"sum":[]}', '{"count":4,"sum":0}', '{"count":2,"sum":2.5}']
        for (const reply of replies) {
            read.mockResolvedValue(reply === null || reply === "" || reply.startsWith("(") ? reply as string : goQuoted(reply))
            await expect(fetchSummary("g1subject"), String(reply)).rejects.toThrow("could not be read")
        }
        // One-star reviews only: the sum equals the count.
        read.mockResolvedValue(goQuoted('{"count":4,"sum":4}'))
        await expect(fetchSummary("g1subject")).resolves.toEqual({ count: 4, average: 1, sum: 4 })
    })

})

describe("fetchModerator", () => {
    afterEach(() => vi.restoreAllMocks())

    it("reads the current realm authority and rejects malformed values", async () => {
        const address = "g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpafgfmt"
        const query = vi.spyOn(shared, "queryEval").mockResolvedValue(`(${JSON.stringify(address)} string)`)
        expect(await fetchModerator()).toBe(address)
        expect(query).toHaveBeenCalledWith(expect.any(String), REVIEWS_PKG_PATH, "GetModerator()", true)
        query.mockResolvedValue('( "bad" string)')
        expect(await fetchModerator()).toBeNull()
    })
})

describe("publisherNote", () => {
    const OTHER = "g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpafgfmt"

    it("says a lister moderates reviews only when the moderator read from chain is that address", () => {
        expect(publisherNote(TEAM_MULTISIG_ADDRESS, TEAM_MULTISIG_ADDRESS)).toBe(" (the Samourai team multisig, which also moderates reviews)")
        expect(publisherNote(OTHER, OTHER)).toBe(" (this address also moderates reviews)")
        // Another moderator, none returned, or not read (reviews off, read pending): no moderation claim.
        for (const moderator of [OTHER, null, undefined]) expect(publisherNote(TEAM_MULTISIG_ADDRESS, moderator)).toBe(" (the Samourai team multisig)")
        for (const moderator of [TEAM_MULTISIG_ADDRESS, null, undefined]) expect(publisherNote(OTHER, moderator)).toBe("")
    })
})

describe("review reads", () => {
    afterEach(() => vi.restoreAllMocks())
    const page = (...bodies: string[]) => JSON.stringify(bodies.map((body, i) => review({ id: i + 1, author: `g1a${i}`, body })))

    it("read only from a node checked to serve this network", async () => {
        const read = vi.spyOn(shared, "queryEval").mockResolvedValue(goQuoted(page("fine")))
        await fetchReviews("gno.land/r/x/app")
        await fetchComments(1).catch(() => {})
        await fetchSummary("gno.land/r/x/app").catch(() => {})
        for (const call of read.mock.calls) expect(call[3], String(call[2])).toBe(true)
    })

    it("decode a body with runes Go quotes as \\x or \\U escapes, instead of reading the page as empty", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue(goQuoted(page("great", "fine\u007f", "x\u{f0000}")))
        const reviews = await fetchReviews("gno.land/r/x/app")
        expect(reviews.map((r) => r.body).sort()).toEqual(["fine\u007f", "great", "x\u{f0000}"])
    })

    it("throw when no node answers or the answer cannot be read: never an empty list", async () => {
        const read = vi.spyOn(shared, "queryEval")
        for (const reply of [null, '("[{\\"id\\":1}" string)', goQuoted('{"id":1}')]) {
            read.mockResolvedValue(reply as string)
            await expect(fetchReviews("gno.land/r/x/app"), String(reply)).rejects.toThrow("could not be read")
            await expect(fetchComments(1), String(reply)).rejects.toThrow("could not be read")
        }
        read.mockRejectedValue(new Error("RPC network does not match the selected chain"))
        await expect(fetchReviews("gno.land/r/x/app")).rejects.toThrow("does not match")
    })
})
