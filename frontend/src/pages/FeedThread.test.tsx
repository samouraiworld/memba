/**
 * FeedThread — reply pagination (B.2). GetFeedThread is keyset-paginated
 * (replies oldest-first, `nextCursor` advances). The page must not discard
 * `nextCursor`: a thread with more replies than one page must expose a
 * "Show more replies" control that appends the next page. The API + hooks are
 * mocked at the module boundary; react-query drives the real page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { FeedViewerProvider } from "../components/feed/FeedViewerProvider"

vi.mock("react-router-dom", () => ({ useParams: () => ({ id: "100" }) }))
const wallet = vi.hoisted(() => ({ address: undefined as string | undefined, connected: false, connect: vi.fn() }))
vi.mock("../hooks/useAdena", () => ({ useAdena: () => wallet }))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => vi.fn() }))
vi.mock("../hooks/home/useActorUsernames", () => ({ useActorUsernames: () => new Map() }))
vi.mock("../lib/feedApi", () => ({ fetchFeedThread: vi.fn() }))

const { fetchFeedThread } = await import("../lib/feedApi")
const FeedThread = (await import("./FeedThread")).default
const mockFetch = vi.mocked(fetchFeedThread)

const post = (id: bigint, body: string, replyTo = 0n) => ({
    id, author: "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", body, replyTo, blockH: id, blockTs: 0n,
    editedAt: 0n, flagCount: 0, hidden: false, deleted: false, replyCount: 0,
})

function renderWithClient(ui: ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
    wallet.address = undefined
    wallet.connected = false
    mockFetch.mockReset()
    // cursor 0 → root + first reply page (more available); cursor 2 → last page, end.
    mockFetch.mockImplementation((_postId: bigint, cursor: bigint) =>
        cursor === 0n
            ? Promise.resolve({
                root: post(100n, "the root post"),
                replies: [post(1n, "first reply", 100n), post(2n, "second reply", 100n)],
                nextCursor: 2n,
            })
            : Promise.resolve({
                root: post(100n, "the root post"),
                replies: [post(3n, "third reply", 100n)],
                nextCursor: 0n,
            }),
    )
})

describe("FeedThread reply pagination", () => {
    it("shows a retry on service failure rather than saying the post is missing", async () => {
        mockFetch.mockRejectedValueOnce(new Error("offline"))
        renderWithClient(<FeedThread />)
        expect(await screen.findByText("Couldn't load the thread")).toBeInTheDocument()
        expect(screen.queryByText("Post not found")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(await screen.findByText("the root post")).toBeInTheDocument()
    })

    it("keeps a wallet-connected but unsigned OS guest out of reply writes", async () => {
        wallet.address = "g1wallet"
        wallet.connected = true
        const connect = vi.fn().mockReturnValue(false)
        renderWithClient(<FeedViewerProvider value={{ connected: false, address: undefined, connect, queueOnConnect: false }}><FeedThread /></FeedViewerProvider>)
        await screen.findByText("the root post")
        expect(mockFetch).toHaveBeenCalledWith(100n, 0n, 50, undefined)
        const input = screen.getByRole("textbox", { name: "Write a reply" })
        fireEvent.change(input, { target: { value: "draft reply" } })
        fireEvent.click(screen.getByRole("button", { name: "Connect to reply" }))
        expect(connect).toHaveBeenCalledOnce()
        expect(wallet.connect).not.toHaveBeenCalled()
        expect(screen.getByRole("button", { name: "Connect to reply" })).toBeEnabled()
        expect(input).toHaveValue("draft reply")
    })

    it("renders the root and the first reply page", async () => {
        renderWithClient(<FeedThread />)
        await screen.findByText("the root post")
        expect(screen.getByText("first reply")).toBeInTheDocument()
        expect(screen.getByText("second reply")).toBeInTheDocument()
        // The next page hasn't loaded yet.
        expect(screen.queryByText("third reply")).toBeNull()
    })

    it("appends the next reply page on 'Show more replies' and stops at the end", async () => {
        renderWithClient(<FeedThread />)
        const more = await screen.findByTestId("feed-thread-load-more")
        fireEvent.click(more)
        await screen.findByText("third reply")
        // Earlier replies stay — pages are appended, not replaced.
        expect(screen.getByText("first reply")).toBeInTheDocument()
        expect(screen.getByText("second reply")).toBeInTheDocument()
        // Cursor pagination reached the end → the control is gone.
        await waitFor(() => expect(screen.queryByTestId("feed-thread-load-more")).toBeNull())
    })

    it("shows no 'Show more replies' control when the first page is the last", async () => {
        mockFetch.mockImplementation(() =>
            Promise.resolve({
                root: post(100n, "the root post"),
                replies: [post(1n, "only reply", 100n)],
                nextCursor: 0n,
            }),
        )
        renderWithClient(<FeedThread />)
        await screen.findByText("only reply")
        expect(screen.queryByTestId("feed-thread-load-more")).toBeNull()
    })
})
