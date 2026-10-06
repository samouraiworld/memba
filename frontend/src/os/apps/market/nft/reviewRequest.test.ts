import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    available: vi.fn(() => true),
    getCollection: vi.fn(),
    getApplication: vi.fn(),
    getCurationAccess: vi.fn(),
    wallet: vi.fn(),
    readTx: vi.fn(),
    freshPrice: vi.fn(),
}))

vi.mock("../../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../../lib/config")>(),
    isNftEnabled: mocks.available,
    isRealmValidOn: mocks.available,
}))
vi.mock("../../../../lib/nft/ledger", async (importActual) => ({ ...await importActual<typeof import("../../../../lib/nft/ledger")>(), getCollection: mocks.getCollection }))
vi.mock("../../../../lib/nft/curation", async (importActual) => ({ ...await importActual<typeof import("../../../../lib/nft/curation")>(), getApplication: mocks.getApplication, getCurationAccess: mocks.getCurationAccess }))
vi.mock("../../../../lib/grc20", async (importActual) => {
    const actual = await importActual<typeof import("../../../../lib/grc20")>()
    return {
        ...actual,
        freshFeeForGasWanted: async (gasWanted: number) => actual.feeForGasWanted(gasWanted, await mocks.freshPrice()),
        // Stand-in for the broadcaster's order: confirmation → beforeSign → wallet.
        doContractBroadcast: vi.fn(async (msgs: unknown, memo: string, opts: { beforeSign?: () => Promise<unknown> }) => {
            const { setTxConfirmationCallback } = await import("../../../../lib/grc20")
            const confirm = setTxConfirmationCallback(null) ?? (async () => true)
            setTxConfirmationCallback(confirm)
            if (!(await confirm(msgs as never, memo))) throw new Error("Transaction cancelled by user")
            await opts.beforeSign?.()
            return mocks.wallet()
        }),
    }
})
vi.mock("../../../../lib/rpcFallback", async (importActual) => ({
    ...await importActual<typeof import("../../../../lib/rpcFallback")>(),
    getRpcUrlsInOrder: () => ["https://rpc.test"],
    directRpcCall: (_url: string, method: string, params: Record<string, string>) => mocks.readTx(method, params),
}))
vi.mock("../../../../lib/dao/chainIdentity", () => ({ assertRpcChain: async () => {} }))

import { setTxConfirmationCallback } from "../../../../lib/grc20"
import type { CurationApplication } from "../../../../lib/nft/curation"
import { executeSignature } from "../../../sign/signer"
import { applyRequest, reviewRequest, type ApplyDraft, type ReviewDraft } from "./reviewRequest"

const HASH = "c".repeat(64)
const FOUNDER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const MANAGER = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const text = { cid: `bafkrei${"a".repeat(52)}`, hash: "d".repeat(64) }
const filing: CurationApplication = {
    collection: "C3", founder: FOUNDER, statementHash: text.hash, statementCID: text.cid, revision: 2n, status: "changes_requested",
    reviewer: MANAGER, reasonHash: "e".repeat(64), reasonCID: `bafy${"b".repeat(55)}`, updatedAt: 1n,
}
const common = { networkKey: "mainnet", chainId: "gnoland-1", gas: { gas: 1000, ugnot: 1 }, text: "Original drawings, signed.", commitment: text }
const access = { chainId: "gnoland-1", height: 9n, time: 9n, collection: "C3", account: MANAGER, founder: false, manager: true, conflicted: false }
const run = (request: ReturnType<typeof applyRequest>) => executeSignature(request, undefined, request.prepare(undefined).msgs, () => {})
const failed = async (request: ReturnType<typeof applyRequest>, message: string) => {
    const result = await run(request)
    expect(result.outcome).toBe("failed")
    expect((result as { error: string }).error).toContain(message)
    expect(mocks.wallet).not.toHaveBeenCalled()
}

beforeEach(() => {
    mocks.available.mockReset().mockReturnValue(true)
    mocks.getCollection.mockReset().mockResolvedValue({ id: "C3", creator: FOUNDER })
    mocks.getApplication.mockReset().mockResolvedValue(filing)
    mocks.getCurationAccess.mockReset().mockResolvedValue(access)
    mocks.wallet.mockReset().mockResolvedValue({ hash: HASH })
    mocks.readTx.mockReset().mockResolvedValue({ hash: HASH, height: "12", tx_result: { ResponseBase: { Error: null } } })
    mocks.freshPrice.mockReset().mockResolvedValue({ gas: 1000, ugnot: 1 })
})
afterEach(() => { setTxConfirmationCallback(null) })

describe("applying for review", () => {
    const draft = (more: Partial<ApplyDraft> = {}): ApplyDraft => ({ collection: "C3", application: filing, caller: FOUNDER, ...common, ...more })

    it("reviews the pinned statement and files exactly it", async () => {
        const request = applyRequest(draft())
        expect(request.title).toBe("File again for review")
        expect(request.sub).toBe("Filing 3, replacing a changes requested filing")
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["Statement", "Original drawings, signed."], ["Pinned at", text.cid], ["SHA-256", text.hash], ["Storage deposit", "Up to 1 GNOT"],
        ]))
        expect(request.prepare(undefined).msgs[0].value).toMatchObject({ func: "Apply", args: ["C3", text.hash, text.cid], send: "" })
        expect(await run(request)).toMatchObject({ outcome: "sent", hash: HASH })
        expect(mocks.getApplication).toHaveBeenCalledWith("C3")
    })

    it("files a first application when there was none, and none appeared since", async () => {
        mocks.getApplication.mockResolvedValue(null)
        const request = applyRequest(draft({ application: null }))
        expect(request.title).toBe("Apply for review")
        expect(await run(request)).toMatchObject({ outcome: "sent" })
    })

    it.each([
        ["the creator role moved", () => mocks.getCollection.mockResolvedValue({ id: "C3", creator: MANAGER }), "no longer is"],
        ["a manager decided since", () => mocks.getApplication.mockResolvedValue({ ...filing, status: "recommended" }), "changed after your review"],
        ["another filing was made since", () => mocks.getApplication.mockResolvedValue({ ...filing, revision: 3n }), "changed after your review"],
        ["the network fee rose", () => mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 2 }), "fee"],
    ])("stops before the wallet when %s", async (_name, change, message) => {
        change()
        await failed(applyRequest(draft()), message)
    })

    it("stops when an application appeared while there was none", async () => {
        await failed(applyRequest(draft({ application: null })), "changed after your review")
    })

    it("refuses a recommended collection, and a network without curation", async () => {
        mocks.getApplication.mockResolvedValue({ ...filing, status: "recommended" })
        await failed(applyRequest(draft({ application: { ...filing, status: "recommended" } })), "already recommended")
        mocks.available.mockReturnValue(false)
        expect(() => applyRequest(draft())).toThrow("NFT curation is not available on this network.")
    })
})

describe("reviewing an application", () => {
    const draft = (more: Partial<ReviewDraft> = {}): ReviewDraft => ({ collection: "C3", application: filing, decision: "declined", caller: MANAGER, ...common, ...more })

    it("decides on the filing read, with the pinned reason", async () => {
        const request = reviewRequest(draft())
        expect(request.summary).toBe("Declined: C3, filing 2")
        expect(request.prepare(undefined).msgs[0].value).toMatchObject({ func: "Review", args: ["C3", "2", "declined", text.hash, text.cid] })
        expect(await run(request)).toMatchObject({ outcome: "sent" })
        expect(mocks.getCurationAccess).toHaveBeenCalledWith("C3", MANAGER, "gnoland-1")
    })

    it.each([
        ["the seat was lost", () => mocks.getCurationAccess.mockResolvedValue({ ...access, manager: false }), "no longer holds a manager seat"],
        ["a conflict was recorded", () => mocks.getCurationAccess.mockResolvedValue({ ...access, conflicted: true }), "conflicted on this collection"],
        ["the founder filed again", () => mocks.getApplication.mockResolvedValue({ ...filing, revision: 3n, status: "submitted", reviewer: "" }), "changed after your review"],
        ["another manager decided", () => mocks.getApplication.mockResolvedValue({ ...filing, reviewer: FOUNDER }), "changed after your review"],
    ])("stops before the wallet when %s", async (_name, change, message) => {
        change()
        await failed(reviewRequest(draft()), message)
    })
})
