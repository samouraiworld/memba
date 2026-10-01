import { afterEach, describe, expect, it, vi } from "vitest"
import { clearGovernanceMemory, readGovernanceReceipt, type GovernanceScope } from "../../lib/dao/governanceRecovery"
import { ChainRejectedError, doContractBroadcast, setTxConfirmationCallback, type AminoMsg } from "../../lib/grc20"
import { executeSignature, verifyWithRetries, type SignRequest } from "./signer"

const msg: AminoMsg = { type: "vm/MsgCall", value: { caller: "g1x", send: "", pkg_path: "gno.land/r/alice/team", func: "Vote", args: ["1", "YES"] } }
const scope: GovernanceScope = { chainId: "gnoland-1", realmPath: "gno.land/r/alice/team", caller: "g1x", operation: "vote:1" }

/** A request whose send runs the real confirmation step, then the given wallet behaviour. */
function request(opts: { sendMsgs?: AminoMsg[]; wallet?: () => Promise<{ hash: string }>; recheck?: () => Promise<void>; receipt?: boolean; onNothingSent?: () => void }): SignRequest<"YES"> {
    return {
        title: "Vote", summary: "Vote on #1", lines: () => [], label: () => "Vote on #1",
        receipt: opts.receipt === false ? undefined : scope,
        prepare: () => ({ msgs: [msg] }),
        recheck: opts.recheck,
        onNothingSent: opts.onNothingSent,
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
    it("reads the account mark and runs the request's rechecks at the same time", async () => {
        let markRead!: (mark: string) => void
        let rechecked!: () => void
        const sent = { before: vi.fn(() => new Promise<string>((resolve) => { markRead = resolve })), after: vi.fn(async () => "M"), onSettling: vi.fn() }
        const recheck = vi.fn(() => new Promise<void>((resolve) => { rechecked = resolve }))
        const pending = executeSignature(request({ recheck }), "YES", [msg], () => {}, () => true, sent)
        // Neither has answered, and both are already asked.
        await vi.waitFor(() => { expect(sent.before).toHaveBeenCalled(); expect(recheck).toHaveBeenCalled() })
        markRead("M")
        rechecked()
        await expect(pending).resolves.toMatchObject({ outcome: "sent" })
    })

    it("approves exactly the reviewed messages, then restores the classic confirmation", async () => {
        const classic = vi.fn(async () => true)
        setTxConfirmationCallback(classic)
        const onWallet = vi.fn()
        const res = await executeSignature(request({}), "YES", [msg], onWallet)
        expect(res).toEqual({ outcome: "sent", hash: "ABC", result: undefined })
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

    it("stops before Adena if the OS member session ends during an asynchronous recheck", async () => {
        let finishRecheck!: () => void
        const wait = new Promise<void>((resolve) => { finishRecheck = resolve })
        const wallet = vi.fn(async () => ({ hash: "NEVER" }))
        const onWallet = vi.fn()
        let member = true
        const result = executeSignature(request({ recheck: () => wait, wallet }), "YES", [msg], onWallet, () => member)
        member = false
        finishRecheck()
        await expect(result).resolves.toMatchObject({ outcome: "failed" })
        expect(onWallet).not.toHaveBeenCalled()
        expect(wallet).not.toHaveBeenCalled()
        expect(readGovernanceReceipt(scope)).toBeNull()
    })

    const refusal = (nodeError: string, data: string, trace: string) => new ChainRejectedError(nodeError, `--= Error =--\nData: ${data}\nMsg Traces:\n    0  ${trace}\n--= /Error =--`, "H")

    it("a refusal by the network is its own outcome: the node's sentence, no fee, no invitation to repeat, and the lock released", async () => {
        const onNothingSent = vi.fn()
        const res = await executeSignature(request({ wallet: async () => { throw refusal("Error: insufficient fee error", "std.InsufficientFeeError{abciError:std.abciError{}}", "/gno/tm2/pkg/sdk/auth/ante.go:412 - insufficient fees; got: {Gas-Wanted: 2000000, Gas-Fee 1ugnot}, fee required: 2000ugnot") }, onNothingSent }), "YES", [msg], () => {})
        expect(res).toEqual({ outcome: "refused", error: "The network refused this transaction: insufficient fees; got: {Gas-Wanted: 2000000, Gas-Fee 1ugnot}, fee required: 2000ugnot. It was not included in a block, so nothing changed and no network fee was charged. Review the request before trying again." })
        expect(readGovernanceReceipt(scope)).toBeNull()
        expect(onNothingSent).toHaveBeenCalledTimes(1)
    })

    it("a refusal quotes the node, never a guessed cause", async () => {
        // The words "unauthorized", "503" and "timeout" appear here; none may be turned into another story.
        const mismatch = await executeSignature(request({ wallet: async () => { throw refusal("Error: unauthorized error", "std.UnauthorizedError{abciError:std.abciError{}}", "/gno/tm2/pkg/sdk/auth/ante.go:301 - signature verification failed; verify correct account, sequence, and chain-id") } }), "YES", [msg], () => {})
        expect(mismatch).toMatchObject({ outcome: "refused", error: expect.stringContaining("The network refused this transaction: signature verification failed; verify correct account, sequence, and chain-id.") })
        expect(mismatch).not.toMatchObject({ error: expect.stringMatching(/permission|correct wallet|gas limit in settings|backend service/i) })
        const bare = await executeSignature(request({ wallet: async () => { throw new ChainRejectedError("Error: unknown error", "upstream answered 503 after a timeout", "") } }), "YES", [msg], () => {})
        expect(bare).toMatchObject({ outcome: "refused", error: expect.stringContaining("The network refused this transaction: Error: unknown error.") })
    })

    it("a wallet failure without the node's reason stays an unknown outcome", async () => {
        const res = await executeSignature(request({ wallet: async () => { throw new Error("Adena could not execute the transaction.") } }), "YES", [msg], () => {})
        expect(res.outcome).toBe("unknown")
        expect(readGovernanceReceipt(scope)).not.toBeNull()
    })

    const REJECTED = "The transaction has been rejected by the user."
    const MARK = "7 5000000ugnot"
    /** A wallet that answers "rejected" after it opened, as Adena does whenever its window is closed. */
    const rejecting = (onNothingSent?: () => void, then?: () => void) => request({ wallet: async () => { then?.(); throw new Error(REJECTED) }, onNothingSent })

    it("a rejection in Adena is a cancellation only once the account is unchanged three blocks later, and is reported as that observation", async () => {
        let blocksLater!: (mark: string) => void
        const sent = { before: vi.fn(async () => MARK), after: vi.fn(() => new Promise<string>((resolve) => { blocksLater = resolve })), onSettling: vi.fn() }
        const onNothingSent = vi.fn()
        const pending = executeSignature(rejecting(onNothingSent), "YES", [msg], () => {}, () => true, sent)
        await vi.waitFor(() => expect(sent.after).toHaveBeenCalledTimes(1))
        // However long the chain takes, nothing is released before the answer.
        expect(sent.onSettling).toHaveBeenCalledTimes(1)
        expect(readGovernanceReceipt(scope)).not.toBeNull()
        expect(onNothingSent).not.toHaveBeenCalled()
        blocksLater(MARK)
        // What Memba saw, not a proof: an accepted transaction has no deadline to be included.
        expect(await pending).toEqual({ outcome: "cancelled", error: "Cancelled in Adena. Your account shows no change three blocks later." })
        expect(sent.before).toHaveBeenCalledTimes(1)
        expect(readGovernanceReceipt(scope)).toBeNull()
        expect(onNothingSent).toHaveBeenCalledTimes(1)
    })

    it.each([
        ["the sequence moved: Adena had already sent the transaction", "8 4990000ugnot"],
        ["only the coins moved: a session key signed, and the fee was taken from the account", "7 4990000ugnot"],
    ])("the same reply is an unknown outcome and the lock stays when %s", async (_why, later) => {
        const onNothingSent = vi.fn()
        const res = await executeSignature(rejecting(onNothingSent), "YES", [msg], () => {}, () => true, { before: async () => MARK, after: async () => later })
        expect(res).toMatchObject({ outcome: "unknown", error: "Adena reported a cancellation, but Memba could not confirm it on chain. Check your account before trying again." })
        expect(readGovernanceReceipt(scope)).toMatchObject({ phase: "intent" })
        expect(onNothingSent).not.toHaveBeenCalled()
    })

    it("a rejection that cannot be checked is unknown too: no check, no first read, or a chain that did not commit the next blocks in time", async () => {
        const onNothingSent = vi.fn()
        const noCheck = await executeSignature(rejecting(onNothingSent), "YES", [msg], () => {})
        expect(noCheck.outcome).toBe("unknown")
        clearGovernanceMemory(); localStorage.clear()
        const after = vi.fn(async () => MARK)
        const unread = await executeSignature(rejecting(onNothingSent), "YES", [msg], () => {}, () => true, { before: async () => { throw new Error("offline") }, after })
        expect(unread.outcome).toBe("unknown")
        expect(after).not.toHaveBeenCalled()
        clearGovernanceMemory(); localStorage.clear()
        const stalled = await executeSignature(rejecting(onNothingSent), "YES", [msg], () => {}, () => true, { before: async () => MARK, after: async () => { throw new Error("The chain did not commit the next blocks in time") } })
        expect(stalled.outcome).toBe("unknown")
        expect(readGovernanceReceipt(scope)).not.toBeNull()
        expect(onNothingSent).not.toHaveBeenCalled()
    })

    it("a first read that never answers holds the wallet back three seconds at most, and then a rejection is unknown", async () => {
        vi.useFakeTimers()
        try {
            const opened = vi.fn()
            const after = vi.fn(async () => MARK)
            const pending = executeSignature(rejecting(undefined, opened), "YES", [msg], () => {}, () => true, { before: () => new Promise<string>(() => {}), after })
            await vi.advanceTimersByTimeAsync(2_999)
            expect(opened).not.toHaveBeenCalled()
            await vi.advanceTimersByTimeAsync(1)
            expect((await pending).outcome).toBe("unknown")
            expect(opened).toHaveBeenCalledTimes(1)
            expect(after).not.toHaveBeenCalled()
            expect(vi.getTimerCount()).toBe(0)
        } finally {
            vi.useRealTimers()
        }
    })

    it("a first read that answers leaves no timer behind", async () => {
        vi.useFakeTimers()
        try {
            const res = await executeSignature(request({}), "YES", [msg], () => {}, () => true, { before: async () => MARK, after: async () => MARK })
            expect(res.outcome).toBe("sent")
            expect(vi.getTimerCount()).toBe(0)
        } finally {
            vi.useRealTimers()
        }
    })

    it("a cancellation before the wallet opened needs no check: there, nothing was sent is a fact", async () => {
        const sent = { before: vi.fn(async () => MARK), after: vi.fn(async () => MARK) }
        const changed = { ...msg, value: { ...msg.value, args: ["1", "NO"] } }
        const res = await executeSignature(request({ sendMsgs: [changed] }), "YES", [msg], () => {}, () => true, sent)
        expect(res).toMatchObject({ outcome: "failed", error: expect.stringContaining("Nothing was sent") })
        expect(sent.before).not.toHaveBeenCalled()
        expect(sent.after).not.toHaveBeenCalled()
    })

    it("calls onNothingSent when the request stopped before the wallet, and not for an unknown or sent outcome", async () => {
        const refused = vi.fn()
        await executeSignature({ ...request({ recheck: async () => { throw new Error("path taken") } }), onNothingSent: refused }, "YES", [msg], () => {})
        expect(refused).toHaveBeenCalledOnce()
        const unknown = vi.fn()
        await executeSignature({ ...request({ receipt: false, wallet: async () => { throw new Error("network timeout") } }), onNothingSent: unknown }, "YES", [msg], () => {})
        const sent = vi.fn()
        await executeSignature({ ...request({ receipt: false }), onNothingSent: sent }, "YES", [msg], () => {})
        expect(unknown).not.toHaveBeenCalled()
        expect(sent).not.toHaveBeenCalled()
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
        await expect(first).resolves.toEqual({ outcome: "sent", hash: "H", result: undefined })
    })

    it("does not let a new account replace a pending account's review callback", async () => {
        const classic = vi.fn(async () => true)
        setTxConfirmationCallback(classic)
        let release!: () => void
        let started!: () => void
        const waiting = new Promise<void>((resolve) => { release = resolve })
        const entered = new Promise<void>((resolve) => { started = resolve })
        const first = executeSignature(request({ receipt: false, recheck: async () => { started(); await waiting } }), "YES", [msg], () => {}, () => false)
        await entered
        const secondWallet = vi.fn(async () => ({ hash: "B" }))
        const second = await executeSignature(request({ receipt: false, wallet: secondWallet }), "YES", [msg], () => {})
        expect(second).toMatchObject({ outcome: "failed", error: expect.stringContaining("already waiting") })
        expect(secondWallet).not.toHaveBeenCalled()
        release()
        await expect(first).resolves.toMatchObject({ outcome: "failed" })
        expect(setTxConfirmationCallback(null)).toBe(classic)
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

    it("stops at once when the chain refused it: that answer is final", async () => {
        const check = vi.fn().mockResolvedValueOnce("failed").mockResolvedValue(true)
        await expect(verifyWithRetries(check, 3, 0)).resolves.toBe("failed")
        expect(check).toHaveBeenCalledOnce()
    })
})
