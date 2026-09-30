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
const fetchSummary = vi.fn()
const fetchModerator = vi.fn()
const submitReviewAction = vi.fn()
const submitReview = vi.fn()

// Keep the real pure helpers (merge/summary/optimistic); stub only the network calls.
vi.mock("../../lib/reviews", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/reviews")>()
  return {
    ...actual,
    fetchReviews: (...args: unknown[]) => fetchReviews(...args),
    fetchSummary: (...args: unknown[]) => fetchSummary(...args),
    fetchModerator: (...args: unknown[]) => fetchModerator(...args),
    fetchComments: vi.fn().mockResolvedValue([]),
    attachUsernames: vi.fn().mockImplementation((x: unknown[]) => Promise.resolve(x)),
    submitReviewAction: (...a: unknown[]) => submitReviewAction(...a),
    submitReview: (...a: unknown[]) => submitReview(...a),
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
    submitReviewAction.mockReset().mockResolvedValue("hash")
    submitReview.mockReset().mockResolvedValue("hash")
    fetchSummary.mockReset().mockResolvedValue({ count: 0, sum: 0, average: 0 })
    fetchModerator.mockReset().mockResolvedValue(null)
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

  it("uses the all-review summary and loads the next visible page for App Store reviews", async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => review({ id: index + 1, author: `g1author${index}`, body: `page-one-${index}` }))
    fetchReviews.mockImplementation((_subject: string, offset: number) => Promise.resolve(offset === 0 ? firstPage : [review({ id: 21, author: "g1later", body: "page-two-review" })]))
    fetchSummary.mockResolvedValue({ count: 25, sum: 100, average: 4 })
    renderWithProviders(<ReviewsSection subject="gno.land/r/samcrew/app" minRatedCount={3} paginate useOnchainSummary />)

    expect(await screen.findByText("page-one-0")).toBeInTheDocument()
    expect(screen.getByText(/25 reviews/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Load more reviews" }))
    expect(await screen.findByText("page-two-review")).toBeInTheDocument()
    // 21 of the 25 counted reviews are loaded: the realm's count, not the short page, decides.
    expect(screen.getByRole("button", { name: "Load more reviews" })).toBeInTheDocument()
    expect(fetchReviews).toHaveBeenCalledWith("gno.land/r/samcrew/app", 20, 20)
  })

  // The realm windows raw ids and then drops hidden reviews, so a page can be short, or empty, mid-list.
  const pages = (byOffset: Record<number, number>) => {
    fetchReviews.mockImplementation((_subject: string, offset: number) => Promise.resolve(
      Array.from({ length: byOffset[offset] ?? 0 }, (_, index) => review({ id: offset + index + 1, author: `g1author${offset + index}`, body: `review-${offset + index}` }))))
  }
  const appReviews = () => renderWithProviders(<ReviewsSection subject="gno.land/r/samcrew/app" paginate useOnchainSummary />)

  it("keeps paging past a page shortened by a hidden review, until the realm's count is loaded", async () => {
    pages({ 0: 19, 20: 6 })
    fetchSummary.mockResolvedValue({ count: 25, sum: 100, average: 4 })
    appReviews()
    expect(await screen.findByText("review-0")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Load more reviews" }))
    expect(await screen.findByText("review-25")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("button", { name: /Load more reviews|Loading/ })).not.toBeInTheDocument())
  })

  it("steps over a page that holds only hidden reviews", async () => {
    pages({ 0: 20, 20: 0, 40: 3 })
    fetchSummary.mockResolvedValue({ count: 23, sum: 92, average: 4 })
    appReviews()
    expect(await screen.findByText("review-0")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Load more reviews" }))
    expect(await screen.findByText("review-42")).toBeInTheDocument()
    expect(fetchReviews).toHaveBeenCalledWith("gno.land/r/samcrew/app", 40, 20)
    await waitFor(() => expect(screen.queryByRole("button", { name: /Load more reviews|Loading/ })).not.toBeInTheDocument())
  })

  it("stops offering more after a run of empty pages, even if the count says otherwise", async () => {
    pages({ 0: 20 })
    fetchSummary.mockResolvedValue({ count: 30, sum: 120, average: 4 })
    appReviews()
    expect(await screen.findByText("review-0")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Load more reviews" }))
    await waitFor(() => expect(fetchReviews).toHaveBeenCalledTimes(6))
    await waitFor(() => expect(screen.queryByRole("button", { name: /Load more reviews|Loading/ })).not.toBeInTheDocument())
  })

  it("shows how many are loaded, not a rating, when the realm's summary cannot be read, and ends on a short page", async () => {
    pages({ 0: 20, 20: 3 })
    fetchSummary.mockRejectedValue(new Error("The reviews summary could not be read."))
    appReviews()
    expect(await screen.findByText("20 shown")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Load more reviews" }))
    expect(await screen.findByText("23 shown")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Load more reviews" })).not.toBeInTheDocument()
    expect(fetchReviews).toHaveBeenCalledTimes(2)
  })

  it("steps over a first page of hidden reviews too, and says none only when the realm's count is zero", async () => {
    pages({ 40: 2 })
    fetchSummary.mockResolvedValue({ count: 2, sum: 8, average: 4 })
    appReviews()
    expect(await screen.findByText("review-40")).toBeInTheDocument()
    expect(fetchReviews).toHaveBeenCalledWith("gno.land/r/samcrew/app", 40, 20)
    expect(screen.queryByText("No reviews yet. Be the first!")).not.toBeInTheDocument()
  })

  it("does not call a counted subject empty when every page read is hidden", async () => {
    pages({})
    fetchSummary.mockResolvedValue({ count: 3, sum: 12, average: 4 })
    appReviews()
    expect(await screen.findByText("The reviews read so far are hidden or removed.")).toBeInTheDocument()
    expect(screen.queryByText("No reviews yet. Be the first!")).not.toBeInTheDocument()
    // The first page and five more, then it stops.
    expect(fetchReviews).toHaveBeenCalledTimes(6)
  })

  it("without the realm's count, reads one page per request: an empty page is the end", async () => {
    pages({ 0: 20 })
    fetchSummary.mockRejectedValue(new Error("The reviews summary could not be read."))
    appReviews()
    expect(await screen.findByText("review-0")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Load more reviews" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: /Load more reviews|Loading/ })).not.toBeInTheDocument())
    expect(fetchReviews).toHaveBeenCalledTimes(2)
  })

  it("offers no more pages while a just-posted review waits for the chain", async () => {
    adena = { address: "g1me", connected: true, connect }
    pages({ 0: 20 })
    fetchSummary.mockResolvedValue({ count: 25, sum: 100, average: 4 })
    appReviews()
    expect(await screen.findByRole("button", { name: "Load more reviews" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }))
    fireEvent.click(screen.getByRole("button", { name: /post review/i }))
    expect(await screen.findByTestId("review-pending")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Load more reviews" })).not.toBeInTheDocument()
  })

  it("refuses a review text longer than the realm takes, in bytes, before any wallet opens", async () => {
    adena = { address: "g1me", connected: true, connect }
    renderWithProviders(<ReviewsSection subject="g1s" />)
    await screen.findByText(/great validator/)
    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }))
    const box = screen.getByLabelText(/review \(optional\)/i)
    fireEvent.change(box, { target: { value: "é".repeat(1000) } })
    expect(screen.getByText("2,000 of 2,000 bytes")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /post review/i })).toBeEnabled()
    fireEvent.change(box, { target: { value: "é".repeat(1001) } })
    expect(screen.getByText("Review text must be 2,000 bytes or fewer: this is 2,002.")).toBeInTheDocument()
    expect(box).toHaveAttribute("aria-invalid", "true")
    const post = screen.getByRole("button", { name: /post review/i })
    expect(post).toBeDisabled()
    fireEvent.submit(post.closest("form")!)
    expect(submitReview).not.toHaveBeenCalled()
  })

  it("lets a reader retry a failed review page", async () => {
    fetchReviews.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValueOnce([review({ body: "back online" })])
    renderWithProviders(<ReviewsSection subject="g1s" />)
    expect(await screen.findByRole("button", { name: "Retry reviews" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry reviews" }))
    expect(await screen.findByText("back online")).toBeInTheDocument()
  })

  it("signs a classic action in the wallet for the connected address, and reloads the list", async () => {
    adena = { address: "g1me", connected: true, connect }
    renderWithProviders(<ReviewsSection subject="g1s" />)
    expect(await screen.findByText("great validator")).toBeInTheDocument()
    const reads = fetchReviews.mock.calls.length
    fireEvent.click(screen.getByRole("button", { name: "Like — 0" }))
    await waitFor(() => expect(submitReviewAction).toHaveBeenCalledWith("g1me", { kind: "react", target: 1, on: "review", reaction: "like" }))
    await waitFor(() => expect(fetchReviews.mock.calls.length).toBeGreaterThan(reads))
  })

  it("hands a Memba OS surface the actions for its viewer, leaves the post form out, and never opens the wallet itself", async () => {
    // A classic wallet that happens to be connected is not the OS session: only `viewer` counts.
    adena = { address: "g1classic", connected: true, connect }
    const act = vi.fn().mockResolvedValue(false)
    const guest = renderWithProviders(<ReviewsSection subject="g1s" os={{ viewer: null, act }} />)
    expect(await screen.findByText("great validator")).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: /your rating/i })).not.toBeInTheDocument()
    // Word labels, no emoji; a guest presses an action and the surface asks for its session.
    const like = screen.getByRole("button", { name: "Like — 0" })
    expect(like).toHaveTextContent("Like 0")
    fireEvent.click(screen.getByRole("button", { name: "Flag for moderation" }))
    await waitFor(() => expect(act).toHaveBeenCalledWith({ kind: "flag", target: 1, on: "review" }))
    expect(connect).not.toHaveBeenCalled()
    act.mockClear()
    guest.unmount()

    renderWithProviders(<ReviewsSection subject="g1s" os={{ viewer: "g1member", act }} />)
    expect(await screen.findByText("great validator")).toBeInTheDocument()
    const reads = fetchReviews.mock.calls.length
    fireEvent.click(screen.getByRole("button", { name: "Flag for moderation" }))
    await waitFor(() => expect(act).toHaveBeenCalledWith({ kind: "flag", target: 1, on: "review" }))
    expect(submitReviewAction).not.toHaveBeenCalled()
    // Handed over, nothing sent yet: the surface reloads the list itself when the chain has it.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchReviews.mock.calls.length).toBe(reads)
  })

  it("states what liking, flagging and replying lock, from the measured storage", async () => {
    renderWithProviders(<ReviewsSection subject="g1s" />)
    expect(await screen.findByText("great validator")).toBeInTheDocument()
    expect(screen.getByText(/Liking, flagging and replying are chain transactions too/)).toHaveTextContent("each paying the network fee. A first like or dislike on a review locks a storage deposit of up to 0.22 GNOT, a flag up to 0.22 GNOT, and a reply up to 0.37 GNOT plus its text. "
      + "Undoing a reaction returns about half of its deposit, and deleting a reply returns what its text took; the rest stays locked. "
      + "A flag cannot be withdrawn, and Flag stays available after you flag: flagging the same review again fails on chain and still costs the fee.")
  })

  it("asks a visitor on the classic page for the wallet when they press an action, and sends nothing", async () => {
    adena = { address: "", connected: false, connect }
    renderWithProviders(<ReviewsSection subject="g1s" />)
    expect(await screen.findByText("great validator")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Flag for moderation" }))
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    expect(submitReviewAction).not.toHaveBeenCalled()
  })

  it("names the realm's moderator in the policy and offers no hide control, even to that moderator", async () => {
    const moderator = "g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpafgfmt"
    adena = { address: moderator, connected: true, connect }
    fetchModerator.mockResolvedValue(moderator)
    renderWithProviders(<ReviewsSection subject="g1s" />)
    expect(await screen.findByText("great validator")).toBeInTheDocument()
    expect(await screen.findByText(moderator)).toBeInTheDocument()
    expect(screen.getByText("How reviews are moderated")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^(Hide|Unhide)$/ })).not.toBeInTheDocument()
  })

  it("shows the policy on the OS view too", async () => {
    fetchModerator.mockResolvedValue("g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpafgfmt")
    renderWithProviders(<ReviewsSection subject="g1s" os={{ viewer: null, act: vi.fn() }} />)
    expect(await screen.findByText("g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpafgfmt")).toBeInTheDocument()
  })

  it("states no policy while the moderator is being read, nor for a realm that returns none", async () => {
    // A reviews realm that returns no moderator, or an unreadable one: the policy describes
    // the realm's behaviour, so it is not stated for it.
    const unread = "How these reviews are moderated cannot be shown: the reviews realm did not return its moderator."
    let answer!: (value: string | null) => void
    fetchModerator.mockReturnValue(new Promise((resolve) => { answer = resolve }))
    const pending = renderWithProviders(<ReviewsSection subject="g1s" />)
    expect(await screen.findByText("great validator")).toBeInTheDocument()
    expect(screen.queryByText("How reviews are moderated")).not.toBeInTheDocument()
    expect(screen.queryByText(unread)).not.toBeInTheDocument()
    answer(null)
    expect(await screen.findByText(unread)).toBeInTheDocument()
    expect(screen.queryByText("How reviews are moderated")).not.toBeInTheDocument()
    expect(screen.queryByText(/g1[0-9a-z]{38}/)).not.toBeInTheDocument()
    pending.unmount()

    fetchModerator.mockReset().mockRejectedValue(new Error("rpc down"))
    renderWithProviders(<ReviewsSection subject="g1s" />)
    expect(await screen.findByText(unread)).toBeInTheDocument()
    expect(screen.queryByText("How reviews are moderated")).not.toBeInTheDocument()
    expect(screen.queryByText(/g1[0-9a-z]{38}/)).not.toBeInTheDocument()
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
    expect(submitReview).toHaveBeenCalledWith("g1me", "g1s", 5, "my fresh take")
  })

  it("states the deposit a new review locks, for the text as typed, before any wallet opens", async () => {
    renderWithProviders(<ReviewsSection subject="g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" />)
    await screen.findByText(/great validator/)
    const cost = () => screen.getByText(/^Posting pays the network fee/)
    // 12,120 bytes for a 40-character subject, at 100 ugnot per byte.
    expect(cost().textContent).toBe("Posting pays the network fee, shown before your wallet opens, and locks a storage deposit: up to 1.21 GNOT for the first review here, less for a later one. "
      + "Replacing your own review locks only what its text adds. Deleting a review returns a small part of its deposit; the rest stays locked. "
      + "If a moderator hid your review, posting again creates a new review with its own deposit.")
    // Surrounding whitespace is not stored: counted, the 300 spaces would read 1.44 GNOT.
    fireEvent.change(screen.getByLabelText(/review \(optional\)/i), { target: { value: `${" ".repeat(150)}${"x".repeat(2000)}${" ".repeat(150)}` } })
    expect(cost()).toHaveTextContent("up to 1.41 GNOT")
    expect(submitReview).not.toHaveBeenCalled()
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
