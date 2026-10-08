import { beforeEach, describe, expect, it, vi } from "vitest"

const grc = vi.hoisted(() => ({ doContractBroadcast: vi.fn(), networkGasPrice: vi.fn(async () => ({ gas: 1000, ugnot: 1 })), feeForGasWanted: vi.fn(() => 20_000) }))
vi.mock("../../lib/grc20", async (orig) => ({ ...(await orig<typeof import("../../lib/grc20")>()), ...grc }))

import { osBroadcast } from "./osWallet"
import type { SignRequest } from "../../os/sign/signer"
import type { SignerApi } from "../../os/sign/signerContext"

const msg = { type: "vm/MsgCall", value: { caller: "g1me", send: "1000000ugnot", pkg_path: "gno.land/r/x/c4", func: "Offer", args: [], max_deposit: "2000000ugnot" } }
let req: SignRequest | null
const signer = (opens = true) => ({ sign: (r: SignRequest) => { req = r; return opens } }) as unknown as SignerApi
const osGuard = vi.fn(() => true)
/** What the OS sheet does on "Sign in Adena": send with its own pre-sign check. */
const sign = () => req!.send(undefined, async () => osGuard)

beforeEach(() => { req = null; vi.clearAllMocks(); osGuard.mockReturnValue(true) })

describe("osBroadcast", () => {
    it("reviews the exact messages and fee, then resolves with the wallet's result", async () => {
        grc.doContractBroadcast.mockResolvedValue({ hash: "H" })
        const p = osBroadcast(signer())([msg], "Connect 4: Offer", { gasWanted: 20_000_000 })
        await vi.waitFor(() => expect(req).not.toBeNull())
        expect(req!.prepare(undefined).msgs).toEqual([msg])
        expect(req!.lines(undefined)).toEqual(expect.arrayContaining([["Move", "Offer"], ["Stake", "1 GNOT"], ["Network fee", "0.02 GNOT"]]))
        await sign()
        expect(grc.doContractBroadcast).toHaveBeenCalledWith([msg], "Connect 4: Offer", expect.objectContaining({ gasWanted: 20_000_000, gasFee: 20_000 }))
        req!.onSettled!("submitted", undefined)
        await expect(p).resolves.toEqual({ hash: "H" })
    })
    it("runs the OS check and the caller's beforeSign, and stops when either refuses", async () => {
        const mine = vi.fn(() => true)
        grc.doContractBroadcast.mockImplementation(async (_m, _memo, o) => { const g = await o.beforeSign(); return { hash: g() ? "ok" : "stopped" } })
        void osBroadcast(signer())([msg], "m", { beforeSign: () => mine })
        await vi.waitFor(() => expect(req).not.toBeNull())
        expect(await sign()).toEqual({ hash: "ok" })
        expect(mine).toHaveBeenCalled()
        osGuard.mockReturnValue(false); mine.mockClear()
        expect(await sign()).toEqual({ hash: "stopped" })
        expect(mine).not.toHaveBeenCalled()
    })
    it("runs the caller's check before the sheet's, so a stop there is nothing sent", async () => {
        const order: string[] = []
        grc.doContractBroadcast.mockImplementation(async (_m, _memo, o) => { await o.beforeSign(); return { hash: "x" } })
        void osBroadcast(signer())([msg], "m", { beforeSign: async () => { order.push("caller"); throw new Error("The game moved on before you signed. Nothing was sent.") } })
        await vi.waitFor(() => expect(req).not.toBeNull())
        await expect(req!.send(undefined, async () => { order.push("sheet"); return osGuard })).rejects.toThrow(/game moved on/)
        expect(order).toEqual(["caller"])
    })
    it("rejects with the wallet's own error when refused, and as cancelled when the review is dismissed", async () => {
        const refused = new Error("refused by node")
        grc.doContractBroadcast.mockRejectedValue(refused)
        const p = osBroadcast(signer())([msg], "m")
        await vi.waitFor(() => expect(req).not.toBeNull())
        await expect(sign()).rejects.toBe(refused)
        req!.onSettled!("failed", undefined)
        await expect(p).rejects.toBe(refused)

        const q = osBroadcast(signer())([msg], "m")
        await vi.waitFor(() => expect(req).not.toBeNull())
        req!.onDismissed!()
        await expect(q).rejects.toThrow("Cancelled. Nothing was sent.")
    })
    it("reports the sheet's verified cancellation as nothing sent", async () => {
        grc.doContractBroadcast.mockRejectedValue(new Error("rejected by user"))
        const p = osBroadcast(signer())([msg], "m")
        await vi.waitFor(() => expect(req).not.toBeNull())
        await expect(sign()).rejects.toThrow()
        req!.onSettled!("cancelled", undefined)
        await expect(p).rejects.toMatchObject({ name: "NothingSentError", message: "rejected by user" })
    })
    it("reports an unknown outcome under the name the game reconciles", async () => {
        const p = osBroadcast(signer())([msg], "m")
        await vi.waitFor(() => expect(req).not.toBeNull())
        req!.onSettled!("unknown", undefined)
        await expect(p).rejects.toMatchObject({ name: "OutcomeUnknownError" })
    })
    it("rejects at once when the sheet can't open", async () => {
        await expect(osBroadcast(signer(false))([msg], "m")).rejects.toThrow(/Couldn't open the signing review/)
    })
})
