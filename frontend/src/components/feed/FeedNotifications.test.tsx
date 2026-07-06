/**
 * FeedNotifications — the reply-notification badge. The API + username hook are
 * mocked at the module boundary; react-query drives the real component.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("../../lib/feedApi", () => ({ fetchReplyNotifications: vi.fn() }))
vi.mock("../../hooks/home/useActorUsernames", () => ({ useActorUsernames: () => new Map() }))

const { fetchReplyNotifications } = await import("../../lib/feedApi")
const { FeedNotifications } = await import("./FeedNotifications")
const mockFetch = vi.mocked(fetchReplyNotifications)

function renderWithClient(ui: ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const reply = (over = {}) => ({
    id: 6n, author: "g1bobbobbobbobbobbobbobbobbobbobbobbobbob", body: "great post",
    replyTo: 2n, blockH: 6n, blockTs: 0n, editedAt: 0n, flagCount: 0, hidden: false, deleted: false, replyCount: 0, ...over,
})

beforeEach(() => { mockFetch.mockReset(); localStorage.clear() })

describe("FeedNotifications", () => {
    it("renders nothing when there are no unread replies", async () => {
        mockFetch.mockResolvedValue({ replies: [], unreadCount: 0, latestId: 0n })
        renderWithClient(<FeedNotifications address="g1me" onOpenThread={() => {}} />)
        await waitFor(() => expect(mockFetch).toHaveBeenCalled())
        expect(screen.queryByTestId("feed-notifications")).toBeNull()
    })

    it("badges the unread count and expands to the reply list", async () => {
        mockFetch.mockResolvedValue({ replies: [reply()], unreadCount: 1, latestId: 6n })
        renderWithClient(<FeedNotifications address="g1me" onOpenThread={() => {}} />)
        await screen.findByTestId("feed-notifications")
        expect(screen.getByText("1")).toBeInTheDocument()
        fireEvent.click(screen.getByTestId("feed-notifs-toggle"))
        expect(screen.getByText("great post")).toBeInTheDocument()
    })

    it("opens the parent thread when a notification is clicked", async () => {
        const onOpen = vi.fn()
        mockFetch.mockResolvedValue({ replies: [reply({ replyTo: 2n })], unreadCount: 1, latestId: 6n })
        renderWithClient(<FeedNotifications address="g1me" onOpenThread={onOpen} />)
        await screen.findByTestId("feed-notifications")
        fireEvent.click(screen.getByTestId("feed-notifs-toggle"))
        fireEvent.click(screen.getByText("great post"))
        expect(onOpen).toHaveBeenCalledWith(2n)
    })
})
