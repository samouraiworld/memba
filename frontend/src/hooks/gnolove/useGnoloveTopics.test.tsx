/**
 * useGnoloveTopics — seed/fetched union behaviour.
 *
 * The hook must always return a populated rule set + label map (never
 * empty, never undefined) so downstream UI doesn't have to handle a
 * "no taxonomy yet" state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useGnoloveTopics } from "./useGnoloveTopics"
import * as api from "../../lib/gnoloveApi"
import { _internals, FOCUS_TOPIC_LABELS } from "../../lib/gnoloveFocusAreas"

function withQueryClient() {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    })
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
}

beforeEach(() => {
    vi.restoreAllMocks()
})

describe("useGnoloveTopics", () => {
    it("serves the seed taxonomy before the network resolves", () => {
        vi.spyOn(api, "getTopics").mockImplementation(
            () => new Promise(() => { /* never */ }),
        )
        const { result } = renderHook(() => useGnoloveTopics(), { wrapper: withQueryClient() })
        expect(result.current.rules).toBe(_internals.SEED_TOPIC_RULES)
        expect(result.current.labels).toBe(FOCUS_TOPIC_LABELS)
        expect(result.current.isFetched).toBe(false)
        expect(result.current.lastSyncedAt).toBeNull()
    })

    it("switches to fetched data once the backend responds", async () => {
        vi.spyOn(api, "getTopics").mockResolvedValue({
            schemaVersion: 1,
            lastSyncedAt: "2026-05-19T10:00:00Z",
            topics: [
                { slug: "wallet", label: "Wallet (live)", patterns: ["adena"] },
                { slug: "indexer", label: "Indexer (live)", patterns: ["gnoscan"] },
            ],
        })
        const { result } = renderHook(() => useGnoloveTopics(), { wrapper: withQueryClient() })
        await waitFor(() => expect(result.current.isFetched).toBe(true))
        expect(result.current.rules).toHaveLength(2)
        expect(result.current.rules[0].topic).toBe("wallet")
        expect(result.current.labels.wallet).toBe("Wallet (live)")
        expect(result.current.lastSyncedAt).toBe("2026-05-19T10:00:00Z")
    })

    it("falls back to the seed when the backend throws", async () => {
        vi.spyOn(api, "getTopics").mockRejectedValue(new Error("network error"))
        const { result } = renderHook(() => useGnoloveTopics(), { wrapper: withQueryClient() })
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.isFetched).toBe(false)
        expect(result.current.rules).toBe(_internals.SEED_TOPIC_RULES)
    })

    it("falls back to the seed when the backend returns an empty taxonomy", async () => {
        vi.spyOn(api, "getTopics").mockResolvedValue({
            schemaVersion: 1,
            lastSyncedAt: "2026-05-19T10:00:00Z",
            topics: [],
        })
        const { result } = renderHook(() => useGnoloveTopics(), { wrapper: withQueryClient() })
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.isFetched).toBe(false)
        expect(result.current.rules).toBe(_internals.SEED_TOPIC_RULES)
    })
})
