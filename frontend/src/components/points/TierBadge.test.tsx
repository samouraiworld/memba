import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TierBadge } from "./TierBadge"

describe("TierBadge", () => {
    it("renders the tier name with a tier-specific class", () => {
        render(<TierBadge tier="Gold" />)
        const el = screen.getByTestId("tier-badge")
        expect(el).toHaveTextContent("Gold")
        expect(el.className).toContain("tier-badge--gold")
    })

    it("falls back to a neutral class for an unknown tier", () => {
        render(<TierBadge tier="Mythic" />)
        expect(screen.getByTestId("tier-badge").className).toContain("tier-badge--default")
    })

    it("renders nothing for an empty tier", () => {
        const { container } = render(<TierBadge tier="" />)
        expect(container).toBeEmptyDOMElement()
    })
})
