/**
 * MarketCard.test.tsx — the ONE marketplace card (marketplace-v2 Phase 1).
 * Renders any lane's CardModel; no per-lane branching; CSS-only hover.
 */
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, it, expect } from "vitest"
import MarketCard from "./MarketCard"
import type { CardModel } from "../../lib/marketplace/types"

const monogramModel: CardModel = {
    id: "nft-gnomes-genesis",
    lane: "nft",
    title: "Gnomes Genesis",
    media: { kind: "monogram", seed: "gnomes-genesis" },
    verified: true,
    seller: {
        handle: "@gnome.dev",
        address: "g1qpz3fr7v9m2x8k4l6n0s5t7w9y2b4d6h8j0m2",
        reputation: { rating: 4.8, count: 42, level: "Top Rated" },
    },
    stats: [
        { label: "Floor", value: "10 GNOT", mono: true },
        { label: "Volume", value: "3.1k GNOT", mono: true },
    ],
    priceLabel: "12 GNOT",
    href: "/test13/nft/collection/gnome.dev/genesis",
}

const artNewSeller: CardModel = {
    ...monogramModel,
    id: "nft-photo-1",
    title: "City Lights",
    media: { kind: "art", src: "data:image/svg+xml,<svg/>" },
    verified: false,
    seller: { handle: "@lens", address: "g1abc000000000000000000000000000000000x", reputation: null },
}

const renderCard = (m: CardModel) =>
    render(<MemoryRouter><MarketCard model={m} /></MemoryRouter>)

describe("MarketCard", () => {
    it("renders title, seller handle, stats and price", () => {
        renderCard(monogramModel)
        expect(screen.getByText("Gnomes Genesis")).toBeInTheDocument()
        expect(screen.getByText("@gnome.dev")).toBeInTheDocument()
        expect(screen.getByText("Floor")).toBeInTheDocument()
        expect(screen.getByText("12 GNOT")).toBeInTheDocument()
    })

    it("links the whole card to the detail href", () => {
        renderCard(monogramModel)
        expect(screen.getByRole("link")).toHaveAttribute(
            "href",
            "/test13/nft/collection/gnome.dev/genesis",
        )
    })

    it("shows the verified badge only when verified is true", () => {
        const { unmount } = renderCard(monogramModel)
        expect(screen.getByLabelText(/verified/i)).toBeInTheDocument()
        unmount()
        renderCard(artNewSeller)
        expect(screen.queryByLabelText(/verified/i)).not.toBeInTheDocument()
    })

    it("shows reputation when present and a neutral state for a new seller", () => {
        const { unmount } = renderCard(monogramModel)
        expect(screen.getByText(/4\.8/)).toBeInTheDocument()
        expect(screen.getByText(/Top Rated/)).toBeInTheDocument()
        unmount()
        renderCard(artNewSeller)
        // A null-reputation seller must NOT show a fabricated rating.
        expect(screen.queryByText(/★/)).not.toBeInTheDocument()
        expect(screen.getByText(/new seller/i)).toBeInTheDocument()
    })

    it("renders the seller address (copymint/impersonation defense)", () => {
        renderCard(monogramModel)
        // Full bech32 lives in the addr element's title; a truncated form is visible.
        expect(screen.getByTitle(monogramModel.seller.address)).toBeInTheDocument()
    })
})
