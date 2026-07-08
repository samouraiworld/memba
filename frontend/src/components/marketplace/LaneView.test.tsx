/**
 * LaneView.test.tsx — the generic lane renderer (marketplace-v2 Phase 7 core).
 */
import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, it, expect } from "vitest"
import { LaneView } from "./LaneView"
import type { CardModel } from "../../lib/marketplace/types"

const toCard = (n: number): CardModel => ({
    id: String(n),
    lane: "nft",
    title: `Item ${n}`,
    category: n % 2 ? "Odd" : "Even",
    priceValue: n,
    media: { kind: "monogram", seed: String(n) },
    verified: false,
    seller: { handle: "@x", address: "g1x00000000000000000000000000000000", reputation: null },
    stats: [],
    priceLabel: `${n} GNOT`,
    href: `#${n}`,
})

const wrapAt = (initial = "/m") => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
        </QueryClientProvider>
    )
}

describe("LaneView", () => {
    it("renders adapter-mapped cards after loading", async () => {
        render(<LaneView lane="nft" fetchFn={async () => [1, 2, 3]} toCard={toCard} />, { wrapper: wrapAt() })
        expect(await screen.findByText("Item 1")).toBeInTheDocument()
        expect(screen.getByText("Item 3")).toBeInTheDocument()
    })

    it("applies the URL query filter to the rendered cards", async () => {
        render(<LaneView lane="nft" fetchFn={async () => [1, 2, 3]} toCard={toCard} />, { wrapper: wrapAt("/m?q=Item%202") })
        expect(await screen.findByText("Item 2")).toBeInTheDocument()
        expect(screen.queryByText("Item 1")).not.toBeInTheDocument()
        expect(screen.queryByText("Item 3")).not.toBeInTheDocument()
    })

    it("shows a retry empty-state on a failed read (never throws)", async () => {
        render(
            <LaneView lane="token" fetchFn={async () => { throw new Error("boom") }} toCard={toCard} />,
            { wrapper: wrapAt() },
        )
        expect(await screen.findByText(/couldn't load this lane/i)).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument()
    })

    it("shows the provided empty-state when the lane has no listings", async () => {
        render(
            <LaneView lane="service" fetchFn={async () => []} toCard={toCard} empty={{ title: "No services yet" }} />,
            { wrapper: wrapAt() },
        )
        expect(await screen.findByText("No services yet")).toBeInTheDocument()
    })
})
