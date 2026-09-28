import { describe, it, expect, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("../../lib/profile", () => ({ resolveOnChainUsername: vi.fn() }))

import { resolveOnChainUsername } from "../../lib/profile"
import { useActorUsernames } from "./useActorUsernames"

describe("useActorUsernames", () => {
    it("bounds concurrent username reads for a full leaderboard page", async () => {
        let active = 0
        let maximum = 0
        vi.mocked(resolveOnChainUsername).mockImplementation(async address => {
            active++
            maximum = Math.max(maximum, active)
            await new Promise(resolve => setTimeout(resolve, 5))
            active--
            return `@${address}`
        })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
        const addresses = Array.from({ length: 20 }, (_, i) => `g1user${i}`)
        const { result } = renderHook(() => useActorUsernames(addresses), { wrapper })
        await waitFor(() => expect(result.current.size).toBe(addresses.length))
        expect(maximum).toBeLessThanOrEqual(6)
        expect(maximum).toBeGreaterThan(1)
    })
})
