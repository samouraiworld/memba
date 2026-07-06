/**
 * FeedPage — infinite scroll. The API + hooks are mocked at the module
 * boundary; react-query drives the real page. Asserts the first page renders
 * and "Load older posts" appends the next cursor page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("../hooks/useAdena", () => ({ useAdena: () => ({ address: undefined, connected: false, connect: vi.fn() }) }))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => vi.fn() }))
vi.mock("../hooks/home/useActorUsernames", () => ({ useActorUsernames: () => new Map() }))
vi.mock("../lib/feedApi", () => ({ fetchFeedTimeline: vi.fn() }))

const { fetchFeedTimeline } = await import("../lib/feedApi")
const FeedPage = (await import("./FeedPage")).default
const mockFetch = vi.mocked(fetchFeedTimeline)

const post = (id: bigint, body: string) => ({
    id, author: "g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", body, replyTo: 0n, blockH: id, blockTs: 0n,
    editedAt: 0n, flagCount: 0, hidden: false, deleted: false, replyCount: 0,
})

function renderWithClient(ui: ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
    mockFetch.mockReset()
    // cursor 0 → newest page (30, 29) with more available; cursor 29 → older (28), end.
    mockFetch.mockImplementation((cursor: bigint) =>
        cursor === 0n
            ? Promise.resolve({ posts: [post(30n, "newest post"), post(29n, "second post")], nextCursor: 29n, indexerLastBlock: 0n })
            : Promise.resolve({ posts: [post(28n, "older post")], nextCursor: 0n, indexerLastBlock: 0n }),
    )
})

describe("FeedPage infinite scroll", () => {
    it("renders the first page", async () => {
        renderWithClient(<FeedPage />)
        await screen.findByText("newest post")
        expect(screen.getByText("second post")).toBeInTheDocument()
    })

    it("appends the next cursor page on 'Load older posts'", async () => {
        renderWithClient(<FeedPage />)
        const more = await screen.findByTestId("feed-load-more")
        fireEvent.click(more)
        await screen.findByText("older post")
        // The newest page is still there — pages are appended, not replaced.
        expect(screen.getByText("newest post")).toBeInTheDocument()
        // Cursor pagination reached the end → the button is gone.
        await waitFor(() => expect(screen.queryByTestId("feed-load-more")).toBeNull())
    })
})
