import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { concat, encodeFunctionData, encodePacked, getAddress, parseAbi, size } from "viem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { OsSession } from "../../shell/useOsSession"
import type { SafeInspection } from "../../../lib/chain/evm/safe/inspect"
import type { Read } from "../../../lib/chain/types"
import { SafeActionError } from "../../../lib/chain/evm/safe/create"
import { SafeApp, SafeWindow } from "./SafeWindows"

vi.mock("../../../lib/chain/flag", () => ({ EVM_ENABLED: true }))

const SAFE = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
const ME = "0xa11ce00000000000000000000000000000000001"
const BOB = "0xb0b0000000000000000000000000000000000002"
const MODULE = "0xd0d0000000000000000000000000000000000003"
const TX_HASH = `0x${"ab".repeat(32)}`

const kit = { getSafesByOwner: vi.fn(), getPendingTransactions: vi.fn(), getMultisigTransactions: vi.fn(), getSafeInfo: vi.fn() }
async function defaultCheck(_chain: number, _owners: readonly string[], tx: { safeTxHash: string; confirmations?: { owner: string }[] }) {
    return {
        hashMatches: !tx.safeTxHash.endsWith("bad"),
        submitted: new Set((tx.confirmations ?? []).map((c) => c.owner)),
        verified: new Set((tx.confirmations ?? []).map((c) => c.owner)),
    }
}
const sdk = {
    safeApiKit: vi.fn(() => kit),
    inspect: vi.fn<(key: string, address: string) => Promise<Read<SafeInspection>>>(),
    readBalance: vi.fn(async () => ({ kind: "ok", value: 1_500_000_000_000_000_000n }) as Read<bigint>),
    toChecksum: (a: string) => getAddress(a),
    readToken: vi.fn(async () => ({ kind: "ok", value: { symbol: "USDC", decimals: 6 } })),
    isContract: vi.fn(async () => ({ kind: "ok", value: false })),
    confirmSafeTx: vi.fn(async () => undefined),
    executeSafeTx: vi.fn(async () => `0x${"ee".repeat(32)}`),
    SafeActionError,
    checkQueuedTx: vi.fn(defaultCheck),
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
    safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: "0x0000000000000000000000000000000000000000", refundReceiver: "0x0000000000000000000000000000000000000000",
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
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)

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
        expect(await queue.findByText("This changes who controls the Safe.")).toBeInTheDocument()
        expect(kit.getPendingTransactions).toHaveBeenCalledWith(SAFE, expect.objectContaining({ currentNonce: 4 }))

        const history = within(screen.getByRole("region", { name: "Executed" }))
        expect(await history.findByText("#3 Send 1 ETH")).toBeInTheDocument()
        expect(history.getByText(/^Failed/)).toBeInTheDocument()
        expect(history.getByRole("link", { name: "Transaction" })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/0x${"34".repeat(32)}`)
    })

    it("asks a guest to connect, and tells a member who isn't an owner", async () => {
        const { unmount } = wrap(<SafeWindow address={SAFE} session={guest} open={vi.fn()} />)
        expect(await screen.findByText(/Connect a wallet to see what waits for you/)).toBeInTheDocument()
        unmount()
        sdk.inspect.mockResolvedValue(safeFacts({ owners: [BOB], threshold: 1 }))
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        expect(await screen.findByText("This wallet is not an owner of this Safe.")).toBeInTheDocument()
    })

    it("says what an address is when it isn't a Safe, and never reads a queue for it", async () => {
        sdk.inspect.mockResolvedValue({ kind: "ok", value: { kind: "not-a-safe", address: SAFE, reason: "unknown-proxy" } })
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        expect(await screen.findByText("This contract is not a Safe proxy Memba recognises.")).toBeInTheDocument()
        expect(kit.getPendingTransactions).not.toHaveBeenCalled()
    })

    it("shows nothing as a Safe while the chain can't be read, with the reason and a retry", async () => {
        sdk.inspect.mockResolvedValue({ kind: "unavailable", reason: "the RPC answered as chain 1, not 84532" })
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't check this address on Base Sepolia: the RPC answered as chain 1, not 84532.")
        expect(screen.queryByLabelText("Members")).toBeNull()
    })

    it("keeps the chain's facts on screen when the Transaction Service fails", async () => {
        kit.getPendingTransactions.mockRejectedValue(new Error("502"))
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        expect(await screen.findByText("Couldn't read this Safe's queue from the Safe Transaction Service.", { exact: false })).toBeInTheDocument()
        expect(screen.getByLabelText("Members")).toBeInTheDocument()
    })
})

describe("acting on the queue", () => {
    const TOKEN = "0x7070000000000000000000000000000000000003"
    const transferData = `0xa9059cbb${BOB.slice(2).padStart(64, "0")}${(12_250_000n).toString(16).padStart(64, "0")}`

    it("lets an owner sign what they haven't, and execute the next nonce once enough owners signed", async () => {
        kit.getPendingTransactions.mockResolvedValue({ count: 2, results: [
            pending(4, TX_HASH, { confirmations: [{ owner: BOB }] }),
            pending(5, `0x${"cd".repeat(32)}`, { confirmations: [{ owner: BOB }] }),
        ] })
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        const queue = within(await screen.findByRole("region", { name: "Waiting to execute" }))
        // #4: next nonce, Bob signed, I'm an owner who hasn't: sign, or sign and execute (1 + me = 2 of 2). #5: sign only.
        await waitFor(() => expect(queue.getAllByRole("button", { name: "Sign" })).toHaveLength(2))
        expect(queue.getAllByRole("button", { name: "Sign and execute" })).toHaveLength(1)
        expect(queue.getAllByLabelText(getAddress(BOB)).length).toBeGreaterThanOrEqual(2)

        await act(async () => { fireEvent.click(queue.getAllByRole("button", { name: "Sign" })[0]) })
        expect(sdk.confirmSafeTx).toHaveBeenCalledWith("base-sepolia", expect.any(String), SAFE, TX_HASH)
        await act(async () => { fireEvent.click(queue.getByRole("button", { name: "Sign and execute" })) })
        expect(sdk.executeSafeTx).toHaveBeenCalledWith("base-sepolia", expect.any(String), SAFE, TX_HASH, expect.any(Function))
    })

    it("doesn't count an owner who already signed twice: with 1 of 2, they can't execute", async () => {
        kit.getPendingTransactions.mockResolvedValue({ count: 1, results: [pending(4, TX_HASH, { confirmations: [{ owner: ME }] })] })
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        const queue = within(await screen.findByRole("region", { name: "Waiting to execute" }))
        await queue.findByText("To")
        expect(queue.queryByRole("button", { name: /Execute|Sign/ })).toBeNull()
        expect(queue.getByText("1 of 2")).toBeInTheDocument()
    })

    it("shows every call of a batch in full, with token decimals and the token's address, before anyone signs", async () => {
        const data = encodeFunctionData({ abi: parseAbi(["function multiSend(bytes transactions)"]), functionName: "multiSend", args: [concat([
            encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, BOB, 10n ** 18n, 0n, "0x"]),
            encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, TOKEN, 0n, BigInt(size(transferData as `0x${string}`)), transferData as `0x${string}`]),
        ])] })
        kit.getPendingTransactions.mockResolvedValue({ count: 1, results: [pending(5, TX_HASH, { to: "0xA83c336B20401Af773B6219BA5027174338D1836", value: "0", operation: 1, data, confirmations: [] })] })
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        const queue = within(await screen.findByRole("region", { name: "Waiting to execute" }))
        expect(await queue.findByText("1. Send 1 ETH")).toBeInTheDocument()
        expect(queue.getByText("2. Send 12.25 USDC")).toBeInTheDocument()
        expect(queue.getByLabelText(getAddress(TOKEN))).toBeInTheDocument()
        expect(queue.getAllByLabelText(getAddress(BOB))).toHaveLength(2)
        expect(queue.getByText(/Any token can take any name/)).toBeInTheDocument()
        expect(queue.getByRole("button", { name: "Sign" })).toBeEnabled()
    })

    it("offers nothing for a gas-refund drain, a delegatecall, a hash mismatch or a guest", async () => {
        kit.getPendingTransactions.mockResolvedValue({ count: 3, results: [
            pending(4, TX_HASH, { value: "1", baseGas: "3900000", gasPrice: "1000000000000", refundReceiver: "0xbad0000000000000000000000000000000000004", confirmations: [{ owner: BOB }] }),
            pending(5, `0x${"cd".repeat(32)}`, { to: "0xbad0000000000000000000000000000000000004", operation: 1, data: "0x12345678", value: "0", confirmations: [] }),
            pending(6, `0x${"ef".repeat(31)}bad`, { confirmations: [] }),
        ] })
        const { unmount } = wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        const queue = within(await screen.findByRole("region", { name: "Waiting to execute" }))
        expect(await queue.findByText(/Memba won't sign or execute this transaction: it pays for gas from the Safe/)).toBeInTheDocument()
        expect(queue.getByText(/Memba won't sign or execute this transaction: it runs another contract's code/)).toBeInTheDocument()
        expect(queue.getByText("This proposal's hash doesn't match its contents. Don't sign it.")).toBeInTheDocument()
        await screen.findAllByText(/Send 0.000000000000000001 ETH|Send 1 ETH/)
        expect(queue.queryByRole("button", { name: /Sign|Execute/ })).toBeNull()
        unmount()
        kit.getPendingTransactions.mockResolvedValue({ count: 1, results: [pending(4, TX_HASH, { confirmations: [{ owner: BOB }] })] })
        wrap(<SafeWindow address={SAFE} session={guest} open={vi.fn()} />)
        await screen.findByText("#4 Send 1 ETH")
        expect(screen.queryByRole("button", { name: /Sign|Execute/ })).toBeNull()
    })

    it("asks for a check with the other owners before a Safe setting change or an unnamed contract call, whose data it shows", async () => {
        kit.getPendingTransactions.mockResolvedValue({ count: 2, results: [
            pending(5, `0x${"ef".repeat(32)}`, { to: SAFE, value: "0", data: "0x694e80c30000000000000000000000000000000000000000000000000000000000000001", confirmations: [] }),
            pending(6, `0x${"cd".repeat(32)}`, { to: TOKEN, value: "0", data: "0x12345678abcdef", confirmations: [] }),
        ] })
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        const queue = within(await screen.findByRole("region", { name: "Waiting to execute" }))
        await waitFor(() => expect(queue.getAllByRole("button", { name: "Sign" })).toHaveLength(2))
        const signs = queue.getAllByRole("button", { name: "Sign" })
        signs.forEach((b) => expect(b).toBeDisabled())
        expect(queue.getByText("0x12345678abcdef")).toBeInTheDocument()
        const boxes = queue.getAllByRole("checkbox", { name: "I checked every line above with the other owners." })
        fireEvent.click(boxes[0])
        expect(signs[0]).toBeEnabled()
        expect(signs[1]).toBeDisabled()
    })

    it("offers nothing while the lines can't be drawn", async () => {
        sdk.isContract.mockRejectedValue(new Error("rpc down"))
        kit.getPendingTransactions.mockResolvedValue({ count: 1, results: [pending(4, TX_HASH, { confirmations: [{ owner: BOB }] })] })
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        expect(await screen.findByText(/Couldn't read every call of this transaction/)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /Sign|Execute/ })).toBeNull()
        sdk.isContract.mockResolvedValue({ kind: "ok", value: false })
    })

    it("shows one entry per hash, the one whose contents match, and draws no lines for a mismatch", async () => {
        // A decoy listed first with the real entry's hash and other contents ("bad" makes checkQueuedTx say mismatch).
        const decoy = { ...pending(4, TX_HASH, { confirmations: [] }), to: "0xbad0000000000000000000000000000000000004", value: "999000000000000000000" }
        sdk.checkQueuedTx.mockImplementation(async (_c: number, _o: readonly string[], tx: { to: string; safeTxHash: string; confirmations?: { owner: string }[] }) => ({
            hashMatches: !tx.to.startsWith("0xbad"),
            submitted: new Set((tx.confirmations ?? []).map((c) => c.owner)),
            verified: new Set((tx.confirmations ?? []).map((c) => c.owner)),
        }))
        kit.getPendingTransactions.mockResolvedValue({ count: 2, results: [decoy, pending(4, TX_HASH, { confirmations: [{ owner: BOB }] })] })
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        const queue = within(await screen.findByRole("region", { name: "Waiting to execute" }))
        expect(await queue.findByText(/listed 2 entries with this hash: Memba shows only the one whose contents match it/)).toBeInTheDocument()
        expect(await queue.findByText("Send 1 ETH")).toBeInTheDocument()
        expect(queue.queryByText(/999/)).toBeNull()
        expect(queue.getAllByRole("listitem").filter((li) => li.querySelector(".os-pill"))).toHaveLength(1)
        sdk.checkQueuedTx.mockImplementation(defaultCheck)
    })

    it("draws no lines for a transaction whose contents don't match its hash", async () => {
        kit.getPendingTransactions.mockResolvedValue({ count: 1, results: [pending(4, `0x${"cd".repeat(31)}bad`, { confirmations: [] })] })
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        expect(await screen.findByText("This proposal's hash doesn't match its contents. Don't sign it.")).toBeInTheDocument()
        expect(screen.queryByText("To")).toBeNull()
        expect(screen.queryByText(/Loading what this transaction does/)).toBeNull()
        expect(sdk.isContract).not.toHaveBeenCalled()
    })

    it("never shows lines drawn for other contents under the same hash", async () => {
        const CAROL = "0xca201e0000000000000000000000000000000005"
        kit.getPendingTransactions.mockResolvedValueOnce({ count: 1, results: [pending(5, TX_HASH, { confirmations: [] })] })
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        expect(await screen.findByLabelText(getAddress(BOB))).toBeInTheDocument()
        kit.getPendingTransactions.mockResolvedValue({ count: 1, results: [pending(5, TX_HASH, { to: CAROL, confirmations: [] })] })
        fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
        expect(await screen.findByLabelText(getAddress(CAROL))).toBeInTheDocument()
        expect(screen.queryByLabelText(getAddress(BOB))).toBeNull()
    })

    it("offers Sign to an owner whose listed signature doesn't recover to them", async () => {
        sdk.checkQueuedTx.mockImplementationOnce(async () => ({ hashMatches: true, submitted: new Set([ME]), verified: new Set<string>() }))
        kit.getPendingTransactions.mockResolvedValue({ count: 1, results: [pending(5, TX_HASH, { confirmations: [{ owner: ME }] })] })
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        expect(await screen.findByRole("button", { name: "Sign" })).toBeInTheDocument()
    })

    it("says why an action stopped, and keeps a sent transaction's link", async () => {
        sdk.confirmSafeTx.mockRejectedValueOnce(new SafeActionError({ code: "declined" }))
        sdk.executeSafeTx.mockImplementationOnce(async (_k: string, _a: string, _s: string, _h: string, onSent?: (h: string) => void) => {
            onSent?.(`0x${"ee".repeat(32)}`)
            throw new SafeActionError({ code: "unconfirmed", hash: `0x${"ee".repeat(32)}` })
        })
        kit.getPendingTransactions.mockResolvedValue({ count: 1, results: [pending(4, TX_HASH, { confirmations: [{ owner: BOB }] })] })
        wrap(<SafeWindow address={SAFE} session={member} open={vi.fn()} />)
        const sign = await screen.findByRole("button", { name: "Sign" })
        await act(async () => { fireEvent.click(sign) })
        expect(await screen.findByText("You declined in your wallet. Nothing was signed.")).toBeInTheDocument()
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign and execute" })) })
        expect(await screen.findByText(/Don't send it again/)).toBeInTheDocument()
        expect(screen.getByRole("link", { name: "Transaction" })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/0x${"ee".repeat(32)}`)
    })
})
