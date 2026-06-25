import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ComingSoon } from "./ComingSoon"

describe("ComingSoon", () => {
    it("shows the three upcoming features, each labelled 'soon'", () => {
        render(<ComingSoon />)
        for (const k of ["marketplace", "services", "agents"]) {
            expect(screen.getByTestId(`soon-${k}`)).toHaveTextContent(/soon/i)
        }
        expect(screen.getByText("NFT Marketplace")).toBeInTheDocument()
    })

    it("never renders the upcoming features as navigable links (gated, not live)", () => {
        const { container } = render(<ComingSoon />)
        expect(container.querySelectorAll("a").length).toBe(0)
    })
})
