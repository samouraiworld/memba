/**
 * W5.3 — ValidatorReviewStars / ValidatorReviewPreview.
 *
 * Pins: lazy summary fetch + module cache (no refetch on remount), the
 * no-reviews dash, star clamping on bad realm data, deleted-tombstone
 * filtering in the hover preview, and the concurrency limiter (≤4 in flight).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import {
    ValidatorReviewStars,
    ValidatorReviewPreview,
    getValidatorReviewSummary,
    __resetValidatorReviewCaches,
} from "./ValidatorReviewStars"
import type { OnChainReview } from "../../lib/reviews"

const mocks = vi.hoisted(() => ({
    fetchSummary: vi.fn(),
    fetchReviews: vi.fn(),
}))

vi.mock("../../lib/reviews", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/reviews")>()),
    fetchSummary: mocks.fetchSummary,
    fetchReviews: mocks.fetchReviews,
}))

const review = (over: Partial<OnChainReview>): OnChainReview => ({
    id: 1, subject: "g1val", author: "g1author", rating: 4, body: "solid uptime",
    createdAt: 100, editedAt: 0, deleted: false, likes: 0, dislikes: 0, flags: 0,
    reputation: 0, ...over,
})

beforeEach(() => {
    __resetValidatorReviewCaches()
    mocks.fetchSummary.mockReset()
    mocks.fetchReviews.mockReset()
})

describe("ValidatorReviewStars", () => {
    it("renders stars + count from the fetched summary", async () => {
        mocks.fetchSummary.mockResolvedValue({ count: 3, average: 4.2, sum: 13 })
        render(<ValidatorReviewStars addr="g1val" />)

        const el = await screen.findByTestId("validator-stars")
        expect(el.textContent).toContain("★★★★☆")
        expect(el.textContent).toContain("(3)")
        expect(el.getAttribute("title")).toContain("4.2 / 5")
    })

    it("shows a muted dash when there are no reviews", async () => {
        mocks.fetchSummary.mockResolvedValue({ count: 0, average: 0, sum: 0 })
        render(<ValidatorReviewStars addr="g1val" />)
        await waitFor(() => expect(screen.getByTitle("No reviews yet")).toBeTruthy())
    })

    it("clamps out-of-range averages instead of throwing", async () => {
        mocks.fetchSummary.mockResolvedValue({ count: 2, average: 11, sum: 22 })
        render(<ValidatorReviewStars addr="g1val" />)
        const el = await screen.findByTestId("validator-stars")
        expect(el.textContent).toContain("★★★★★")
    })

    it("serves the module cache on remount (single fetch per address)", async () => {
        mocks.fetchSummary.mockResolvedValue({ count: 1, average: 5, sum: 5 })
        const first = render(<ValidatorReviewStars addr="g1cached" />)
        await screen.findByTestId("validator-stars")
        first.unmount()

        render(<ValidatorReviewStars addr="g1cached" />)
        await screen.findByTestId("validator-stars")
        expect(mocks.fetchSummary).toHaveBeenCalledTimes(1)
    })

    it("renders the pending placeholder for an empty address without fetching", () => {
        render(<ValidatorReviewStars addr="" />)
        expect(mocks.fetchSummary).not.toHaveBeenCalled()
    })
})

describe("concurrency limiter", () => {
    it("never runs more than 4 summary fetches at once", async () => {
        let inFlight = 0
        let peak = 0
        const resolvers: (() => void)[] = []
        mocks.fetchSummary.mockImplementation(() => {
            inFlight++
            peak = Math.max(peak, inFlight)
            return new Promise(res => {
                resolvers.push(() => { inFlight--; res({ count: 0, average: 0, sum: 0 }) })
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
        expect(mocks.fetchSummary).toHaveBeenCalledTimes(10)
    })
})

describe("ValidatorReviewPreview", () => {
    it("shows recent reviews and filters deleted tombstones", async () => {
        mocks.fetchReviews.mockResolvedValue([
            review({ id: 1, body: "great validator" }),
            review({ id: 2, body: "", deleted: true }),
            review({ id: 3, rating: 2, body: "missed blocks recently" }),
        ])
        render(<ValidatorReviewPreview addr="g1val" />)

        await waitFor(() => expect(screen.getByText("great validator")).toBeTruthy())
        expect(screen.getByText("missed blocks recently")).toBeTruthy()
        expect(document.querySelectorAll(".vhc-review")).toHaveLength(2)
    })

    it("renders nothing when there are no reviews", async () => {
        mocks.fetchReviews.mockResolvedValue([])
        const { container } = render(<ValidatorReviewPreview addr="g1val" />)
        await waitFor(() => expect(mocks.fetchReviews).toHaveBeenCalled())
        expect(container.innerHTML).toBe("")
    })
})
