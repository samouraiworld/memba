import { describe, expect, it } from "vitest"
import {
    ESCROW_CALL_FULL_SET_GAS,
    ESCROW_CALL_GAS_BASIS,
    ESCROW_CALL_SMALL_SET_GAS,
    ESCROW_FULL_SET_GAS_GROWTH,
    ESCROW_STATE_CALL_STORAGE_BYTES,
    ESCROW_MAX_CALL_GAS,
    createContractBudget,
    estimateArchiveRefundBytes,
    estimateArchiveRefundUgnot,
    estimateCreateContract,
    escrowCallBudget,
    type EscrowFunc,
    type EscrowStateFunc,
} from "./escrowBudget"
import { MAX_GAS_WANTED } from "../grc20"
import { V2_MAX_DEPOSIT_UGNOT, depositNeedsOverride } from "../dao/v2Budget"

const bytes = (s: string) => new TextEncoder().encode(s).length
const msArg = (n: number, titleBytes: number, amount: string, char = "M") =>
    Array.from({ length: n }, () => char.repeat(titleBytes / bytes(char)) + ":" + amount).join(",")

/**
 * CreateContract points measured on an in-memory gnoland node built from the
 * gnoland-1 runtime pin (e75fef82) against the escrow_v4 production source: the
 * STORAGE DELTA and GAS USED gnokey prints. "Full" means 4,999 other open
 * contracts. Milestone amounts were not recorded for every run, so each point
 * uses the shortest amount the realm accepts ("1000"): that gives the smallest
 * model value, which makes the bound the strictest.
 */
const CREATE_POINTS = [
    { name: "smallest, first contract for the client", title: 1, desc: 0, arg: "m:1000", storage: 4_672, gas: 8_300_000 },
    { name: "smallest, client counter exists", title: 1, desc: 0, arg: "m:1000", storage: 4_589, gas: 9_800_000 },
    { name: "smallest, full set, new client counter", title: 1, desc: 0, arg: "m:1000", storage: 6_770, gas: 22_000_000 },
    { name: "max ASCII (largest storage)", title: 200, desc: 5000, arg: msArg(20, 200, "1000"), storage: 30_548, gas: 201_300_000 },
    { name: "max 4-byte UTF-8", title: 200, desc: 5000, arg: msArg(20, 200, "1000", "\u{1F680}"), storage: 30_443, gas: 230_500_000 },
    { name: "max 2-byte UTF-8", title: 200, desc: 5000, arg: msArg(20, 200, "1000", "é"), storage: 30_547, gas: 180_000_000 },
    // Half of the text is characters the realm strips. The builders refuse those, so Memba never sends
    // this; the model still covers it.
    { name: "max, half stripped (most gas)", title: 200, desc: 5000, arg: msArg(20, 200, "1000"), storage: 25_904, gas: 255_100_000 },
]

/**
 * Not measured, derived: the largest contract on the full set adds the full set's
 * extra storage (6,770 − 4,672 B) and gas (22.0M − 9.8M) to the small-set maximum.
 */
const FULL_SET_EXTRA = { storage: 6_770 - 4_672, gas: 22_000_000 - 9_800_000 }

/** Largest storage delta seen per state-changing call (same runs, up to 5,000 open contracts). */
const MEASURED_STORAGE: Record<EscrowStateFunc, number> = {
    FundMilestone: 238,
    CompleteMilestone: 3,
    ReleaseFunds: 9,
    RaiseDispute: 34,
    CancelContract: 51,
    ClaimRefund: 5,
    ClaimDisputeTimeout: 1,
    ExpireUnfunded: 27,
    ArchiveContract: -4_671,
}

const create = (title: number, desc: number, arg: string) =>
    createContractBudget({ titleBytes: title, descriptionBytes: desc, milestonesArg: arg })

describe("escrow_v4 CreateContract model", () => {
    it.each(CREATE_POINTS)("bounds the measured point: $name", (p) => {
        const est = estimateCreateContract({ titleBytes: p.title, descriptionBytes: p.desc, milestonesArg: p.arg })
        expect(est.storageBytes).toBeGreaterThanOrEqual(p.storage)
        expect(est.gas).toBeGreaterThanOrEqual(p.gas)
    })

    it("bounds the largest contract with 5,000 open ones (derived)", () => {
        const est = estimateCreateContract({ titleBytes: 200, descriptionBytes: 5000, milestonesArg: msArg(20, 200, "1000") })
        expect(est.storageBytes).toBeGreaterThanOrEqual(30_548 + FULL_SET_EXTRA.storage)
        expect(est.gas).toBeGreaterThanOrEqual(255_100_000 + FULL_SET_EXTRA.gas)
        // The limit sent is clamped, and still covers the worst gas.
        expect(create(200, 5000, msArg(20, 200, "1000")).gasWanted).toBeGreaterThanOrEqual(255_100_000 + FULL_SET_EXTRA.gas)
    })

    it("caps are twice the estimate at 100 ugnot per byte, rounded up to 0.01 GNOT; gas is +25 %, rounded up to 1M", () => {
        const arg = "Sketches:5000000,Final files:15000000,Revisions:5000000"
        const est = estimateCreateContract({ titleBytes: 21, descriptionBytes: 400, milestonesArg: arg })
        const budget = create(21, 400, arg)
        expect(budget.maxDepositUgnot).toBe(Math.ceil((est.storageBytes * 2 * 100) / 10_000) * 10_000)
        expect(budget.maxDepositUgnot % 10_000).toBe(0)
        expect(budget.gasWanted).toBe(Math.ceil((est.gas * 1.25) / 1_000_000) * 1_000_000)
    })

    it("the largest contract the builders produce caps at 7.51 GNOT, under the 10 GNOT ceiling", () => {
        const max = create(200, 5000, msArg(20, 200, "999999999999999"))
        expect(max.maxDepositUgnot).toBe(7_510_000)
        expect(max.maxDepositUgnot).toBeLessThanOrEqual(V2_MAX_DEPOSIT_UGNOT)
        expect(depositNeedsOverride(max.maxDepositUgnot)).toBe(false)
        expect(max.gasWanted).toBe(ESCROW_MAX_CALL_GAS)
        expect(ESCROW_MAX_CALL_GAS).toBeLessThanOrEqual(MAX_GAS_WANTED)
    })

    it("pins the smallest contract's budget: 1.8 GNOT cap, 31M gas", () => {
        expect(create(1, 0, "m:1000")).toEqual({ maxDepositUgnot: 1_810_000, gasWanted: 31_000_000 })
        expect(create(1, 0, "m:1000").maxDepositUgnot).toBeGreaterThanOrEqual(2 * 6_770 * 100)
    })

    it("counts bytes in UTF-8", () => {
        const ascii = create(bytes("x".repeat(8)), 0, "m:1000")
        const emoji = create(bytes("\u{1F680}".repeat(2)), 0, "m:1000")
        expect(emoji).toEqual(ascii)
    })

    it("has no flat budget", () => {
        expect(() => escrowCallBudget("CreateContract")).toThrow()
    })
})

describe("escrow_v4 per-call budgets", () => {
    it("covers every state-changing call Memba signs, including ArchiveContract and ExpireUnfunded", () => {
        expect(Object.keys(ESCROW_CALL_GAS_BASIS).sort()).toEqual(Object.keys(MEASURED_STORAGE).sort())
    })

    it.each(Object.entries(MEASURED_STORAGE))("%s carries a flat cap at least four times its measured storage", (func, measured) => {
        const b = escrowCallBudget(func as EscrowFunc)
        expect(b.maxDepositUgnot).toBe(ESCROW_STATE_CALL_STORAGE_BYTES * 2 * 100)
        expect(ESCROW_STATE_CALL_STORAGE_BYTES).toBeGreaterThanOrEqual(4 * measured)
    })

    it("the full-set growth is the largest seen (ArchiveContract 6.9M → 20.1M)", () => {
        expect(ESCROW_FULL_SET_GAS_GROWTH).toBe(20_100_000 - 6_900_000)
    })

    it.each(Object.keys(ESCROW_CALL_SMALL_SET_GAS))("%s gas basis covers both the full-set measurement and the small-set worst plus growth", (func) => {
        const f = func as EscrowStateFunc
        const basis = ESCROW_CALL_GAS_BASIS[f]
        expect(basis).toBeGreaterThanOrEqual(ESCROW_CALL_FULL_SET_GAS[f] ?? 0)
        expect(basis).toBeGreaterThanOrEqual(ESCROW_CALL_SMALL_SET_GAS[f] + ESCROW_FULL_SET_GAS_GROWTH)
        const b = escrowCallBudget(f)
        expect(b.gasWanted).toBe(Math.ceil((basis * 1.25) / 1_000_000) * 1_000_000)
        expect(b.gasWanted).toBeLessThanOrEqual(ESCROW_MAX_CALL_GAS)
    })

    it("every call stays above the 22.1M the realm's review measured as the ceiling with 5,000 open contracts", () => {
        for (const f of Object.keys(ESCROW_CALL_GAS_BASIS) as EscrowStateFunc[]) {
            expect(escrowCallBudget(f).gasWanted, f).toBeGreaterThan(22_100_000)
        }
    })

    it("pins the flat per-call budgets", () => {
        expect(Object.fromEntries((Object.keys(MEASURED_STORAGE) as EscrowFunc[]).map((f) => [f, escrowCallBudget(f)]))).toEqual({
            FundMilestone: { gasWanted: 25_000_000, maxDepositUgnot: 200_000 },
            CompleteMilestone: { gasWanted: 24_000_000, maxDepositUgnot: 200_000 },
            ReleaseFunds: { gasWanted: 30_000_000, maxDepositUgnot: 200_000 },
            RaiseDispute: { gasWanted: 25_000_000, maxDepositUgnot: 200_000 },
            CancelContract: { gasWanted: 33_000_000, maxDepositUgnot: 200_000 },
            ClaimRefund: { gasWanted: 27_000_000, maxDepositUgnot: 200_000 },
            ClaimDisputeTimeout: { gasWanted: 29_000_000, maxDepositUgnot: 200_000 },
            ExpireUnfunded: { gasWanted: 25_000_000, maxDepositUgnot: 200_000 },
            ArchiveContract: { gasWanted: 31_000_000, maxDepositUgnot: 200_000 },
        })
    })
})

describe("ArchiveContract refund estimate", () => {
    // Measured archives: freed bytes, and the refund the client received (100 ugnot per byte).
    const ARCHIVES = [
        { name: "smallest", text: { titleBytes: 1, descriptionBytes: 0, milestoneTitleBytes: [1] }, freed: 4_671, refund: 467_100 },
        { name: "two milestones", text: { titleBytes: 1, descriptionBytes: 0, milestoneTitleBytes: [1, 1] }, freed: 5_561 },
        { name: "largest", text: { titleBytes: 200, descriptionBytes: 5000, milestoneTitleBytes: Array(20).fill(200) }, freed: 30_753, refund: 3_075_300 },
    ]

    it.each(ARCHIVES)("is within 1 % of the measured archive: $name", (a) => {
        const est = estimateArchiveRefundBytes(a.text)
        expect(Math.abs(est - a.freed) / a.freed).toBeLessThan(0.01)
        if (a.refund) expect(Math.abs(estimateArchiveRefundUgnot(a.text) - a.refund) / a.refund).toBeLessThan(0.01)
    })
})
