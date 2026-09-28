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

const { mockInvalidateQueries } = vi.hoisted(() => ({ mockInvalidateQueries: vi.fn() }))
vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-query")>()),
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

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
    api: { createTransaction: vi.fn(), multisigInfo: vi.fn() },
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
    ENABLE_NATIVE_GNO_MULTISIG: true,
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
    mockInvalidateQueries.mockResolvedValue(undefined)
    mockAuth.isAuthenticated = true
    vi.mocked(fetchAccountInfo).mockResolvedValue({ accountNumber: 12, sequence: 3 })
    vi.mocked(api.multisigInfo).mockResolvedValue({ multisig: { pubkeyJson: '{"@type":"/tm.PubKeyMultisig"}' } } as never)
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

    it.each(["-1", "1x", "1e3", "1.0000001", "9223372036854.775808"])("rejects invalid GNOT send amount %s", async (value) => {
        render(<ProposeTransaction />)
        fillSendForm(value)
        fireEvent.click(screen.getByText("Propose Send"))
        expect(await screen.findByTestId("error-toast")).toBeInTheDocument()
        expect(fetchAccountInfo).not.toHaveBeenCalled()
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
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["multisig"] })
        expect(mockNavigate).toHaveBeenCalledWith(`/tx/42?ms=${MULTISIG}&chain=test-13`)
    })

    it("keeps the created proposal successful when cache invalidation fails", async () => {
        vi.mocked(api.createTransaction).mockResolvedValue({ transactionId: 43 } as never)
        mockInvalidateQueries.mockRejectedValue(new Error("cache unavailable"))
        render(<ProposeTransaction />)
        fillSendForm("0.000001")
        fireEvent.click(screen.getByText("Propose Send"))

        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(`/tx/43?ms=${MULTISIG}&chain=test-13`))
        expect(screen.queryByTestId("error-toast")).not.toBeInTheDocument()
        expect(vi.mocked(api.createTransaction).mock.calls[0][0].msgsJson).toContain("1ugnot")
    })

    it.each([
        ["1.000001", "1000001"],
        ["9223372036854.775807", "9223372036854775807"],
    ])("serializes exact GNOT amount %s as %s ugnot", async (value, expected) => {
        vi.mocked(api.createTransaction).mockResolvedValue({ transactionId: 46 } as never)
        render(<ProposeTransaction />)
        fillSendForm(value)
        fireEvent.click(screen.getByText("Propose Send"))

        await waitFor(() => expect(api.createTransaction).toHaveBeenCalled())
        expect(vi.mocked(api.createTransaction).mock.calls[0][0].msgsJson).toContain(expected)
    })
})

describe("ProposeTransaction — contract call value", () => {
    function fillCallForm(send: string) {
        fireEvent.click(screen.getByText("Contract Call"))
        fireEvent.change(screen.getByPlaceholderText("gno.land/r/demo/boards"), { target: { value: "gno.land/r/demo/boards" } })
        fireEvent.change(screen.getByPlaceholderText("CreateThread"), { target: { value: "CreateThread" } })
        fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: send } })
    }

    it.each(["", "0", "0.000001"])("accepts optional send amount %s exactly", async (send) => {
        vi.mocked(api.createTransaction).mockResolvedValue({ transactionId: 44 } as never)
        render(<ProposeTransaction />)
        fillCallForm(send)
        fireEvent.click(screen.getByText("Propose Call"))

        await waitFor(() => expect(api.createTransaction).toHaveBeenCalled())
        const msgsJson = vi.mocked(api.createTransaction).mock.calls[0][0].msgsJson
        if (send === "0.000001") expect(msgsJson).toContain("1ugnot")
        else expect(msgsJson).not.toContain("1ugnot")
    })

    it.each(["-1", "1junk", "0.0000001"])("rejects invalid call send amount %s", async (send) => {
        render(<ProposeTransaction />)
        fillCallForm(send)
        fireEvent.click(screen.getByText("Propose Call"))
        expect(await screen.findByTestId("error-toast")).toBeInTheDocument()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })
})

describe("ProposeTransaction — token amounts", () => {
    function fillTokenForm(tab: string, value: string) {
        fireEvent.click(screen.getByText(tab))
        fireEvent.change(screen.getByPlaceholderText("e.g. SAM"), { target: { value: "SAM" } })
        fireEvent.change(screen.getByPlaceholderText("g1..."), { target: { value: RECIPIENT } })
        fireEvent.change(screen.getByPlaceholderText("e.g. 1000000"), { target: { value } })
    }

    it.each(["🪙 Transfer", "🪙 Mint", "🪙 Burn"])("rejects zero for %s", async (tab) => {
        render(<ProposeTransaction />)
        fillTokenForm(tab, "0")
        fireEvent.click(screen.getByRole("button", { name: /Propose (Transfer|Mint|Burn)/ }))
        expect(await screen.findByText("Amount must be greater than 0")).toBeInTheDocument()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })

    it("does not silently turn a negative token amount positive", async () => {
        render(<ProposeTransaction />)
        fillTokenForm("🪙 Transfer", "-5")
        expect(screen.getByPlaceholderText("e.g. 1000000")).toHaveValue("-5")
        fireEvent.click(screen.getByText("Propose Transfer"))
        expect(await screen.findByTestId("error-toast")).toHaveTextContent("nonnegative whole number")
        expect(api.createTransaction).not.toHaveBeenCalled()
    })

    it("accepts zero approval to revoke an allowance", async () => {
        vi.mocked(api.createTransaction).mockResolvedValue({ transactionId: 45 } as never)
        render(<ProposeTransaction />)
        fillTokenForm("🪙 Approve", "0")
        fireEvent.click(screen.getByText("Propose Approve"))

        await waitFor(() => expect(api.createTransaction).toHaveBeenCalled())
        const msgs = JSON.parse(vi.mocked(api.createTransaction).mock.calls[0][0].msgsJson)
        expect(msgs[0].args).toContain("0")
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

describe("ProposeTransaction — executable identity", () => {
    it("rejects legacy history before constructing an on-chain proposal", async () => {
        vi.mocked(api.multisigInfo).mockResolvedValue({ multisig: { pubkeyJson: '{}' } } as never)
        render(<ProposeTransaction />)
        fillSendForm()
        fireEvent.click(screen.getByText("Propose Send"))
        expect(await screen.findByText(/Legacy multisig history cannot create executable proposals/)).toBeInTheDocument()
        expect(fetchAccountInfo).not.toHaveBeenCalled()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })
})
