import { screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { ReviewsSection } from "./ReviewsSection"
import { renderWithProviders } from "../../test/test-utils"

vi.mock("../../lib/reviews", () => ({
  fetchReviews: vi.fn().mockResolvedValue([
    {
      id: 1,
      subject: "g1s",
      author: "g1a",
      rating: 5,
      body: "great validator",
      createdAt: 1,
      editedAt: 0,
      deleted: false,
      likes: 2,
      dislikes: 0,
      flags: 0,
      reputation: 3,
      username: "@alice",
    },
  ]),
  fetchSummary: vi.fn().mockResolvedValue({ count: 1, average: 5, sum: 5 }),
  fetchComments: vi.fn().mockResolvedValue([]),
  attachUsernames: vi.fn().mockImplementation((x: unknown[]) => Promise.resolve(x)),
  buildPostReviewMsg: vi.fn(),
  submitMsg: vi.fn(),
  REVIEWS_PKG_PATH: "gno.land/r/samcrew/memba_reviews_v1",
}))

// Keep block-height → date resolution offline in tests.
vi.mock("../../lib/blockTimeRpc", () => ({
  fetchBlockTime: vi.fn().mockResolvedValue(null),
}))

const connect = vi.fn().mockResolvedValue(false)
vi.mock("../../hooks/useAdena", () => ({
  useAdena: () => ({ address: "", connected: false, connect }),
}))

describe("ReviewsSection", () => {
  it("shows summary + a review body, and the write form is visible while logged out", async () => {
    renderWithProviders(<ReviewsSection subject="g1s" />)

    expect(await screen.findByText(/great validator/)).toBeInTheDocument()
    // Average displays — sum/count = 5/1 = 5.0
    expect(screen.getByText(/5\.0/)).toBeInTheDocument()

    // The form (rating radiogroup + Connect & post button) is present without a wallet.
    expect(screen.getByRole("radiogroup", { name: /your rating/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /connect & post review/i })).toBeInTheDocument()
  })

  it("triggers wallet connect when posting while logged out (after a rating is chosen)", async () => {
    connect.mockClear()
    renderWithProviders(<ReviewsSection subject="g1s" />)
    await screen.findByText(/great validator/)

    // Choose 4 stars, then submit.
    fireEvent.click(screen.getByRole("radio", { name: /4 stars/i }))
    fireEvent.click(screen.getByRole("button", { name: /connect & post review/i }))

    await waitFor(() => expect(connect).toHaveBeenCalled())
  })

  it("does not connect when no rating is selected", async () => {
    connect.mockClear()
    renderWithProviders(<ReviewsSection subject="g1s" />)
    await screen.findByText(/great validator/)

    fireEvent.click(screen.getByRole("button", { name: /connect & post review/i }))
    expect(connect).not.toHaveBeenCalled()
  })
})
