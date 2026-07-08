import { screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { ReviewsSection } from "./ReviewsSection"
import { renderWithProviders } from "../../test/test-utils"
import type { OnChainReview } from "../../lib/reviews"

function review(over: Partial<OnChainReview>): OnChainReview {
  return {
    id: 1, subject: "g1s", author: "g1a", rating: 5, body: "ok",
    createdAt: 10, editedAt: 0, deleted: false, likes: 0, dislikes: 0,
    flags: 0, reputation: 0, ...over,
  }
}

const fetchReviews = vi.fn()
const submitMsg = vi.fn()

// Keep the real pure helpers (merge/summary/optimistic); stub only the network calls.
vi.mock("../../lib/reviews", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/reviews")>()
  return {
    ...actual,
    fetchReviews: (s: string) => fetchReviews(s),
    fetchComments: vi.fn().mockResolvedValue([]),
    attachUsernames: vi.fn().mockImplementation((x: unknown[]) => Promise.resolve(x)),
    buildPostReviewMsg: vi.fn().mockReturnValue({}),
    submitMsg: (...a: unknown[]) => submitMsg(...a),
  }
})

// Keep block-height → date resolution offline in tests.
vi.mock("../../lib/blockTimeRpc", () => ({
  fetchBlockTime: vi.fn().mockResolvedValue(null),
}))

const connect = vi.fn().mockResolvedValue(false)
let adena = { address: "", connected: false, connect }
vi.mock("../../hooks/useAdena", () => ({ useAdena: () => adena }))

describe("ReviewsSection", () => {
  beforeEach(() => {
    fetchReviews.mockReset().mockResolvedValue([
      review({ id: 1, subject: "g1s", author: "g1a", body: "great validator", rating: 5, reputation: 3, username: "@alice" }),
    ])
    submitMsg.mockReset().mockResolvedValue("hash")
    connect.mockReset().mockResolvedValue(false)
    adena = { address: "", connected: false, connect }
  })

  it("shows the review body + a client-computed average, with the form visible logged-out", async () => {
    renderWithProviders(<ReviewsSection subject="g1s" />)
    expect(await screen.findByText(/great validator/)).toBeInTheDocument()
    expect(screen.getByText(/5\.0/)).toBeInTheDocument()
    expect(screen.getByRole("radiogroup", { name: /your rating/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /connect & post review/i })).toBeInTheDocument()
  })

  it("suppresses the header average below minRatedCount (App Store integrity rule)", async () => {
    // One review, but minRatedCount=3 → the header must NOT present a confident "5.0"; it shows
    // a neutral "New · 1 review" instead. The review body + form still render normally.
    renderWithProviders(<ReviewsSection subject="g1s" minRatedCount={3} />)
    expect(await screen.findByText(/great validator/)).toBeInTheDocument()
    expect(screen.queryByText(/5\.0/)).not.toBeInTheDocument()
    expect(screen.getByText(/New/)).toBeInTheDocument()
    expect(screen.getByText(/1 review\b/)).toBeInTheDocument()
  })

  it("shows a 'select a rating' hint while no rating is chosen, and does not connect on submit", async () => {
    renderWithProviders(<ReviewsSection subject="g1s" />)
    await screen.findByText(/great validator/)
    expect(screen.getByTestId("reviews-rating-hint")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /connect & post review/i }))
    expect(connect).not.toHaveBeenCalled()
  })

  it("triggers wallet connect when posting after a rating is chosen", async () => {
    renderWithProviders(<ReviewsSection subject="g1s" />)
    await screen.findByText(/great validator/)
    fireEvent.click(screen.getByRole("radio", { name: /4 stars/i }))
    fireEvent.click(screen.getByRole("button", { name: /connect & post review/i }))
    await waitFor(() => expect(connect).toHaveBeenCalled())
  })

  it("merges reviews across the canonical subject + an alias address (orphaned reviews recovered)", async () => {
    // operator subject has one review; the signing alias has a different author's review.
    fetchReviews.mockImplementation((s: string) =>
      Promise.resolve(
        s === "g1op"
          ? [review({ id: 3, subject: "g1op", author: "g1alice", body: "from operator" })]
          : [review({ id: 2, subject: "g1sign", author: "g1bob", body: "from signing" })],
      ),
    )
    renderWithProviders(<ReviewsSection subject="g1op" aliasSubjects={["g1sign"]} />)
    expect(await screen.findByText(/from operator/)).toBeInTheDocument()
    expect(await screen.findByText(/from signing/)).toBeInTheDocument()
    // 2 distinct authors → "2 reviews"
    expect(screen.getByText(/2 reviews/)).toBeInTheDocument()
  })

  it("optimistically shows a just-posted review before the chain reflects it", async () => {
    adena = { address: "g1me", connected: true, connect }
    // Chain still returns only the old review (read-after-write lag).
    fetchReviews.mockResolvedValue([review({ id: 1, author: "g1other", body: "existing" })])
    renderWithProviders(<ReviewsSection subject="g1s" />)
    await screen.findByText(/existing/)

    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }))
    fireEvent.change(screen.getByLabelText(/review \(optional\)/i), { target: { value: "my fresh take" } })
    fireEvent.click(screen.getByRole("button", { name: /post review/i }))

    // Appears immediately even though the chain fetch doesn't include it yet, marked pending.
    // findBy* for both: the pending badge lands in the same render as the text, but under a
    // loaded CI runner the retry queues can interleave — never assert async UI synchronously.
    expect(await screen.findByText(/my fresh take/)).toBeInTheDocument()
    expect(await screen.findByTestId("review-pending")).toBeInTheDocument()
    expect(submitMsg).toHaveBeenCalled()
  })

  it("stops the post-review reconcile polling after unmount (no leaked fetches)", async () => {
    adena = { address: "g1me", connected: true, connect }
    fetchReviews.mockResolvedValue([review({ id: 1, author: "g1other", body: "existing" })])
    const { unmount } = renderWithProviders(<ReviewsSection subject="g1s" />)
    await screen.findByText(/existing/)

    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }))
    fireEvent.click(screen.getByRole("button", { name: /post review/i }))
    await screen.findByTestId("review-pending")

    // The reconcile loop polls the chain every 1.5s while the optimistic entry is
    // unconfirmed. After unmount it must stop — a leaked loop keeps fetching against
    // reset mocks in whatever test runs next (the CI flake), and in prod it keeps
    // hitting the RPC after the user navigates away.
    const callsAtUnmount = fetchReviews.mock.calls.length
    unmount()
    await new Promise((r) => setTimeout(r, 1700))
    expect(fetchReviews.mock.calls.length).toBe(callsAtUnmount)
  })
})
