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
vi.mock("../../../lib/grc20", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/grc20")>(),
    networkGasPriceFresh: mocks.freshPrice,
    // Stand-in for the broadcaster's order: confirmation → beforeSign → wallet.
    doContractBroadcast: vi.fn(async (msgs: unknown, memo: string, opts: { beforeSign?: () => Promise<unknown> }) => {
        const { setTxConfirmationCallback } = await import("../../../lib/grc20")
        const confirm = setTxConfirmationCallback(null) ?? (async () => true)
        setTxConfirmationCallback(confirm)
        if (!(await confirm(msgs as never, memo))) throw new Error("Transaction cancelled by user")
        await opts.beforeSign?.()
        return mocks.wallet()
    }),
}))
vi.mock("../../../lib/rpcFallback", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/rpcFallback")>(),
    resilientRpcCall: mocks.readTx,
}))

import { doContractBroadcast, setTxConfirmationCallback } from "../../../lib/grc20"
import { executeSignature } from "../../sign/signer"
import { storeReviewRequest, type StoreReviewDraft } from "./reviewRequest"

const HASH = "a".repeat(64)
const draft: StoreReviewDraft = {
    subject: "gno.land/r/samcrew/app",
    appName: "Test App",
    caller: "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5",
    rating: 4,
    body: "Useful app",
    realmPath: "gno.land/r/samcrew/memba_appstore_reviews_v1",
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
            value: { caller: draft.caller, send: "", pkg_path: draft.realmPath, func: "PostReview", args: [draft.subject, "4", "Useful app"], max_deposit: "3200000ugnot" },
        })
        expect(request.lines(undefined)).toEqual(expect.arrayContaining([
            ["Account", draft.caller], ["Network", "gnoland-1"],
            // 12,165 measured bytes plus the 10-byte body, at 100 ugnot per byte.
            ["Storage deposit", "≈ 1.22 GNOT for a new review, less when replacing one (cap 3.2 GNOT)"],
            // 15M gas at 1 ugnot per 1,000 gas, with the broadcaster's 20 % headroom.
            ["Network fee", "up to 0.018 GNOT"],
        ]))
        await expect(run(request)).resolves.toEqual({ outcome: "sent", hash: HASH, result: undefined })
        expect(mocks.fetchAppStrict).toHaveBeenCalledWith(draft.subject)
        expect(doContractBroadcast).toHaveBeenCalledWith([msg], "Review app", { gasWanted: 15_000_000, gasFee: 18_000, retry: false, beforeSign: expect.any(Function) })
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

    it("quotes the deposit for the text being posted and the fee at the reviewed gas price", () => {
        const lines = storeReviewRequest({ ...draft, body: "é".repeat(1000), price: { gas: 1000, ugnot: 2 } }).lines(undefined)
        expect(lines).toEqual(expect.arrayContaining([
            ["Storage deposit", "≈ 1.42 GNOT for a new review, less when replacing one (cap 3.2 GNOT)"],
            ["Network fee", "up to 0.036 GNOT"],
        ]))
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
