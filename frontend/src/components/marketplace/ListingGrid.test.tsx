/**
 * ListingGrid.test.tsx — the one marketplace grid (marketplace-v2 Phase 1).
 * Virtualization arrives in Phase 2 behind this same API.
 */
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, it, expect } from "vitest"
import ListingGrid from "./ListingGrid"
import type { CardModel } from "../../lib/marketplace/types"

const mk = (id: string): CardModel => ({
    id,
    lane: "nft",
    title: `Item ${id}`,
    media: { kind: "monogram", seed: id },
    verified: false,
    seller: { handle: "@x", address: `g1${id}00000000000000000000000000000000`, reputation: null },
    stats: [],
    priceLabel: "1 GNOT",
    href: `/test13/nft/${id}`,
})

describe("ListingGrid", () => {
    it("renders one card per item inside a single grid container", () => {
        const items = [mk("a"), mk("b"), mk("c")]
        const { container } = render(
            <MemoryRouter><ListingGrid items={items} /></MemoryRouter>,
        )
        expect(screen.getByText("Item a")).toBeInTheDocument()
        expect(screen.getByText("Item c")).toBeInTheDocument()
        expect(container.querySelectorAll(".mkt-grid")).toHaveLength(1)
        expect(screen.getAllByRole("link")).toHaveLength(3)
    })

    it("renders the provided empty state when there are no items", () => {
        render(
            <MemoryRouter><ListingGrid items={[]} empty={<div>nothing here</div>} /></MemoryRouter>,
        )
        expect(screen.getByText("nothing here")).toBeInTheDocument()
        expect(screen.queryByRole("link")).not.toBeInTheDocument()
    })
})
