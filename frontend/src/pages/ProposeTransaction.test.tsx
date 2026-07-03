/**
 * ProposeTransaction.test.tsx — W2.4 money-path coverage.
 *
 * Proposing writes the canonical sign-doc every member will sign; these tests
 * pin the validation gates, the exact payload sent to the backend, and the
 * W2.2 fail-loud behavior: a thrown fetchAccountInfo (RPC down) must surface
 * as an error and create NOTHING — never a proposal with sequence 0.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const mockNavigate = vi.fn()
vi.mock("../hooks/useNetworkNav", () => ({
    useNetworkNav: () => mockNavigate,
}))

const mockAuth = {
    token: { value: "test-token" },
    isAuthenticated: true,
}
const MULTISIG = "g1multisig000000000000000000000000000000"
vi.mock("react-router-dom", () => ({
    useOutletContext: () => ({ auth: mockAuth, adena: { connected: true, address: "g1member" } }),
    useParams: () => ({ address: MULTISIG }),
}))

vi.mock("../lib/api", () => ({
    api: { createTransaction: vi.fn() },
}))

vi.mock("../lib/account", () => ({
    fetchAccountInfo: vi.fn(),
}))

// Render raw error text — the real ErrorToast routes messages through the
// errorMap, which rewrites copy and would make these assertions brittle.
vi.mock("../components/ui/ErrorToast", () => ({
    ErrorToast: ({ message }: { message: string | null }) =>
        message ? <div data-testid="error-toast">{message}</div> : null,
}))

vi.mock("../lib/config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../lib/config")>()),
    GNO_CHAIN_ID: "test-13",
}))

import { ProposeTransaction } from "./ProposeTransaction"
import { api } from "../lib/api"
import { fetchAccountInfo } from "../lib/account"

const RECIPIENT = "g1recipient00000000000000000000000000000"

function fillSendForm(amount = "1.5") {
    fireEvent.change(screen.getByPlaceholderText("g1recipient..."), { target: { value: RECIPIENT } })
    fireEvent.change(screen.getByPlaceholderText("1.0"), { target: { value: amount } })
}

beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.isAuthenticated = true
    vi.mocked(fetchAccountInfo).mockResolvedValue({ accountNumber: 12, sequence: 3 })
})

describe("ProposeTransaction — validation gates", () => {
    it("requires recipient and amount", async () => {
        render(<ProposeTransaction />)
        fireEvent.click(screen.getByText("Propose Send"))
        expect(await screen.findByText(/Recipient and amount are required/)).toBeInTheDocument()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })

    it("rejects a malformed recipient address", async () => {
        render(<ProposeTransaction />)
        fireEvent.change(screen.getByPlaceholderText("g1recipient..."), { target: { value: "not-an-address" } })
        fireEvent.change(screen.getByPlaceholderText("1.0"), { target: { value: "1" } })
        fireEvent.click(screen.getByText("Propose Send"))
        expect(await screen.findByText(/Invalid recipient address format/)).toBeInTheDocument()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })

    it("rejects a zero/negative amount", async () => {
        render(<ProposeTransaction />)
        fillSendForm("0")
        fireEvent.click(screen.getByText("Propose Send"))
        expect(await screen.findByText(/Amount must be greater than 0/)).toBeInTheDocument()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })
})

describe("ProposeTransaction — happy path payload", () => {
    it("creates the proposal with the live account sequence and navigates to it", async () => {
        vi.mocked(api.createTransaction).mockResolvedValue({ transactionId: 42 } as never)
        render(<ProposeTransaction />)
        fillSendForm("1.5")
        fireEvent.click(screen.getByText("Propose Send"))

        await waitFor(() => expect(api.createTransaction).toHaveBeenCalled())
        const payload = vi.mocked(api.createTransaction).mock.calls[0][0]
        expect(payload).toMatchObject({
            multisigAddress: MULTISIG,
            chainId: "test-13",
            accountNumber: 12,
            sequence: 3,
            type: "send",
        })
        // 1.5 GNOT → 1_500_000 ugnot in the canonical msgs payload (the
        // canonical encoder may fold the coin into "1500000ugnot").
        expect(payload.msgsJson).toContain("1500000")
        expect(payload.msgsJson).toContain(RECIPIENT)
        expect(mockNavigate).toHaveBeenCalledWith(`/tx/42?ms=${MULTISIG}&chain=test-13`)
    })
})

describe("ProposeTransaction — W2.2 fail-loud account read", () => {
    it("surfaces a thrown fetchAccountInfo and creates NOTHING (no sequence-0 sign-doc)", async () => {
        vi.mocked(fetchAccountInfo).mockRejectedValue(
            new Error("Could not read on-chain account state (HTTP 502). Check your connection and try again — signing without it would produce an invalid transaction."),
        )
        render(<ProposeTransaction />)
        fillSendForm()
        fireEvent.click(screen.getByText("Propose Send"))

        expect(await screen.findByText(/Could not read on-chain account state/)).toBeInTheDocument()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })
})
