import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
    available: vi.fn(() => true),
    allowed: vi.fn(() => true),
    fetchAppStrict: vi.fn(),
    wallet: vi.fn(),
    readTx: vi.fn(),
    freshPrice: vi.fn(),
}))

vi.mock("../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/config")>(),
    isAppReviewsAvailable: mocks.available,
    isRealmValidOn: mocks.allowed,
}))
vi.mock("../../../lib/appStore", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/appStore")>(),
    fetchAppStrict: mocks.fetchAppStrict,
}))
vi.mock("../../../lib/grc20", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/grc20")>()
    return {
        ...actual,
        networkGasPriceFresh: mocks.freshPrice,
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
import { executeSignature } from "../../sign/signer"
import { REVIEWS_PKG_PATH } from "../../../lib/reviews"
import { storeReviewRequest, type StoreReviewDraft } from "./reviewRequest"

const HASH = "a".repeat(64)
const draft: StoreReviewDraft = {
    subject: "gno.land/r/samcrew/app",
    appName: "Test App",
    caller: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
    rating: 4,
    body: "Useful app",
    networkKey: "mainnet",
    chainId: "gnoland-1",
    price: { gas: 1000, ugnot: 1 },
}
const run = (request: ReturnType<typeof storeReviewRequest>) => executeSignature(request, undefined, request.prepare(undefined).msgs, () => {})

beforeEach(() => {
    mocks.available.mockReset().mockReturnValue(true)
    mocks.allowed.mockReset().mockReturnValue(true)
    mocks.fetchAppStrict.mockReset().mockResolvedValue({ status: "live", name: "Test App" })
    mocks.wallet.mockReset().mockResolvedValue({ hash: HASH })
    mocks.readTx.mockReset().mockResolvedValue({ hash: HASH, height: "12", tx_result: { ResponseBase: { Error: null } } })
    mocks.freshPrice.mockReset().mockResolvedValue({ gas: 1000, ugnot: 1 })
})
afterEach(() => { setTxConfirmationCallback(null); vi.mocked(doContractBroadcast).mockClear() })

describe("native App Store review signing", () => {
    it("reviews the exact PostReview call and rechecks the live listing before Adena", async () => {
        const request = storeReviewRequest(draft)
        const msg = request.prepare(undefined).msgs[0]
        expect(msg).toEqual({
            type: "vm/MsgCall",
            value: { caller: draft.caller, send: "", pkg_path: REVIEWS_PKG_PATH, func: "PostReview", args: [draft.subject, "4", "Useful app"], max_deposit: "2390000ugnot" },
        })
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["Account", draft.caller], ["Network", "gnoland-1"],
            // 11,720 bytes, ten per character of the 22-character subject and the 10-byte body, at 100 ugnot per byte; the cap is twice that.
            ["Storage deposit", "Up to 1.2 GNOT for the first review of this app, less for a later one or a replacement (cap 2.39 GNOT)"],
            // 17M gas at 1 ugnot per 1,000 gas; feeForGasWanted adds 20 % headroom and the broadcaster sends exactly this.
            ["Network fee", "0.0204 GNOT"],
        ]))
        await expect(run(request)).resolves.toEqual({ outcome: "sent", hash: HASH, result: undefined })
        expect(mocks.fetchAppStrict).toHaveBeenCalledWith(draft.subject)
        expect(doContractBroadcast).toHaveBeenCalledWith([msg], "Review app", { gasWanted: 17_000_000, gasFee: 20_400, beforeSign: expect.any(Function) })
        expect(mocks.wallet).toHaveBeenCalledTimes(1)
    })

    it("stops before Adena when the app is unpublished or delisted", async () => {
        const request = storeReviewRequest(draft)
        mocks.fetchAppStrict.mockResolvedValue({ status: "delisted" })
        await expect(request.recheck?.(undefined)).rejects.toThrow(/no longer a live listing/)
        await expect(run(request)).resolves.toMatchObject({ outcome: "failed" })
        mocks.fetchAppStrict.mockResolvedValue(null)
        await expect(request.recheck?.(undefined)).rejects.toThrow(/no longer a live listing/)
        await expect(run(request)).resolves.toMatchObject({ outcome: "failed" })
        expect(mocks.wallet).not.toHaveBeenCalled()
    })

    it("reports a registry outage as an outage, not as a delisted app", async () => {
        const request = storeReviewRequest(draft)
        mocks.fetchAppStrict.mockRejectedValue(new Error("App Store registry is unavailable"))
        await expect(request.recheck?.(undefined)).rejects.toThrow("App Store registry is unavailable")
        await expect(run(request)).resolves.toMatchObject({ outcome: "failed" })
        expect(mocks.wallet).not.toHaveBeenCalled()
    })

    it("requires a fresh review when the app identity changed", async () => {
        const request = storeReviewRequest(draft)
        mocks.fetchAppStrict.mockResolvedValue({ status: "live", name: "Renamed App" })
        await expect(request.recheck?.(undefined)).rejects.toThrow(/listing changed/)
        await expect(run(request)).resolves.toMatchObject({ outcome: "failed" })
        expect(mocks.wallet).not.toHaveBeenCalled()
    })

    it("quotes the deposit for the trimmed text being posted, and quotes and sends the fee at the reviewed gas price", async () => {
        // Surrounding whitespace is not stored: counting either side would show 1.4 GNOT.
        const request = storeReviewRequest({ ...draft, body: `${" ".repeat(100)}${"é".repeat(1000)}${"\n".repeat(100)}`, price: { gas: 1000, ugnot: 2 } })
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["Storage deposit", "Up to 1.39 GNOT for the first review of this app, less for a later one or a replacement (cap 2.79 GNOT)"],
            ["Network fee", "0.0408 GNOT"],
        ]))
        // The chain's price is below the reviewed one by now: the reviewed fee still covers it.
        await expect(run(request)).resolves.toMatchObject({ outcome: "sent" })
        expect(doContractBroadcast).toHaveBeenCalledWith(expect.anything(), "Review app", { gasWanted: 17_000_000, gasFee: 40_800, beforeSign: expect.any(Function) })
    })

    it("stops before Adena when the network fee rose or cannot be read", async () => {
        const request = storeReviewRequest(draft)
        mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 2 })
        await expect(request.recheck?.(undefined)).rejects.toThrow(/network fee increased/)
        await expect(run(request)).resolves.toMatchObject({ outcome: "failed" })
        mocks.freshPrice.mockRejectedValue(new Error("offline"))
        await expect(request.recheck?.(undefined)).rejects.toThrow(/Couldn't confirm the current network fee/)
        await expect(run(request)).resolves.toMatchObject({ outcome: "failed" })
        expect(mocks.wallet).not.toHaveBeenCalled()
    })

    it("fails closed when the reviews realm is disabled or unavailable on this network", async () => {
        mocks.available.mockReturnValue(false)
        expect(() => storeReviewRequest(draft)).toThrow(/not available/)
        mocks.available.mockReturnValue(true)
        mocks.allowed.mockReturnValue(false)
        expect(() => storeReviewRequest(draft)).toThrow(/not available/)
        // The check is on the reviews realm of the draft's own network, not on the app being reviewed.
        expect(mocks.allowed).toHaveBeenLastCalledWith("mainnet", REVIEWS_PKG_PATH)
    })

    it("validates again at the recheck, before reading the listing", async () => {
        const request = storeReviewRequest(draft)
        mocks.allowed.mockReturnValue(false)
        await expect(request.recheck?.(undefined)).rejects.toThrow(/not available/)
        expect(mocks.fetchAppStrict).not.toHaveBeenCalled()
    })

    it("rejects a caller that is not a valid address and a subject that is not a safe realm path", () => {
        expect(() => storeReviewRequest({ ...draft, caller: "" })).toThrow(/Connect your wallet/)
        // Address-shaped, wrong checksum.
        expect(() => storeReviewRequest({ ...draft, caller: `g1${"q".repeat(38)}` })).toThrow(/Connect your wallet/)
        expect(() => storeReviewRequest({ ...draft, subject: "gno.land/r/samcrew/../app" })).toThrow(/realm path is invalid/)
        expect(() => storeReviewRequest({ ...draft, subject: "samcrew/app" })).toThrow(/realm path is invalid/)
    })

    it("enforces the realm's rating range and its UTF-8 body limit on the trimmed text", () => {
        for (const rating of [0, 6, 2.5]) expect(() => storeReviewRequest({ ...draft, rating })).toThrow(/Select a rating/)
        const atLimit = "é".repeat(1000)
        expect(storeReviewRequest({ ...draft, body: ` ${atLimit}\n` }).prepare(undefined).msgs[0].value.args).toEqual([draft.subject, "4", atLimit])
        expect(() => storeReviewRequest({ ...draft, body: `${atLimit}a` })).toThrow(/2,000 bytes/)
    })

    it("shows and signs the review as it was when the sheet opened", () => {
        const mutable = { ...draft }
        const request = storeReviewRequest(mutable)
        Object.assign(mutable, { rating: 1, body: "Changed", caller: "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c", appName: "Other" })
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([["Account", draft.caller], ["Rating", "4 of 5 stars"], ["Review", "Useful app"]]))
        expect(request.label(undefined)).toBe("Review Test App")
        expect(request.prepare(undefined).msgs[0].value).toMatchObject({ caller: draft.caller, args: [draft.subject, "4", "Useful app"] })
    })

    it("confirms only a transaction the chain delivered without an error", async () => {
        const request = storeReviewRequest(draft)
        await expect(request.verify?.(undefined, HASH, undefined)).resolves.toBe(true)
        expect(mocks.readTx).toHaveBeenCalledWith("tx", { hash: `0x${HASH}` })
        mocks.readTx.mockResolvedValue({ hash: HASH, height: "12", tx_result: { ResponseBase: { Error: "out of gas" } } })
        await expect(request.verify?.(undefined, HASH, undefined)).resolves.toBe(false)
    })

    it("passes the settled outcome to the composer", () => {
        const onSettled = vi.fn()
        storeReviewRequest({ ...draft, onSettled }).onSettled?.("confirmed", undefined)
        expect(onSettled).toHaveBeenCalledWith("confirmed", undefined)
    })
})
