import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { getAddress } from "viem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OsSession } from "../../shell/useOsSession"
import { SafeActionError } from "../../../lib/chain/evm/safe/create"
import { ProposeSafe } from "./ProposeSafe"

vi.mock("../../../lib/chain/flag", () => ({ EVM_ENABLED: true }))

const SAFE = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
const ME = "0xa11ce00000000000000000000000000000000001"
const BOB = "0xb0b0000000000000000000000000000000000002"
const PAYEE = "0x1234000000000000000000000000000000005678"
const TOKEN = "0x7070000000000000000000000000000000000003"

const kit = { getMultisigTransactions: vi.fn() }
const sdk = {
    safeApiKit: () => kit,
    toChecksum: (a: string) => getAddress(a),
    inspect: vi.fn(async () => ({ kind: "ok", value: { kind: "safe", address: SAFE, version: "1.5.0", l2: true, owners: [ME, BOB], threshold: 2, nonce: 4n, modules: [], modulesTruncated: false, guard: null, moduleGuard: null, fallbackHandler: null, warnings: [] } })),
    readToken: vi.fn(async () => ({ kind: "ok", value: { symbol: "USDC", decimals: 6 } })),
    isContract: vi.fn(async () => ({ kind: "ok", value: false })),
    proposeSafeTx: vi.fn(async () => `0x${"ab".repeat(32)}`),
    SafeActionError,
}
vi.mock("../../../lib/chain/evm/safe/load", () => ({ loadSafeSdk: async () => sdk }))

const base = { network: { key: "base-sepolia", family: "evm", label: "Base Sepolia", chainId: "84532" }, layout: {}, openConnect: vi.fn() }
const owner = { ...base, status: "guest", address: "", walletAddress: ME } as unknown as OsSession
const guest = { ...base, status: "guest", address: "", walletAddress: "" } as unknown as OsSession
const stranger = { ...base, status: "guest", address: "", walletAddress: "0x9999999999999999999999999999999999999999" } as unknown as OsSession

function wrap(session: OsSession) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}><ProposeSafe address={SAFE} session={session} open={vi.fn()} /></QueryClientProvider>)
}

async function fill(i: number, recipient: string, amount: string, token = "") {
    fireEvent.change(await screen.findByRole("textbox", { name: `Recipient ${i}` }), { target: { value: recipient } })
    fireEvent.change(screen.getByRole("textbox", { name: `Amount ${i}` }), { target: { value: amount } })
    fireEvent.change(screen.getByRole("textbox", { name: `Token ${i}` }), { target: { value: token } })
}

beforeEach(() => {
    vi.clearAllMocks()
    kit.getMultisigTransactions.mockResolvedValue({ count: 0, results: [] })
})

describe("proposing a payment from a Safe", () => {
    it("shows a guest the form and asks for a wallet only at review", async () => {
        wrap(guest)
        await fill(1, PAYEE, "1")
        fireEvent.click(screen.getByRole("button", { name: "Connect a wallet to review" }))
        expect(guest.openConnect).toHaveBeenCalledOnce()
    })

    it("refuses a wallet that isn't an owner", async () => {
        wrap(stranger)
        await fill(1, PAYEE, "1")
        fireEvent.click(screen.getByRole("button", { name: "Review" }))
        expect(await screen.findByRole("alert")).toHaveTextContent("only owners can propose")
    })

    it("proposes an ETH payment and a token payment as one batch, with exact amounts", async () => {
        wrap(owner)
        await fill(1, PAYEE, "0.5")
        fireEvent.click(screen.getByRole("button", { name: "Add a payment" }))
        await fill(2, BOB, "12.25", TOKEN)
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review" })) })
        expect(await screen.findByText("Send 0.5 ETH")).toBeInTheDocument()
        expect(screen.getByText(`Send 12.25 USDC (token ${getAddress(TOKEN)})`)).toBeInTheDocument()
        expect(screen.getByText(/These 2 payments run together/)).toBeInTheDocument()
        // A first-time payee is flagged; an owner isn't. A token's name is never trusted.
        expect(screen.getAllByText(/has not paid this address before/)).toHaveLength(1)
        expect(screen.getAllByText(/Any token can take any name/)).toHaveLength(1)

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign and propose" })) })
        expect(sdk.proposeSafeTx).toHaveBeenCalledWith("base-sepolia", expect.any(String), SAFE, [
            { to: PAYEE, value: 500_000_000_000_000_000n, data: "0x" },
            { to: TOKEN, value: 0n, data: `0xa9059cbb${BOB.slice(2).padStart(64, "0")}${(12_250_000n).toString(16).padStart(64, "0")}` },
        ])
        expect(await screen.findByText("Proposed")).toBeInTheDocument()
    })

    it("asks to compare every character before signing a payment to a look-alike", async () => {
        const lookAlike = `0x${BOB.slice(2, 6)}${"9".repeat(32)}${BOB.slice(-4)}`
        wrap(owner)
        await fill(1, lookAlike, "1")
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review" })) })
        expect(await screen.findByText(/starts and ends like one you know/)).toBeInTheDocument()
        const sign = screen.getByRole("button", { name: "Sign and propose" })
        expect(sign).toBeDisabled()
        fireEvent.click(screen.getByRole("checkbox"))
        expect(sign).toBeEnabled()
    })

    it("refuses an amount it can't read exactly, and a token that doesn't answer", async () => {
        wrap(owner)
        await fill(1, PAYEE, "1.1234567", TOKEN)
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review" })) })
        expect(await screen.findByRole("alert")).toHaveTextContent("At most 6 decimal places.")
        sdk.readToken.mockResolvedValueOnce({ kind: "unavailable", reason: "this address does not answer like an ERC-20 token" } as never)
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review" })) })
        expect(await screen.findByRole("alert")).toHaveTextContent("token: this address does not answer like an ERC-20 token.")
        expect(sdk.proposeSafeTx).not.toHaveBeenCalled()
    })

    it("says what stopped the proposal and keeps the review", async () => {
        sdk.proposeSafeTx.mockRejectedValueOnce(new SafeActionError({ code: "service", detail: "nonce too low" }))
        wrap(owner)
        await fill(1, BOB, "1")
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review" })) })
        await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Sign and propose" })) })
        expect(await screen.findByRole("alert")).toHaveTextContent("The Safe Transaction Service refused it: nonce too low")
        expect(screen.getByRole("button", { name: "Sign and propose" })).toBeEnabled()
    })
})
