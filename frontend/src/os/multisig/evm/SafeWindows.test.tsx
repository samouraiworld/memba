import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getAddress } from "viem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { OsSession } from "../../shell/useOsSession"
import type { SafeInspection } from "../../../lib/chain/evm/safe/inspect"
import type { Read } from "../../../lib/chain/types"
import { SafeApp, SafeWindow } from "./SafeWindows"

vi.mock("../../../lib/chain/flag", () => ({ EVM_ENABLED: true }))

const SAFE = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
const ME = "0xa11ce00000000000000000000000000000000001"
const BOB = "0xb0b0000000000000000000000000000000000002"
const MODULE = "0xd0d0000000000000000000000000000000000003"
const TX_HASH = `0x${"ab".repeat(32)}`

const kit = { getSafesByOwner: vi.fn(), getPendingTransactions: vi.fn(), getMultisigTransactions: vi.fn(), getSafeInfo: vi.fn() }
const sdk = {
    safeApiKit: vi.fn(() => kit),
    inspect: vi.fn<(key: string, address: string) => Promise<Read<SafeInspection>>>(),
    readBalance: vi.fn(async () => ({ kind: "ok", value: 1_500_000_000_000_000_000n }) as Read<bigint>),
    toChecksum: (a: string) => getAddress(a),
    checkQueuedTx: vi.fn(async (_chain: number, _owners: readonly string[], tx: { safeTxHash: string; confirmations?: { owner: string }[] }) => ({
        hashMatches: !tx.safeTxHash.endsWith("bad"),
        submitted: new Set((tx.confirmations ?? []).map((c) => c.owner)),
        verified: new Set((tx.confirmations ?? []).map((c) => c.owner)),
    })),
}
vi.mock("../../../lib/chain/evm/safe/load", () => ({ loadSafeSdk: async () => sdk }))

const base = { network: { key: "base-sepolia", family: "evm", label: "Base Sepolia", chainId: "84532" }, layout: {}, openConnect: vi.fn() }
const guest = { ...base, status: "guest", address: "", walletAddress: "" } as unknown as OsSession
// A connected wallet without a Memba sign-in: enough to see and sign for its Safes.
const walletOnly = { ...base, status: "guest", address: "", walletAddress: ME } as unknown as OsSession
const member = { ...base, status: "member", address: ME, walletAddress: ME } as unknown as OsSession

function wrap(ui: ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const safeFacts = (over: Partial<Extract<SafeInspection, { kind: "safe" }>> = {}): Read<SafeInspection> => ({
    kind: "ok",
    value: {
        kind: "safe", address: SAFE, version: "1.5.0", l2: true, singleton: "0xedd160febbd92e350d4d398fb636302fccd67c7e",
        owners: [ME, BOB], threshold: 2, nonce: 4n, modules: [], modulesTruncated: false, guard: null, moduleGuard: null,
        fallbackHandler: "0x3efcbb83a4a7afcb4f68d501e2c2203a38be77f4", warnings: [], ...over,
    },
})

const pending = (nonce: number, safeTxHash: string, extra: object = {}) => ({
    safe: getAddress(SAFE), to: BOB, value: "1000000000000000000", data: null, operation: 0, nonce: String(nonce), safeTxHash,
    submissionDate: "2026-10-07T10:00:00Z", confirmations: [{ owner: ME }], ...extra,
})

beforeEach(() => {
    vi.clearAllMocks()
    kit.getSafesByOwner.mockResolvedValue({ safes: [getAddress(SAFE)] })
    kit.getSafeInfo.mockResolvedValue({ nonce: "4" })
    kit.getPendingTransactions.mockResolvedValue({ count: 0, results: [] })
    kit.getMultisigTransactions.mockResolvedValue({ count: 0, results: [] })
    sdk.inspect.mockResolvedValue(safeFacts())
})

describe("the Multisig app on an EVM network", () => {
    it("lets a guest open any Safe by address, refusing a broken checksum, and asks to connect only for their own Safes", async () => {
        const open = vi.fn()
        wrap(<SafeApp session={guest} open={open} />)
        expect(screen.getByText(/A Safe is a shared account/)).toBeInTheDocument()
        expect(screen.getByText("Connect a wallet to see the Safes that list you as an owner.")).toBeInTheDocument()
        expect(kit.getSafesByOwner).not.toHaveBeenCalled()

        const input = screen.getByRole("textbox", { name: "Safe address" })
        const checksummed = getAddress(SAFE)
        // Flip the case of one letter: still mixed case, no longer the checksum.
        const i = checksummed.slice(2).search(/[a-fA-F]/) + 2
        const flipped = checksummed[i] === checksummed[i].toLowerCase() ? checksummed[i].toUpperCase() : checksummed[i].toLowerCase()
        fireEvent.change(input, { target: { value: `${checksummed.slice(0, i)}${flipped}${checksummed.slice(i + 1)}` } })
        fireEvent.click(screen.getByRole("button", { name: "Open" }))
        expect(await screen.findByRole("alert")).toHaveTextContent(/checksum/)
        expect(open).not.toHaveBeenCalled()

        fireEvent.change(input, { target: { value: checksummed } })
        fireEvent.click(screen.getByRole("button", { name: "Open" }))
        await waitFor(() => expect(open).toHaveBeenCalledOnce())
        expect(open.mock.calls[0][0].target).toEqual({ kind: "multisig", address: SAFE })
    })

    it("lists, for a member, the Safes that list them, warns that anyone can, and counts what waits for them", async () => {
        kit.getPendingTransactions.mockResolvedValue({ count: 1, results: [pending(4, TX_HASH, { confirmations: [{ owner: BOB }] })] })
        const open = vi.fn()
        wrap(<SafeApp session={member} open={open} />)
        expect(await screen.findByText(getAddress(SAFE))).toBeInTheDocument()
        expect(screen.getByText(/Anyone can create a Safe that lists you as an owner/)).toBeInTheDocument()
        expect(await screen.findByText("1 waiting for your signature")).toBeInTheDocument()
        expect(kit.getSafesByOwner).toHaveBeenCalledWith(ME)
        expect(sdk.safeApiKit).toHaveBeenCalledWith(expect.any(String), 84532)
        fireEvent.click(screen.getByRole("button", { name: new RegExp(getAddress(SAFE)) }))
        expect(open.mock.calls[0][0].target).toEqual({ kind: "multisig", address: SAFE })
    })

    it("lists a connected wallet's Safes without a Memba sign-in", async () => {
        wrap(<SafeApp session={walletOnly} open={vi.fn()} />)
        expect(await screen.findByText(getAddress(SAFE))).toBeInTheDocument()
        expect(kit.getSafesByOwner).toHaveBeenCalledWith(ME)
    })

    it("says when the Transaction Service can't be read, with a retry", async () => {
        kit.getSafesByOwner.mockRejectedValue(new Error("502"))
        wrap(<SafeApp session={member} open={vi.fn()} />)
        expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't read the Safes that list you from the Safe Transaction Service.")
    })
})

describe("a Safe window", () => {
    it("shows the Safe as the chain describes it, its warnings, owners, queue and history", async () => {
        sdk.inspect.mockResolvedValue(safeFacts({
            modules: [MODULE],
            warnings: [{ code: "modules", severity: "danger", addresses: [MODULE], text: "1 module is enabled. A module can move this Safe's funds." }],
        }))
        kit.getPendingTransactions.mockResolvedValue({ count: 3, results: [
            pending(4, TX_HASH, { confirmations: [{ owner: ME }, { owner: BOB }] }),
            pending(4, `0x${"cd".repeat(31)}bad`),
            pending(5, `0x${"ef".repeat(32)}`, { to: SAFE, value: "0", data: "0x694e80c30000000000000000000000000000000000000000000000000000000000000001" }),
        ] })
        kit.getMultisigTransactions.mockResolvedValue({ count: 1, results: [
            { ...pending(3, `0x${"12".repeat(32)}`), isExecuted: true, isSuccessful: false, transactionHash: `0x${"34".repeat(32)}`, executionDate: "2026-10-06T10:00:00Z" },
        ] })
        wrap(<SafeWindow address={SAFE} session={member} />)

        expect(await screen.findByText(/v1\.5\.0 · Requires 2 of 2 owners · nonce 4/)).toBeInTheDocument()
        expect(screen.getByLabelText(getAddress(SAFE))).toHaveTextContent(`0x ${getAddress(SAFE).slice(2).match(/.{4}/g)!.join(" ")}`)
        expect(screen.getByText("1.5 ETH")).toBeInTheDocument()
        expect(screen.getAllByRole("alert")[0]).toHaveTextContent("1 module is enabled")
        expect(screen.getByLabelText("Members")).toHaveTextContent("You")

        const queue = within(await screen.findByRole("region", { name: "Waiting to execute" }))
        expect(await queue.findAllByText("#4 Send 1 ETH")).toHaveLength(2)
        expect(queue.getAllByText("2 proposals use nonce 4: only one of them can execute.")).toHaveLength(2)
        expect(queue.getByText("This proposal's hash doesn't match its contents. Don't sign it.")).toBeInTheDocument()
        expect(queue.getByText("Ready to execute")).toBeInTheDocument()
        expect(queue.getByText("#5 Change the threshold")).toBeInTheDocument()
        expect(queue.getByText(/it can change who controls the Safe/)).toBeInTheDocument()
        expect(kit.getPendingTransactions).toHaveBeenCalledWith(SAFE, expect.objectContaining({ currentNonce: 4 }))

        const history = within(screen.getByRole("region", { name: "Executed" }))
        expect(await history.findByText("#3 Send 1 ETH")).toBeInTheDocument()
        expect(history.getByText(/^Failed/)).toBeInTheDocument()
        expect(history.getByRole("link", { name: "Transaction" })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/0x${"34".repeat(32)}`)
    })

    it("asks a guest to connect, and tells a member who isn't an owner", async () => {
        const { unmount } = wrap(<SafeWindow address={SAFE} session={guest} />)
        expect(await screen.findByText(/Connect a wallet to see what waits for you/)).toBeInTheDocument()
        unmount()
        sdk.inspect.mockResolvedValue(safeFacts({ owners: [BOB], threshold: 1 }))
        wrap(<SafeWindow address={SAFE} session={member} />)
        expect(await screen.findByText("This wallet is not an owner of this Safe.")).toBeInTheDocument()
    })

    it("says what an address is when it isn't a Safe, and never reads a queue for it", async () => {
        sdk.inspect.mockResolvedValue({ kind: "ok", value: { kind: "not-a-safe", address: SAFE, reason: "unknown-proxy" } })
        wrap(<SafeWindow address={SAFE} session={member} />)
        expect(await screen.findByText("This contract is not a Safe proxy Memba recognises.")).toBeInTheDocument()
        expect(kit.getPendingTransactions).not.toHaveBeenCalled()
    })

    it("shows nothing as a Safe while the chain can't be read, with the reason and a retry", async () => {
        sdk.inspect.mockResolvedValue({ kind: "unavailable", reason: "the RPC answered as chain 1, not 84532" })
        wrap(<SafeWindow address={SAFE} session={member} />)
        expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't check this address on Base Sepolia: the RPC answered as chain 1, not 84532.")
        expect(screen.queryByLabelText("Members")).toBeNull()
    })

    it("keeps the chain's facts on screen when the Transaction Service fails", async () => {
        kit.getPendingTransactions.mockRejectedValue(new Error("502"))
        wrap(<SafeWindow address={SAFE} session={member} />)
        expect(await screen.findByText("Couldn't read this Safe's queue from the Safe Transaction Service.", { exact: false })).toBeInTheDocument()
        expect(screen.getByLabelText("Members")).toBeInTheDocument()
    })
})
