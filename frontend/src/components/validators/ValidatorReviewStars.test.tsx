/**
 * ValidatorReviewStars / ValidatorReviewPreview.
 *
 * Pins: lazy review fetch + module cache (no refetch on remount), summary
 * derived from the merged list, the no-reviews dash, star clamping on bad realm
 * data, deleted-tombstone filtering, the in-flight dedup, the concurrency
 * limiter (≤4 in flight), and — the fix — canonical/alias subject merging so a
 * validator whose reviews live under its operator address (with a signing-address
 * alias) is counted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import { ValidatorReviewStars, ValidatorReviewPreview } from "./ValidatorReviewStars"
import {
    getValidatorReviewSummary,
    buildSigningToOperator,
    resolveReviewSubjects,
    __resetValidatorReviewCaches,
} from "./validatorReviewsData"
import type { OnChainReview } from "../../lib/reviews"

const mocks = vi.hoisted(() => ({
    fetchReviews: vi.fn(),
}))

vi.mock("../../lib/reviews", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/reviews")>()),
    fetchReviews: mocks.fetchReviews,
}))

const review = (over: Partial<OnChainReview>): OnChainReview => ({
    id: 1, subject: "g1val", author: "g1author", rating: 4, body: "solid uptime",
    createdAt: 100, editedAt: 0, deleted: false, likes: 0, dislikes: 0, flags: 0,
    reputation: 0, ...over,
})

beforeEach(() => {
    __resetValidatorReviewCaches()
    mocks.fetchReviews.mockReset()
})

describe("subject resolution", () => {
    it("resolves a registered validator to its operator address with a signing alias", () => {
        const map = buildSigningToOperator([{ signingAddress: "g1SIGN", operatorAddress: "g1op" }])
        expect(resolveReviewSubjects("g1sign", map)).toEqual({ subject: "g1op", aliases: ["g1sign"] })
    })
    it("falls back to the signing address when no valoper is registered", () => {
        expect(resolveReviewSubjects("g1lonely", new Map())).toEqual({ subject: "g1lonely", aliases: [] })
    })
    it("returns an empty subject for a missing address", () => {
        expect(resolveReviewSubjects("", new Map())).toEqual({ subject: "", aliases: [] })
    })
})

describe("ValidatorReviewStars", () => {
    it("renders stars + count derived from the merged reviews", async () => {
        mocks.fetchReviews.mockResolvedValue([
            review({ author: "a", rating: 4 }),
            review({ author: "b", rating: 4 }),
            review({ author: "c", rating: 5 }),
        ])
        render(<ValidatorReviewStars subject="g1val" />)

        const el = await screen.findByTestId("validator-stars")
        expect(el.textContent).toContain("★★★★☆")
        expect(el.textContent).toContain("(3)")
        expect(el.getAttribute("title")).toContain("4.3 / 5")
    })

    it("shows a muted dash when there are no reviews", async () => {
        mocks.fetchReviews.mockResolvedValue([])
        render(<ValidatorReviewStars subject="g1val" />)
        await waitFor(() => expect(screen.getByTitle("No reviews yet")).toBeTruthy())
    })

    it("clamps out-of-range averages instead of throwing", async () => {
        mocks.fetchReviews.mockResolvedValue([
            review({ author: "a", rating: 11 }),
            review({ author: "b", rating: 11 }),
        ])
        render(<ValidatorReviewStars subject="g1val" />)
        const el = await screen.findByTestId("validator-stars")
        expect(el.textContent).toContain("★★★★★")
    })

    it("merges reviews across the canonical subject + signing alias", async () => {
        mocks.fetchReviews.mockImplementation((subject: string) =>
            Promise.resolve(subject === "g1op"
                ? [review({ author: "a", rating: 5, subject: "g1op" })]
                : [review({ author: "b", rating: 3, subject: "g1sign" })]),
        )
        render(<ValidatorReviewStars subject="g1op" aliases={["g1sign"]} />)

        const el = await screen.findByTestId("validator-stars")
        // Two distinct authors across the two subjects → count 2, avg 4.0.
        expect(el.textContent).toContain("(2)")
        expect(el.getAttribute("title")).toContain("4.0 / 5")
        expect(mocks.fetchReviews).toHaveBeenCalledTimes(2)
    })

    it("serves the module cache on remount (single fetch per canonical subject)", async () => {
        mocks.fetchReviews.mockResolvedValue([review({ author: "a", rating: 5 })])
        const first = render(<ValidatorReviewStars subject="g1cached" />)
        await screen.findByTestId("validator-stars")
        first.unmount()

        render(<ValidatorReviewStars subject="g1cached" />)
        await screen.findByTestId("validator-stars")
        expect(mocks.fetchReviews).toHaveBeenCalledTimes(1)
    })

    it("renders the pending placeholder for an empty subject without fetching", () => {
        render(<ValidatorReviewStars subject="" />)
        expect(mocks.fetchReviews).not.toHaveBeenCalled()
    })
})

describe("StrictMode / racing mounts", () => {
    it("dedupes concurrent fetches for the same subject (in-flight promise share)", async () => {
        let resolveFetch!: (v: unknown) => void
        mocks.fetchReviews.mockImplementation(() => new Promise(res => { resolveFetch = res }))

        // Two racing requests before the first resolves — StrictMode's shape.
        const a = getValidatorReviewSummary("g1race")
        const b = getValidatorReviewSummary("g1race")
        await act(async () => { await Promise.resolve() })
        expect(mocks.fetchReviews).toHaveBeenCalledTimes(1)

        resolveFetch([review({ author: "a", rating: 4 }), review({ author: "b", rating: 4 })])
        expect(await a).toEqual(await b)
    })
})

describe("error paths (never cached)", () => {
    it("falls back to the no-reviews state on rejection and retries on next mount", async () => {
        mocks.fetchReviews.mockRejectedValueOnce(new Error("rpc down"))
        const first = render(<ValidatorReviewStars subject="g1err" />)
        await waitFor(() => expect(screen.getByTitle("No reviews yet")).toBeTruthy())
        first.unmount()

        // The failure must NOT be cached — a later mount retries and succeeds.
        mocks.fetchReviews.mockResolvedValueOnce([review({ author: "a", rating: 5 })])
        render(<ValidatorReviewStars subject="g1err" />)
        const el = await screen.findByTestId("validator-stars")
        expect(el.textContent).toContain("(1)")
        expect(mocks.fetchReviews).toHaveBeenCalledTimes(2)
    })

    it("preview renders nothing on rejection without poisoning the cache", async () => {
        mocks.fetchReviews.mockRejectedValueOnce(new Error("rpc down"))
        const first = render(<ValidatorReviewPreview subject="g1err2" />)
        await waitFor(() => expect(mocks.fetchReviews).toHaveBeenCalledTimes(1))
        expect(first.container.innerHTML).toBe("")
        first.unmount()

        mocks.fetchReviews.mockResolvedValueOnce([review({ id: 9, author: "z", body: "back online" })])
        render(<ValidatorReviewPreview subject="g1err2" />)
        await waitFor(() => expect(screen.getByText("back online")).toBeTruthy())
        expect(mocks.fetchReviews).toHaveBeenCalledTimes(2)
    })
})

describe("concurrency limiter", () => {
    it("never runs more than 4 review fetches at once", async () => {
        let inFlight = 0
        let peak = 0
        const resolvers: (() => void)[] = []
        mocks.fetchReviews.mockImplementation(() => {
            inFlight++
            peak = Math.max(peak, inFlight)
            return new Promise(res => {
                resolvers.push(() => { inFlight--; res([]) })
            })
        })

        const all = Promise.all(
            Array.from({ length: 10 }, (_, i) => getValidatorReviewSummary(`g1addr${i}`)),
        )
        await act(async () => { await Promise.resolve() })
        expect(peak).toBeLessThanOrEqual(4)

        // Drain: releasing each in-flight call admits the next queued one.
        while (resolvers.length > 0) {
            resolvers.shift()!()
            await act(async () => { await Promise.resolve() })
        }
        await all
        expect(peak).toBeLessThanOrEqual(4)
        expect(mocks.fetchReviews).toHaveBeenCalledTimes(10)
    })
})

describe("ValidatorReviewPreview", () => {
    it("shows recent reviews and filters deleted tombstones", async () => {
        mocks.fetchReviews.mockResolvedValue([
            review({ id: 1, author: "a", body: "great validator" }),
            review({ id: 2, author: "b", body: "", deleted: true }),
            review({ id: 3, author: "c", rating: 2, body: "missed blocks recently" }),
        ])
        render(<ValidatorReviewPreview subject="g1val" />)

        await waitFor(() => expect(screen.getByText("great validator")).toBeTruthy())
        expect(screen.getByText("missed blocks recently")).toBeTruthy()
        expect(document.querySelectorAll(".vhc-review")).toHaveLength(2)
    })

    it("renders nothing when there are no reviews", async () => {
        mocks.fetchReviews.mockResolvedValue([])
        const { container } = render(<ValidatorReviewPreview subject="g1val" />)
        await waitFor(() => expect(mocks.fetchReviews).toHaveBeenCalled())
        expect(container.innerHTML).toBe("")
    })
})
