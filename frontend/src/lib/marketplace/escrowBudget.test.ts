import { describe, expect, it } from "vitest"
import {
    ESCROW_CALL_FULL_SET_GAS,
    ESCROW_CALL_GAS_BASIS,
    ESCROW_CALL_SMALL_SET_GAS,
    ESCROW_FULL_SET_GAS_GROWTH,
    ESCROW_STATE_CALL_STORAGE_BYTES,
    ESCROW_MAX_CALL_GAS,
    ESCROW_MAX_LOOKUP_CALL_GAS,
    ESCROW_FORMAT_LOOKUP_GAS,
    countFormatLookupRunes,
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
 * gnoland-1 runtime pin (e75fef82) against the escrow_v4 production source, with
 * its per-client contract index: the STORAGE DELTA and GAS USED gnokey prints.
 * "Full" means 4,999 other open contracts. Milestone amounts were not recorded
 * for every run, so each point uses the shortest amount the realm accepts
 * ("1000"): that gives the smallest model value, which makes the bound the
 * strictest.
 */
const CREATE_POINTS = [
    { name: "smallest, first contract for the client", title: 1, desc: 0, arg: "m:1000", storage: 6_714, gas: 8_700_000 },
    { name: "smallest, client counter exists", title: 1, desc: 0, arg: "m:1000", storage: 6_689, gas: 11_200_000 },
    { name: "smallest, full set, new client counter", title: 1, desc: 0, arg: "m:1000", storage: 8_874, gas: 28_400_000 },
    { name: "smallest, full set, existing client counter", title: 1, desc: 0, arg: "m:1000", storage: 6_553, gas: 28_600_000 },
    { name: "max ASCII (largest storage)", title: 200, desc: 5000, arg: msArg(20, 200, "1000"), storage: 32_589, gas: 201_800_000 },
    // Every emoji rune (U+1F680, at or above U+FEFF) costs the realm a format-table lookup: 50 + 1,250 + 20 × 50.
    { name: "max 4-byte UTF-8", title: 200, desc: 5000, arg: msArg(20, 200, "1000", "\u{1F680}"), lookups: 2_300, storage: 32_497, gas: 231_500_000 },
    { name: "max 2-byte UTF-8", title: 200, desc: 5000, arg: msArg(20, 200, "1000", "é"), storage: 32_589, gas: 180_400_000 },
    { name: "max 3-byte UTF-8", title: 200, desc: 5000, arg: Array.from({ length: 20 }, () => "日".repeat(66) + "xx:1000").join(","), storage: 32_521, gas: 162_200_000 },
    // Half of the text is characters the realm strips. The builders refuse those, so Memba never sends
    // this; the model still covers it.
    { name: "max, half stripped (most gas)", title: 200, desc: 5000, arg: msArg(20, 200, "1000"), storage: 27_946, gas: 255_500_000 },
]

/**
 * Not measured, derived: the largest contract on the full set adds the full set's
 * extra storage (8,874 − 6,714 B) and gas (28.4M − 8.7M) to the small-set maximum.
 */
const FULL_SET_EXTRA = { storage: 8_874 - 6_714, gas: 28_400_000 - 8_700_000 }

/** Largest storage delta seen per state-changing call (same runs, up to 5,000 open contracts). */
const MEASURED_STORAGE: Record<EscrowStateFunc, number> = {
    FundMilestone: 238,
    CompleteMilestone: 3,
    ReleaseFunds: 16,
    RaiseDispute: 34,
    CancelContract: 51,
    ClaimRefund: 12,
    ClaimDisputeTimeout: 9,
    ExpireUnfunded: 33,
    ArchiveContract: -6_718,
}

const create = (title: number, desc: number, arg: string, lookups = 0) =>
    createContractBudget({ titleBytes: title, descriptionBytes: desc, milestonesArg: arg, formatLookupRunes: lookups })

describe("escrow_v4 CreateContract model", () => {
    it.each(CREATE_POINTS)("bounds the measured point: $name", (p) => {
        const est = estimateCreateContract({ titleBytes: p.title, descriptionBytes: p.desc, milestonesArg: p.arg, formatLookupRunes: "lookups" in p ? p.lookups : 0 })
        expect(est.storageBytes).toBeGreaterThanOrEqual(p.storage)
        expect(est.gas).toBeGreaterThanOrEqual(p.gas)
    })

    it("bounds the largest contract with 5,000 open ones (derived)", () => {
        const est = estimateCreateContract({ titleBytes: 200, descriptionBytes: 5000, milestonesArg: msArg(20, 200, "1000") })
        expect(est.storageBytes).toBeGreaterThanOrEqual(32_589 + FULL_SET_EXTRA.storage)
        expect(est.gas).toBeGreaterThanOrEqual(255_500_000 + FULL_SET_EXTRA.gas)
        // The limit sent is clamped, and still covers the worst gas.
        expect(create(200, 5000, msArg(20, 200, "1000")).gasWanted).toBeGreaterThanOrEqual(255_500_000 + FULL_SET_EXTRA.gas)
    })

    it("caps are twice the estimate at 100 ugnot per byte, rounded up to 0.01 GNOT; gas is +25 %, rounded up to 1M", () => {
        const arg = "Sketches:5000000,Final files:15000000,Revisions:5000000"
        const est = estimateCreateContract({ titleBytes: 21, descriptionBytes: 400, milestonesArg: arg })
        const budget = create(21, 400, arg)
        expect(budget.maxDepositUgnot).toBe(Math.ceil((est.storageBytes * 2 * 100) / 10_000) * 10_000)
        expect(budget.maxDepositUgnot % 10_000).toBe(0)
        expect(budget.gasWanted).toBe(Math.ceil((est.gas * 1.25) / 1_000_000) * 1_000_000)
    })

    it("the largest contract the builders produce caps at 7.91 GNOT, under the 10 GNOT ceiling", () => {
        const max = create(200, 5000, msArg(20, 200, "999999999999999"))
        expect(max.maxDepositUgnot).toBe(7_910_000)
        expect(max.maxDepositUgnot).toBeLessThanOrEqual(V2_MAX_DEPOSIT_UGNOT)
        expect(depositNeedsOverride(max.maxDepositUgnot)).toBe(false)
        expect(max.gasWanted).toBe(ESCROW_MAX_CALL_GAS)
        expect(ESCROW_MAX_CALL_GAS).toBeLessThanOrEqual(MAX_GAS_WANTED)
    })

    it("pins the smallest contract's budget: 2.21 GNOT cap, 38M gas", () => {
        expect(create(1, 0, "m:1000")).toEqual({ maxDepositUgnot: 2_210_000, gasWanted: 38_000_000 })
        expect(create(1, 0, "m:1000").maxDepositUgnot).toBeGreaterThanOrEqual(2 * 8_874 * 100)
    })

    it("counts the runes the realm looks up in the format table, and only those", () => {
        const cp = (...n: number[]) => String.fromCodePoint(...n)
        expect(countFormatLookupRunes(cp(0x5ff, 0x600, 0x206f, 0x2070))).toBe(2)
        expect(countFormatLookupRunes(cp(0xfefe, 0xfeff, 0x1f680, 0xf0000))).toBe(3)
        expect(countFormatLookupRunes(cp(0xad, 0xac, 0xe9, 0x65e5), "plain ASCII")).toBe(1)
        expect(countFormatLookupRunes(cp(0x627), cp(0x627, 0x628), "a:1000")).toBe(3)
    })

    it("sizes lookup-heavy text above the measured per-lookup cost, with a higher clamp", () => {
        // Emoji: 231.5M measured with 2,300 lookups, +19.7M on the full set.
        const emoji = create(200, 5000, msArg(20, 200, "1000", "\u{1F680}"), 2_300)
        expect(emoji.gasWanted).toBe(ESCROW_MAX_LOOKUP_CALL_GAS)
        expect(emoji.gasWanted).toBeGreaterThanOrEqual(231_500_000 + FULL_SET_EXTRA.gas)
        // Estimated, not measured: maximum-size text of 2-byte runes in U+0600–U+07FF (4,600 lookups).
        // Per-rune walk ~11.9k and base ~125.8M (from 日 162.2M and é 180.4M), lookup ~34.1k (from the emoji point).
        const perRune = (180_400_000 - 162_200_000) / (4_600 - 3_066)
        const base = 162_200_000 - 3_066 * perRune
        const lookup = (231_500_000 - base - 2_300 * perRune) / 2_300
        expect(lookup).toBeLessThan(ESCROW_FORMAT_LOOKUP_GAS)
        const worstArabic = base + 4_600 * (perRune + lookup) + FULL_SET_EXTRA.gas
        expect(worstArabic).toBeGreaterThan(ESCROW_MAX_CALL_GAS) // why lookup-heavy text needs the higher clamp
        const arabic = create(200, 5000, msArg(20, 200, "1000", String.fromCodePoint(0x627)), 4_600)
        expect(arabic.gasWanted).toBe(ESCROW_MAX_LOOKUP_CALL_GAS)
        expect(arabic.gasWanted).toBeGreaterThanOrEqual(worstArabic * 1.2)
        expect(ESCROW_MAX_LOOKUP_CALL_GAS).toBeLessThanOrEqual(MAX_GAS_WANTED)
    })

    it("text without lookups keeps the 350M clamp, and a few lookups add only their cost", () => {
        expect(create(200, 5000, msArg(20, 200, "999999999999999")).gasWanted).toBe(ESCROW_MAX_CALL_GAS)
        const plain = create(10, 0, "m:1000")
        const arabicTitle = create(10, 0, "m:1000", 5)
        expect(arabicTitle.gasWanted - plain.gasWanted).toBeLessThanOrEqual(1_000_000)
        expect(estimateCreateContract({ titleBytes: 10, descriptionBytes: 0, milestonesArg: "m:1000", formatLookupRunes: 5 }).gas -
            estimateCreateContract({ titleBytes: 10, descriptionBytes: 0, milestonesArg: "m:1000" }).gas).toBe(5 * ESCROW_FORMAT_LOOKUP_GAS)
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

    it("the full-set growth is the largest seen (ArchiveContract 7.8M → 26.7M)", () => {
        expect(ESCROW_FULL_SET_GAS_GROWTH).toBe(26_700_000 - 7_800_000)
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

    it("every call stays above the 28.6M measured as the ceiling with 5,000 open contracts", () => {
        for (const f of Object.keys(ESCROW_CALL_GAS_BASIS) as EscrowStateFunc[]) {
            expect(escrowCallBudget(f).gasWanted, f).toBeGreaterThan(28_600_000)
        }
    })

    it("pins the flat per-call budgets", () => {
        expect(Object.fromEntries((Object.keys(MEASURED_STORAGE) as EscrowFunc[]).map((f) => [f, escrowCallBudget(f)]))).toEqual({
            FundMilestone: { gasWanted: 32_000_000, maxDepositUgnot: 200_000 },
            CompleteMilestone: { gasWanted: 32_000_000, maxDepositUgnot: 200_000 },
            ReleaseFunds: { gasWanted: 37_000_000, maxDepositUgnot: 200_000 },
            RaiseDispute: { gasWanted: 32_000_000, maxDepositUgnot: 200_000 },
            CancelContract: { gasWanted: 40_000_000, maxDepositUgnot: 200_000 },
            ClaimRefund: { gasWanted: 34_000_000, maxDepositUgnot: 200_000 },
            ClaimDisputeTimeout: { gasWanted: 37_000_000, maxDepositUgnot: 200_000 },
            ExpireUnfunded: { gasWanted: 33_000_000, maxDepositUgnot: 200_000 },
            ArchiveContract: { gasWanted: 39_000_000, maxDepositUgnot: 200_000 },
        })
    })
})

describe("ArchiveContract refund estimate", () => {
    // Measured archives (contract and client index entry): freed bytes, and the refund the client received.
    const ARCHIVES = [
        { name: "smallest", text: { titleBytes: 1, descriptionBytes: 0, milestoneTitleBytes: [1] }, freed: 6_718, refund: 671_800 },
        { name: "two milestones", text: { titleBytes: 1, descriptionBytes: 0, milestoneTitleBytes: [1, 1] }, freed: 7_610 },
        { name: "largest", text: { titleBytes: 200, descriptionBytes: 5000, milestoneTitleBytes: Array(20).fill(200) }, freed: 32_801, refund: 3_280_100 },
    ]

    it.each(ARCHIVES)("is within 1 % of the measured archive: $name", (a) => {
        const est = estimateArchiveRefundBytes(a.text)
        expect(Math.abs(est - a.freed) / a.freed).toBeLessThan(0.01)
        if (a.refund) expect(Math.abs(estimateArchiveRefundUgnot(a.text) - a.refund) / a.refund).toBeLessThan(0.01)
    })
})
