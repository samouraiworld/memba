import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ available: vi.fn(() => true), allowed: vi.fn(() => true), applies: vi.fn(), wallet: vi.fn(), readTx: vi.fn(), freshPrice: vi.fn() }))

vi.mock("../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/config")>(),
    isAppReviewsAvailable: mocks.available,
    isRealmValidOn: mocks.allowed,
}))
vi.mock("../../../lib/reviews", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/reviews")>(),
    assertReviewActionApplies: mocks.applies,
}))
vi.mock("../../../lib/grc20", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/grc20")>()
    return {
        ...actual,
        // The module's own fresh quote calls networkGasPriceFresh internally, out of a mock's reach.
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
    resilientRpcCall: mocks.readTx,
}))

import { doContractBroadcast, setTxConfirmationCallback } from "../../../lib/grc20"
import { reviewActionMsg, REVIEWS_PKG_PATH, type ReviewAction } from "../../../lib/reviews"
import { executeSignature } from "../../sign/signer"
import { reviewActionRequest, type StoreReviewAction } from "./reviewActionRequest"

const HASH = "a".repeat(64)
const CALLER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const input = (action: ReviewAction, over: Partial<StoreReviewAction> = {}): StoreReviewAction => ({ action, appName: "Test App", caller: CALLER, networkKey: "mainnet", chainId: "gnoland-1", price: { gas: 1000, ugnot: 1 }, ...over })
const run = (request: ReturnType<typeof reviewActionRequest>) => executeSignature(request, undefined, request.prepare(undefined).msgs, () => {})
const line = (request: ReturnType<typeof reviewActionRequest>, label: string) => request.lines(undefined).find(([name]) => name === label)?.[1]

beforeEach(() => {
    mocks.available.mockReset().mockReturnValue(true)
    mocks.allowed.mockReset().mockReturnValue(true)
    mocks.applies.mockReset().mockResolvedValue(undefined)
    mocks.wallet.mockReset().mockResolvedValue({ hash: HASH })
    mocks.readTx.mockReset().mockResolvedValue({ hash: HASH, height: "12", tx_result: { ResponseBase: { Error: null } } })
    mocks.freshPrice.mockReset().mockResolvedValue({ gas: 1000, ugnot: 1 })
})
afterEach(() => { setTxConfirmationCallback(null); vi.mocked(doContractBroadcast).mockClear() })

describe("a review action through the OS signing sheet", () => {
    it("reviews the exact call with its deposit and fee, checks the target again, and sends that call once", async () => {
        const action: ReviewAction = { kind: "react", target: 12, on: "review", reaction: "like" }
        const request = reviewActionRequest(input(action))
        const msg = request.prepare(undefined).msgs[0]
        expect(msg).toEqual(reviewActionMsg(CALLER, action))
        expect(msg.value).toMatchObject({ pkg_path: REVIEWS_PKG_PATH, func: "React", args: ["12", "like"], caller: CALLER, max_deposit: "440000ugnot" })
        expect([request.title, request.summary, request.label(undefined)]).toEqual(["Like a review", "Like a review of Test App", "Like a review"])
        expect(request.lines(undefined)).toEqual([
            ["Account", CALLER], ["Review", "#12"], ["Reviews realm", REVIEWS_PKG_PATH], ["Network", "gnoland-1"],
            // 2,200 bytes at 100 ugnot per byte; the cap is twice that.
            ["Storage deposit", "≈ 0.22 GNOT for a first reaction on it (cap 0.44 GNOT)"],
            // 17M gas at 1 ugnot per 1,000 gas, with feeForGasWanted's 20 % headroom.
            ["Network fee", "0.0204 GNOT"],
        ])
        expect(request.note).toContain("choosing the same one again undoes it and returns about half")
        expect(request.acks).toBeUndefined()
        await expect(run(request)).resolves.toEqual({ outcome: "sent", hash: HASH, result: undefined })
        expect(mocks.applies).toHaveBeenCalledWith(CALLER, action)
        expect(doContractBroadcast).toHaveBeenCalledTimes(1)
        expect(doContractBroadcast).toHaveBeenCalledWith([msg], "Like a review", { gasWanted: 17_000_000, gasFee: 20_400, beforeSign: expect.any(Function) })
    })

    it("words each action's text, deposit and acknowledgement for what it does", () => {
        const flag = reviewActionRequest(input({ kind: "flag", target: 13, on: "reply" }))
        expect([flag.title, line(flag, "Reply"), line(flag, "Storage deposit")]).toEqual(["Flag a reply", "#13", "≈ 0.22 GNOT, not returned (cap 0.43 GNOT)"])
        expect(flag.note).toContain("Flagging the same item a second time fails, and a failed transaction still costs its fee.")
        expect(flag.acks).toEqual(["I understand this flag is public and cannot be withdrawn."])

        const reply = reviewActionRequest(input({ kind: "reply", review: 12, body: "y".repeat(1000) }))
        expect([reply.title, line(reply, "Review"), line(reply, "Reply"), line(reply, "Storage deposit")]).toEqual(["Reply to a review", "#12", "y".repeat(1000), "Up to 0.47 GNOT (cap 0.94 GNOT)"])
        expect(reply.note).toBe("The storage deposit is locked with the reply. Deleting the reply later returns only what its text took; the rest stays locked.")
        expect(reply.acks).toEqual(["I understand this reply is public and its chain history cannot be erased."])

        const edit = reviewActionRequest(input({ kind: "editReview", review: 12, rating: 3, body: "", was: "older text" }))
        expect([edit.title, line(edit, "Rating"), line(edit, "New text"), line(edit, "Storage deposit")]).toEqual(["Edit your review", "3 of 5 stars", "Rating only", "None: up to 0.001 GNOT returned for the text removed (cap 0.02 GNOT)"])
        const editReply = reviewActionRequest(input({ kind: "editReply", reply: 13, body: "w".repeat(1000), was: "x" }))
        expect([editReply.title, line(editReply, "Reply"), line(editReply, "New text"), line(editReply, "Storage deposit")]).toEqual(["Edit your reply", "#13", "w".repeat(1000), "Up to 0.11 GNOT for the text this edit adds (cap 0.22 GNOT)"])

        const remove = reviewActionRequest(input({ kind: "deleteReview", review: 12 }))
        expect([remove.title, line(remove, "Storage deposit"), remove.acks]).toEqual(["Delete your review", "at most 0.01 GNOT (cap 0.02 GNOT)", undefined])
        expect(remove.note).toBe("Deleting removes your review from the public list. Its chain history remains.")
        expect(reviewActionRequest(input({ kind: "deleteReply", reply: 13 })).title).toBe("Delete your reply")
    })

    it("stops before Adena when the target no longer takes the action", async () => {
        const request = reviewActionRequest(input({ kind: "flag", target: 12, on: "review" }))
        mocks.applies.mockRejectedValue(new Error("This review is no longer available. Refresh the reviews."))
        await expect(request.recheck?.(undefined)).rejects.toThrow("no longer available")
        await expect(run(request)).resolves.toMatchObject({ outcome: "failed" })
        expect(mocks.wallet).not.toHaveBeenCalled()
    })

    it("stops before Adena when the network fee rose or cannot be read, and sends at the reviewed fee otherwise", async () => {
        const request = reviewActionRequest(input({ kind: "flag", target: 12, on: "review" }, { price: { gas: 1000, ugnot: 2 } }))
        expect(line(request, "Network fee")).toBe("0.0408 GNOT")
        mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 3 })
        await expect(request.recheck?.(undefined)).rejects.toThrow(/network fee increased/)
        mocks.freshPrice.mockRejectedValue(new Error("offline"))
        await expect(request.recheck?.(undefined)).rejects.toThrow(/Couldn't confirm the current network fee/)
        await expect(run(request)).resolves.toMatchObject({ outcome: "failed" })
        expect(mocks.wallet).not.toHaveBeenCalled()
        // The chain's price is below the reviewed one: the reviewed fee still covers it.
        mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 1 })
        await expect(run(request)).resolves.toMatchObject({ outcome: "sent" })
        expect(doContractBroadcast).toHaveBeenCalledWith(expect.anything(), "Flag a review", { gasWanted: 17_000_000, gasFee: 40_800, beforeSign: expect.any(Function) })
    })

    it("fails closed off the reviews network, and refuses a call the realm would reject", async () => {
        const flag: ReviewAction = { kind: "flag", target: 12, on: "review" }
        mocks.available.mockReturnValue(false)
        expect(() => reviewActionRequest(input(flag))).toThrow("App reviews are not available on this network.")
        mocks.available.mockReturnValue(true)
        const request = reviewActionRequest(input(flag))
        mocks.allowed.mockReturnValue(false)
        expect(() => reviewActionRequest(input(flag))).toThrow("not available")
        // Validated again at the recheck, before the target is read.
        await expect(request.recheck?.(undefined)).rejects.toThrow("not available")
        expect(mocks.applies).not.toHaveBeenCalled()
        mocks.allowed.mockReturnValue(true)

        expect(() => reviewActionRequest(input(flag, { caller: "" }))).toThrow("Connect your wallet first.")
        expect(() => reviewActionRequest(input({ kind: "flag", target: 0, on: "review" }))).toThrow("cannot be identified")
        expect(() => reviewActionRequest(input({ kind: "reply", review: 12, body: "" }))).toThrow("A reply must be 1 to 1,000 bytes.")
        expect(() => reviewActionRequest(input({ kind: "reply", review: 12, body: "é".repeat(501) }))).toThrow("A reply must be 1 to 1,000 bytes.")
        expect(() => reviewActionRequest(input({ kind: "editReply", reply: 13, body: "", was: "x" }))).toThrow("A reply must be 1 to 1,000 bytes.")
        expect(() => reviewActionRequest(input({ kind: "editReview", review: 12, rating: 6, body: "", was: "" }))).toThrow("Select a rating from 1 to 5.")
        expect(() => reviewActionRequest(input({ kind: "editReview", review: 12, rating: 4, body: "é".repeat(1001), was: "" }))).toThrow("2,000 bytes or fewer")
    })

    it("signs the action as it was when the sheet opened, and confirms only a delivered transaction", async () => {
        const action = { kind: "reply", review: 12, body: "First" } as ReviewAction & { kind: "reply" }
        const request = reviewActionRequest(input(action))
        action.body = "Changed after the sheet opened"
        expect(line(request, "Reply")).toBe("First")
        expect(request.prepare(undefined).msgs[0].value.args).toEqual(["12", "First"])
        await expect(request.verify?.(undefined, HASH, undefined)).resolves.toBe(true)
        mocks.readTx.mockResolvedValue({ hash: HASH, height: "12", tx_result: { ResponseBase: { Error: "out of gas" } } })
        await expect(request.verify?.(undefined, HASH, undefined)).resolves.toBe(false)
        const onSettled = vi.fn()
        reviewActionRequest(input(action, { onSettled })).onSettled?.("confirmed", undefined)
        expect(onSettled).toHaveBeenCalledWith("confirmed", undefined)
    })
})
