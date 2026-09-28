import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const wallet = vi.hoisted(() => ({
    impl: vi.fn(async (): Promise<{ hash: string }> => ({ hash: "a".repeat(64) })),
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
vi.mock("../../lib/rpcFallback", async (orig) => ({
    ...(await orig<typeof import("../../lib/rpcFallback")>()),
    resilientRpcCall: vi.fn(async () => ({ hash: "a".repeat(64), height: "12", tx_result: { ResponseBase: { Error: null } } })),
}))

import { doContractBroadcast, setTxConfirmationCallback } from "../../lib/grc20"
import { executeSignature } from "../sign/signer"
import { readSendLock } from "./send"
import { sendRequest, verifySendTx, type SendContext } from "./sendRequest"

const A = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const B = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const HASH = "a".repeat(64)
const ctx = (over: Partial<SendContext> = {}): SendContext => ({
    from: A, to: B, ugnot: 1_500_000n, memo: "thanks", feeUgnot: 2_400n, tiers: ["new address"], currentWallet: async () => A, onSent: vi.fn(), ...over,
})
const run = (c: SendContext) => { const r = sendRequest(c); return executeSignature(r, undefined, r.prepare(undefined).msgs, () => {}) }

beforeEach(() => {
    wallet.impl.mockImplementation(async () => ({ hash: HASH })); wallet.lockAtWallet = null
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback() } })
})
afterEach(() => { localStorage.clear(); setTxConfirmationCallback(null); vi.clearAllMocks(); Reflect.deleteProperty(navigator, "locks") })

describe("sendRequest", () => {
    it("signs exactly one /bank.MsgSend, never retried, with the tier acknowledgement", async () => {
        const r = sendRequest(ctx())
        expect(r.prepare(undefined).msgs).toEqual([{ type: "/bank.MsgSend", value: { from_address: A, to_address: B, amount: "1500000ugnot" } }])
        expect(r.acks).toHaveLength(1)
        expect(r.warns?.[0]).toMatch(/never sent/)
        await run(ctx())
        expect(vi.mocked(doContractBroadcast).mock.calls[0][2]).toMatchObject({ retry: false, gasWanted: expect.any(Number) })
    })

    it("saves the lock before the wallet opens and clears it only after chain confirmation", async () => {
        const c = ctx()
        const r = sendRequest(c)
        await expect(executeSignature(r, undefined, r.prepare(undefined).msgs, () => {})).resolves.toMatchObject({ outcome: "sent", hash: HASH })
        expect(wallet.lockAtWallet).toMatchObject({ label: "Send 1.5 GNOT" })
        expect(readSendLock("gnoland-1", A)?.hash).toBe(HASH)
        expect(c.onSent).not.toHaveBeenCalled()
        await expect(r.verify!(undefined, HASH, undefined)).resolves.toBe(true)
        expect(readSendLock("gnoland-1", A)).toBeNull()
        expect(c.onSent).toHaveBeenCalledWith(HASH)
    })

    it("keeps the lock when the outcome is unknown, and drops it when Adena rejected", async () => {
        wallet.impl.mockImplementation(async () => { throw new Error("network timeout") })
        await expect(run(ctx())).resolves.toMatchObject({ outcome: "unknown" })
        expect(readSendLock("gnoland-1", A)).not.toBeNull()
        localStorage.clear()
        wallet.impl.mockImplementation(async () => { throw new Error("User rejected the transaction") })
        await expect(run(ctx())).resolves.toMatchObject({ outcome: "cancelled" })
        expect(readSendLock("gnoland-1", A)).toBeNull()
        wallet.impl.mockImplementation(async () => { throw new Error("Transaction cancelled by user") })
        await expect(run(ctx())).resolves.toMatchObject({ outcome: "cancelled" })
        expect(readSendLock("gnoland-1", A)).toBeNull()
    })

    it("keeps the lock for an empty or malformed wallet hash", async () => {
        wallet.impl.mockImplementation(async () => ({ hash: "" }))
        await expect(run(ctx())).resolves.toMatchObject({ outcome: "unknown" })
        expect(readSendLock("gnoland-1", A)?.hash).toBe("")
    })

    it("a second request cannot replace or clear another request's lock", async () => {
        wallet.impl.mockImplementation(async () => { throw new Error("network timeout") })
        await expect(run(ctx())).resolves.toMatchObject({ outcome: "unknown" })
        const first = readSendLock("gnoland-1", A)
        await expect(run(ctx())).resolves.toMatchObject({ outcome: "failed", error: expect.stringContaining("Another send") })
        expect(readSendLock("gnoland-1", A)).toEqual(first)
    })

    it("requires a matching delivered transaction before confirmation", async () => {
        const good = { hash: HASH, height: "12", tx_result: { ResponseBase: { Error: null } } }
        await expect(verifySendTx(HASH, async () => good)).resolves.toBe(true)
        await expect(verifySendTx(HASH, async () => ({ ...good, tx_result: { ResponseBase: { Error: "" } } }))).resolves.toBe(true)
        await expect(verifySendTx(HASH, async () => ({ ...good, tx_result: { ResponseBase: {} } }))).resolves.toBe(false)
        await expect(verifySendTx(HASH, async () => ({ ...good, hash: "b".repeat(64) }))).resolves.toBe(false)
        await expect(verifySendTx(HASH, async () => ({ ...good, height: "0" }))).resolves.toBe(false)
        await expect(verifySendTx(HASH, async () => ({ ...good, tx_result: { ResponseBase: { Error: "out of gas" } } }))).resolves.toBe(false)
        await expect(verifySendTx("bad", async () => good)).resolves.toBe(false)
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
        const gone = await run(ctx({ toName: "alice", resolveName: async () => "" }))
        expect(gone).toMatchObject({ outcome: "failed", error: expect.stringContaining("@alice is no longer registered") })
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

    it("stops before Adena when the live fee exceeds the reviewed fee", async () => {
        const result = await run(ctx({ currentFee: async () => 2_401n }))
        expect(result).toMatchObject({ outcome: "failed", error: expect.stringContaining("fee increased") })
        expect(wallet.impl).not.toHaveBeenCalled()
        expect(readSendLock("gnoland-1", A)).toBeNull()
    })
})
