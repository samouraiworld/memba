import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { BarricadeGate } from "./BarricadeGate"

const mockEnabled = vi.fn(() => false)
vi.mock("../../lib/config", async (orig) => ({
    ...(await orig<typeof import("../../lib/config")>()),
    isBarricadeEnabled: () => mockEnabled(),
}))

describe("BarricadeGate", () => {
    it("shows the coming-soon gate when the flag is off (default)", () => {
        mockEnabled.mockReturnValue(false)
        render(
            <MemoryRouter>
                <BarricadeGate>
                    <div>the game itself</div>
                </BarricadeGate>
            </MemoryRouter>,
        )
        expect(screen.getByText(/MEMBA: BARRICADE/)).toBeInTheDocument()
        expect(screen.queryByText("the game itself")).toBeNull()
    })

    it("renders children when the flag is on", () => {
        mockEnabled.mockReturnValue(true)
        render(
            <MemoryRouter>
                <BarricadeGate>
                    <div>the game itself</div>
                </BarricadeGate>
            </MemoryRouter>,
        )
        expect(screen.getByText("the game itself")).toBeInTheDocument()
    })
})
