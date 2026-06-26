/**
 * useTokenLaunches — enriches the top-N registry tokens with on-chain supply/
 * admin via getTokenInfo. Honest: best-effort per token; 0/unparsable supply is
 * omitted; total reflects the full list so "view all N" stays accurate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import React from "react"

vi.mock("../../lib/directory", () => ({ fetchTokens: vi.fn() }))
vi.mock("../../lib/grc20", () => ({ getTokenInfo: vi.fn(), formatSupply: vi.fn() }))
vi.mock("../useNetwork", () => ({
    useNetwork: vi.fn(() => ({ networkKey: "test13", rpcUrl: "https://rpc.test13.example" })),
}))

const dir = await import("../../lib/directory")
const grc20 = await import("../../lib/grc20")

const tok = (symbol: string) => ({ slug: symbol, name: `${symbol} Token`, symbol, path: `gno.land/r/x/factory:${symbol}` })
const info = (totalSupply: string, admin: string, decimals = 6) => ({ name: "", symbol: "", decimals, totalSupply, admin })

function makeWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children)
    }
}

beforeEach(() => vi.clearAllMocks())

describe("useTokenLaunches", () => {
    it("enriches the top-N tokens with supply + admin and reports the full total", async () => {
        vi.mocked(dir.fetchTokens).mockResolvedValue([tok("FOO"), tok("BAR"), tok("BAZ")])
        vi.mocked(grc20.getTokenInfo).mockResolvedValue(info("102500100", "g1admin", 6))
        vi.mocked(grc20.formatSupply).mockReturnValue("102.5001")

        const { useTokenLaunches } = await import("./useTokenLaunches")
        const { result } = renderHook(() => useTokenLaunches(2), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.total).toBe(3) // full count, not the sliced 2
        expect(result.current.tokens).toHaveLength(2) // only top-2 enriched/shown
        expect(result.current.tokens[0]).toMatchObject({ symbol: "FOO", supplyDisplay: "102.5001", admin: "g1admin", decimals: 6 })
    })

    it("omits supply when formatSupply returns null (zero/unparsable), keeping the row honest", async () => {
        vi.mocked(dir.fetchTokens).mockResolvedValue([tok("ZERO")])
        vi.mocked(grc20.getTokenInfo).mockResolvedValue(info("0", "g1admin", 6))
        vi.mocked(grc20.formatSupply).mockReturnValue(null)

        const { useTokenLaunches } = await import("./useTokenLaunches")
        const { result } = renderHook(() => useTokenLaunches(3), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.tokens[0].supplyDisplay).toBeUndefined()
        expect(result.current.tokens[0].symbol).toBe("ZERO") // still shows the row
    })

    it("degrades a row to name/symbol/path when getTokenInfo throws (best-effort)", async () => {
        vi.mocked(dir.fetchTokens).mockResolvedValue([tok("ERR")])
        vi.mocked(grc20.getTokenInfo).mockRejectedValue(new Error("rpc down"))

        const { useTokenLaunches } = await import("./useTokenLaunches")
        const { result } = renderHook(() => useTokenLaunches(3), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.tokens[0]).toMatchObject({ symbol: "ERR" })
        expect(result.current.tokens[0].supplyDisplay).toBeUndefined()
    })

    it("returns empty list / total 0 when there are no tokens", async () => {
        vi.mocked(dir.fetchTokens).mockResolvedValue([])

        const { useTokenLaunches } = await import("./useTokenLaunches")
        const { result } = renderHook(() => useTokenLaunches(3), { wrapper: makeWrapper() })
        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.tokens).toEqual([])
        expect(result.current.total).toBe(0)
    })
})
