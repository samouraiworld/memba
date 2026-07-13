/**
 * FeedPage — infinite scroll. The API + hooks are mocked at the module
 * boundary; react-query drives the real page. Asserts the first page renders
 * and "Load older posts" appends the next cursor page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("../hooks/useAdena", () => ({ useAdena: () => ({ address: undefined, connected: false, connect: vi.fn() }) }))
vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => vi.fn() }))
vi.mock("../hooks/home/useActorUsernames", () => ({ useActorUsernames: () => new Map() }))
// Stub the Ecosystem tab so its activity stack (tx-indexer) never runs here —
// the tab-switch behavior is what FeedPage owns and is what we assert.
vi.mock("../components/feed/FeedEcosystem", () => ({
    FeedEcosystem: () => <div data-testid="feed-ecosystem">ecosystem activity</div>,
}))
vi.mock("../lib/feedApi", () => ({
    fetchFeedTimeline: vi.fn(),
    fetchFeedStats: vi.fn(async () => ({ livePosts: 0n, totalReplies: 0n, totalAuthors: 0n, mostReplied: [] })),
}))

const { fetchFeedTimeline, fetchFeedStats } = await import("../lib/feedApi")
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

describe("FeedPage Posts/Ecosystem tabs", () => {
    it("defaults to the Posts tab (timeline visible, ecosystem hidden)", async () => {
        renderWithClient(<FeedPage />)
        await screen.findByText("newest post")
        expect(screen.getByTestId("feed-tab-posts")).toHaveAttribute("aria-selected", "true")
        expect(screen.queryByTestId("feed-ecosystem")).toBeNull()
    })

    it("switches to the Ecosystem tab and back", async () => {
        renderWithClient(<FeedPage />)
        await screen.findByText("newest post")

        fireEvent.click(screen.getByTestId("feed-tab-ecosystem"))
        expect(screen.getByTestId("feed-ecosystem")).toBeInTheDocument()
        // The post timeline is unmounted while Ecosystem is active.
        expect(screen.queryByText("newest post")).toBeNull()
        expect(screen.getByTestId("feed-tab-ecosystem")).toHaveAttribute("aria-selected", "true")

        fireEvent.click(screen.getByTestId("feed-tab-posts"))
        expect(await screen.findByText("newest post")).toBeInTheDocument()
        expect(screen.queryByTestId("feed-ecosystem")).toBeNull()
    })
})

describe("FeedPage two-pane rail", () => {
    it("renders the stats and 'Most replied' list inside the right rail", async () => {
        // Feed with activity: live posts + a hot thread → both rail sections show.
        vi.mocked(fetchFeedStats).mockResolvedValue({
            livePosts: 12n,
            totalReplies: 5n,
            totalAuthors: 4n,
            mostReplied: [{ ...post(30n, "a hot thread"), replyCount: 7 }],
        })
        renderWithClient(<FeedPage />)

        const rail = await screen.findByTestId("feed-rail")
        // Stats and trending are PROMOTED into the rail (not the header / inline
        // timeline). Both appear once the stats query resolves.
        expect(await within(rail).findByTestId("feed-stats")).toBeInTheDocument()
        expect(within(rail).getByTestId("feed-trending")).toBeInTheDocument()
        // The timeline still renders its posts in the main column.
        expect(await screen.findByText("newest post")).toBeInTheDocument()
    })
})
