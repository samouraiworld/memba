/**
 * MultisigHub.test.tsx — the hub lists only the active network's multisigs.
 *
 * Without a chainId the backend returns rows from every chain, so a testnet
 * wallet would show up (and be joinable) on the mainnet hub.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))
vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkNav: () => mockNavigate,
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
    ENABLE_NATIVE_GNO_MULTISIG: false,
}))

import MultisigHub from "./MultisigHub"
import { api } from "../lib/api"

beforeEach(() => {
    vi.clearAllMocks()
})

function renderHub() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}><MultisigHub /></QueryClientProvider>)
}

function wallet(index: number, joined = true) {
    return {
        address: `g1${String(index).padStart(38, "0")}`,
        name: `Treasury ${index}`,
        chainId: "gnoland-1",
        pubkeyJson: "{\"type\":\"test\"}",
        threshold: 2,
        membersCount: 3,
        joined,
    }
}

describe("MultisigHub", () => {
    it("scopes the multisig list to the active chain", async () => {
        vi.mocked(api.multisigs).mockResolvedValue({ multisigs: [] } as never)
        renderHub()

        await screen.findByText("No multisig accounts yet")
        expect(api.multisigs).toHaveBeenCalledTimes(1)
        expect(vi.mocked(api.multisigs).mock.calls[0][0]).toMatchObject({ chainId: "gnoland-1", limit: 50 })
    })

    it("shows the release gate and an honest import action for an empty account list", async () => {
        vi.mocked(api.multisigs).mockResolvedValue({ multisigs: [] } as never)
        renderHub()

        await screen.findByText("No multisig accounts yet")
        expect(screen.getByTestId("multisig-create-btn")).toBeDisabled()
        expect(screen.getByRole("status")).toHaveTextContent("read-only history")
        fireEvent.click(screen.getByRole("button", { name: "Import account" }))
        expect(mockNavigate).toHaveBeenCalledWith("/import")
    })

    it("shows a retryable error instead of an empty wallet list when the backend is unreachable", async () => {
        vi.mocked(api.multisigs).mockRejectedValueOnce(new Error("Failed to fetch"))
            .mockResolvedValueOnce({ multisigs: [] } as never)
        renderHub()

        expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your multisig accounts")
        expect(screen.queryByText("No multisig accounts yet")).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Try again" }))
        await screen.findByText("No multisig accounts yet")
        expect(api.multisigs).toHaveBeenCalledTimes(2)
    })

    it("provides a keyboard accessible account action and accurately names the add flow", async () => {
        vi.mocked(api.multisigs).mockResolvedValue({ multisigs: [wallet(1), wallet(2, false)] } as never)
        vi.mocked(api.createOrJoinMultisig).mockResolvedValue({} as never)
        renderHub()

        const view = await screen.findByRole("button", { name: "View Treasury 1 multisig history" })
        fireEvent.click(view)
        expect(mockNavigate).toHaveBeenCalledWith(`/multisig/${wallet(1).address}`)
        expect(screen.getByText("Accounts shared with you")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Add account" }))
        await waitFor(() => expect(api.createOrJoinMultisig).toHaveBeenCalled())
    })

    it("discloses the 50 account response cap", async () => {
        vi.mocked(api.multisigs).mockResolvedValue({ multisigs: Array.from({ length: 50 }, (_, i) => wallet(i)) } as never)
        renderHub()

        expect(await screen.findByText("Showing the newest 50 accounts. Older accounts may not appear here.")).toBeInTheDocument()
    })
})
