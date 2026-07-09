import { waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { ReviewsSection } from "./ReviewsSection"
import { renderWithProviders } from "../../test/test-utils"

// B2b: ReviewsSection is reused on the App Store detail page with a realmPath pointing at the
// reputation-isolated app-reviews realm. This pins that the prop actually reaches the data layer
// (fetchReviews' 4th positional arg) — and that omitting it leaves the arg undefined, so the
// client falls back to the default web-of-trust realm for the existing validator/profile callers.

const fetchReviews = vi.fn()

vi.mock("../../lib/reviews", async (importActual) => {
    const actual = await importActual<typeof import("../../lib/reviews")>()
    return {
        ...actual,
        // Forward ALL args (unlike the sibling suite, which only needs `subject`) so we can
        // assert the realmPath lands in the 4th slot.
        fetchReviews: (...a: unknown[]) => fetchReviews(...a),
        fetchComments: vi.fn().mockResolvedValue([]),
        attachUsernames: vi.fn().mockImplementation((x: unknown[]) => Promise.resolve(x)),
    }
})

vi.mock("../../lib/blockTimeRpc", () => ({
    fetchBlockTime: vi.fn().mockResolvedValue(null),
}))

vi.mock("../../hooks/useAdena", () => ({
    useAdena: () => ({ address: "", connected: false, connect: vi.fn() }),
}))

const APP_REVIEWS = "gno.land/r/samcrew/memba_appstore_reviews_v1"
const SUBJECT = "gno.land/r/samcrew/block_party"

describe("ReviewsSection realmPath threading", () => {
    beforeEach(() => fetchReviews.mockReset().mockResolvedValue([]))

    it("passes an explicit realmPath through to fetchReviews", async () => {
        renderWithProviders(<ReviewsSection subject={SUBJECT} realmPath={APP_REVIEWS} />)
        await waitFor(() => expect(fetchReviews).toHaveBeenCalled())
        expect(fetchReviews.mock.calls[0]).toEqual([SUBJECT, 0, 20, APP_REVIEWS])
    })

    it("leaves realmPath undefined when the prop is omitted (falls back to the default realm)", async () => {
        renderWithProviders(<ReviewsSection subject={SUBJECT} />)
        await waitFor(() => expect(fetchReviews).toHaveBeenCalled())
        expect(fetchReviews.mock.calls[0]).toEqual([SUBJECT, 0, 20, undefined])
    })
})
