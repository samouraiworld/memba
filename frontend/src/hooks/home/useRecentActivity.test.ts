/**
 * useRecentActivity.test.ts — indexer availability + the `updatedAt` liveness
 * timestamp the feed uses for its "updated N ago" label.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

vi.mock("../../lib/activity", () => ({ fetchRecentActivity: vi.fn() }))
vi.mock("../../lib/config", () => ({ getIndexerUrl: vi.fn() }))

const activity = await import("../../lib/activity")
const config = await import("../../lib/config")

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

beforeEach(() => vi.clearAllMocks())

describe("useRecentActivity", () => {
    it("is unavailable (and updatedAt 0) when the network has no indexer", async () => {
        vi.mocked(config.getIndexerUrl).mockReturnValue(undefined as unknown as string)
        const { useRecentActivity } = await import("./useRecentActivity")
        const { result } = renderHook(() => useRecentActivity("test13"), { wrapper: makeWrapper() })
        expect(result.current.available).toBe(false)
        expect(result.current.updatedAt).toBe(0)
        expect(activity.fetchRecentActivity).not.toHaveBeenCalled()
    })

    it("exposes a non-zero updatedAt after a successful fetch", async () => {
        vi.mocked(config.getIndexerUrl).mockReturnValue("https://indexer.example/graphql")
        vi.mocked(activity.fetchRecentActivity).mockResolvedValue([])
        const { useRecentActivity } = await import("./useRecentActivity")
        const { result } = renderHook(() => useRecentActivity("test13"), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.available).toBe(true)
        expect(result.current.updatedAt).toBeGreaterThan(0)
    })
})
