/**
 * useActorUsernames.test.ts — best-effort actor address → @username resolution.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

vi.mock("../../lib/profile", () => ({ resolveOnChainUsername: vi.fn() }))
const profile = await import("../../lib/profile")

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

beforeEach(() => vi.clearAllMocks())

describe("useActorUsernames", () => {
    it("maps the addresses that have a registered username (omits the rest)", async () => {
        // resolveOnChainUsername returns a display-ready "@handle" (real shape).
        vi.mocked(profile.resolveOnChainUsername).mockImplementation(async (a: string) =>
            a === "g1alice" ? "@alice" : "")
        const { useActorUsernames } = await import("./useActorUsernames")
        const { result } = renderHook(() => useActorUsernames(["g1alice", "g1nobody"]), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.size).toBe(1))
        expect(result.current.get("g1alice")).toBe("alice")
        expect(result.current.has("g1nobody")).toBe(false)
    })

    it("is best-effort: one address throwing does not drop the others", async () => {
        vi.mocked(profile.resolveOnChainUsername).mockImplementation(async (a: string) => {
            if (a === "g1boom") throw new Error("rpc down")
            return "@bob"
        })
        const { useActorUsernames } = await import("./useActorUsernames")
        const { result } = renderHook(() => useActorUsernames(["g1boom", "g1bob"]), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.get("g1bob")).toBe("bob"))
        expect(result.current.has("g1boom")).toBe(false)
    })

    it("dedupes actors and skips the query when there are none (no calls)", async () => {
        const { useActorUsernames } = await import("./useActorUsernames")
        const { result } = renderHook(() => useActorUsernames([]), { wrapper: makeWrapper() })
        expect(result.current.size).toBe(0)
        expect(profile.resolveOnChainUsername).not.toHaveBeenCalled()
    })

    it("resolves each distinct address only once even if it repeats", async () => {
        vi.mocked(profile.resolveOnChainUsername).mockResolvedValue("@dup")
        const { useActorUsernames } = await import("./useActorUsernames")
        const { result } = renderHook(() => useActorUsernames(["g1x", "g1x", "g1x"]), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.get("g1x")).toBe("dup"))
        expect(profile.resolveOnChainUsername).toHaveBeenCalledTimes(1)
    })
})
