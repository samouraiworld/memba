import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    available: vi.fn(() => true),
    collection: vi.fn(),
    stages: vi.fn(),
    terms: vi.fn(),
    lane: vi.fn(),
    wallet: vi.fn(),
    readTx: vi.fn(),
    freshPrice: vi.fn(),
}))

vi.mock("../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/config")>(),
    isNftEnabled: mocks.available,
    isRealmValidOn: mocks.available,
}))
vi.mock("../../../lib/nft/drops", async (importActual) => ({ ...await importActual<typeof import("../../../lib/nft/drops")>(), listStages: mocks.stages, getDropTerms: mocks.terms }))
vi.mock("../../../lib/nft/ledger", async (importActual) => ({ ...await importActual<typeof import("../../../lib/nft/ledger")>(), getCollection: mocks.collection }))
vi.mock("../../../lib/nft/lane", async (importActual) => ({ ...await importActual<typeof import("../../../lib/nft/lane")>(), getLaneStatus: mocks.lane }))
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
import type { NftStage } from "../../../lib/nft/drops"
import { RealmRefusedError } from "../../../lib/nft/read"
import type { StageTerms } from "../../../lib/nft/studio"
import { executeSignature } from "../../sign/signer"
import { addStageRequest, endStageRequest, type AddStageDraft, type EndStageDraft } from "./studioRequest"

const HASH = "e".repeat(64)
const CREATOR = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const OTHER = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const now = () => BigInt(Math.floor(Date.now() / 1000))
const DAY = 86_400n
const stage = (index: number, start: bigint, end: bigint, more: Partial<NftStage> = {}): NftStage => ({
    index, kind: "fixed", start, end, open: false, price: 1n, floor: 0n, currentPrice: 1n, currency: "ugnot", feeBPS: 200n, supplyCap: 0n,
    perWallet: 1n, root: "", gate: "", minted: 4n, ...more,
})
const common = { collection: "C1", caller: CREATOR, networkKey: "mainnet", chainId: "gnoland-1", gas: { gas: 1000, ugnot: 1 } }
const run = (request: ReturnType<typeof addStageRequest>) => executeSignature(request, undefined, request.prepare(undefined).msgs, () => {})
const open = { lane: "nft_drops", currency: "ugnot", paused: false, allowlisted: true, laneReady: true, open: true }
const failed = async (request: ReturnType<typeof addStageRequest>, message: string) => {
    const result = await run(request)
    expect(result.outcome).toBe("failed")
    expect((result as { error: string }).error).toContain(message)
    expect(mocks.wallet).not.toHaveBeenCalled()
}

let past: NftStage
beforeEach(() => {
    past = stage(0, now() - 2n * DAY, now() - DAY)
    mocks.available.mockReset().mockReturnValue(true)
    mocks.collection.mockReset().mockImplementation(async (id: string) => ({ id, creator: CREATOR }))
    mocks.stages.mockReset().mockResolvedValue([past])
    mocks.terms.mockReset().mockResolvedValue({ currency: "ugnot", collectionFee: 1n, primaryFeeBPS: 200n, maxPrimaryFeeBPS: 500n, treasury: OTHER })
    mocks.lane.mockReset().mockResolvedValue(open)
    mocks.wallet.mockReset().mockResolvedValue({ hash: HASH })
    mocks.readTx.mockReset().mockResolvedValue({ hash: HASH, height: "12", tx_result: { ResponseBase: { Error: null } } })
    mocks.freshPrice.mockReset().mockResolvedValue({ gas: 1000, ugnot: 1 })
})
afterEach(() => { setTxConfirmationCallback(null); vi.mocked(doContractBroadcast).mockClear() })

describe("scheduling a stage", () => {
    const terms = (more: Partial<StageTerms> = {}): StageTerms => ({
        kind: "dutch", start: now() + 3_600n, end: now() + 3_600n + DAY, price: 10_000_000n, floor: 1_000_000n, supplyCap: 0n, perWallet: 2n, gate: "", ...more,
    })
    const draft = (more: Partial<AddStageDraft> = {}): AddStageDraft => ({ ...common, terms: terms(), feeBPS: 200n, existing: [past], ...more })

    it("reviews the stage and its split, then sends exactly the reviewed call", async () => {
        const request = addStageRequest(draft())
        expect(request.summary).toBe("Dutch auction stage 2 for C1")
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["Price", "10 GNOT, falling to 1 GNOT"], ["Per wallet", "2"], ["Stage cap", "None beyond the collection's"],
            ["Split of each mint", "2% to the Launchpad treasury, the rest to you"], ["Storage deposit", "Up to 0.7 GNOT"], ["Network fee", "0.036 GNOT"],
        ]))
        expect(await run(request)).toMatchObject({ outcome: "sent", hash: HASH })
        expect(vi.mocked(doContractBroadcast)).toHaveBeenCalledWith(request.prepare(undefined).msgs, "Stage 2 for C1", expect.objectContaining({ gasWanted: 30_000_000 }))
        expect(mocks.lane).toHaveBeenCalledWith("nft_drops", "ugnot")
        expect(await request.verify!(undefined, HASH, undefined)).toBe(true)
    })

    it("names a holder stage's gate and checks the gate collection exists", async () => {
        const request = addStageRequest(draft({ terms: terms({ kind: "holder", price: 0n, floor: 0n, gate: "C2" }) }))
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([["Price", "Free"], ["Gate", "Each token of C2 pays for one mint"]]))
        mocks.collection.mockImplementation(async (id: string) => {
            if (id === "C2") throw new RealmRefusedError("unknown collection")
            return { id, creator: CREATOR }
        })
        await failed(request, "There is no collection C2 to gate this stage.")
    })

    it.each([
        ["the signer is no longer the creator", () => mocks.collection.mockResolvedValue({ id: "C1", creator: OTHER }), "not the creator of C1"],
        ["the lane was paused", () => mocks.lane.mockResolvedValue({ ...open, paused: true, open: false }), "Minting is paused"],
        ["the protocol fee changed", () => mocks.terms.mockResolvedValue({ currency: "ugnot", collectionFee: 1n, primaryFeeBPS: 300n, maxPrimaryFeeBPS: 500n, treasury: OTHER }), "protocol fee for new stages changed"],
        ["another stage was scheduled", () => mocks.stages.mockResolvedValue([past, stage(1, now() + 10n * DAY, now() + 11n * DAY)]), "stages changed after your review"],
        ["the network fee rose", () => mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 2 }), "fee"],
    ])("stops before the wallet when %s", async (_, change, message) => {
        change()
        await failed(addStageRequest(draft()), message)
    })

    it("stops a stage whose start has passed by the time the wallet would open", async () => {
        const request = addStageRequest(draft())
        vi.useFakeTimers({ now: Date.now() + 3_600_000 })
        try { await failed(request, "at least a minute from now. Nothing was sent.") } finally { vi.useRealTimers() }
    })

    it("refuses a draft Memba must not sign", () => {
        expect(() => addStageRequest(draft({ terms: terms({ floor: 10_000_000n }) }))).toThrow(/floor below/)
        expect(() => addStageRequest(draft({ caller: "g1nope" }))).toThrow("Connect your wallet")
        mocks.available.mockReturnValue(false)
        expect(() => addStageRequest(draft())).toThrow("Mint stages are not available on this network.")
    })
})

describe("ending a stage", () => {
    const live = () => stage(1, now() - 3_600n, now() + DAY, { open: true })
    const draft = (more: Partial<EndStageDraft> = {}): EndStageDraft => ({ ...common, stage: live(), ...more })

    it("ends the creator's open stage without asking the lane", async () => {
        mocks.lane.mockResolvedValue({ ...open, paused: true, open: false })
        const s = live()
        mocks.stages.mockResolvedValue([past, s])
        const request = endStageRequest(draft({ stage: s }))
        expect(request.acks).toEqual(["I understand that an ended stage never opens again."])
        expect(request.prepare(undefined).msgs[0].value).toMatchObject({ func: "EndStage", args: ["C1", "1"] })
        expect(await run(request)).toMatchObject({ outcome: "sent" })
        expect(mocks.lane).not.toHaveBeenCalled()
    })

    it("stops when the stage closed meanwhile or the signer is not the creator", async () => {
        const s = live()
        mocks.stages.mockResolvedValue([past, { ...s, open: false }])
        await failed(endStageRequest(draft({ stage: s })), "This stage is no longer open.")
        mocks.stages.mockResolvedValue([past, s])
        mocks.collection.mockResolvedValue({ id: "C1", creator: OTHER })
        await failed(endStageRequest(draft({ stage: s })), "not the creator of C1")
        expect(() => endStageRequest(draft({ stage: { ...s, open: false } }))).toThrow("Only an open stage")
    })
})
