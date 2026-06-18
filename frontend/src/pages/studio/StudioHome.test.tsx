import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { StudioHome } from "./StudioHome"

function renderWithCtx(address: string) {
    return render(
        <MemoryRouter initialEntries={["/test13/nft/studio"]}>
            <Routes>
                <Route path="/:network/nft/studio" element={<StudioHome />} />
            </Routes>
        </MemoryRouter>,
    )
}

vi.mock("react-router-dom", async (orig) => {
    const mod = await orig<typeof import("react-router-dom")>()
    return { ...mod, useOutletContext: () => ({ adena: { address: "" } }) }
})

describe("StudioHome — gating", () => {
    it("prompts to connect when no wallet", () => {
        renderWithCtx("")
        expect(screen.getByText(/connect/i)).toBeInTheDocument()
    })
})
