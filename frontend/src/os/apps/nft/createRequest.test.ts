import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    available: vi.fn(() => true),
    terms: vi.fn(),
    lane: vi.fn(),
    reserved: vi.fn(),
    unspendable: vi.fn(),
    wallet: vi.fn(),
    readTx: vi.fn(),
    freshPrice: vi.fn(),
}))

vi.mock("../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/config")>(),
    isNftEnabled: mocks.available,
    isRealmValidOn: mocks.available,
}))
vi.mock("../../../lib/nft/drops", async (importActual) => ({ ...await importActual<typeof import("../../../lib/nft/drops")>(), getDropTerms: mocks.terms }))
vi.mock("../../../lib/tokenLaunchpadConfigClient", async (importActual) => ({ ...await importActual<typeof import("../../../lib/tokenLaunchpadConfigClient")>(), readActionStatus: mocks.lane, readReserved: mocks.reserved }))
vi.mock("../../../lib/nft/create", async (importActual) => ({ ...await importActual<typeof import("../../../lib/nft/create")>(), isUnspendable: mocks.unspendable }))
vi.mock("../../../lib/grc20", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/grc20")>()
    return {
        ...actual,
        freshFeeForGasWanted: async (gasWanted: number) => actual.feeForGasWanted(gasWanted, await mocks.freshPrice()),
        // Stand-in for the broadcaster's order: confirmation → beforeSign → wallet.
        doContractBroadcast: vi.fn(async (msgs: unknown, memo: string, opts: { beforeSign?: () => Promise<unknown> }) => {
            const { setTxConfirmationCallback } = await import("../../../lib/grc20")
            const confirm = setTxConfirmationCallback(null) ?? (async () => true)
            setTxConfirmationCallback(confirm)
            if (!(await confirm(msgs as never, memo))) throw new Error("Transaction cancelled by user")
            await opts.beforeSign?.()
            return mocks.wallet()
        }),
    }
})
vi.mock("../../../lib/rpcFallback", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/rpcFallback")>(),
    getRpcUrlsInOrder: () => ["https://rpc.test"],
    directRpcCall: (_url: string, method: string, params: Record<string, string>) => mocks.readTx(method, params),
}))
vi.mock("../../../lib/dao/chainIdentity", () => ({ assertRpcChain: async () => {} }))

import { doContractBroadcast, setTxConfirmationCallback } from "../../../lib/grc20"
import type { CollectionTerms } from "../../../lib/nft/create"
import { ReadError } from "../../../lib/nft/read"
import { executeSignature } from "../../sign/signer"
import { createCollectionRequest, type CreateDraft } from "./createRequest"

const HASH = "d".repeat(64)
const CREATOR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const A = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const B = "g1e6gxg5tvc55mwsn7t7dymmlasratv7mkv0rap2"
const BASE = `ipfs://bafy${"b".repeat(55)}/`
const terms: CollectionTerms = {
    name: "Relevés", symbol: "REL", description: "", image: "", banner: "", website: "", mode: "royalty_protected", revocable: false,
    maxSupply: 0n, metadataMode: "mutable", baseURI: BASE, royalties: [{ account: B, bps: 250n }, { account: A, bps: 100n }],
}
const draft = (more: Partial<CreateDraft> = {}): CreateDraft => ({ terms, fee: 1_000_000n, caller: CREATOR, networkKey: "mainnet", chainId: "gnoland-1", gas: { gas: 1000, ugnot: 1 }, ...more })
const run = (request: ReturnType<typeof createCollectionRequest>) => executeSignature(request, undefined, request.prepare(undefined).msgs, () => {})
const open = { lane: "collection", currency: "ugnot", version: 1n, paused: false, allowlisted: true, laneReady: true, open: true }

beforeEach(() => {
    mocks.available.mockReset().mockReturnValue(true)
    mocks.terms.mockReset().mockResolvedValue({ currency: "ugnot", collectionFee: 1_000_000n, primaryFeeBPS: 200n, maxPrimaryFeeBPS: 500n, treasury: A })
    mocks.lane.mockReset().mockResolvedValue(open)
    mocks.reserved.mockReset().mockResolvedValue(false)
    mocks.unspendable.mockReset().mockResolvedValue(false)
    mocks.wallet.mockReset().mockResolvedValue({ hash: HASH })
    mocks.readTx.mockReset().mockResolvedValue({ hash: HASH, height: "12", tx_result: { ResponseBase: { Error: null } } })
    mocks.freshPrice.mockReset().mockResolvedValue({ gas: 1000, ugnot: 1 })
})
afterEach(() => { setTxConfirmationCallback(null); vi.mocked(doContractBroadcast).mockClear() })

describe("creating a collection", () => {
    it("reviews what can never change and what it costs, then sends exactly the reviewed creation", async () => {
        const request = createCollectionRequest(draft())
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["Name and symbol", "Relevés · REL"],
            ["Mode", "Royalty-protected: tokens move only through a market the collection allows, which pays its royalties"],
            ["Supply", "Open edition: no maximum"],
            ["Metadata", `${BASE}, changeable until you freeze it`],
            ["Royalties", `2.5% to ${B}; 1% to ${A}`],
            ["Collection fee", "1 GNOT to the Launchpad treasury"],
            ["Storage deposit", "Up to 2.4 GNOT, locked with the collection"],
            ["Network fee", "0.048 GNOT"],
        ]))
        expect(request.acks).toEqual(["I understand that the name, symbol, mode, maximum supply and royalties can never change."])
        expect(request.prepare(undefined).msgs[0].value).toMatchObject({ send: "1000000ugnot", func: "CreateCollection" })
        expect(await run(request)).toMatchObject({ outcome: "sent", hash: HASH })
        expect(vi.mocked(doContractBroadcast)).toHaveBeenCalledWith(request.prepare(undefined).msgs, "Create REL", expect.objectContaining({ gasWanted: 40_000_000, gasFee: 48_000 }))
        expect(mocks.lane).toHaveBeenCalledWith("mainnet", "collection", "ugnot")
        expect(mocks.reserved).toHaveBeenCalledWith("mainnet", "REL")
        expect(mocks.unspendable.mock.calls).toEqual([[B], [A]])
        expect(await request.verify!(undefined, HASH, undefined)).toBe(true)
    })

    it("shows every term it signs, and that Memba will not load an https image", () => {
        const request = createCollectionRequest(draft({ terms: {
            ...terms, description: "Official drop", image: "https://tracker.example/a.png", banner: `ipfs://bafy${"b".repeat(55)}`, website: "https://phish.example",
        } }))
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["Description", "Official drop"],
            ["Image", "https://tracker.example/a.png (Memba will not load this image; use ipfs://)"],
            ["Banner", `ipfs://bafy${"b".repeat(55)}`],
            ["Website", "https://phish.example"],
        ]))
        expect(createCollectionRequest(draft()).lines(undefined)).toEqual(expect.arrayContaining([
            ["Description", "None"], ["Image", "None"], ["Banner", "None"], ["Website", "None"],
        ]))
    })

    it("says a soulbound collection's revocability and a capped supply", () => {
        const request = createCollectionRequest(draft({ terms: { ...terms, mode: "soulbound", revocable: true, maxSupply: 50n, royalties: [], metadataMode: "static" } }))
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["Revocable", "Yes: you may revoke a token"], ["Supply", "At most 50 tokens"], ["Metadata", `${BASE}, fixed for good`], ["Royalties", "None"],
        ]))
    })

    it("refuses a draft Memba must not sign", () => {
        expect(() => createCollectionRequest(draft({ terms: { ...terms, symbol: "rel" } }))).toThrow(/^The symbol/)
        expect(() => createCollectionRequest(draft({ caller: "g1nope" }))).toThrow("Connect your wallet")
        mocks.available.mockReturnValue(false)
        expect(() => createCollectionRequest(draft())).toThrow("Creating a collection is not available on this network.")
    })

    it.each([
        ["the lane was paused", () => mocks.lane.mockResolvedValue({ ...open, paused: true, open: false }), "Creating a collection is paused on this network for now. Nothing was sent."],
        ["the fee changed", () => mocks.terms.mockResolvedValue({ currency: "ugnot", collectionFee: 2_000_000n, primaryFeeBPS: 200n, maxPrimaryFeeBPS: 500n, treasury: A }), "The collection fee is now 2 GNOT. Nothing was sent."],
        ["the fee was lowered", () => mocks.terms.mockResolvedValue({ currency: "ugnot", collectionFee: 500_000n, primaryFeeBPS: 200n, maxPrimaryFeeBPS: 500n, treasury: A }), "The collection fee is now 0.5 GNOT. Nothing was sent."],
        ["creation closed in GNOT", () => mocks.terms.mockResolvedValue({ currency: "ugnot", collectionFee: null, primaryFeeBPS: 200n, maxPrimaryFeeBPS: 500n, treasury: A }), "not open on this network. Nothing was sent."],
        ["the symbol is reserved", () => mocks.reserved.mockResolvedValue(true), "The symbol REL is reserved on this network. Nothing was sent."],
        ["a receiver cannot be paid", () => mocks.unspendable.mockImplementation(async (account: string) => account === A), `${A} cannot receive royalties`],
        ["a read failed", () => mocks.reserved.mockRejectedValue(new ReadError("Could not read reserved symbol")), "Could not read reserved symbol. Nothing was sent."],
        ["the network fee rose", () => mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 2 }), "fee"],
    ])("stops before the wallet when %s", async (_, change, message) => {
        change()
        const result = await run(createCollectionRequest(draft()))
        expect(result.outcome).toBe("failed")
        expect((result as { error: string }).error).toContain(message)
        expect(mocks.wallet).not.toHaveBeenCalled()
    })
})
