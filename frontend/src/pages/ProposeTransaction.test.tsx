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

// The network price as read from the chain: 1 ugnot per 1,000 gas (gnoland-1, 2026-09).
vi.mock("../lib/grc20", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../lib/grc20")>()),
    networkGasPriceFresh: vi.fn(async () => ({ gas: 1000, ugnot: 1 })),
}))

import { ProposeTransaction } from "./ProposeTransaction"
import { networkGasPriceFresh } from "../lib/grc20"

/** The page once its fee is priced, as a member sees it before pressing Propose. */
async function renderPage() {
    render(<ProposeTransaction />)
    await waitFor(() => expect(screen.getByLabelText("Native fee (ugnot)")).not.toHaveValue(""))
}
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
        await renderPage()
        fireEvent.click(screen.getByText("Propose Send"))
        expect(await screen.findByText(/Recipient and amount are required/)).toBeInTheDocument()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })

    it("rejects a malformed recipient address", async () => {
        await renderPage()
        fireEvent.change(screen.getByPlaceholderText("g1recipient..."), { target: { value: "not-an-address" } })
        fireEvent.change(screen.getByPlaceholderText("1.0"), { target: { value: "1" } })
        fireEvent.click(screen.getByText("Propose Send"))
        expect(await screen.findByText(/Invalid recipient address format/)).toBeInTheDocument()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })

    it("rejects a zero/negative amount", async () => {
        await renderPage()
        fillSendForm("0")
        fireEvent.click(screen.getByText("Propose Send"))
        expect(await screen.findByText(/Amount must be greater than 0/)).toBeInTheDocument()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })

    it.each(["-1", "1x", "1e3", "1.0000001", "9223372036854.775808"])("rejects invalid GNOT send amount %s", async (value) => {
        await renderPage()
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
        await renderPage()
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
        // Twice the network price: 10,000,000 gas at 1 ugnot per 1,000, times 2.
        expect(JSON.parse(payload.feeJson)).toEqual({ gas_wanted: "10000000", gas_fee: "20000ugnot" })
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["multisig"] })
        expect(mockNavigate).toHaveBeenCalledWith(`/tx/42?ms=${MULTISIG}&chain=test-13`)
    })

    it("keeps the created proposal successful when cache invalidation fails", async () => {
        vi.mocked(api.createTransaction).mockResolvedValue({ transactionId: 43 } as never)
        mockInvalidateQueries.mockRejectedValue(new Error("cache unavailable"))
        await renderPage()
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
        await renderPage()
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
        await renderPage()
        fillCallForm(send)
        fireEvent.click(screen.getByText("Propose Call"))

        await waitFor(() => expect(api.createTransaction).toHaveBeenCalled())
        const msgsJson = vi.mocked(api.createTransaction).mock.calls[0][0].msgsJson
        if (send === "0.000001") expect(msgsJson).toContain("1ugnot")
        else expect(msgsJson).not.toContain("1ugnot")
    })

    it.each(["-1", "1junk", "0.0000001"])("rejects invalid call send amount %s", async (send) => {
        await renderPage()
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
        await renderPage()
        fillTokenForm(tab, "0")
        fireEvent.click(screen.getByRole("button", { name: /Propose (Transfer|Mint|Burn)/ }))
        expect(await screen.findByText("Amount must be greater than 0")).toBeInTheDocument()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })

    it("does not silently turn a negative token amount positive", async () => {
        await renderPage()
        fillTokenForm("🪙 Transfer", "-5")
        expect(screen.getByPlaceholderText("e.g. 1000000")).toHaveValue("-5")
        fireEvent.click(screen.getByText("Propose Transfer"))
        expect(await screen.findByTestId("error-toast")).toHaveTextContent("nonnegative whole number")
        expect(api.createTransaction).not.toHaveBeenCalled()
    })

    it("accepts zero approval to revoke an allowance", async () => {
        vi.mocked(api.createTransaction).mockResolvedValue({ transactionId: 45 } as never)
        await renderPage()
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
        await renderPage()
        fillSendForm()
        fireEvent.click(screen.getByText("Propose Send"))

        expect(await screen.findByText(/Could not read on-chain account state/)).toBeInTheDocument()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })
})

describe("ProposeTransaction — executable identity", () => {
    it("rejects legacy history before constructing an on-chain proposal", async () => {
        vi.mocked(api.multisigInfo).mockResolvedValue({ multisig: { pubkeyJson: '{}' } } as never)
        await renderPage()
        fillSendForm()
        fireEvent.click(screen.getByText("Propose Send"))
        expect(await screen.findByText(/Legacy multisig history cannot create executable proposals/)).toBeInTheDocument()
        expect(fetchAccountInfo).not.toHaveBeenCalled()
        expect(api.createTransaction).not.toHaveBeenCalled()
    })
})

describe("ProposeTransaction — native fee at the network price", () => {
    const fee = () => screen.getByLabelText("Native fee (ugnot)")
    const gas = () => screen.getByLabelText("Native gas limit")

    it("defaults to twice a fresh network price for the gas limit and follows the limit until the member types a fee", async () => {
        await renderPage()
        expect(fee()).toHaveValue("20000")
        expect(screen.getByText(/twice the network gas price for this gas limit/)).toBeInTheDocument()
        expect(screen.getByText(/it can be changed only before you press Propose/)).toBeInTheDocument()
        fireEvent.change(gas(), { target: { value: "20000000" } })
        expect(fee()).toHaveValue("40000")
        fireEvent.change(fee(), { target: { value: "50000" } })
        fireEvent.change(gas(), { target: { value: "30000000" } })
        expect(fee()).toHaveValue("50000")
        expect(screen.getByText(/You set this fee. Clear it to return to the network price./)).toBeInTheDocument()
        expect(screen.queryByText(/twice the network gas price/)).toBeNull()
        // Cleared: back to the priced fee for the current limit.
        fireEvent.change(fee(), { target: { value: "" } })
        expect(fee()).toHaveValue("60000")
    })

    it("says why the fee is blank when the gas limit cannot be priced", async () => {
        await renderPage()
        fireEvent.change(gas(), { target: { value: "500000001" } })
        expect(fee()).toHaveValue("")
        expect(screen.getByText("Enter a whole gas limit up to 500,000,000 to price the fee.")).toBeInTheDocument()
        expect(screen.getByText("Propose Send")).toBeDisabled()
    })

    it("keeps Propose disabled until the fee is known, so nothing is proposed with an empty fee", async () => {
        vi.mocked(networkGasPriceFresh).mockReturnValueOnce(new Promise(() => {}))
        render(<ProposeTransaction />)
        fillSendForm("1")
        expect(screen.getByText("Propose Send")).toBeDisabled()
        expect(fee()).toHaveAttribute("placeholder", "Reading the network price…")
        expect(api.createTransaction).not.toHaveBeenCalled()
    })

    it("says when the price could not be read and the fee uses a default price", async () => {
        vi.mocked(networkGasPriceFresh).mockRejectedValueOnce(new Error("no node answered"))
        await renderPage()
        expect(screen.getByText(/network gas price couldn't be read, so this fee uses a default price/)).toBeInTheDocument()
        expect(fee()).toHaveValue("20000")
    })
})
