/**
 * TokenLaneV2.test.tsx — Tokens (OTC) lane on the v2 foundation (marketplace-v2 7.3).
 */
import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, it, expect, vi } from "vitest"
import type { OtcListing } from "../../lib/marketplace/codec"

vi.mock("../../lib/tokenOtcApi", () => ({
    fetchOtcListings: vi.fn(
        async (): Promise<OtcListing[]> => [
            { id: "1", seller: "g1a000000000000000000000000000000000x", symbol: "FORGE", expectedUnitPrice: 1_500_000n, amountAvailable: 900_000_000n },
            { id: "2", seller: "g1b000000000000000000000000000000000y", symbol: "AXIS", expectedUnitPrice: 500_000n, amountAvailable: 40_000_000n },
        ],
    ),
}))

// T3.2 (#992) added a decimals lookup per listed symbol before rendering
// cards — getTokenDecimals hits a real network endpoint if unmocked, which
// resolves fast enough to pass locally but hangs past CI's test timeout
// (observed: passes on a dev machine, times out in GitHub Actions on both
// Node legs). Mock it so this test never depends on real network I/O; keep
// the rest of the module real (tokenOtcToCard also calls formatTokenAmount
// from here, a pure function this test should genuinely exercise).
vi.mock("../../lib/grc20", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/grc20")>()
    return { ...actual, getTokenDecimals: vi.fn(async () => 6) }
})

import TokenLaneV2 from "./TokenLaneV2"

const wrap = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={["/test13/marketplace/tokens"]}>{children}</MemoryRouter>
        </QueryClientProvider>
    )
}

describe("TokenLaneV2", () => {
    it("renders fetched OTC listings through the v2 card/grid", async () => {
        render(<TokenLaneV2 />, { wrapper: wrap() })
        expect(await screen.findByText("FORGE")).toBeInTheDocument()
        expect(screen.getByText("AXIS")).toBeInTheDocument()
        expect(screen.getByRole("searchbox")).toBeInTheDocument()
    })
})
