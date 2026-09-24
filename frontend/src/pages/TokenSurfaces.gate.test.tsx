import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const gate = vi.hoisted(() => ({ factory: false }))

vi.mock("../lib/config", async (orig) => ({
    ...(await orig<typeof import("../lib/config")>()),
    isTokenFactoryValid: () => gate.factory,
}))
vi.mock("../lib/grc20", async (orig) => ({
    ...(await orig<typeof import("../lib/grc20")>()),
    getTokenInfo: vi.fn(async () => null),
    getTokenBalance: vi.fn(async () => 0n),
}))
vi.mock("react-router-dom", async (orig) => ({
    ...(await orig<typeof import("react-router-dom")>()),
    useOutletContext: () => ({ auth: { isAuthenticated: false }, adena: { connected: false, address: "" } }),
}))

import { getTokenInfo } from "../lib/grc20"
import { TokenView } from "./TokenView"
import { TokensTab } from "../components/directory/tabs/TokensTab"
import * as directory from "../lib/directory"

function renderRoute(ui: React.ReactElement, path = "/mainnet/tokens/FOO") {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path="/:network/tokens/:symbol" element={ui} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

describe("token surfaces without a token factory", () => {
    beforeEach(() => {
        gate.factory = false
        vi.mocked(getTokenInfo).mockClear()
    })

    it("TokenView says the factory is not on this network and never looks the token up", () => {
        renderRoute(<TokenView />)
        expect(screen.getByTestId("token-view-unavailable")).toHaveTextContent("Not available on this network")
        expect(getTokenInfo).not.toHaveBeenCalled()
    })

    it("the Directory Tokens tab says the factory is missing instead of 'No tokens registered'", () => {
        const fetchTokens = vi.spyOn(directory, "fetchTokens")
        renderRoute(<TokensTab />)
        expect(screen.getByTestId("tokens-tab-unavailable")).toBeInTheDocument()
        expect(screen.queryByText("No tokens registered")).toBeNull()
        expect(fetchTokens).not.toHaveBeenCalled()
    })

    it("TokenView still looks the token up where the factory exists", async () => {
        gate.factory = true
        renderRoute(<TokenView />)
        // (The page's own retry policy runs for seconds; the lookup starting is what matters.)
        expect(screen.getByText("Loading token...")).toBeInTheDocument()
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalled())
        expect(screen.queryByTestId("token-view-unavailable")).toBeNull()
    })
})
