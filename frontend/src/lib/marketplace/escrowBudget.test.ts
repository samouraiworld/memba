import { describe, expect, it } from "vitest"
import {
    ESCROW_CALL_MEASURED_GAS,
    ESCROW_STATE_CALL_STORAGE_BYTES,
    ESCROW_MAX_CALL_GAS,
    createContractBudget,
    estimateCreateContract,
    escrowCallBudget,
    type EscrowFunc,
} from "./escrowBudget"
import { MAX_GAS_WANTED } from "../grc20"
import { V2_MAX_DEPOSIT_UGNOT, depositNeedsOverride } from "../dao/v2Budget"

const bytes = (s: string) => new TextEncoder().encode(s).length
const msArg = (n: number, titleBytes: number, amount: string) => Array.from({ length: n }, () => "M".repeat(titleBytes) + ":" + amount).join(",")

/**
 * CreateContract points measured on an in-memory gnoland node built from the
 * gnoland-1 runtime pin (e75fef82) against the deployed escrow_v3 source: the
 * STORAGE DELTA and GAS USED gnokey prints. `contracts` is how many contracts the
 * realm already held (gas grows with the tree; the realm caps it at 500).
 */
const CREATE_POINTS = [
    { name: "first contract, minimal", contracts: 0, title: 1, desc: 0, arg: "m:1000", storage: 3_471, gas: 5_246_199 },
    { name: "typical, 3 milestones", contracts: 1, title: 21, desc: 400, arg: "Sketches:5000000,Final files:15000000,Revisions:5000000", storage: 6_472, gas: 13_681_187 },
    { name: "bulk, 2 milestones", contracts: 43, title: 18, desc: 200, arg: "A:1000000,B:2000000", storage: 5_489, gas: 12_574_332 },
    { name: "one milestone", contracts: 47, title: 8, desc: 1, arg: "Only:1000000", storage: 4_499, gas: 9_020_916 },
    { name: "3 short milestones", contracts: 46, title: 9, desc: 1, arg: "A:1000000,B:1000000,C:1000000", storage: 6_099, gas: 9_701_903 },
    { name: "max ASCII, 15-digit amounts", contracts: 2, title: 200, desc: 5000, arg: msArg(20, 200, "999999999999999"), storage: 28_807, gas: 260_802_380 },
    { name: "max 4-byte UTF-8", contracts: 3, title: 200, desc: 5000, arg: Array.from({ length: 20 }, () => "\u{1F680}".repeat(50) + ":999999999999999").join(","), storage: 28_905, gas: 154_528_190 },
    { name: "max ASCII at 499 contracts", contracts: 499, title: 200, desc: 5000, arg: msArg(20, 200, "1000"), storage: 29_059, gas: 261_288_539 },
    { name: "max ASCII at 498 contracts (twin)", contracts: 498, title: 200, desc: 5000, arg: msArg(20, 200, "1000"), storage: 29_130, gas: 261_188_627 },
]

/** Largest storage delta seen per state-changing call (same runs, up to 500 max-size contracts). */
const MEASURED_STORAGE: Record<Exclude<EscrowFunc, "CreateContract">, number> = {
    FundMilestone: 35,
    CompleteMilestone: 41,
    ReleaseFunds: 2,
    RaiseDispute: 37,
    CancelContract: 43,
    ClaimRefund: 5,
    ClaimDisputeTimeout: 1,
}

const create = (title: number, desc: number, arg: string) =>
    createContractBudget({ titleBytes: title, descriptionBytes: desc, milestonesArg: arg })

describe("escrow storage and gas model", () => {
    it.each(CREATE_POINTS)("CreateContract model bounds the measured point: $name", (p) => {
        const est = estimateCreateContract({ titleBytes: p.title, descriptionBytes: p.desc, milestonesArg: p.arg })
        expect(est.storageBytes).toBeGreaterThanOrEqual(p.storage)
        expect(est.gas).toBeGreaterThanOrEqual(p.gas)
    })

    it("CreateContract caps are twice the estimate at 100 ugnot per byte, rounded up to 0.01 GNOT", () => {
        const est = estimateCreateContract({ titleBytes: 21, descriptionBytes: 400, milestonesArg: CREATE_POINTS[1].arg })
        const budget = create(21, 400, CREATE_POINTS[1].arg)
        expect(budget.maxDepositUgnot).toBe(Math.ceil((est.storageBytes * 2 * 100) / 10_000) * 10_000)
        expect(budget.maxDepositUgnot % 10_000).toBe(0)
        expect(budget.gasWanted).toBe(Math.ceil((est.gas * 1.25) / 1_000_000) * 1_000_000)
    })

    it("the largest contract the realm accepts stays under the 10 GNOT ceiling, so no call needs an override", () => {
        const max = create(200, 5000, msArg(20, 200, "999999999999999"))
        expect(max.maxDepositUgnot).toBe(6_910_000)
        expect(max.maxDepositUgnot).toBeLessThanOrEqual(V2_MAX_DEPOSIT_UGNOT)
        expect(depositNeedsOverride(max.maxDepositUgnot)).toBe(false)
        expect(max.gasWanted).toBeLessThanOrEqual(ESCROW_MAX_CALL_GAS)
        expect(ESCROW_MAX_CALL_GAS).toBeLessThanOrEqual(MAX_GAS_WANTED)
    })

    it("a minimal contract still carries a cap above its measured deposit", () => {
        const min = create(1, 0, "m:1000")
        expect(min.maxDepositUgnot).toBeGreaterThanOrEqual(2 * 3_471 * 100)
        expect(min.gasWanted).toBeGreaterThan(5_246_199)
    })

    it.each(Object.entries(MEASURED_STORAGE))("%s carries a flat cap far above its measured storage", (func, measured) => {
        const b = escrowCallBudget(func as EscrowFunc)
        expect(b.maxDepositUgnot).toBe(ESCROW_STATE_CALL_STORAGE_BYTES * 2 * 100)
        expect(ESCROW_STATE_CALL_STORAGE_BYTES).toBeGreaterThanOrEqual(10 * measured)
    })

    it.each(Object.entries(ESCROW_CALL_MEASURED_GAS))("%s gas limit is the measured maximum plus 25 %%, rounded up to 1M", (func, measured) => {
        const b = escrowCallBudget(func as EscrowFunc)
        expect(b.gasWanted).toBe(Math.ceil((measured * 1.25) / 1_000_000) * 1_000_000)
        expect(b.gasWanted).toBeGreaterThan(measured)
        // The wallet profile default (10M) is too low for most of them; that is why every plan sets one.
        expect(b.gasWanted).toBeLessThanOrEqual(ESCROW_MAX_CALL_GAS)
    })

    it("pins the flat per-call budgets", () => {
        expect(Object.fromEntries((Object.keys(MEASURED_STORAGE) as EscrowFunc[]).map((f) => [f, escrowCallBudget(f)]))).toEqual({
            FundMilestone: { gasWanted: 14_000_000, maxDepositUgnot: 200_000 },
            CompleteMilestone: { gasWanted: 14_000_000, maxDepositUgnot: 200_000 },
            ReleaseFunds: { gasWanted: 17_000_000, maxDepositUgnot: 200_000 },
            RaiseDispute: { gasWanted: 14_000_000, maxDepositUgnot: 200_000 },
            CancelContract: { gasWanted: 21_000_000, maxDepositUgnot: 200_000 },
            ClaimRefund: { gasWanted: 14_000_000, maxDepositUgnot: 200_000 },
            ClaimDisputeTimeout: { gasWanted: 18_000_000, maxDepositUgnot: 200_000 },
        })
    })

    it("CreateContract has no flat budget", () => {
        expect(() => escrowCallBudget("CreateContract")).toThrow()
    })

    it("bytes are counted in UTF-8", () => {
        const ascii = create(bytes("x".repeat(8)), 0, "m:1000")
        const emoji = create(bytes("\u{1F680}".repeat(2)), 0, "m:1000")
        expect(emoji).toEqual(ascii)
    })
})
