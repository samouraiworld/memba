/**
 * useGnoloveBackendHealth — probe loop + 2x-fail-in-30s threshold.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useGnoloveBackendHealth } from "./useGnoloveBackendHealth"

beforeEach(() => {
    vi.restoreAllMocks()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("useGnoloveBackendHealth", () => {
    it("starts as 'unknown' before any probe completes", async () => {
        // Stall the fetch so the probe never resolves during this assertion.
        vi.spyOn(globalThis, "fetch").mockImplementation(
            () => new Promise(() => { /* never */ }) as unknown as Promise<Response>,
        )
        const { result } = renderHook(() => useGnoloveBackendHealth({ probeUrl: "http://x/teams" }))
        expect(result.current).toBe("unknown")
    })

    it("becomes 'up' after one successful probe", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }))
        const { result } = renderHook(() => useGnoloveBackendHealth({ probeUrl: "http://x/teams" }))
        await waitFor(() => expect(result.current).toBe("up"))
    })

    it("treats 4xx as 'up' (server responding, just rejecting)", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }))
        const { result } = renderHook(() => useGnoloveBackendHealth({ probeUrl: "http://x/teams" }))
        await waitFor(() => expect(result.current).toBe("up"))
    })

    it("doesn't flip to 'down' on a single failure (need 2)", async () => {
        let calls = 0
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
            calls++
            // First call rejects (network error), then stall.
            if (calls === 1) throw new Error("ECONNREFUSED")
            return new Promise(() => { /* never */ }) as unknown as Promise<Response>
        })
        const { result } = renderHook(() => useGnoloveBackendHealth({ probeUrl: "http://x/teams" }))
        // Give the first probe time to finish.
        await new Promise(r => setTimeout(r, 20))
        // After exactly 1 failure, status should still be "unknown" (threshold is 2).
        expect(result.current).not.toBe("down")
    })

    it("can be disabled to skip probing entirely", () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch")
        renderHook(() => useGnoloveBackendHealth({ enabled: false, probeUrl: "http://x/teams" }))
        expect(fetchSpy).not.toHaveBeenCalled()
    })
})
