import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ExploreGrid } from "./ExploreGrid"

const renderIt = () => render(<MemoryRouter><ExploreGrid networkKey="test13" /></MemoryRouter>)

describe("ExploreGrid", () => {
    it("renders the six live surfaces with network-aware hrefs", () => {
        renderIt()
        expect(screen.getByTestId("explore-tokens")).toHaveAttribute("href", "/test13/tokens")
        expect(screen.getByTestId("explore-directory")).toHaveAttribute("href", "/test13/directory")
        expect(screen.getByTestId("explore-validators")).toHaveAttribute("href", "/test13/validators")
        expect(screen.getByTestId("explore-gnolove")).toHaveAttribute("href", "/test13/gnolove")
        expect(screen.getByTestId("explore-quests")).toHaveAttribute("href", "/test13/quests")
        expect(screen.getByTestId("explore-multisig")).toHaveAttribute("href", "/test13/multisig")
    })

    it("does NOT surface any gated/upcoming feature (NFT / marketplace / services)", () => {
        renderIt()
        expect(screen.queryByText(/marketplace|services|\bnft\b/i)).not.toBeInTheDocument()
    })
})
