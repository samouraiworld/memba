/**
 * Every signing flow reaches the wallet through doContractBroadcast, which
 * reads the wallet's live network right before the wallet is asked to sign.
 * These drive representative flows end to end (real grc20, stubbed Adena) and
 * check that none of them reaches DoContract unless the wallet names the
 * page's chain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./config")>()),
    // Open the network gates these flows keep, so the wallet check is what decides.
    isServicesEnabled: () => true,
    isEscrowValid: () => true,
    isFeedWritable: () => true,
}))

import { GNO_CHAIN_ID } from "./config"
import { doContractBroadcast, setTxConfirmationCallback, setWalletRpcContext, type AminoMsg } from "./grc20"
import * as grc20 from "./grc20"
import { WalletNetworkError } from "./walletNetworkGuard"
import { broadcastDaoTx, planDaoTx } from "./dao/daoTx"
import { broadcastEscrowTx, escrowFailureMayHaveLanded, planCancelContract } from "./marketplace/escrowTx"
import { submitFeedMsg } from "./feed"
import { submitReview } from "./reviews"
import { clearGovernanceMemory, readGovernanceReceipt, type GovernanceScope } from "./dao/governanceRecovery"
import { executeSignature, WALLET_SILENT_MS } from "../os/sign/signer"
import { liveWallet } from "../test/walletStub"

const CALLER = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const PAYEE = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const OTHER = `${GNO_CHAIN_ID}-other`
const call = (func: string, pkg = "gno.land/r/samcrew/memba_feed_v1"): AminoMsg =>
    ({ type: "vm/MsgCall", value: { caller: CALLER, send: "", pkg_path: pkg, func, args: [] } })

const PATHS: Array<[string, () => Promise<unknown>]> = [
    ["GNOT send (Memba OS wallet)", () => doContractBroadcast([{ type: "/bank.MsgSend", value: { from_address: CALLER, to_address: PAYEE, amount: "1000000ugnot" } }], "send")],
    ["DAO v2 vote (daoTx)", () => broadcastDaoTx(planDaoTx("memba-v2", "gno.land/r/alice/team", { type: "vote", id: 1, vote: "YES" }, CALLER), "vote")],
    ["escrow (broadcastEscrowTx)", () => broadcastEscrowTx(planCancelContract(CALLER, "gno.land/r/samcrew/escrow_v4", "7"), "cancel")],
    ["feed post (submitFeedMsg)", () => submitFeedMsg(call("Post"), "post")],
    ["review (reviews.submitReview)", () => submitReview(CALLER, PAYEE, 5, "")],
]

let DoContract: ReturnType<typeof vi.fn>
let freshFee: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    // The cached context useAdena keeps is valid; only the live answer varies.
    setWalletRpcContext("https://rpc.gno.land:443", true, GNO_CHAIN_ID)
    setTxConfirmationCallback(null)
    DoContract = vi.fn(async () => ({ status: "success", data: { hash: "H" } }))
    // Gas-price reads fall back to the default instead of reaching a node.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")))
    // A review is sent at a fee read from the chain, with no fallback: that read answers here.
    freshFee = vi.spyOn(grc20, "freshFeeForGasWanted").mockResolvedValue(20_400)
})

afterEach(() => {
    freshFee.mockRestore()
    setWalletRpcContext(null, false, null)
    clearGovernanceMemory()
    localStorage.clear()
    vi.unstubAllGlobals()
})

describe.each(PATHS)("%s", (_name, sign) => {
    it("refuses when the wallet reports no chain", async () => {
        vi.stubGlobal("adena", { ...liveWallet({ chainId: "", networkChainId: "" }), DoContract })
        await expect(sign()).rejects.toThrow(/Your wallet did not report its network \(Adena named no chain\) — switch Adena to .+ and try again\./)
        expect(DoContract).not.toHaveBeenCalled()
    })

    it("refuses when the wallet is on another chain", async () => {
        vi.stubGlobal("adena", { ...liveWallet({ chainId: OTHER }), DoContract })
        await expect(sign()).rejects.toThrow(/Your wallet is on/)
        expect(DoContract).not.toHaveBeenCalled()
    })

    it("refuses when the wallet's account and network disagree", async () => {
        vi.stubGlobal("adena", { ...liveWallet({ chainId: GNO_CHAIN_ID, networkChainId: OTHER }), DoContract })
        await expect(sign()).rejects.toThrow(/two different networks/)
        expect(DoContract).not.toHaveBeenCalled()
    })

    it("refuses even when the cached chain id is empty, the case the old check skipped", async () => {
        setWalletRpcContext("https://rpc.gno.land:443", true, null)
        vi.stubGlobal("adena", { ...liveWallet({ chainId: "", networkChainId: "" }), DoContract })
        await expect(sign()).rejects.toThrow(/did not report its network/)
        expect(DoContract).not.toHaveBeenCalled()
    })

    it("asks a locked Adena to unlock in its own window, then signs", async () => {
        const wallet = liveWallet()
        const LOCKED = { status: "failure", type: "WALLET_LOCKED", data: {} }
        wallet.GetAccount.mockResolvedValueOnce(LOCKED as never)
        wallet.GetNetwork.mockResolvedValueOnce(LOCKED as never)
        const AddEstablish = vi.fn(async () => ({ status: "failure", type: "ALREADY_CONNECTED", data: {} }))
        vi.stubGlobal("adena", { ...wallet, AddEstablish, DoContract })
        await sign()
        expect(AddEstablish).toHaveBeenCalledWith("Memba")
        expect(DoContract).toHaveBeenCalledTimes(1)
    })

    it("signs when the wallet names the page's chain", async () => {
        vi.stubGlobal("adena", { ...liveWallet(), DoContract })
        await sign()
        expect(DoContract).toHaveBeenCalledTimes(1)
    })
})

describe("a refusal is reported as nothing sent", () => {
    it("is a WalletNetworkError, thrown once the caller's beforeSign (which callers treat as the wallet opening) has finished", async () => {
        vi.stubGlobal("adena", { ...liveWallet({ chainId: "", networkChainId: "" }), DoContract })
        let finished = false
        const beforeSign = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); finished = true })
        const err = await doContractBroadcast([call("Post")], "post", { beforeSign }).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(WalletNetworkError)
        expect((err as Error).message).toMatch(/did not report its network/)
        expect(finished).toBe(true)
        expect(DoContract).not.toHaveBeenCalled()
    })

    it("is asked again when beforeSign finishes after the wallet answered, right before the wallet request", async () => {
        const wallet = liveWallet()
        vi.stubGlobal("adena", { ...wallet, DoContract })
        // The wallet answers, then switches network while the caller's last checks still run.
        const beforeSign = vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            wallet.GetAccount.mockResolvedValue({ status: "success", data: { address: CALLER, chainId: OTHER } })
            wallet.GetNetwork.mockResolvedValue({ status: "success", data: { chainId: OTHER, rpcUrl: "https://rpc.gno.land:443" } })
        })
        await expect(doContractBroadcast([call("Post")], "post", { beforeSign })).rejects.toThrow(/Your wallet is on/)
        expect(beforeSign).toHaveBeenCalledTimes(1)
        expect(DoContract).not.toHaveBeenCalled()
    })

    it("escrow does not treat it as a transaction that may have landed", async () => {
        vi.stubGlobal("adena", { ...liveWallet({ chainId: OTHER }), DoContract })
        const err = await broadcastEscrowTx(planCancelContract(CALLER, "gno.land/r/samcrew/escrow_v4", "7"), "cancel").catch((e: unknown) => e)
        expect(escrowFailureMayHaveLanded(err)).toBe(false)
    })

    it("in the Memba OS signer, the request's recheck runs while the wallet is read once, and its answer comes before the wallet request", async () => {
        const order: string[] = []
        const wallet = liveWallet()
        wallet.GetAccount.mockImplementation(async () => {
            order.push("guard")
            // Adena's read is the slow part (it decrypts the wallet), so it answers after the recheck.
            await new Promise((resolve) => setTimeout(resolve, 10))
            order.push("answer")
            return { status: "success", data: { address: "g1stub", chainId: GNO_CHAIN_ID } }
        })
        DoContract.mockImplementation(async () => { order.push("wallet"); return { status: "success", data: { hash: "H" } } })
        vi.stubGlobal("adena", { ...wallet, DoContract })
        const msg = call("Vote", "gno.land/r/alice/team")
        const res = await executeSignature({
            title: "Vote", summary: "Vote on #1", lines: () => [], label: () => "Vote on #1",
            prepare: () => ({ msgs: [msg] }),
            recheck: async () => { order.push("recheck") },
            send: (_c, beforeSign) => doContractBroadcast([msg], "vote", { beforeSign }),
        }, undefined, [msg], () => {})
        expect(res.outcome).toBe("sent")
        expect(order).toEqual(["guard", "recheck", "answer", "wallet"])
    })

    it("the Memba OS signer reports it as failed and keeps no governance lock", async () => {
        const scope: GovernanceScope = { chainId: GNO_CHAIN_ID, realmPath: "gno.land/r/alice/team", caller: CALLER, operation: "vote:1" }
        const msg = call("Vote", "gno.land/r/alice/team")
        for (const wallet of [liveWallet({ chainId: "", networkChainId: "" }), liveWallet({ chainId: OTHER })]) {
            vi.stubGlobal("adena", { ...wallet, DoContract })
            const res = await executeSignature({
                title: "Vote", summary: "Vote on #1", lines: () => [], label: () => "Vote on #1", receipt: scope,
                prepare: () => ({ msgs: [msg] }),
                send: (_c, beforeSign) => doContractBroadcast([msg], "vote", { beforeSign }),
            }, undefined, [msg], () => {})
            expect(res.outcome).toBe("failed")
            expect(readGovernanceReceipt(scope)).toBeNull()
        }
        expect(DoContract).not.toHaveBeenCalled()
    })
})

describe("a locked Adena in the Memba OS signer", () => {
    const LOCKED = { status: "failure", type: "WALLET_LOCKED", data: {} }
    const msg = call("Vote", "gno.land/r/alice/team")
    /** Adena locked until its unlock window, held by the test, is answered. */
    function lockedWallet(lockedAt: () => boolean) {
        const wallet = liveWallet()
        const ok = wallet.GetAccount.getMockImplementation()!
        wallet.GetAccount.mockImplementation(async () => (lockedAt() ? LOCKED as never : ok()))
        const net = wallet.GetNetwork.getMockImplementation()!
        wallet.GetNetwork.mockImplementation(async () => (lockedAt() ? LOCKED as never : net()))
        let unlock!: () => void
        const AddEstablish = vi.fn(() => new Promise((resolve) => { unlock = () => resolve({ status: "failure", type: "ALREADY_CONNECTED", data: {} }) }))
        vi.stubGlobal("adena", { ...wallet, AddEstablish, DoContract })
        return { AddEstablish, unlock: () => unlock() }
    }

    afterEach(() => { vi.useRealTimers() })

    it("says the wallet is opening only once Adena is unlocked, and rechecks the chain after the password", async () => {
        let locked = true
        const { AddEstablish, unlock } = lockedWallet(() => locked)
        // A chain read: slower than Adena's answer that it is locked.
        const recheck = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
        const onWallet = vi.fn()
        const result = executeSignature({
            title: "Vote", summary: "Vote on #1", lines: () => [], label: () => "Vote on #1",
            prepare: () => ({ msgs: [msg] }), recheck,
            send: (_c, beforeSign) => doContractBroadcast([msg], "vote", { beforeSign }),
        }, undefined, [msg], onWallet)
        await vi.waitFor(() => expect(AddEstablish).toHaveBeenCalledOnce())
        await new Promise((resolve) => setTimeout(resolve, 40))
        expect(recheck).toHaveBeenCalledOnce()
        expect(onWallet).not.toHaveBeenCalled()
        locked = false
        unlock()
        await expect(result).resolves.toMatchObject({ outcome: "sent" })
        expect(recheck).toHaveBeenCalledTimes(2)
        expect(onWallet).toHaveBeenCalledOnce()
        expect(DoContract).toHaveBeenCalledOnce()
    })

    it("never opens Adena for a request it already gave up on", async () => {
        vi.useFakeTimers()
        let locked = false
        const { AddEstablish, unlock } = lockedWallet(() => locked)
        const res = executeSignature({
            title: "Vote", summary: "Vote on #1", lines: () => [], label: () => "Vote on #1",
            prepare: () => ({ msgs: [msg] }),
            // Outlasts the wallet's first answer, and Adena locks itself meanwhile: the read after it opens the unlock window.
            recheck: async () => { await new Promise((resolve) => setTimeout(resolve, 100)); locked = true },
            send: (_c, beforeSign) => doContractBroadcast([msg], "vote", { beforeSign }),
        }, undefined, [msg], () => {}, () => true, { before: async () => "0 5ugnot", after: async () => "0 5ugnot" })
        await vi.advanceTimersByTimeAsync(200)
        expect(AddEstablish).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(WALLET_SILENT_MS + 5_000)
        await expect(res).resolves.toMatchObject({ outcome: "unknown" })
        locked = false
        unlock()
        await vi.advanceTimersByTimeAsync(100)
        expect(DoContract).not.toHaveBeenCalled()
    })

    it("reports a recheck refusal only once Adena's unlock window is answered, and never opens Adena", async () => {
        let locked = true
        const { AddEstablish, unlock } = lockedWallet(() => locked)
        let settled = false
        const result = doContractBroadcast([msg], "vote", { beforeSign: async () => { throw new Error("The network fee increased since review. Nothing was sent.") } })
            .finally(() => { settled = true })
        await vi.waitFor(() => expect(AddEstablish).toHaveBeenCalledOnce())
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(settled).toBe(false)
        locked = false
        unlock()
        await expect(result).rejects.toThrow("The network fee increased")
        expect(DoContract).not.toHaveBeenCalled()
    })
})

describe("the connected account", () => {
    it("refuses when Adena's account is not the one the session connected", async () => {
        setWalletRpcContext("https://rpc.gno.land:443", true, GNO_CHAIN_ID, CALLER)
        vi.stubGlobal("adena", { ...liveWallet({ address: PAYEE }), DoContract })
        await expect(submitReview(CALLER, PAYEE, 5, "")).rejects.toThrow(/account is not the one connected/)
        expect(DoContract).not.toHaveBeenCalled()
        vi.stubGlobal("adena", { ...liveWallet({ address: CALLER }), DoContract })
        await submitReview(CALLER, PAYEE, 5, "")
        expect(DoContract).toHaveBeenCalledTimes(1)
    })
})

describe("a wallet on another network", () => {
    it("is refused with a WalletNetworkError before the wallet is asked, for a v1 DAO vote too", async () => {
        vi.stubGlobal("adena", { ...liveWallet({ chainId: OTHER }), DoContract })
        const plan = planDaoTx("memba-v1", "gno.land/r/alice/team", { type: "vote", id: 1, vote: "YES" }, CALLER)
        await expect(broadcastDaoTx(plan, "vote")).rejects.toBeInstanceOf(WalletNetworkError)
        expect(DoContract).not.toHaveBeenCalled()
    })
})
