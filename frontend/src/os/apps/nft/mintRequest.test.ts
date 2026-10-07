import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    available: vi.fn(() => true),
    listStages: vi.fn(),
    mintedBy: vi.fn(),
    gateUsed: vi.fn(),
    getToken: vi.fn(),
    getCollection: vi.fn(),
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
vi.mock("../../../lib/nft/drops", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/nft/drops")>(),
    listStages: mocks.listStages, mintedBy: mocks.mintedBy, gateUsed: mocks.gateUsed,
}))
vi.mock("../../../lib/nft/ledger", async (importActual) => ({ ...await importActual<typeof import("../../../lib/nft/ledger")>(), getToken: mocks.getToken, getCollection: mocks.getCollection }))
vi.mock("../../../lib/tokenLaunchpadConfigClient", async (importActual) => ({ ...await importActual<typeof import("../../../lib/tokenLaunchpadConfigClient")>(), readActionStatus: mocks.lane }))
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
import { executeSignature } from "../../sign/signer"
import { mintRequest, type MintDraft } from "./mintRequest"

const HASH = "a".repeat(64)
const BUYER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const OTHER = "g1c0j899h88nwyvnzvh5jagpq6fkkyuj76nld6t0"
const dutch: NftStage = {
    index: 0, kind: "dutch", start: 1n, end: 2n, open: true, price: 10_000_000n, floor: 1_000_000n, currentPrice: 4_000_000n, currency: "ugnot",
    feeBPS: 200n, supplyCap: 10n, perWallet: 2n, root: "", gate: "", gateLimit: 0n, minted: 3n,
}
const holder: NftStage = { ...dutch, kind: "holder", floor: 0n, price: 0n, currentPrice: 0n, gate: "C2", gateLimit: 40n }
const draft = (more: Partial<MintDraft> = {}): MintDraft => ({
    collection: "C1", collectionName: "Relevés", supply: { sealed: false, maxSupply: 0n, minted: 3n }, stage: dutch, gateNumber: 0n, mintedSoFar: 0n, caller: BUYER,
    networkKey: "mainnet", chainId: "gnoland-1", price: { gas: 1000, ugnot: 1 }, ...more,
})
const run = (request: ReturnType<typeof mintRequest>) => executeSignature(request, undefined, request.prepare(undefined).msgs, () => {})
const open = { lane: "nft_drops", currency: "ugnot", version: 1n, paused: false, allowlisted: true, laneReady: true, open: true }

beforeEach(() => {
    mocks.available.mockReset().mockReturnValue(true)
    mocks.listStages.mockReset().mockResolvedValue([dutch])
    mocks.mintedBy.mockReset().mockResolvedValue(0n)
    mocks.gateUsed.mockReset().mockResolvedValue(false)
    mocks.getToken.mockReset().mockResolvedValue({ collection: "C2", number: 7n, owner: BUYER, status: "active", uri: "" })
    mocks.lane.mockReset().mockResolvedValue(open)
    mocks.getCollection.mockReset().mockResolvedValue({ id: "C1", sealed: false, maxSupply: 0n, minted: 3n })
    mocks.wallet.mockReset().mockResolvedValue({ hash: HASH })
    mocks.readTx.mockReset().mockResolvedValue({ hash: HASH, height: "12", tx_result: { ResponseBase: { Error: null } } })
    mocks.freshPrice.mockReset().mockResolvedValue({ gas: 1000, ugnot: 1 })
})
afterEach(() => { setTxConfirmationCallback(null); vi.mocked(doContractBroadcast).mockClear() })

describe("NFT mint signing", () => {
    it("reviews the price as the most the realm can charge, then sends exactly the reviewed call", async () => {
        const request = mintRequest(draft())
        const lines = Object.fromEntries(request.lines(undefined))
        expect(lines.Price).toBe("At most 4 GNOT. The price at the block is charged; the rest comes back in the same transaction.")
        expect(lines.Split).toBe("2% to the Launchpad treasury, the rest to the creator")
        expect(lines["Storage deposit"]).toBe("Up to 2.1 GNOT, locked with the new token")
        expect(lines["Network fee"]).toBe("0.072 GNOT")
        expect(await run(request)).toEqual({ outcome: "sent", hash: HASH, result: undefined })
        expect(vi.mocked(doContractBroadcast)).toHaveBeenCalledWith(request.prepare(undefined).msgs, "Mint from C1", expect.objectContaining({ gasWanted: 60_000_000, gasFee: 72_000 }))
        expect(mocks.lane).toHaveBeenCalledWith("mainnet", "nft_drops", "ugnot")
        expect(mocks.mintedBy).toHaveBeenCalledWith("C1", 0, BUYER)
        expect(await request.verify!(undefined, HASH, undefined)).toBe(true)
    })

    it("refuses a draft Memba must not sign", () => {
        expect(() => mintRequest(draft({ mintedSoFar: 2n }))).toThrow("as many tokens as this stage allows")
        expect(() => mintRequest(draft({ caller: "g1nope" }))).toThrow("Connect your wallet")
        expect(() => mintRequest(draft({ supply: { sealed: true, maxSupply: 0n, minted: 3n } }))).toThrow("the creator sealed the supply")
        expect(() => mintRequest(draft({ supply: { sealed: false, maxSupply: 3n, minted: 3n } }))).toThrow("maximum supply")
        expect(() => mintRequest(draft({ stage: { ...dutch, kind: "allowlist", perWallet: 0n, floor: 0n, root: "ab".repeat(32) } }))).toThrow("allowlist")
        mocks.available.mockReturnValue(false)
        expect(() => mintRequest(draft())).toThrow("Minting is not available on this network.")
    })

    it.each([
        ["the lane was paused", () => mocks.lane.mockResolvedValue({ ...open, paused: true, open: false }), "Minting is paused on this network for now. Nothing was sent."],
        ["the stage was replaced", () => mocks.listStages.mockResolvedValue([{ ...dutch, feeBPS: 300n }]), "This stage changed after your review."],
        ["the stage is gone", () => mocks.listStages.mockResolvedValue([]), "This stage changed after your review."],
        ["the stage sold out", () => mocks.listStages.mockResolvedValue([{ ...dutch, minted: 10n }]), "This stage is sold out. Nothing was sent."],
        ["the stage closed", () => mocks.listStages.mockResolvedValue([{ ...dutch, open: false, currentPrice: dutch.price }]), "This stage is not open. Nothing was sent."],
        ["the member reached the limit", () => mocks.mintedBy.mockResolvedValue(2n), "as many tokens as this stage allows per wallet. Nothing was sent."],
        ["the fee rose", () => mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 2 }), "fee"],
        ["the creator sealed the supply", () => mocks.getCollection.mockResolvedValue({ id: "C1", sealed: true, maxSupply: 0n, minted: 3n }), "Minting has ended for good: the creator sealed the supply. Nothing was sent."],
        ["the collection reached its maximum supply", () => mocks.getCollection.mockResolvedValue({ id: "C1", sealed: false, maxSupply: 3n, minted: 3n }), "The collection has reached its maximum supply. Nothing was sent."],
    ])("stops before the wallet when %s", async (_, change, message) => {
        change()
        const result = await run(mintRequest(draft()))
        expect(result.outcome).toBe("failed")
        expect((result as { error: string }).error).toContain(message)
        expect(mocks.wallet).not.toHaveBeenCalled()
    })

    it("lets a dutch price that fell since the review through, and stops one that rose", async () => {
        mocks.listStages.mockResolvedValue([{ ...dutch, currentPrice: 3_000_000n }])
        expect((await run(mintRequest(draft()))).outcome).toBe("sent")
        mocks.listStages.mockResolvedValue([{ ...dutch, currentPrice: 4_000_001n }])
        expect(await run(mintRequest(draft()))).toEqual({ outcome: "failed", error: "The price is now above the amount you reviewed. Nothing was sent." })
    })

    it("checks the gate token again for a holder stage", async () => {
        mocks.listStages.mockResolvedValue([holder])
        const request = mintRequest(draft({ stage: holder, gateNumber: 7n }))
        expect(Object.fromEntries(request.lines(undefined))).toMatchObject({ Price: "Free", "Gate token": "C2 #7, used up for this stage by this mint" })
        mocks.gateUsed.mockResolvedValueOnce(true)
        expect(await run(request)).toEqual({ outcome: "failed", error: "C2 #7 has already been used for a mint in this stage. Nothing was sent." })
        mocks.getToken.mockResolvedValueOnce({ collection: "C2", number: 7n, owner: OTHER, status: "active", uri: "" })
        expect(await run(request)).toEqual({ outcome: "failed", error: "This account does not hold C2 #7. Nothing was sent." })
        mocks.getToken.mockResolvedValueOnce({ collection: "C2", number: 7n, owner: "", status: "burned", uri: "" })
        expect(await run(request)).toEqual({ outcome: "failed", error: "This account does not hold C2 #7. Nothing was sent." })
        expect(await run(request)).toMatchObject({ outcome: "sent" })
        expect(mocks.gateUsed).toHaveBeenLastCalledWith("C1", 0, 7n)
    })

    it("refuses a gate token minted after the stage was scheduled, as the realm does", async () => {
        mocks.listStages.mockResolvedValue([holder])
        expect(await run(mintRequest(draft({ stage: holder, gateNumber: 41n })))).toMatchObject({
            outcome: "failed", error: expect.stringMatching(/^C2 #41 was minted after this stage was scheduled: only C2 #1 to #40 allow a mint here\./),
        })
        const none = { ...holder, gateLimit: 0n }
        mocks.listStages.mockResolvedValue([none])
        expect(await run(mintRequest(draft({ stage: none, gateNumber: 1n })))).toMatchObject({
            outcome: "failed", error: expect.stringMatching(/^C2 #1 was minted after this stage was scheduled, when C2 had no token: no token opens a mint here\./),
        })
        // The limit is part of the terms reviewed: a stage replaced with another one stops the signature.
        mocks.listStages.mockResolvedValue([{ ...holder, gateLimit: 41n }])
        expect(await run(mintRequest(draft({ stage: holder, gateNumber: 7n })))).toMatchObject({ outcome: "failed", error: expect.stringContaining("This stage changed after your review.") })
        expect(mocks.wallet).not.toHaveBeenCalled()
    })
})

describe("the review note", () => {
    it("names who is paid: creator and treasury, the creator alone at no fee, or nobody for a free mint", () => {
        expect(mintRequest(draft()).note).toContain("goes to the creator and the treasury")
        expect(mintRequest(draft({ stage: { ...dutch, feeBPS: 0n } })).note).toContain("the price goes to the creator in the same transaction")
        expect(mintRequest(draft({ stage: { ...dutch, kind: "fixed", price: 0n, floor: 0n, currentPrice: 0n } })).note).toContain("A free mint")
    })
})
