/**
 * TokenDashboard.test.tsx — characterization tests.
 *
 * Pin the observable behavior (lists enriched factory tokens; empty state;
 * refresh re-reads) so the useState→useQuery caching refactor is provably
 * behavior-preserving.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, fireEvent, waitFor } from "@testing-library/react"
import { renderWithProviders, mockLayoutContext } from "../test/test-utils"
import { TokenDashboard } from "./TokenDashboard"

const capability = vi.hoisted(() => ({ available: true }))
const mockNavigate = vi.fn()
vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkNav: () => mockNavigate,
}))

vi.mock("../lib/config", () => ({
    GNO_RPC_URL: "https://rpc.test.gno.land",
    GNO_CHAIN_ID: "test-13",
    ACTIVE_NETWORK_KEY: "test13",
    GRC20_FACTORY_PATH: "gno.land/r/samcrew/tokenfactory_v2",
    isRealmValidOn: () => capability.available,
}))

const listFactoryTokens = vi.fn()
const getTokenInfo = vi.fn()
const getTokenBalance = vi.fn()
vi.mock("../lib/grc20", () => ({
    listFactoryTokens: (...a: unknown[]) => listFactoryTokens(...a),
    getTokenInfo: (...a: unknown[]) => getTokenInfo(...a),
    getTokenBalance: (...a: unknown[]) => getTokenBalance(...a),
    formatTokenAmount: (v: bigint) => v.toString(),
}))

// TokenDashboard reads the wallet via useOutletContext — provide a disconnected
// LayoutContext by default (keeps the balances read out of these cases).
vi.mock("react-router-dom", async (orig) => ({
    ...(await orig<typeof import("react-router-dom")>()),
    useOutletContext: () => mockLayoutContext(),
}))

describe("TokenDashboard", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        capability.available = true
        getTokenBalance.mockResolvedValue(0n)
    })

    it("does not query or advertise creation when the factory is unavailable", () => {
        capability.available = false
        renderWithProviders(<TokenDashboard />)
        expect(screen.getByText("Token creation unavailable here")).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Create a Token/ })).not.toBeInTheDocument()
        expect(screen.queryByText("No tokens yet")).not.toBeInTheDocument()
        expect(listFactoryTokens).not.toHaveBeenCalled()
        expect(getTokenBalance).not.toHaveBeenCalled()
    })

    it("lists factory tokens enriched with their on-chain info", async () => {
        listFactoryTokens.mockResolvedValue([{ symbol: "FOO" }])
        getTokenInfo.mockResolvedValue({ symbol: "FOO", name: "Foo Token", totalSupply: "1000", decimals: 6 })

        renderWithProviders(<TokenDashboard />)

        expect(await screen.findByText("Foo Token")).toBeInTheDocument()
        expect(screen.getByText("$FOO")).toBeInTheDocument()
    })

    it("shows the empty state when there are no tokens", async () => {
        listFactoryTokens.mockResolvedValue([])

        renderWithProviders(<TokenDashboard />)

        expect(await screen.findByText("No tokens yet")).toBeInTheDocument()
    })

    it("re-reads the token list when Refresh is clicked", async () => {
        listFactoryTokens.mockResolvedValue([{ symbol: "FOO" }])
        getTokenInfo.mockResolvedValue({ symbol: "FOO", name: "Foo Token", totalSupply: "1000", decimals: 6 })

        renderWithProviders(<TokenDashboard />)
        await screen.findByText("Foo Token")
        const before = listFactoryTokens.mock.calls.length

        fireEvent.click(screen.getByRole("button", { name: /Refresh/i }))
        await waitFor(() => expect(listFactoryTokens.mock.calls.length).toBeGreaterThan(before))
    })
})
