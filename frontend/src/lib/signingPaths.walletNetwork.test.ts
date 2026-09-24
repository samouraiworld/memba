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
import { WalletNetworkError } from "./walletNetworkGuard"
import { broadcastDaoTx, planDaoTx } from "./dao/daoTx"
import { broadcastEscrowTx, escrowFailureMayHaveLanded, planCancelContract } from "./marketplace/escrowTx"
import { submitFeedMsg } from "./feed"
import { buildHideCommentMsg, submitMsg as submitReviewMsg } from "./reviews"
import { clearGovernanceMemory, readGovernanceReceipt, type GovernanceScope } from "./dao/governanceRecovery"
import { executeSignature } from "../os/sign/signer"
import { liveWallet } from "../test/walletStub"

const CALLER = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const PAYEE = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const OTHER = `${GNO_CHAIN_ID}-other`
const call = (func: string, pkg = "gno.land/r/samcrew/memba_feed_v1"): AminoMsg =>
    ({ type: "vm/MsgCall", value: { caller: CALLER, send: "", pkg_path: pkg, func, args: [] } })

const PATHS: Array<[string, () => Promise<unknown>]> = [
    ["GNOT send (Memba OS wallet)", () => doContractBroadcast([{ type: "/bank.MsgSend", value: { from_address: CALLER, to_address: PAYEE, amount: "1000000ugnot" } }], "send", { retry: false })],
    ["DAO v2 vote (daoTx)", () => broadcastDaoTx(planDaoTx("memba-v2", "gno.land/r/alice/team", { type: "vote", id: 1, vote: "YES" }, CALLER), { type: "vote", id: 1, vote: "YES" }, "vote")],
    ["escrow (broadcastEscrowTx)", () => broadcastEscrowTx(planCancelContract(CALLER, "gno.land/r/samcrew/escrow_v4", "7"), "cancel")],
    ["feed post (submitFeedMsg)", () => submitFeedMsg(call("Post"), "post")],
    ["review moderation (reviews.submitMsg)", () => submitReviewMsg(buildHideCommentMsg(CALLER, 1), "hide")],
]

let DoContract: ReturnType<typeof vi.fn>

beforeEach(() => {
    // The cached context useAdena keeps is valid; only the live answer varies.
    setWalletRpcContext("https://rpc.gno.land:443", true, GNO_CHAIN_ID)
    setTxConfirmationCallback(null)
    DoContract = vi.fn(async () => ({ status: "success", data: { hash: "H" } }))
    // Gas-price reads fall back to the default instead of reaching a node.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")))
})

afterEach(() => {
    setWalletRpcContext(null, false, null)
    clearGovernanceMemory()
    localStorage.clear()
    vi.unstubAllGlobals()
})

describe.each(PATHS)("%s", (_name, sign) => {
    it("refuses when the wallet reports no chain", async () => {
        vi.stubGlobal("adena", { ...liveWallet({ chainId: "", networkChainId: "" }), DoContract })
        await expect(sign()).rejects.toThrow(/Your wallet did not report its network — switch Adena to .+ and try again\./)
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

    it("signs when the wallet names the page's chain", async () => {
        vi.stubGlobal("adena", { ...liveWallet(), DoContract })
        await sign()
        expect(DoContract).toHaveBeenCalledTimes(1)
    })
})

describe("a refusal is reported as nothing sent", () => {
    it("is asked before the caller's beforeSign, which callers treat as the wallet opening", async () => {
        vi.stubGlobal("adena", { ...liveWallet({ chainId: "", networkChainId: "" }), DoContract })
        const beforeSign = vi.fn()
        await expect(doContractBroadcast([call("Post")], "post", { retry: false, beforeSign })).rejects.toThrow(/did not report its network/)
        expect(beforeSign).not.toHaveBeenCalled()
        expect(DoContract).not.toHaveBeenCalled()
    })

    it("is asked again after beforeSign, right before the wallet request", async () => {
        const wallet = liveWallet()
        vi.stubGlobal("adena", { ...wallet, DoContract })
        // The wallet switches network while the caller's last checks run.
        const beforeSign = vi.fn(async () => { wallet.GetAccount.mockResolvedValue({ status: "success", data: { address: CALLER, chainId: OTHER } }); wallet.GetNetwork.mockResolvedValue({ status: "success", data: { chainId: OTHER, rpcUrl: "https://rpc.gno.land:443" } }) })
        await expect(doContractBroadcast([call("Post")], "post", { retry: false, beforeSign })).rejects.toThrow(/Your wallet is on/)
        expect(beforeSign).toHaveBeenCalledTimes(1)
        expect(DoContract).not.toHaveBeenCalled()
    })

    it("escrow does not treat it as a transaction that may have landed", async () => {
        vi.stubGlobal("adena", { ...liveWallet({ chainId: OTHER }), DoContract })
        const err = await broadcastEscrowTx(planCancelContract(CALLER, "gno.land/r/samcrew/escrow_v4", "7"), "cancel").catch((e: unknown) => e)
        expect(escrowFailureMayHaveLanded(err)).toBe(false)
    })

    it("in the Memba OS signer, the request's recheck runs before the last wallet check, and that check before the wallet", async () => {
        const order: string[] = []
        const wallet = liveWallet()
        wallet.GetAccount.mockImplementation(async () => { order.push("guard"); return { status: "success", data: { address: "g1stub", chainId: GNO_CHAIN_ID } } })
        DoContract.mockImplementation(async () => { order.push("wallet"); return { status: "success", data: { hash: "H" } } })
        vi.stubGlobal("adena", { ...wallet, DoContract })
        const msg = call("Vote", "gno.land/r/alice/team")
        const res = await executeSignature({
            title: "Vote", summary: "Vote on #1", lines: () => [], label: () => "Vote on #1",
            prepare: () => ({ msgs: [msg] }),
            recheck: async () => { order.push("recheck") },
            send: (_c, beforeSign) => doContractBroadcast([msg], "vote", { retry: false, beforeSign }),
        }, undefined, [msg], () => {})
        expect(res.outcome).toBe("sent")
        expect(order).toEqual(["guard", "recheck", "guard", "wallet"])
    })

    it("the Memba OS signer reports it as failed and keeps no governance lock", async () => {
        const scope: GovernanceScope = { chainId: GNO_CHAIN_ID, realmPath: "gno.land/r/alice/team", caller: CALLER, operation: "vote:1" }
        const msg = call("Vote", "gno.land/r/alice/team")
        for (const wallet of [liveWallet({ chainId: "", networkChainId: "" }), liveWallet({ chainId: OTHER })]) {
            vi.stubGlobal("adena", { ...wallet, DoContract })
            const res = await executeSignature({
                title: "Vote", summary: "Vote on #1", lines: () => [], label: () => "Vote on #1", receipt: scope,
                prepare: () => ({ msgs: [msg] }),
                send: (_c, beforeSign) => doContractBroadcast([msg], "vote", { retry: false, beforeSign }),
            }, undefined, [msg], () => {})
            expect(res.outcome).toBe("failed")
            expect(readGovernanceReceipt(scope)).toBeNull()
        }
        expect(DoContract).not.toHaveBeenCalled()
    })
})

describe("the connected account", () => {
    it("refuses when Adena's account is not the one the session connected", async () => {
        setWalletRpcContext("https://rpc.gno.land:443", true, GNO_CHAIN_ID, CALLER)
        vi.stubGlobal("adena", { ...liveWallet({ address: PAYEE }), DoContract })
        await expect(submitReviewMsg(buildHideCommentMsg(CALLER, 1), "hide")).rejects.toThrow(/account is not the one connected/)
        expect(DoContract).not.toHaveBeenCalled()
        vi.stubGlobal("adena", { ...liveWallet({ address: CALLER }), DoContract })
        await submitReviewMsg(buildHideCommentMsg(CALLER, 1), "hide")
        expect(DoContract).toHaveBeenCalledTimes(1)
    })
})

describe("a refusal on a retry", () => {
    it("is not reported as nothing sent: a v1 DAO vote retried after a lost reply says the outcome is unknown", async () => {
        vi.useFakeTimers()
        try {
            const wallet = liveWallet()
            vi.stubGlobal("adena", { ...wallet, DoContract })
            // First request reaches the wallet and its reply is lost; then the wallet switches network.
            DoContract.mockImplementationOnce(async () => {
                wallet.GetAccount.mockResolvedValue({ status: "success", data: { address: CALLER, chainId: OTHER } })
                wallet.GetNetwork.mockResolvedValue({ status: "success", data: { chainId: OTHER, rpcUrl: "https://rpc.gno.land:443" } })
                return { status: "failure", message: "network timeout" }
            })
            const plan = planDaoTx("memba-v1", "gno.land/r/alice/team", { type: "vote", id: 1, vote: "YES" }, CALLER)
            const settled = broadcastDaoTx(plan, { type: "vote", id: 1, vote: "YES" }, "vote").catch((e: unknown) => e)
            await vi.runAllTimersAsync()
            const err = await settled
            expect(err).toBeInstanceOf(Error)
            expect(err).not.toBeInstanceOf(WalletNetworkError)
            expect((err as Error).message).toMatch(/outcome is unknown/)
            expect((err as Error).message).toMatch(/network timeout/)
            expect(DoContract).toHaveBeenCalledTimes(1)
        } finally {
            vi.useRealTimers()
        }
    })

    it("on the first attempt stays a WalletNetworkError", async () => {
        vi.stubGlobal("adena", { ...liveWallet({ chainId: OTHER }), DoContract })
        const plan = planDaoTx("memba-v1", "gno.land/r/alice/team", { type: "vote", id: 1, vote: "YES" }, CALLER)
        await expect(broadcastDaoTx(plan, { type: "vote", id: 1, vote: "YES" }, "vote")).rejects.toBeInstanceOf(WalletNetworkError)
    })
})
