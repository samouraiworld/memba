/**
 * NftLaneV2.test.tsx — NFT lane on the v2 foundation (marketplace-v2 Phase 7.1).
 * Mocks the chain read; asserts collections render through MarketCard via LaneView.
 */
import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, it, expect, vi } from "vitest"
import type { HubCollection } from "../../lib/nftHub"

vi.mock("../../lib/nftHub", () => ({
    fetchVerifiedCollections: vi.fn(
        async (): Promise<HubCollection[]> => [
            { id: "a/one", name: "Alpha Collection", creator: "g1creator0000000000000000000000000000x", slug: "one", verified: true, floorUgnot: 5_000_000n, volumeUgnot: 12_000_000n },
            { id: "b/two", name: "Beta Collection", creator: "g1creator1111111111111111111111111111y", slug: "two", verified: false, floorUgnot: 2_000_000n, volumeUgnot: 3_000_000n },
        ],
    ),
}))

import NftLaneV2 from "./NftLaneV2"

const wrap = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={["/test13/marketplace/nfts"]}>{children}</MemoryRouter>
        </QueryClientProvider>
    )
}

describe("NftLaneV2", () => {
    it("renders fetched collections through the v2 card/grid", async () => {
        render(<NftLaneV2 />, { wrapper: wrap() })
        expect(await screen.findByText("Alpha Collection")).toBeInTheDocument()
        expect(screen.getByText("Beta Collection")).toBeInTheDocument()
        // the shared toolbar is present (one discovery bar)
        expect(screen.getByRole("searchbox")).toBeInTheDocument()
    })
})
