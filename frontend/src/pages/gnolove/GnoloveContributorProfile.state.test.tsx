import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import GnoloveContributorProfile from "./GnoloveContributorProfile"

const mockContributor = vi.fn()
vi.mock("../../hooks/gnolove", () => ({ useGnoloveContributor: () => mockContributor() }))
vi.mock("../../hooks/useNetworkNav", () => ({ useNetworkPath: () => (path: string) => `/mainnet/${path}` }))

function renderProfile() {
    return render(
        <MemoryRouter initialEntries={["/mainnet/gnolove/contributor/unknown"]}>
            <Routes>
                <Route path="/mainnet/gnolove/contributor/:login" element={<GnoloveContributorProfile />} />
            </Routes>
        </MemoryRouter>,
    )
}

describe("Gnolove contributor states", () => {
    it("offers retry on a service failure", () => {
        const refetch = vi.fn()
        mockContributor.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
        renderProfile()
        expect(screen.getByRole("heading", { level: 1, name: "Contributor unavailable" })).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Retry" }))
        expect(refetch).toHaveBeenCalledOnce()
    })

    it("uses a primary heading and recovery link for a genuine missing contributor", () => {
        mockContributor.mockReturnValue({ data: null, isLoading: false, isError: false })
        renderProfile()
        expect(screen.getByRole("heading", { level: 1, name: "Contributor not found" })).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "Return to Contributors Overview" })).toHaveAttribute("href", "/mainnet/gnolove")
    })
})
