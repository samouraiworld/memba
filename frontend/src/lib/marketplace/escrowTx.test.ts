import { beforeEach, describe, expect, it, vi } from "vitest"

const doContractBroadcast = vi.hoisted(() => vi.fn(async () => ({ hash: "ABC" })))
vi.mock("../grc20", async (importOriginal) => ({ ...(await importOriginal<typeof import("../grc20")>()), doContractBroadcast }))
const gate = vi.hoisted(() => ({ services: true, escrow: true }))
vi.mock("../config", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../config")>()),
    isServicesEnabled: () => gate.services,
    isEscrowValid: () => gate.escrow,
}))

import {
    assertEscrowPlanSignable,
    planArchiveContract,
    planExpireUnfunded,
    broadcastEscrowTx,
    escrowFailureMayHaveLanded,
    planCancelContract,
    planClaimDisputeTimeout,
    planClaimRefund,
    planCompleteMilestone,
    planCreateContract,
    planFundMilestone,
    planHireService,
    formatUgnotExactBig,
    planRaiseDispute,
    planReleaseFunds,
    type EscrowTxPlan,
} from "./escrowTx"
import { createContractBudget } from "./escrowBudget"
import { EscrowInputError } from "./builders"

const CLIENT = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const FREELANCER = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
const ESCROW = "gno.land/r/samcrew/escrow_v4"
const MS = [{ title: "Deposit", amountUgnot: 250_000_000 }, { title: "Final", amountUgnot: 250_000_000 }]

const tamper = (plan: EscrowTxPlan, value: Record<string, unknown>): EscrowTxPlan =>
    ({ ...plan, msg: { ...plan.msg, value: { ...plan.msg.value, ...value } } } as EscrowTxPlan)

beforeEach(() => {
    doContractBroadcast.mockClear()
    gate.services = true
    gate.escrow = true
})

describe("escrow transaction plans", () => {
    it("a CreateContract plan carries the budget it was sized with, and sends nothing", () => {
        const plan = planCreateContract(CLIENT, ESCROW, { freelancer: FREELANCER, title: "Audit", description: "Audit the realm", milestones: MS })
        const budget = createContractBudget({ titleBytes: 5, descriptionBytes: 15, milestonesArg: "Deposit:250000000,Final:250000000" })
        expect(plan.maxDepositUgnot).toBe(budget.maxDepositUgnot)
        expect(plan.gasWanted).toBe(budget.gasWanted)
        expect(plan.msg.value.max_deposit).toBe(`${budget.maxDepositUgnot}ugnot`)
        expect(plan.sendUgnot).toBe(0)
        expect(plan.msg.value.send).toBe("")
        expect(() => assertEscrowPlanSignable(plan)).not.toThrow()
    })

    it("a FundMilestone plan sends exactly the milestone amount", () => {
        const plan = planFundMilestone(CLIENT, ESCROW, "7", 1, 250_000_000)
        expect(plan.sendUgnot).toBe(250_000_000)
        expect(plan.msg.value.send).toBe("250000000ugnot")
        expect(plan.msg.value.max_deposit).toBe("200000ugnot")
        expect(plan.gasWanted).toBe(32_000_000)
    })

    it("ArchiveContract and ExpireUnfunded plans send nothing, carry the flat cap and pass the guard", () => {
        const archive = planArchiveContract(CLIENT, ESCROW, "7")
        const expire = planExpireUnfunded(FREELANCER, ESCROW, "7")
        expect(archive.msg.value).toMatchObject({ func: "ArchiveContract", args: ["7"], caller: CLIENT, send: "", max_deposit: "200000ugnot" })
        expect(expire.msg.value).toMatchObject({ func: "ExpireUnfunded", args: ["7"], caller: FREELANCER, send: "", max_deposit: "200000ugnot" })
        expect(archive.gasWanted).toBe(39_000_000)
        expect(expire.gasWanted).toBe(33_000_000)
        expect(() => assertEscrowPlanSignable(archive)).not.toThrow()
        expect(() => assertEscrowPlanSignable(expire)).not.toThrow()
        // Neither may send coins.
        expect(() => assertEscrowPlanSignable(tamper(archive, { send: "1ugnot" }))).toThrow()
        expect(() => assertEscrowPlanSignable({ ...expire, sendUgnot: 1 })).toThrow()
    })

    it("every other call sends nothing and carries its flat cap", () => {
        for (const plan of [
            planCompleteMilestone(FREELANCER, ESCROW, "7", 0),
            planReleaseFunds(CLIENT, ESCROW, "7", 0),
            planRaiseDispute(CLIENT, ESCROW, "7", 0),
            planCancelContract(CLIENT, ESCROW, "7"),
            planClaimRefund(FREELANCER, ESCROW, "7", 0),
            planClaimDisputeTimeout(FREELANCER, ESCROW, "7", 0),
            planExpireUnfunded(FREELANCER, ESCROW, "7"),
            planArchiveContract(CLIENT, ESCROW, "7"),
        ]) {
            expect(plan.sendUgnot).toBe(0)
            expect(plan.msg.value.send).toBe("")
            expect(plan.msg.value.max_deposit).toBe("200000ugnot")
            expect(() => assertEscrowPlanSignable(plan)).not.toThrow()
        }
    })

    it("planHireService parses the listing's milestones strictly and hires its freelancer", () => {
        const plan = planHireService(CLIENT, ESCROW, { freelancer: FREELANCER, title: "Audit", description: "x", milestones: "Deposit:250000000,Final:250000000" })
        expect(plan.msg.value.func).toBe("CreateContract")
        expect(plan.msg.value.args).toEqual([FREELANCER, "Audit", "x", "Deposit:250000000,Final:250000000"])
        expect(plan.milestones).toEqual(MS)
        expect(plan.totalUgnot).toBe(500_000_000n)
        expect(() => planHireService(CLIENT, ESCROW, { freelancer: FREELANCER, title: "Audit", description: "x", milestones: "Deposit:2.5" })).toThrow()
        expect(() => planHireService(FREELANCER, ESCROW, { freelancer: FREELANCER, title: "Audit", description: "x", milestones: "A:1000" })).toThrow(/yourself/)
    })
})

describe("format-table lookups in the text", () => {
    it("raise the planned gas, and editing the text re-derives it", () => {
        const arabic = String.fromCodePoint(0x627).repeat(100) // 200 bytes, 100 lookups
        const ascii = planCreateContract(CLIENT, ESCROW, { freelancer: FREELANCER, title: "x".repeat(200), description: "", milestones: MS })
        const plan = planCreateContract(CLIENT, ESCROW, { freelancer: FREELANCER, title: arabic, description: "", milestones: MS })
        expect(plan.gasWanted).toBe(createContractBudget({ titleBytes: 200, descriptionBytes: 0, milestonesArg: "Deposit:250000000,Final:250000000", formatLookupRunes: 100 }).gasWanted)
        expect(plan.gasWanted).toBeGreaterThan(ascii.gasWanted)
        const args = [...ascii.msg.value.args]
        args[1] = arabic
        expect(() => assertEscrowPlanSignable(tamper(ascii, { args }))).toThrow(/changed/)
    })
})

describe("hire total", () => {
    it("sums in BigInt, exactly, past 2^53", () => {
        const milestones = Array.from({ length: 20 }, (_, i) => `M${i}:999999999999999`).join(",")
        const plan = planHireService(CLIENT, ESCROW, { freelancer: FREELANCER, title: "Big", description: "", milestones })
        expect(plan.totalUgnot).toBe(19_999_999_999_999_980n)
        expect(formatUgnotExactBig(plan.totalUgnot)).toBe("19,999,999,999.99998 GNOT")
        expect(formatUgnotExactBig(500_000_000n)).toBe("500 GNOT")
    })
})

describe("the signing guard refuses anything but the reviewed plan", () => {
    const fund = () => planFundMilestone(CLIENT, ESCROW, "7", 1, 250_000_000)
    const createPlan = () => planCreateContract(CLIENT, ESCROW, { freelancer: FREELANCER, title: "Audit", description: "short", milestones: MS })

    it("a missing, different or non-canonical deposit cap", () => {
        for (const max_deposit of [undefined, "", "200001ugnot", "0200000ugnot", "200000 ugnot", "200000ugnot,1ugnot", "0.2gnot", 200000]) {
            expect(() => assertEscrowPlanSignable(tamper(fund(), { max_deposit })), String(max_deposit)).toThrow()
        }
    })

    it("a cap above the 10 GNOT ceiling, even when the message agrees with the plan", () => {
        const plan = tamper({ ...fund(), maxDepositUgnot: 10_000_001 }, { max_deposit: "10000001ugnot" })
        expect(() => assertEscrowPlanSignable(plan)).toThrow(/10 GNOT/)
    })

    it("a send that differs from the milestone amount, or any send on a non-payable call", () => {
        for (const send of ["", "250000001ugnot", "0250000000ugnot", "250000000 ugnot", "250000000ugnot,1ugnot", "250gnot", "250000000ugnot "]) {
            expect(() => assertEscrowPlanSignable(tamper(fund(), { send })), JSON.stringify(send)).toThrow()
        }
        expect(() => assertEscrowPlanSignable({ ...fund(), sendUgnot: 1 })).toThrow()
        expect(() => assertEscrowPlanSignable(tamper(planReleaseFunds(CLIENT, ESCROW, "7", 0), { send: "1ugnot" }))).toThrow()
    })

    it("arguments edited after planning, which would change the deposit the call needs", () => {
        const plan = createPlan()
        const args = [...plan.msg.value.args]
        args[2] = "d".repeat(5000)
        expect(() => assertEscrowPlanSignable(tamper(plan, { args }))).toThrow()
    })

    it("a realm other than the configured escrow realm, even one the builders accept", () => {
        expect(() => planCancelContract(CLIENT, "gno.land/r/samcrew/escrow_v3", "7")).toThrow(/another realm/)
        expect(() => assertEscrowPlanSignable(tamper(fund(), { pkg_path: "gno.land/r/evil/escrow" }))).toThrow(/another realm/)
    })

    it("a different gas limit, function or message type", () => {
        expect(() => assertEscrowPlanSignable({ ...fund(), gasWanted: 10_000_000 })).toThrow()
        expect(() => assertEscrowPlanSignable(tamper(fund(), { func: "ResolveDispute" }))).toThrow()
        expect(() => assertEscrowPlanSignable({ ...fund(), msg: { ...fund().msg, type: "/vm.m_call" } } as unknown as EscrowTxPlan)).toThrow()
    })
})

describe("escrowFailureMayHaveLanded", () => {
    it("is false only for failures that certainly left the chain unchanged", () => {
        for (const msg of [
            "Transaction cancelled by user",
            "User rejected the request",
            "user denied transaction signature",
            "🛡️ Transaction blocked — Your wallet is using an untrusted RPC: https://x",
            "Adena wallet not available — please install or refresh the page",
            "insufficient funds to pay for fees",
            "out of gas in location: ReadFlat",
        ]) expect(escrowFailureMayHaveLanded(new Error(msg)), msg).toBe(false)
        expect(escrowFailureMayHaveLanded(new EscrowInputError("Invalid caller address"))).toBe(false)
    })

    it("is true for timeouts, network errors and anything unknown", () => {
        for (const err of [
            new Error("Request timed out"),
            new Error("Failed to fetch"),
            new Error("Transaction failed after retries"),
            new Error("Transaction failed"),
            new Error(""),
            "string error",
            undefined,
        ]) expect(escrowFailureMayHaveLanded(err), String(err)).toBe(true)
    })
})

describe("broadcastEscrowTx", () => {
    it("signs the planned message itself with its gas limit and no automatic retry", async () => {
        const plan = planCreateContract(CLIENT, ESCROW, { freelancer: FREELANCER, title: "Audit", description: "short", milestones: MS })
        await broadcastEscrowTx(plan, "Create escrow: Audit")
        expect(doContractBroadcast).toHaveBeenCalledTimes(1)
        const [msgs, memo, opts] = doContractBroadcast.mock.calls[0] as unknown as [unknown[], string, Record<string, unknown>]
        expect(msgs).toEqual([plan.msg])
        expect(msgs[0]).toBe(plan.msg)
        expect(memo).toBe("Create escrow: Audit")
        expect(opts).toMatchObject({ gasWanted: plan.gasWanted, retry: false })
    })

    it("never reaches the wallet while the services lane is gated, whoever calls it", async () => {
        const plan = planCancelContract(CLIENT, ESCROW, "7")
        gate.escrow = false
        await expect(broadcastEscrowTx(plan, "Cancel")).rejects.toThrow(/not available/)
        gate.escrow = true
        gate.services = false
        await expect(broadcastEscrowTx(plan, "Cancel")).rejects.toThrow(/not available/)
        expect(doContractBroadcast).not.toHaveBeenCalled()
    })

    it("never reaches the wallet with a tampered plan", async () => {
        const plan = tamper(planFundMilestone(CLIENT, ESCROW, "7", 1, 250_000_000), { send: "250000001ugnot" })
        await expect(broadcastEscrowTx(plan, "Fund")).rejects.toThrow()
        expect(doContractBroadcast).not.toHaveBeenCalled()
    })
})
