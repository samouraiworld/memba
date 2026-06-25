/**
 * useEcosystemTokens.test.ts
 *
 * Covers:
 * 1. Returns the real token list from fetchTokens() when populated
 * 2. Returns [] (and the band omits the section) when fetchTokens() is empty
 * 3. Degrades gracefully — fetchTokens() resolving [] on error → empty list
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"
import type { DirectoryToken } from "../../lib/directory"

vi.mock("../../lib/directory", () => ({
    fetchTokens: vi.fn(),
}))

vi.mock("../useNetwork", () => ({
    useNetwork: vi.fn(() => ({ networkKey: "test13", rpcUrl: "https://rpc.test13.gno.land" })),
}))

const directoryMod = await import("../../lib/directory")

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

const token = (overrides: Partial<DirectoryToken> = {}): DirectoryToken => ({
    slug: "FOO",
    name: "Foo Token",
    symbol: "FOO",
    path: "gno.land/r/samcrew/tokenfactory_v2:FOO",
    ...overrides,
})

describe("useEcosystemTokens", () => {
    beforeEach(() => vi.clearAllMocks())

    it("returns the real token list when fetchTokens() is populated", async () => {
        const tokens = [token({ symbol: "FOO" }), token({ symbol: "BAR", name: "Bar" })]
        vi.mocked(directoryMod.fetchTokens).mockResolvedValue(tokens)

        const { useEcosystemTokens } = await import("./useEcosystemTokens")
        const { result } = renderHook(() => useEcosystemTokens(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.tokens).toHaveLength(2)
        expect(result.current.tokens[0].symbol).toBe("FOO")
    })

    it("returns an empty list when fetchTokens() resolves []", async () => {
        vi.mocked(directoryMod.fetchTokens).mockResolvedValue([])

        const { useEcosystemTokens } = await import("./useEcosystemTokens")
        const { result } = renderHook(() => useEcosystemTokens(), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.tokens).toEqual([])
    })
})
