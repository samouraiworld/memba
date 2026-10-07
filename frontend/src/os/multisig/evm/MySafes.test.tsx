import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { Code, ConnectError } from "@connectrpc/connect"
import { getAddress } from "viem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { OsSession } from "../../shell/useOsSession"
import type { SafeInspection } from "../../../lib/chain/evm/safe/inspect"
import type { Read } from "../../../lib/chain/types"
import { ImportSafe } from "./ImportSafe"
import { SafeApp, SafeWindow } from "./SafeWindows"
import { registerErrorText, safeLabel } from "./useMySafes"

vi.mock("../../../lib/chain/flag", () => ({ EVM_ENABLED: true }))

const SAFE = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe"
const OTHER = "0x0be7000000000000000000000000000000000009"
const ME = "0xa11ce00000000000000000000000000000000001"
const BOB = "0xb0b0000000000000000000000000000000000002"
const MODULE = "0xd0d0000000000000000000000000000000000003"

const m = vi.hoisted(() => ({ token: null as null | { chainId: string; userAddress: string }, safes: vi.fn(), registerSafe: vi.fn() }))
vi.mock("../../../hooks/useAuth", () => ({ useAuth: () => ({ token: m.token }) }))
vi.mock("../../../lib/api", () => ({ api: { safes: m.safes, registerSafe: m.registerSafe } }))

const kit = { getSafesByOwner: vi.fn(), getPendingTransactions: vi.fn(), getMultisigTransactions: vi.fn(), getSafeInfo: vi.fn() }
const sdk = {
    safeApiKit: () => kit,
    inspect: vi.fn<(key: string, address: string) => Promise<Read<SafeInspection>>>(),
    readBalance: vi.fn(async () => ({ kind: "ok", value: 0n }) as Read<bigint>),
    toChecksum: (a: string) => getAddress(a),
    checkQueuedTx: vi.fn(),
}
vi.mock("../../../lib/chain/evm/safe/load", () => ({ loadSafeSdk: async () => sdk }))

const net = { key: "base-sepolia", family: "evm", label: "Base Sepolia", chainId: "84532" }
const member = { network: net, layout: {}, openConnect: vi.fn(), status: "member", address: ME, walletAddress: ME } as unknown as OsSession
const walletOnly = { network: net, layout: {}, openConnect: vi.fn(), status: "guest", address: "", walletAddress: ME } as unknown as OsSession
const guest = { network: net, layout: {}, openConnect: vi.fn(), status: "guest", address: "", walletAddress: "" } as unknown as OsSession

const record = (address: string, over: object = {}) => ({ chainId: "eip155:84532", address, name: "", joined: true, sharedName: "", namedBy: "", createdAt: "", ...over })
const safeFacts = (over: object = {}): Read<SafeInspection> => ({
    kind: "ok",
    value: { kind: "safe", address: SAFE, version: "1.5.0", l2: true, singleton: "0x", owners: [ME, BOB], threshold: 2, nonce: 4n, modules: [], modulesTruncated: false, guard: null, moduleGuard: null, fallbackHandler: null, warnings: [], ...over } as never,
})

function wrap(ui: ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
    vi.clearAllMocks()
    m.token = { chainId: "eip155:84532", userAddress: ME }
    m.safes.mockResolvedValue({ safes: [record(SAFE, { name: "Treasury" })] })
    m.registerSafe.mockImplementation(async (req: { safeAddress: string; name: string; joined: boolean }) => ({ safe: record(req.safeAddress, { name: req.name, joined: req.joined }) }))
    kit.getSafesByOwner.mockResolvedValue({ safes: [getAddress(SAFE), getAddress(OTHER)] })
    kit.getPendingTransactions.mockResolvedValue({ count: 0, results: [] })
    kit.getMultisigTransactions.mockResolvedValue({ count: 0, results: [] })
    kit.getSafeInfo.mockResolvedValue({ nonce: "0" })
    sdk.inspect.mockResolvedValue(safeFacts())
})

describe("names and lists", () => {
    it("shows the account's own name, else the first namer's said so, else none", () => {
        expect(safeLabel(record(SAFE, { name: "Mine", sharedName: "Theirs", namedBy: BOB }) as never)).toEqual({ name: "Mine", namedBy: "" })
        expect(safeLabel(record(SAFE, { sharedName: "Theirs", namedBy: BOB }) as never)).toEqual({ name: "Theirs", namedBy: BOB })
        expect(safeLabel(record(SAFE) as never)).toBeNull()
        expect(safeLabel(undefined)).toBeNull()
    })

    it("says why the server refused, per reason", () => {
        expect(registerErrorText(new ConnectError("", Code.PermissionDenied))).toMatch(/not an owner/)
        expect(registerErrorText(new ConnectError("", Code.FailedPrecondition))).toMatch(/not a Safe Memba recognises/)
        expect(registerErrorText(new ConnectError("", Code.Unavailable))).toMatch(/couldn't read the Safe on chain/)
        expect(registerErrorText(new ConnectError("", Code.Unimplemented))).toMatch(/isn't available on this server/)
    })
})

describe("the Multisig app with a signed-in account", () => {
    it("lists your Safes by name, and lets you add one that lists you", async () => {
        wrap(<SafeApp session={member} open={vi.fn()} />)
        const yours = within(await screen.findByRole("heading", { name: "Your Safes" }).then((h) => h.closest("section")!))
        expect(await yours.findByText("Treasury")).toBeInTheDocument()
        expect(m.safes).toHaveBeenCalledWith(expect.objectContaining({ chainId: "eip155:84532", authToken: m.token }))
        // The listing no longer repeats a Safe you keep; the other can be added.
        expect(await screen.findByText(getAddress(OTHER))).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: `Add ${getAddress(SAFE)} to your Safes` })).toBeNull()
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: `Add ${getAddress(OTHER)} to your Safes` })) })
        expect(m.registerSafe).toHaveBeenCalledWith(expect.objectContaining({ safeAddress: OTHER, name: "", joined: true, chainId: "eip155:84532" }))
        await waitFor(() => expect(m.safes).toHaveBeenCalledTimes(2))
    })

    it("says why an add was refused", async () => {
        m.registerSafe.mockRejectedValueOnce(new ConnectError("", Code.PermissionDenied))
        wrap(<SafeApp session={member} open={vi.fn()} />)
        await act(async () => { fireEvent.click(await screen.findByRole("button", { name: `Add ${getAddress(OTHER)} to your Safes` })) })
        expect(await screen.findByRole("alert")).toHaveTextContent("not an owner of this Safe on chain")
    })

    it("asks a connected wallet without a sign-in to sign in, and keeps nothing", async () => {
        m.token = null
        wrap(<SafeApp session={walletOnly} open={vi.fn()} />)
        expect(await screen.findByText(/Sign in with this wallet to keep Safes in your list/)).toBeInTheDocument()
        expect(screen.queryByRole("heading", { name: "Your Safes" })).toBeNull()
        expect(screen.queryByRole("button", { name: /^Add / })).toBeNull()
        expect(m.safes).not.toHaveBeenCalled()
    })
})

describe("a Safe's name in its window", () => {
    it("lets its owner rename it and take it out of their list", async () => {
        wrap(<SafeWindow address={SAFE} session={member} />)
        expect(await screen.findByText("Treasury")).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Rename" }))
        fireEvent.change(screen.getByRole("textbox", { name: "Safe name" }), { target: { value: "  Ops  " } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })) })
        expect(m.registerSafe).toHaveBeenLastCalledWith(expect.objectContaining({ safeAddress: SAFE, name: "Ops", joined: true }))
        await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Remove from my Safes" })) })
        expect(m.registerSafe).toHaveBeenLastCalledWith(expect.objectContaining({ safeAddress: SAFE, joined: false }))
    })

    it("shows another owner's name as theirs, and offers a non-owner nothing", async () => {
        m.safes.mockResolvedValue({ safes: [record(SAFE, { sharedName: "Team", namedBy: BOB, joined: false })] })
        const { unmount } = wrap(<SafeWindow address={SAFE} session={member} />)
        expect(await screen.findByText("Team")).toBeInTheDocument()
        expect(screen.getByText(/named by/)).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Add to my Safes" })).toBeInTheDocument()
        unmount()
        sdk.inspect.mockResolvedValue(safeFacts({ owners: [BOB], threshold: 1 }))
        wrap(<SafeWindow address={SAFE} session={member} />)
        await screen.findByText(/Requires 1 of 1 owners/)
        expect(screen.queryByRole("button", { name: /Rename|Add to my Safes|Remove/ })).toBeNull()
    })
})

describe("importing a Safe", () => {
    async function check(session: OsSession, address = getAddress(SAFE)) {
        wrap(<ImportSafe session={session} open={vi.fn()} />)
        fireEvent.change(screen.getByRole("textbox", { name: "Safe address" }), { target: { value: address } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check" })) })
    }

    it("reads the Safe from the chain, then adds it with a name and opens it", async () => {
        const open = vi.fn()
        wrap(<ImportSafe session={member} open={open} />)
        fireEvent.change(screen.getByRole("textbox", { name: "Safe address" }), { target: { value: getAddress(SAFE) } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check" })) })
        expect(await screen.findByText(/Safe v1.5.0 · 2 of 2 owners · nonce 4/)).toBeInTheDocument()
        fireEvent.change(screen.getByRole("textbox", { name: "Safe name" }), { target: { value: " Treasury " } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add to my Safes" })) })
        expect(m.registerSafe).toHaveBeenCalledWith(expect.objectContaining({ safeAddress: SAFE, name: "Treasury", joined: true }))
        expect(open.mock.calls[0][0].target).toEqual({ kind: "multisig", address: SAFE })
    })

    it("shows each module and needs a confirmation before adding a Safe that has one", async () => {
        sdk.inspect.mockResolvedValue(safeFacts({ modules: [MODULE], warnings: [{ code: "modules", severity: "danger", addresses: [MODULE], text: "1 module is enabled." }] }))
        await check(member)
        expect(await screen.findByLabelText(getAddress(MODULE))).toBeInTheDocument()
        const add = screen.getByRole("button", { name: "Add to my Safes" })
        expect(add).toBeDisabled()
        fireEvent.click(screen.getByRole("checkbox", { name: "I know what each module, guard and handler above does." }))
        expect(add).toBeEnabled()
    })

    it("refuses what isn't a Safe, a bad checksum, and an address the chain can't confirm", async () => {
        sdk.inspect.mockResolvedValueOnce({ kind: "ok", value: { kind: "not-a-safe", address: SAFE, reason: "unknown-proxy" } })
        const { unmount } = wrap(<ImportSafe session={member} open={vi.fn()} />)
        const input = screen.getByRole("textbox", { name: "Safe address" })
        const go = async (value: string) => {
            fireEvent.change(input, { target: { value } })
            await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check" })) })
        }
        await go(getAddress(SAFE))
        expect(await screen.findByRole("alert")).toHaveTextContent("not a Safe proxy Memba recognises")
        const cs = getAddress(SAFE)
        const i = cs.slice(2).search(/[a-fA-F]/) + 2
        await go(`${cs.slice(0, i)}${cs[i] === cs[i].toLowerCase() ? cs[i].toUpperCase() : cs[i].toLowerCase()}${cs.slice(i + 1)}`)
        expect(await screen.findByRole("alert")).toHaveTextContent(/checksum/)
        sdk.inspect.mockResolvedValueOnce({ kind: "unavailable", reason: "the RPC did not answer" })
        await go(getAddress(SAFE))
        expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't check this address on Base Sepolia: the RPC did not answer")
        expect(screen.queryByRole("button", { name: "Add to my Safes" })).toBeNull()
        expect(m.registerSafe).not.toHaveBeenCalled()
        unmount()
    })

    it("lets a guest check, then asks to connect; a non-owner wallet is told it can't keep it", async () => {
        const { unmount } = wrap(<ImportSafe session={guest} open={vi.fn()} />)
        fireEvent.change(screen.getByRole("textbox", { name: "Safe address" }), { target: { value: getAddress(SAFE) } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check" })) })
        expect(await screen.findByText(/Connect the wallet that owns this Safe/)).toBeInTheDocument()
        unmount()
        sdk.inspect.mockResolvedValue(safeFacts({ owners: [BOB], threshold: 1 }))
        await check(member)
        expect(await screen.findByText(/not an owner of this Safe: only an owner can keep it/)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Add to my Safes" })).toBeNull()
    })
})
