import { beforeEach, describe, expect, it, vi } from "vitest"
import { doContractBroadcast } from "../grc20"
import { broadcastDaoTx, planDaoTx, proposalIdFromTxResult } from "./daoTx"

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

    it("never re-sends a proposal, and sends the planned gas limit", async () => {
        const action = { type: "propose-archive" as const, title: "Close", description: "" }
        const plan = planDaoTx("memba-v2", REALM, action, CALLER)
        await broadcastDaoTx(plan, action, "Propose: Close")
        expect(doContractBroadcast).toHaveBeenCalledWith([plan.msg], "Propose: Close", { gasWanted: plan.gasWanted, retry: false })
        const vote = { type: "vote" as const, id: 2, vote: "NO" as const }
        const votePlan = planDaoTx("memba-v2", REALM, vote, CALLER)
        await broadcastDaoTx(votePlan, vote, "Vote NO")
        expect(doContractBroadcast).toHaveBeenLastCalledWith([votePlan.msg], "Vote NO", { gasWanted: 15_000_000 })
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
