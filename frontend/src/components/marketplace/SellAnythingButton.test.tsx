/**
 * SellAnythingButton.test.tsx — the single "Sell anything" entry (marketplace-v2 Phase 4.2).
 */
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, it, expect } from "vitest"
import { SellAnythingButton } from "./SellAnythingButton"
import type { SellOption } from "../../lib/marketplace/sellOptions"

const nft: SellOption = { key: "nft", label: "List an NFT", to: "/test13/nft/create" }
const token: SellOption = { key: "token", label: "List tokens (OTC)", to: "/test13/marketplace/tokens" }

const renderWith = (options: SellOption[]) =>
    render(<MemoryRouter><SellAnythingButton options={options} /></MemoryRouter>)

describe("SellAnythingButton", () => {
    it("renders nothing when there are no live lanes", () => {
        const { container } = renderWith([])
        expect(container).toBeEmptyDOMElement()
    })

    it("is a direct link when there is a single live lane", () => {
        renderWith([nft])
        expect(screen.getByRole("link", { name: "Sell" })).toHaveAttribute("href", "/test13/nft/create")
    })

    it("opens an accessible menu when there are multiple lanes", () => {
        renderWith([nft, token])
        const btn = screen.getByRole("button", { name: "Sell" })
        expect(btn).toHaveAttribute("aria-haspopup", "menu")
        expect(btn).toHaveAttribute("aria-expanded", "false")
        fireEvent.click(btn)
        expect(btn).toHaveAttribute("aria-expanded", "true")
        expect(screen.getByRole("menuitem", { name: "List an NFT" })).toHaveAttribute("href", "/test13/nft/create")
        expect(screen.getByRole("menuitem", { name: "List tokens (OTC)" })).toHaveAttribute("href", "/test13/marketplace/tokens")
    })

    it("closes the menu on Escape", () => {
        renderWith([nft, token])
        const btn = screen.getByRole("button", { name: "Sell" })
        fireEvent.click(btn)
        expect(btn).toHaveAttribute("aria-expanded", "true")
        fireEvent.keyDown(document, { key: "Escape" })
        expect(btn).toHaveAttribute("aria-expanded", "false")
    })
})
