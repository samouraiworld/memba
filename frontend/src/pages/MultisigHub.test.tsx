/**
 * MultisigHub.test.tsx — the hub lists only the active network's multisigs.
 *
 * Without a chainId the backend returns rows from every chain, so a testnet
 * wallet would show up (and be joinable) on the mainnet hub.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkNav: () => vi.fn(),
}))

const mockAuth = {
    token: { userAddress: "g1member" },
    isAuthenticated: true,
}
vi.mock("react-router-dom", () => ({
    useOutletContext: () => ({ auth: mockAuth }),
}))

vi.mock("../lib/api", () => ({
    api: {
        multisigs: vi.fn(),
        createOrJoinMultisig: vi.fn(),
    },
}))

vi.mock("../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../lib/config")>()),
    GNO_CHAIN_ID: "gnoland-1",
}))

import MultisigHub from "./MultisigHub"
import { api } from "../lib/api"

beforeEach(() => {
    vi.clearAllMocks()
})

describe("MultisigHub", () => {
    it("scopes the multisig list to the active chain", async () => {
        vi.mocked(api.multisigs).mockResolvedValue({ multisigs: [] } as never)
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(<QueryClientProvider client={client}><MultisigHub /></QueryClientProvider>)

        await screen.findByText("No multisig wallets yet")
        expect(api.multisigs).toHaveBeenCalledTimes(1)
        expect(vi.mocked(api.multisigs).mock.calls[0][0]).toMatchObject({ chainId: "gnoland-1" })
    })
})
