/**
 * useChainHealth — shared chain-liveness signal (polls checkNetworkHealth) so the
 * home tells ONE story during a halt: "degraded" is true when the chain is halted
 * or unreachable. Optimistic "healthy" while loading (no false alarm on first paint).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

vi.mock("../../lib/networkStatus", () => ({ checkNetworkHealth: vi.fn() }))
vi.mock("../../lib/config", () => ({ GNO_RPC_URL: "https://rpc.test13.example" }))

const ns = await import("../../lib/networkStatus")

const result = (health: string, blockAge = 0) =>
    ({ health, chainId: "test-13", latestBlockTime: new Date(0), blockAge })

function wrap() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return ({ children }: { children: ReactNode }) => React.createElement(QueryClientProvider, { client }, children)
}

beforeEach(() => vi.clearAllMocks())

describe("useChainHealth", () => {
    it("is NOT degraded while loading (optimistic — no false halt flash)", async () => {
        vi.mocked(ns.checkNetworkHealth).mockImplementation(() => new Promise(() => {})) // never resolves
        const { useChainHealth } = await import("./useChainHealth")
        const { result: r } = renderHook(() => useChainHealth(), { wrapper: wrap() })
        expect(r.current.degraded).toBe(false)
        expect(r.current.loading).toBe(true)
    })

    it("is degraded when the chain is halted", async () => {
        vi.mocked(ns.checkNetworkHealth).mockResolvedValue(result("halted", 3600) as never)
        const { useChainHealth } = await import("./useChainHealth")
        const { result: r } = renderHook(() => useChainHealth(), { wrapper: wrap() })
        await waitFor(() => expect(r.current.loading).toBe(false))
        expect(r.current.degraded).toBe(true)
        expect(r.current.health).toBe("halted")
        expect(r.current.blockAge).toBe(3600)
    })

    it("is degraded when the chain is unreachable", async () => {
        vi.mocked(ns.checkNetworkHealth).mockResolvedValue(result("unreachable", Infinity) as never)
        const { useChainHealth } = await import("./useChainHealth")
        const { result: r } = renderHook(() => useChainHealth(), { wrapper: wrap() })
        await waitFor(() => expect(r.current.loading).toBe(false))
        expect(r.current.degraded).toBe(true)
    })

    it("is NOT degraded when healthy or merely slow", async () => {
        vi.mocked(ns.checkNetworkHealth).mockResolvedValue(result("slow", 30) as never)
        const { useChainHealth } = await import("./useChainHealth")
        const { result: r } = renderHook(() => useChainHealth(), { wrapper: wrap() })
        await waitFor(() => expect(r.current.loading).toBe(false))
        expect(r.current.degraded).toBe(false)
        expect(r.current.health).toBe("slow")
    })
})
