import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const wallet = vi.hoisted(() => ({
    impl: vi.fn(async (): Promise<{ hash: string }> => ({ hash: "SENDHASH" })),
    lockAtWallet: null as unknown,
}))

vi.mock("../../lib/config", async (orig) => ({ ...(await orig<typeof import("../../lib/config")>()), GNO_CHAIN_ID: "gnoland-1" }))
vi.mock("../../lib/grc20", async (orig) => ({
    ...(await orig<typeof import("../../lib/grc20")>()),
    // Stand-in for the broadcaster's order: confirmation → beforeSign → wallet.
    doContractBroadcast: vi.fn(async (msgs: unknown, _memo: string, opts: { beforeSign?: () => Promise<void> }) => {
        const { setTxConfirmationCallback } = await import("../../lib/grc20")
        const confirm = setTxConfirmationCallback(null) ?? (async () => true)
        setTxConfirmationCallback(confirm)
        if (!(await confirm(msgs as never, _memo))) throw new Error("Transaction cancelled by user")
        await opts.beforeSign?.()
        const { readSendLock } = await import("./send")
        wallet.lockAtWallet = readSendLock("gnoland-1", A)
        return wallet.impl()
    }),
}))

import { doContractBroadcast, setTxConfirmationCallback } from "../../lib/grc20"
import { executeSignature } from "../sign/signer"
import { readSendLock } from "./send"
import { sendRequest, type SendContext } from "./sendRequest"

const A = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const B = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const ctx = (over: Partial<SendContext> = {}): SendContext => ({
    from: A, to: B, ugnot: 1_500_000n, memo: "thanks", feeUgnot: 2_400n, tiers: ["new address"], currentWallet: async () => A, onSent: vi.fn(), ...over,
})
const run = (c: SendContext) => { const r = sendRequest(c); return executeSignature(r, undefined, r.prepare(undefined).msgs, () => {}) }

beforeEach(() => { wallet.impl.mockImplementation(async () => ({ hash: "SENDHASH" })); wallet.lockAtWallet = null })
afterEach(() => { localStorage.clear(); setTxConfirmationCallback(null); vi.clearAllMocks() })

describe("sendRequest", () => {
    it("signs exactly one /bank.MsgSend, never retried, with the tier acknowledgement", async () => {
        const r = sendRequest(ctx())
        expect(r.prepare(undefined).msgs).toEqual([{ type: "/bank.MsgSend", value: { from_address: A, to_address: B, amount: "1500000ugnot" } }])
        expect(r.acks).toHaveLength(1)
        expect(r.warns?.[0]).toMatch(/never sent/)
        await run(ctx())
        expect(vi.mocked(doContractBroadcast).mock.calls[0][2]).toMatchObject({ retry: false, gasWanted: expect.any(Number) })
    })

    it("saves the lock before the wallet opens and clears it once sent", async () => {
        const c = ctx()
        await expect(run(c)).resolves.toMatchObject({ outcome: "sent", hash: "SENDHASH" })
        expect(wallet.lockAtWallet).toMatchObject({ label: "Send 1.5 GNOT" })
        expect(readSendLock("gnoland-1", A)).toBeNull()
        expect(c.onSent).toHaveBeenCalledWith("SENDHASH")
    })

    it("keeps the lock when the outcome is unknown, and drops it when Adena rejected", async () => {
        wallet.impl.mockImplementation(async () => { throw new Error("network timeout") })
        await expect(run(ctx())).resolves.toMatchObject({ outcome: "unknown" })
        expect(readSendLock("gnoland-1", A)).not.toBeNull()
        localStorage.clear()
        wallet.impl.mockImplementation(async () => { throw new Error("User rejected the transaction") })
        await expect(run(ctx())).resolves.toMatchObject({ outcome: "cancelled" })
        expect(readSendLock("gnoland-1", A)).toBeNull()
    })

    it("shows an @name with its full address in the review, and signs that address", async () => {
        const r = sendRequest(ctx({ toName: "alice", resolveName: async () => B }))
        expect(r.sub).toBe(`to @alice (${B})`)
        expect(r.lines()).toContainEqual(["To", `@alice · ${B}`])
        expect(r.prepare(undefined).msgs[0]).toMatchObject({ value: { to_address: B } })
    })

    it("looks the name up again just before the wallet opens, and stops if it moved or can't be read", async () => {
        const moved = await run(ctx({ toName: "alice", resolveName: async () => A }))
        expect(moved).toMatchObject({ outcome: "failed", error: expect.stringContaining("@alice now points to another address") })
        const unread = await run(ctx({ toName: "alice", resolveName: async () => null }))
        expect(unread).toMatchObject({ outcome: "failed", error: expect.stringContaining("Couldn't confirm @alice") })
        expect(wallet.impl).not.toHaveBeenCalled()
        const same = await run(ctx({ toName: "alice", resolveName: async () => B }))
        expect(same).toMatchObject({ outcome: "sent" })
        expect(wallet.impl).toHaveBeenCalledOnce()
    })

    it("stops before the wallet when the connected wallet changed since the review", async () => {
        const res = await run(ctx({ currentWallet: async () => B }))
        expect(res).toMatchObject({ outcome: "failed", error: expect.stringContaining("wallet changed") })
        expect(wallet.impl).not.toHaveBeenCalled()
        expect(readSendLock("gnoland-1", A)).toBeNull()
    })
})
