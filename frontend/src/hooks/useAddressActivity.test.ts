/**
 * useAddressActivity.test.ts
 *
 * Verifies:
 *   1. maps fetchAddressActivity items for the address (loading → loaded)
 *   2. empty result → empty list, not loading, no error
 *   3. fetch failure → error flag (for the retry UI)
 *   4. no indexer on the network → available:false (section hides)
 *   5. no address → query disabled (fetch not called), not perpetually loading
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"
import type { ActivityItem } from "../lib/activity"

vi.mock("../lib/activity", () => ({ fetchAddressActivity: vi.fn() }))
vi.mock("../lib/config", () => ({ getIndexerUrl: vi.fn(() => "https://memba-backend.fly.dev/api/indexer") }))

import { fetchAddressActivity } from "../lib/activity"
import { getIndexerUrl } from "../lib/config"
import { useAddressActivity } from "./useAddressActivity"

const ADDR = "g1k7asng8uzf74xs0tsrfwytldl76hs4l3asglym"

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return React.createElement(QueryClientProvider, { client }, children)
}

const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
    kind: "call", title: "F · x/a", actor: ADDR, pkgPath: "gno.land/r/x/a", func: "F",
    txHash: "h1", blockHeight: 100, extraCount: 0, ...over,
})

describe("useAddressActivity", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(getIndexerUrl).mockReturnValue("https://memba-backend.fly.dev/api/indexer")
    })

    it("maps the address's activity items", async () => {
        vi.mocked(fetchAddressActivity).mockResolvedValue([item({ txHash: "a" }), item({ txHash: "b" })])
        const { result } = renderHook(() => useAddressActivity(ADDR), { wrapper })

        expect(result.current.loading).toBe(true)
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.items.map(i => i.txHash)).toEqual(["a", "b"])
        expect(result.current.available).toBe(true)
        expect(result.current.error).toBe(false)
        expect(vi.mocked(fetchAddressActivity)).toHaveBeenCalledWith(
            "https://memba-backend.fly.dev/api/indexer", ADDR, expect.objectContaining({ limit: 20 }),
        )
    })

    it("returns an empty list (no error) when the address has no activity", async () => {
        vi.mocked(fetchAddressActivity).mockResolvedValue([])
        const { result } = renderHook(() => useAddressActivity(ADDR), { wrapper })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.items).toEqual([])
        expect(result.current.error).toBe(false)
        expect(result.current.available).toBe(true)
    })

    it("flags an error when the indexer fetch rejects", async () => {
        vi.mocked(fetchAddressActivity).mockRejectedValue(new Error("indexer down"))
        const { result } = renderHook(() => useAddressActivity(ADDR), { wrapper })
        await waitFor(() => expect(result.current.error).toBe(true))
        expect(result.current.items).toEqual([])
    })

    it("is unavailable (hides) when the network has no indexer", () => {
        vi.mocked(getIndexerUrl).mockReturnValue(null)
        const { result } = renderHook(() => useAddressActivity(ADDR), { wrapper })
        expect(result.current.available).toBe(false)
        expect(result.current.loading).toBe(false)
        expect(vi.mocked(fetchAddressActivity)).not.toHaveBeenCalled()
    })

    it("does not fetch (and is not stuck loading) without an address", () => {
        const { result } = renderHook(() => useAddressActivity(undefined), { wrapper })
        expect(result.current.loading).toBe(false)
        expect(result.current.available).toBe(true)
        expect(vi.mocked(fetchAddressActivity)).not.toHaveBeenCalled()
    })
})
