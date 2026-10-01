import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ enabled: vi.fn(() => true), allowed: vi.fn(() => true), applies: vi.fn(), wallet: vi.fn(), readTx: vi.fn(), freshPrice: vi.fn() }))

vi.mock("../../../lib/config", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/config")>(),
    isAppStoreEnabled: mocks.enabled,
    isRealmValidOn: mocks.allowed,
}))
vi.mock("../../../lib/appStore", async (importActual) => ({
    ...await importActual<typeof import("../../../lib/appStore")>(),
    assertAppReportApplies: mocks.applies,
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

import { APPSTORE_REALM_PATH } from "../../../lib/appStore"
import { doContractBroadcast, setTxConfirmationCallback } from "../../../lib/grc20"
import { executeSignature } from "../../sign/signer"
import { reportRequest, type StoreReport } from "./reportRequest"

const HASH = "a".repeat(64)
const CALLER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const PKG = "gno.land/r/samcrew/space_invaders"
const input = (over: Partial<StoreReport> = {}): StoreReport => ({ pkgPath: PKG, appName: "Space Invaders", caller: CALLER, networkKey: "mainnet", chainId: "gnoland-1", price: { gas: 1000, ugnot: 1 }, ...over })
const run = (request: ReturnType<typeof reportRequest>) => executeSignature(request, undefined, request.prepare(undefined).msgs, () => {})

beforeEach(() => {
    mocks.enabled.mockReset().mockReturnValue(true)
    mocks.allowed.mockReset().mockReturnValue(true)
    mocks.applies.mockReset().mockResolvedValue(undefined)
    mocks.wallet.mockReset().mockResolvedValue({ hash: HASH })
    mocks.readTx.mockReset().mockResolvedValue({ hash: HASH, height: "12", tx_result: { ResponseBase: { Error: null } } })
    mocks.freshPrice.mockReset().mockResolvedValue({ gas: 1000, ugnot: 1 })
})
afterEach(() => { setTxConfirmationCallback(null); vi.mocked(doContractBroadcast).mockClear() })

describe("a listing report through the OS signing sheet", () => {
    it("reviews the exact call with its deposit, fee and threshold, checks again, and sends that call once", async () => {
        const request = reportRequest(input())
        const msg = request.prepare(undefined).msgs[0]
        expect(msg.value).toEqual({ caller: CALLER, send: "", pkg_path: APPSTORE_REALM_PATH, func: "FlagApp", args: [PKG], max_deposit: "230000ugnot" })
        expect([request.title, request.summary, request.label(undefined)]).toEqual(["Report a listing", "Report Space Invaders to the App Store curators", "Report a listing"])
        expect(request.lines(undefined)).toEqual([
            ["Account", CALLER], ["Listing", PKG], ["App Store realm", APPSTORE_REALM_PATH], ["Network", "gnoland-1"],
            // 1,103 bytes at 100 ugnot per byte; the cap is twice that, rounded up.
            ["Storage deposit", "≈ 0.11 GNOT, not returned (cap 0.23 GNOT)"],
            // 15M gas at 1 ugnot per 1,000 gas, with feeForGasWanted's 20 % headroom.
            ["Network fee", "0.018 GNOT"],
        ])
        expect(request.note).toBe("One report per account. Reports from 5 different accounts hide the listing from the public lists until a curator clears them. Reporting the same listing again fails, and a failed transaction still costs its fee.")
        expect(request.acks).toEqual(["I understand this report is public and cannot be withdrawn."])
        await expect(run(request)).resolves.toEqual({ outcome: "sent", hash: HASH, result: undefined })
        expect(mocks.applies).toHaveBeenCalledWith(CALLER, PKG)
        expect(doContractBroadcast).toHaveBeenCalledTimes(1)
        expect(doContractBroadcast).toHaveBeenCalledWith([msg], "Report a listing", { gasWanted: 15_000_000, gasFee: 18_000, beforeSign: expect.any(Function) })
    })

    it("stops before Adena when the listing no longer takes a report from this account", async () => {
        const request = reportRequest(input())
        mocks.applies.mockRejectedValue(new Error("You have already reported this listing."))
        await expect(request.recheck?.(undefined)).rejects.toThrow("already reported")
        await expect(run(request)).resolves.toMatchObject({ outcome: "failed" })
        expect(mocks.wallet).not.toHaveBeenCalled()
    })

    it("stops before Adena when the network fee rose, and sends at the reviewed fee otherwise", async () => {
        const request = reportRequest(input({ price: { gas: 1000, ugnot: 2 } }))
        mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 3 })
        await expect(run(request)).resolves.toMatchObject({ outcome: "failed" })
        expect(mocks.wallet).not.toHaveBeenCalled()
        mocks.freshPrice.mockResolvedValue({ gas: 1000, ugnot: 1 })
        await expect(run(request)).resolves.toMatchObject({ outcome: "sent" })
        expect(doContractBroadcast).toHaveBeenLastCalledWith(expect.anything(), "Report a listing", { gasWanted: 15_000_000, gasFee: 36_000, beforeSign: expect.any(Function) })
    })

    it("fails closed when the registry is off or not on this network, and refuses a guest or a malformed path", () => {
        mocks.enabled.mockReturnValue(false)
        expect(() => reportRequest(input())).toThrow("Reports are not available on this network.")
        mocks.enabled.mockReturnValue(true)
        mocks.allowed.mockReturnValue(false)
        expect(() => reportRequest(input())).toThrow("Reports are not available on this network.")
        mocks.allowed.mockReturnValue(true)
        expect(() => reportRequest(input({ caller: "" }))).toThrow("Connect your wallet first.")
        expect(() => reportRequest(input({ pkgPath: 'x") or Steal("' }))).toThrow("cannot be identified")
    })
})
