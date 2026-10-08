import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ open: vi.fn(() => true), v3: vi.fn(() => true), register: vi.fn(), edit: vi.fn(), delist: vi.fn(), wallet: vi.fn(), readTx: vi.fn(), freshPrice: vi.fn() }))

vi.mock("../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/config")>(),
    isAppStoreSubmitEnabled: mocks.open,
}))
vi.mock("../../../lib/appStore", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/appStore")>(),
    isAppStoreV3OrLaterOn: mocks.v3,
}))
vi.mock("../../../lib/appStoreSubmit", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/appStoreSubmit")>(),
    assertRegisterApplies: mocks.register, assertEditApplies: mocks.edit, assertDelistApplies: mocks.delist,
}))
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
    resilientRpcCall: mocks.readTx,
}))

import { buildDelistAppMsg, buildEditListingMsg, buildRegisterAppMsg, type AppSubmission } from "../../../lib/appStoreSubmit"
import { doContractBroadcast, setTxConfirmationCallback } from "../../../lib/grc20"
import { executeSignature } from "../../sign/signer"
import { listingRequest, type ListingAction, type StoreListingCall } from "./listingRequest"

const HASH = "a".repeat(64)
const CALLER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const S: AppSubmission = { pkgPath: "gno.land/r/alice/garden", name: "Garden", tagline: "", descr: "A shared garden.", category: "Games", iconCID: "", screenshotsCSV: "", appURL: "https://example.org/" }
const input = (action: ListingAction, over: Partial<StoreListingCall> = {}): StoreListingCall => ({ action, caller: CALLER, networkKey: "mainnet", chainId: "gnoland-1", price: { gas: 1000, ugnot: 1 }, ...over })
const run = (request: ReturnType<typeof listingRequest>) => executeSignature(request, undefined, request.prepare(undefined).msgs, () => {})
const line = (request: ReturnType<typeof listingRequest>, label: string) => request.lines(undefined).find(([name]) => name === label)?.[1]

beforeEach(() => {
    for (const m of [mocks.register, mocks.edit, mocks.delist]) m.mockReset().mockResolvedValue(undefined)
    mocks.open.mockReset().mockReturnValue(true); mocks.v3.mockReset().mockReturnValue(true)
    mocks.wallet.mockReset().mockResolvedValue({ hash: HASH })
    mocks.readTx.mockReset().mockResolvedValue({ hash: HASH, height: "12", tx_result: { ResponseBase: { Error: null } } })
    mocks.freshPrice.mockReset().mockResolvedValue({ gas: 1000, ugnot: 1 })
})
afterEach(() => { setTxConfirmationCallback(null); vi.mocked(doContractBroadcast).mockClear() })

describe("a listing call through the OS signing sheet", () => {
    it("submits the exact registration with its listing fee, deposit and fee, checked again before the wallet", async () => {
        const request = listingRequest(input({ kind: "register", submission: S, feeUgnot: 1_000_000 }))
        expect(request.prepare(undefined).msgs).toEqual([buildRegisterAppMsg(CALLER, 1_000_000, S)])
        expect(line(request, "Listing fee")).toBe("1 GNOT, forwarded to the App Store treasury; not returned, including if the listing is rejected")
        expect(line(request, "Storage deposit")).toMatch(/^≈ 0\.8\d GNOT, not returned \(cap 1\.\d+ GNOT\)$/)
        // 36M gas at 1 ugnot per 1,000 gas, with the 20 % headroom.
        expect(line(request, "Network fee")).toBe("0.0432 GNOT")
        await expect(run(request)).resolves.toMatchObject({ outcome: "sent", hash: HASH })
        expect(mocks.register).toHaveBeenCalledWith(CALLER, S, 1_000_000)
        expect(doContractBroadcast).toHaveBeenCalledWith(expect.anything(), "Submit app", { gasWanted: 36_000_000, gasFee: 43_200, beforeSign: expect.any(Function) })
    })

    it("resubmits against the listing as loaded, saying which edit this is", async () => {
        const next = { ...S, descr: "A bigger shared garden." }
        const request = listingRequest(input({ kind: "edit", submission: next, was: S, editsUsed: 2 }))
        expect(request.prepare(undefined).msgs).toEqual([buildEditListingMsg(CALLER, next, S)])
        expect(line(request, "Edits used")).toBe("3 of 5 after this one")
        await run(request)
        // Checked again against the listing as loaded, its edit count included.
        expect(mocks.edit).toHaveBeenCalledWith(CALLER, next, S, 2)
        expect(doContractBroadcast).toHaveBeenCalledWith(expect.anything(), "Resubmit app", expect.objectContaining({ gasWanted: 30_000_000 }))
    })

    it("warns that a delist is one-way and asks for the acknowledgement", async () => {
        const request = listingRequest(input({ kind: "delist", pkgPath: S.pkgPath, name: "Garden" }))
        expect(request.prepare(undefined).msgs).toEqual([buildDelistAppMsg(CALLER, S.pkgPath)])
        expect(request.warns).toEqual(["Delisting is one-way for you: only a curator can restore the listing, and its package path stays taken."])
        expect(request.acks).toEqual(["I understand only a curator can bring this listing back."])
        expect(line(request, "Storage deposit")).toBe("at most 0.02 GNOT, the cap sent with the call")
        await run(request)
        // The same memo as the classic page's delist.
        expect(doContractBroadcast).toHaveBeenCalledWith(expect.anything(), "Delist app", expect.objectContaining({ gasWanted: 21_000_000 }))
    })

    it("stops before Adena when a check fails or the fee rose", async () => {
        mocks.register.mockRejectedValue(new Error("The listing fee is now 2 GNOT. Review it again; nothing was sent."))
        await expect(run(listingRequest(input({ kind: "register", submission: S, feeUgnot: 1_000_000 })))).resolves.toMatchObject({ outcome: "failed" })
        mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 2 })
        await expect(run(listingRequest(input({ kind: "delist", pkgPath: S.pkgPath, name: "Garden" })))).resolves.toMatchObject({ outcome: "failed" })
        expect(mocks.wallet).not.toHaveBeenCalled()
    })

    it("offers nothing while submissions are off or the registry is not v3 here, and needs a wallet", () => {
        mocks.open.mockReturnValue(false)
        expect(() => listingRequest(input({ kind: "delist", pkgPath: S.pkgPath, name: "Garden" }))).toThrow("not open")
        mocks.open.mockReturnValue(true); mocks.v3.mockReturnValue(false)
        expect(() => listingRequest(input({ kind: "delist", pkgPath: S.pkgPath, name: "Garden" }))).toThrow("not open")
        mocks.v3.mockReturnValue(true)
        expect(() => listingRequest(input({ kind: "delist", pkgPath: S.pkgPath, name: "Garden" }, { caller: "" }))).toThrow("Connect your wallet first.")
    })
})
