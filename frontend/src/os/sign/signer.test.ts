import { afterEach, describe, expect, it, vi } from "vitest"
import { clearGovernanceMemory, readGovernanceReceipt, type GovernanceScope } from "../../lib/dao/governanceRecovery"
import { doContractBroadcast, setTxConfirmationCallback, type AminoMsg } from "../../lib/grc20"
import { executeSignature, verifyWithRetries, type SignRequest } from "./signer"

const msg: AminoMsg = { type: "vm/MsgCall", value: { caller: "g1x", send: "", pkg_path: "gno.land/r/alice/team", func: "Vote", args: ["1", "YES"] } }
const scope: GovernanceScope = { chainId: "gnoland-1", realmPath: "gno.land/r/alice/team", caller: "g1x", operation: "vote:1" }

/** A request whose send runs the real confirmation step, then the given wallet behaviour. */
function request(opts: { sendMsgs?: AminoMsg[]; wallet?: () => Promise<{ hash: string }>; recheck?: () => Promise<void>; receipt?: boolean }): SignRequest<"YES"> {
    return {
        title: "Vote", summary: "Vote on #1", lines: () => [], label: () => "Vote on #1",
        receipt: opts.receipt === false ? undefined : scope,
        prepare: () => ({ msgs: [msg] }),
        recheck: opts.recheck,
        // Stand-in for doContractBroadcast's order: confirmation callback → beforeSign → wallet.
        send: async (_c, beforeSign) => {
            const confirm = (setTxConfirmationCallback(null) ?? (async () => true))
            setTxConfirmationCallback(confirm)
            if (!(await confirm(opts.sendMsgs ?? [msg], "memo"))) throw new Error("Transaction cancelled by user")
            await beforeSign()
            return (opts.wallet ?? (async () => ({ hash: "ABC" })))()
        },
    }
}

afterEach(() => {
    setTxConfirmationCallback(null)
    clearGovernanceMemory()
    localStorage.clear()
})

describe("executeSignature", () => {
    it("approves exactly the reviewed messages, then restores the classic confirmation", async () => {
        const classic = vi.fn(async () => true)
        setTxConfirmationCallback(classic)
        const onWallet = vi.fn()
        const res = await executeSignature(request({}), "YES", [msg], onWallet)
        expect(res).toEqual({ outcome: "sent", hash: "ABC" })
        expect(onWallet).toHaveBeenCalledOnce()
        expect(classic).not.toHaveBeenCalled() // the OS sheet stood in for it
        expect(setTxConfirmationCallback(null)).toBe(classic) // …and it's back
        expect(readGovernanceReceipt(scope)).toMatchObject({ phase: "submitted", hash: "ABC", label: "Vote on #1" })
    })

    it("refuses messages that differ from the review; nothing is sent and nothing stays locked", async () => {
        const wallet = vi.fn(async () => ({ hash: "NEVER" }))
        const changed = { ...msg, value: { ...msg.value, args: ["1", "NO"] } }
        const res = await executeSignature(request({ sendMsgs: [changed], wallet }), "YES", [msg], () => {})
        expect(res).toMatchObject({ outcome: "failed", error: expect.stringContaining("changed after your review") })
        expect(wallet).not.toHaveBeenCalled()
        expect(readGovernanceReceipt(scope)).toBeNull()
    })

    it("a failed recheck stops before the wallet and clears the attempt", async () => {
        const res = await executeSignature(request({ recheck: async () => { throw new Error("This vote is no longer available.") } }), "YES", [msg], () => {})
        expect(res).toMatchObject({ outcome: "failed" })
        expect(readGovernanceReceipt(scope)).toBeNull()
    })

    it("a rejection in Adena means nothing was sent", async () => {
        const res = await executeSignature(request({ wallet: async () => { throw new Error("The transaction has been rejected by the user.") } }), "YES", [msg], () => {})
        expect(res).toEqual({ outcome: "cancelled", error: "Cancelled. Nothing was sent." })
        expect(readGovernanceReceipt(scope)).toBeNull()
    })

    it("an error after the wallet opened is an unknown outcome, and stays locked", async () => {
        const res = await executeSignature(request({ wallet: async () => { throw new Error("network timeout") } }), "YES", [msg], () => {})
        expect(res.outcome).toBe("unknown")
        expect(readGovernanceReceipt(scope)).toMatchObject({ phase: "intent" })
    })

    it("refuses a second attempt while one is waiting for the wallet", async () => {
        let release!: (v: { hash: string }) => void
        const slow = request({ wallet: () => new Promise((r) => { release = r }) })
        const first = executeSignature(slow, "YES", [msg], () => {})
        await vi.waitFor(() => expect(release).toBeTypeOf("function"))
        await expect(executeSignature(request({}), "YES", [msg], () => {})).resolves.toMatchObject({ outcome: "failed", error: expect.stringContaining("already waiting") })
        release({ hash: "H" })
        await expect(first).resolves.toEqual({ outcome: "sent", hash: "H" })
    })

    it("works through the real broadcaster's confirmation step", async () => {
        setTxConfirmationCallback(async () => true)
        const req: SignRequest<"YES"> = {
            ...request({ receipt: false }),
            // Real doContractBroadcast: our callback approves, then it stops at the missing wallet.
            send: (_c, beforeSign) => doContractBroadcast([msg], "memo", { beforeSign }),
        }
        const res = await executeSignature(req, "YES", [msg], () => {})
        // Our sheet approved the identical messages; the broadcaster's own wallet guard
        // then stopped it (no wallet in tests), so nothing reached a wallet.
        expect(res.outcome).toBe("failed")
        expect(res.outcome === "failed" && res.error).not.toMatch(/changed after your review|Cancelled/)
    })
})

describe("verifyWithRetries", () => {
    it("retries until the chain shows it", async () => {
        const check = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("rpc")).mockResolvedValueOnce(true)
        await expect(verifyWithRetries(check, 3, 0)).resolves.toBe(true)
        expect(check).toHaveBeenCalledTimes(3)
    })

    it("gives up after the attempts", async () => {
        await expect(verifyWithRetries(async () => false, 2, 0)).resolves.toBe(false)
    })
})

