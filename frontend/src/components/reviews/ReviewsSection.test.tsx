import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { ReviewsSection } from "./ReviewsSection"

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

// useAdena: disconnected — field is `connected` (not `isConnected`)
vi.mock("../../hooks/useAdena", () => ({
  useAdena: () => ({
    address: "",
    connected: false,
    connect: vi.fn(),
  }),
}))

describe("ReviewsSection", () => {
  it("shows summary + a review body and a connect gate", async () => {
    render(<ReviewsSection subject="g1s" />)

    // Review body renders
    expect(await screen.findByText(/great validator/)).toBeInTheDocument()

    // Average displays — sum/count = 5/1 = 5.0
    expect(screen.getByText(/5\.0/)).toBeInTheDocument()

    // Connect gate appears when disconnected — button is present
    expect(screen.getByRole("button", { name: /connect wallet to review/i })).toBeInTheDocument()
  })
})
