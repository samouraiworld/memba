/**
 * useFeedReplyBadge — returns the unread reply count for the nav badge, and 0
 * when the feed is disabled or no wallet is connected. The API + config are
 * mocked at the module boundary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("../lib/config", () => ({ isFeedEnabled: () => true }))
vi.mock("../lib/feedApi", () => ({ fetchReplyNotifications: vi.fn() }))
vi.mock("../lib/feedLastSeen", () => ({
    getLastSeenReply: () => 0n,
    FEED_LASTSEEN_EVENT: "memba:feed-lastseen",
}))

const { fetchReplyNotifications } = await import("../lib/feedApi")
const { useFeedReplyBadge } = await import("./useFeedReplyBadge")
const mockFetch = vi.mocked(fetchReplyNotifications)

function wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => mockFetch.mockReset())

describe("useFeedReplyBadge", () => {
    it("returns the unread count for a connected wallet", async () => {
        mockFetch.mockResolvedValue({ replies: [], unreadCount: 3, latestId: 9n })
        const { result } = renderHook(() => useFeedReplyBadge("g1me"), { wrapper })
        await waitFor(() => expect(result.current).toBe(3))
    })

    it("returns 0 and does not poll when disconnected (address null)", async () => {
        const { result } = renderHook(() => useFeedReplyBadge(null), { wrapper })
        expect(result.current).toBe(0)
        expect(mockFetch).not.toHaveBeenCalled()
    })
})
