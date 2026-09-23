import { beforeEach, describe, expect, it, vi } from "vitest"
import { doContractBroadcast } from "../grc20"
import { broadcastDaoTx, daoBroadcastOptions, planDaoTx, planNeedsDepositOverride, proposalIdFromTxResult, type DaoTxPlan } from "./daoTx"

vi.mock("../grc20", async (orig) => ({ ...(await orig<typeof import("../grc20")>()), doContractBroadcast: vi.fn(async () => ({ hash: "h" })) }))

const REALM = "gno.land/r/alice/team"
const CALLER = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"

beforeEach(() => vi.clearAllMocks())

describe("DAO transaction plans", () => {
    it("carries the deposit cap in the signed message and the gas limit beside it", () => {
        const action = { type: "propose-text" as const, title: "Hello", description: "", category: "governance" }
        const plan = planDaoTx("memba-v2", REALM, action, CALLER)
        expect(plan.msg).toEqual({
            type: "vm/MsgCall",
            value: { caller: CALLER, send: "", pkg_path: REALM, func: "ProposeText", args: ["Hello", "", "governance"], max_deposit: "1610000ugnot" },
        })
        expect(plan.gasWanted).toBe(26_000_000)
        expect(plan.maxDepositUgnot).toBe(1_610_000)
    })

    it("sizes an execution by the action it applies", () => {
        const roles = Array.from({ length: 16 }, (_, i) => `role_${i}`)
        const add = planDaoTx("memba-v2", REALM, { type: "execute", id: 4 }, CALLER, { kind: "add_member", roles })
        const text = planDaoTx("memba-v2", REALM, { type: "execute", id: 4 }, CALLER, { kind: "text", roles: [] })
        expect(add.maxDepositUgnot).toBeGreaterThan(text.maxDepositUgnot!)
    })

    it("leaves other contracts on the default budget without a deposit cap", () => {
        const plan = planDaoTx("govdao", "gno.land/r/gov/dao", { type: "vote", id: 1, vote: "YES" }, CALLER)
        expect(plan.gasWanted).toBeUndefined()
        expect(plan.msg.value).not.toHaveProperty("max_deposit")
    })

    it("never re-sends a version-2 call, and sends the planned gas limit", async () => {
        const action = { type: "propose-archive" as const, title: "Close", description: "" }
        const plan = planDaoTx("memba-v2", REALM, action, CALLER)
        await broadcastDaoTx(plan, action, "Propose: Close")
        expect(doContractBroadcast).toHaveBeenCalledWith([plan.msg], "Propose: Close", { gasWanted: plan.gasWanted, retry: false })
        const vote = { type: "vote" as const, id: 2, vote: "NO" as const }
        const votePlan = planDaoTx("memba-v2", REALM, vote, CALLER)
        await broadcastDaoTx(votePlan, vote, "Vote NO")
        expect(doContractBroadcast).toHaveBeenLastCalledWith([votePlan.msg], "Vote NO", { gasWanted: 15_000_000, retry: false })
        const execute = { type: "execute" as const, id: 2 }
        const executePlan = planDaoTx("memba-v2", REALM, execute, CALLER, { kind: "text", roles: [] })
        await broadcastDaoTx(executePlan, execute, "Execute #2")
        expect(doContractBroadcast).toHaveBeenLastCalledWith([executePlan.msg], "Execute #2", { gasWanted: executePlan.gasWanted, retry: false })
    })

    it("leaves votes on other contracts retryable", async () => {
        const vote = { type: "vote" as const, id: 2, vote: "NO" as const }
        const plan = planDaoTx("govdao", "gno.land/r/gov/dao", vote, CALLER)
        await broadcastDaoTx(plan, vote, "Vote NO")
        expect(doContractBroadcast).toHaveBeenLastCalledWith([plan.msg], "Vote NO", {})
    })
})

describe("storage deposit ceiling", () => {
    const action = { type: "propose-text" as const, title: "Big", description: "", category: "governance" }
    const withDeposit = (ugnot: number, signed = `${ugnot}ugnot`): DaoTxPlan => {
        const base = planDaoTx("memba-v2", REALM, action, CALLER)
        return { ...base, msg: { ...base.msg, value: { ...base.msg.value, max_deposit: signed } }, maxDepositUgnot: ugnot }
    }

    it("signs a plan at exactly 10 GNOT without an override", async () => {
        const plan = withDeposit(10_000_000)
        expect(planNeedsDepositOverride(plan)).toBe(false)
        await broadcastDaoTx(plan, action, "Propose: Big")
        expect(doContractBroadcast).toHaveBeenCalledTimes(1)
    })

    it("refuses 10 GNOT + 1 ugnot unless that exact amount was approved", async () => {
        const plan = withDeposit(10_000_001)
        expect(planNeedsDepositOverride(plan)).toBe(true)
        await expect(broadcastDaoTx(plan, action, "Propose: Big")).rejects.toThrow(/10\.000001 GNOT/)
        await expect(broadcastDaoTx(plan, action, "Propose: Big", undefined, { approvedDepositUgnot: 10_000_000 })).rejects.toThrow(/above the 10 GNOT limit/)
        await expect(broadcastDaoTx(plan, action, "Propose: Big", undefined, { approvedDepositUgnot: 20_000_000 })).rejects.toThrow(/above the 10 GNOT limit/)
        expect(doContractBroadcast).not.toHaveBeenCalled()
        await broadcastDaoTx(plan, action, "Propose: Big", undefined, { approvedDepositUgnot: 10_000_001 })
        expect(doContractBroadcast).toHaveBeenCalledWith([plan.msg], "Propose: Big", { gasWanted: plan.gasWanted, retry: false })
    })

    it("judges the amount the message carries, not the preview field", async () => {
        const spoofed = withDeposit(1_000_000, "50000000ugnot")
        await expect(broadcastDaoTx(spoofed, action, "Propose: Big", undefined, { approvedDepositUgnot: 1_000_000 })).rejects.toThrow()
        const odd = withDeposit(1_000_000, "1000000ugnot,1gnot")
        await expect(broadcastDaoTx(odd, action, "Propose: Big")).rejects.toThrow()
        expect(doContractBroadcast).not.toHaveBeenCalled()
    })

    it("also guards callers that broadcast a plan themselves", () => {
        expect(() => daoBroadcastOptions(withDeposit(10_000_001), action)).toThrow(/above the 10 GNOT limit/)
        expect(daoBroadcastOptions(withDeposit(10_000_000), action)).toEqual({ gasWanted: expect.any(Number), retry: false })
    })
})

describe("proposal id from a broadcast result", () => {
    const b64 = (s: string) => btoa(s)
    it("reads the returned id from the deliver result", () => {
        expect(proposalIdFromTxResult({ hash: "h", deliver_tx: { ResponseBase: { Data: b64("(7 uint64)\n") } } })).toBe(7)
        expect(proposalIdFromTxResult({ hash: "h", deliverTx: { ResponseBase: { Data: b64("(12 uint64)") } } })).toBe(12)
        expect(proposalIdFromTxResult({ deliverTx: { data: "(3 uint64)" } })).toBe(3)
    })

    it("returns null for anything else", () => {
        expect(proposalIdFromTxResult(undefined)).toBeNull()
        expect(proposalIdFromTxResult({ hash: "h" })).toBeNull()
        expect(proposalIdFromTxResult({ deliver_tx: { ResponseBase: { Data: b64("(0 uint64)") } } })).toBeNull()
        expect(proposalIdFromTxResult({ deliver_tx: { ResponseBase: { Data: b64("(-1 int)") } } })).toBeNull()
        expect(proposalIdFromTxResult({ deliver_tx: { ResponseBase: { Data: b64("(7 uint64) extra") } } })).toBeNull()
        expect(proposalIdFromTxResult({ deliver_tx: { ResponseBase: { Data: "%%%" } } })).toBeNull()
    })
})
