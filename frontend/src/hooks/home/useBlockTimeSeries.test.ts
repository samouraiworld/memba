/**
 * useBlockTimeSeries.test.ts
 *
 * Verifies the network block-time sparkline hook (R2-H4a):
 *   1. POSTs to the backend proxy (getIndexerUrl) — NOT a direct indexer URL.
 *   2. Computes consecutive `time` deltas (seconds per block) from getBlocks.
 *   3. Series is sorted by height ascending before differencing.
 *   4. Empty / single-block / unavailable window → EMPTY series (no fabrication).
 *   5. getIndexerUrl() === null (no indexer on network) → query disabled, empty.
 *   6. Indexer error → empty series + error flag (never a fake flat line).
 *
 * The pure interval math (computeBlockIntervals) is unit-tested directly so a
 * mutation to the delta computation is caught without the network layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"
import { computeBlockIntervals } from "./useBlockTimeSeries"

// ── Mock config: getIndexerUrl returns the proxy path ─────────────────────────
vi.mock("../../lib/config", () => ({
    getIndexerUrl: vi.fn(() => "https://memba-backend.fly.dev/api/indexer"),
}))

const configMod = await import("../../lib/config")

// ── Wrapper ───────────────────────────────────────────────────────────────────
function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

/** Build a fetch mock that answers the two GraphQL POSTs by query content. */
function mockIndexer(handlers: { tip?: number; blocks?: { height: number; time: string }[]; throwOn?: "tip" | "blocks" }) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        const body = JSON.parse((init?.body as string) ?? "{}") as { query: string }
        const q = body.query
        if (q.includes("latestBlockHeight")) {
            if (handlers.throwOn === "tip") return new Response("err", { status: 500 })
            return new Response(JSON.stringify({ data: { latestBlockHeight: handlers.tip ?? 0 } }), { status: 200 })
        }
        if (q.includes("getBlocks")) {
            if (handlers.throwOn === "blocks") return new Response("err", { status: 500 })
            return new Response(JSON.stringify({ data: { getBlocks: handlers.blocks ?? [] } }), { status: 200 })
        }
        return new Response(JSON.stringify({ data: {} }), { status: 200 })
    })
}

// ── computeBlockIntervals (pure) ────────────────────────────────────────────────
describe("computeBlockIntervals", () => {
    it("computes consecutive second-deltas, sorted by height ascending", () => {
        const blocks = [
            { height: 12, time: "2026-06-25T00:00:06Z" },
            { height: 10, time: "2026-06-25T00:00:00Z" },
            { height: 11, time: "2026-06-25T00:00:02Z" },
        ]
        // sorted → t=0,2,6 → deltas 2,4
        expect(computeBlockIntervals(blocks)).toEqual([2, 4])
    })

    it("returns [] for an empty block list (honest — no fabricated line)", () => {
        expect(computeBlockIntervals([])).toEqual([])
    })

    it("returns [] for a single block (no interval is computable)", () => {
        expect(computeBlockIntervals([{ height: 5, time: "2026-06-25T00:00:00Z" }])).toEqual([])
    })

    it("drops blocks with unparseable timestamps rather than emitting NaN", () => {
        const blocks = [
            { height: 1, time: "2026-06-25T00:00:00Z" },
            { height: 2, time: "not-a-date" },
            { height: 3, time: "2026-06-25T00:00:09Z" },
        ]
        // heights 1 & 3 survive → single delta of 9s
        expect(computeBlockIntervals(blocks)).toEqual([9])
    })

    it("never emits a negative interval (clamps to 0)", () => {
        // Out-of-order timestamps after sort-by-height shouldn't normally happen,
        // but a clock skew must not produce a negative bar.
        const blocks = [
            { height: 1, time: "2026-06-25T00:00:05Z" },
            { height: 2, time: "2026-06-25T00:00:03Z" },
        ]
        expect(computeBlockIntervals(blocks)).toEqual([0])
    })
})

// ── useBlockTimeSeries (network) ─────────────────────────────────────────────────
describe("useBlockTimeSeries", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.mocked(configMod.getIndexerUrl).mockReturnValue("https://memba-backend.fly.dev/api/indexer")
    })

    it("POSTs to the backend proxy path (getIndexerUrl), not a direct indexer URL", async () => {
        const spy = mockIndexer({ tip: 100, blocks: [
            { height: 99, time: "2026-06-25T00:00:00Z" },
            { height: 100, time: "2026-06-25T00:00:02Z" },
        ] })

        const { useBlockTimeSeries } = await import("./useBlockTimeSeries")
        const { result } = renderHook(() => useBlockTimeSeries(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(spy).toHaveBeenCalled()
        for (const call of spy.mock.calls) {
            expect(String(call[0])).toBe("https://memba-backend.fly.dev/api/indexer")
            expect(String(call[0])).not.toMatch(/indexer\.test13/)
        }
    })

    it("returns a computed interval series for a healthy window", async () => {
        mockIndexer({ tip: 30, blocks: [
            { height: 28, time: "2026-06-25T00:00:00Z" },
            { height: 29, time: "2026-06-25T00:00:02Z" },
            { height: 30, time: "2026-06-25T00:00:05Z" },
        ] })

        const { useBlockTimeSeries } = await import("./useBlockTimeSeries")
        const { result } = renderHook(() => useBlockTimeSeries(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.series).toEqual([2, 3])
        expect(result.current.error).toBe(false)
    })

    it("returns an EMPTY series when the blocks window is empty (never a fake line)", async () => {
        mockIndexer({ tip: 50, blocks: [] })

        const { useBlockTimeSeries } = await import("./useBlockTimeSeries")
        const { result } = renderHook(() => useBlockTimeSeries(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.series).toEqual([])
    })

    it("returns an empty series when the chain tip is 0 (fresh/unavailable)", async () => {
        const spy = mockIndexer({ tip: 0 })

        const { useBlockTimeSeries } = await import("./useBlockTimeSeries")
        const { result } = renderHook(() => useBlockTimeSeries(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.series).toEqual([])
        // tip was 0 → the blocks query must not even fire
        const blocksCalled = spy.mock.calls.some(c => JSON.parse((c[1]?.body as string) ?? "{}").query?.includes("getBlocks"))
        expect(blocksCalled).toBe(false)
    })

    it("disables the query and returns empty when getIndexerUrl() is null", async () => {
        vi.mocked(configMod.getIndexerUrl).mockReturnValue(null)
        const spy = mockIndexer({ tip: 100, blocks: [{ height: 100, time: "2026-06-25T00:00:00Z" }] })

        const { useBlockTimeSeries } = await import("./useBlockTimeSeries")
        const { result } = renderHook(() => useBlockTimeSeries(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.series).toEqual([])
        expect(spy).not.toHaveBeenCalled()
    })

    it("surfaces an error and an empty series when the indexer fails", async () => {
        mockIndexer({ throwOn: "tip" })

        const { useBlockTimeSeries } = await import("./useBlockTimeSeries")
        const { result } = renderHook(() => useBlockTimeSeries(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.series).toEqual([])
        expect(result.current.error).toBe(true)
    })
})
