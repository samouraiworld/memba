import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const state = vi.hoisted(() => ({ ugnot: 5_000_000n as bigint | null, faucet: "" }))

vi.mock("../../../hooks/useAdena", () => ({
    useAdena: () => ({ connected: true, address: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" }),
}))
vi.mock("../../../hooks/useBalance", () => ({ useBalance: () => ({ rawUgnot: state.ugnot }) }))
vi.mock("../../../lib/config", async (orig) => {
    const actual = await orig<typeof import("../../../lib/config")>()
    return {
        ...actual,
        get GNO_FAUCET_URL() { return state.faucet },
    }
})

import { YourAssetsPanel } from "./YourAssetsPanel"

function renderOn(network: string) {
    return render(
        <MemoryRouter initialEntries={[`/${network}/dashboard`]}>
            <Routes>
                <Route path="/:network/dashboard" element={<YourAssetsPanel />} />
            </Routes>
        </MemoryRouter>,
    )
}

describe("YourAssetsPanel", () => {
    beforeEach(() => {
        state.ugnot = 5_000_000n
        state.faucet = ""
    })

    it("labels the balance with the active network, not a testnet, on mainnet", () => {
        renderOn("mainnet")
        expect(screen.getByTestId("your-assets-network").textContent).toBe("gno.land")
        expect(screen.queryByText(/testnet/i)).toBeNull()
    })

    it("marks a test chain as a testnet", () => {
        renderOn("pearl")
        expect(screen.getByTestId("your-assets-network").textContent).toBe("Pearl testnet")
    })

    it("offers no faucet link on a network without a faucet", () => {
        state.ugnot = 0n
        renderOn("mainnet")
        expect(screen.queryByText(/testnet GNOT/i)).toBeNull()
        expect(document.querySelector('a[href*="faucet"]')).toBeNull()
    })

    it("links the network's own faucet where there is one", () => {
        state.ugnot = 0n
        state.faucet = "https://faucet.example"
        renderOn("pearl")
        expect(screen.getByText("Get testnet GNOT").closest("a")).toHaveAttribute("href", "https://faucet.example")
    })
})
