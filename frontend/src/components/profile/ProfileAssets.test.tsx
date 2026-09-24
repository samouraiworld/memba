import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

vi.mock("../../hooks/useBalance", () => ({ useBalance: () => ({ rawUgnot: 5_000_000n, loading: false }) }))
vi.mock("../../lib/nftApi", () => ({ fetchNFTPortfolio: vi.fn(async () => []) }))

import { ProfileAssets } from "./ProfileAssets"

function renderOn(network: string) {
    return render(
        <MemoryRouter initialEntries={[`/${network}/profile/g1x`]}>
            <Routes>
                <Route path="/:network/profile/:address" element={<ProfileAssets address="g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" />} />
            </Routes>
        </MemoryRouter>,
    )
}

describe("ProfileAssets native balance label", () => {
    it("names gno.land mainnet, not a testnet, on mainnet", () => {
        renderOn("mainnet")
        expect(screen.getByTestId("asset-native-network").textContent).toBe("gno.land")
        expect(screen.queryByText(/testnet/i)).toBeNull()
    })

    it("marks a test chain as a testnet", () => {
        renderOn("pearl")
        expect(screen.getByTestId("asset-native-network").textContent).toBe("Pearl testnet")
    })

    it("does not repeat 'testnet' when the label already says it", () => {
        renderOn("test13")
        expect(screen.getByTestId("asset-native-network").textContent).toBe("Testnet 13")
    })
})
