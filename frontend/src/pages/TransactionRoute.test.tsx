/**
 * TransactionRoute: one TransactionView per transaction. With a real router,
 * navigating tx/7 → tx/12 must start tx 12 fresh: a gnokey signature pasted
 * for tx 7 must not survive onto tx 12, where "Submit Signature" would file
 * it under the wrong transaction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from "react-router-dom"

vi.mock("../hooks/useNetworkNav", () => ({ useNetworkNav: () => vi.fn() }))
vi.mock("../lib/api", () => ({ api: { getTransaction: vi.fn(), signTransaction: vi.fn(), completeTransaction: vi.fn() } }))
vi.mock("../lib/quests", () => ({ completeQuest: vi.fn() }))
vi.mock("../lib/grc20", () => ({ assertWalletBroadcastSafe: vi.fn() }))
vi.mock("../lib/config", () => ({
    API_BASE_URL: "https://memba-api.test",
    GNO_RPC_URL: "https://rpc.test13.testnets.gno.land:443",
    GNO_BECH32_HRP: "g",
    GNO_CHAIN_ID: "test-13",
    ENABLE_NATIVE_GNO_MULTISIG: true,
}))
vi.mock("../lib/dao/realmAddress", () => ({ pubkeyToAddress: vi.fn(() => Promise.resolve("g1alice00000000000000000000000000000000")) }))

import { TransactionRoute } from "./TransactionView"
import { api } from "../lib/api"

const context = {
    adena: { connected: true, address: "g1carol000000000000000000000000000000000", signArbitrary: vi.fn() },
    auth: { token: { value: "test-token" }, isAuthenticated: true },
}

function tx(id: number) {
    return {
        id, createdAt: "2026-07-03T10:00:00Z", finalHash: "", multisigAddress: "g1multisig000000000000000000000000000000", chainId: "test-13",
        msgsJson: JSON.stringify([{ type: "/bank.MsgSend", value: { from_address: "g1multisig000000000000000000000000000000", to_address: "g1recipientfulladdress0000000000000000xy", amount: [{ denom: "ugnot", amount: String(id * 1000) }] } }]),
        feeJson: JSON.stringify({ gas_wanted: "200000", gas_fee: "10000ugnot" }),
        accountNumber: 12, sequence: 3, creatorAddress: "g1alice00000000000000000000000000000000", threshold: 2, membersCount: 3, memo: "",
        signatures: [], multisigPubkeyJson: JSON.stringify({ type: "tendermint/PubKeyMultisigThreshold", value: { threshold: "2", pubkeys: [{ value: "PK_A" }, { value: "PK_B" }] } }),
        type: "send", verified: false,
    }
}

/** A link inside the app, standing in for a jump from one transaction to another. */
function GoTo12() {
    const navigate = useNavigate()
    return <button type="button" onClick={() => navigate("/test13/tx/12")}>go to 12</button>
}

describe("TransactionRoute", () => {
    beforeEach(() => {
        vi.mocked(api.getTransaction).mockImplementation(async (req: { transactionId: number }) => ({ transaction: tx(req.transactionId) }) as never)
    })

    it("starts each transaction fresh: a signature pasted for tx 7 is gone on tx 12", async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        render(
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={["/test13/tx/7"]}>
                    <GoTo12 />
                    <Routes>
                        <Route path="/:network" element={<Outlet context={context} />}>
                            <Route path="tx/:id" element={<TransactionRoute />} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>,
        )

        fireEvent.click(await screen.findByRole("button", { name: "Paste gnokey Sig" }))
        const box = screen.getByPlaceholderText("Paste base64 signature from gnokey...")
        fireEvent.change(box, { target: { value: "SIGNATURE-FOR-TX-7" } })
        expect(box).toHaveValue("SIGNATURE-FOR-TX-7")

        fireEvent.click(screen.getByRole("button", { name: "go to 12" }))
        await waitFor(() => expect(vi.mocked(api.getTransaction)).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 12 })))
        await screen.findByRole("button", { name: "Paste gnokey Sig" })
        // Fresh page: the manual form is closed, and reopening it shows an empty box.
        expect(screen.queryByDisplayValue("SIGNATURE-FOR-TX-7")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Paste gnokey Sig" }))
        expect(screen.getByPlaceholderText("Paste base64 signature from gnokey...")).toHaveValue("")
    })
})
