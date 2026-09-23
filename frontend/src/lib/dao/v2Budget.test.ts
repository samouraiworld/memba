import { describe, expect, it } from "vitest"
import { MAX_GAS_WANTED } from "../grc20"
import type { DaoAction } from "./builders"
import { depositNeedsOverride, estimateV2Call, formatUgnot, formatUgnotExact, v2CallBudget, V2_MAX_CALL_GAS, V2_MAX_DEPOSIT_UGNOT, type V2ExecuteTarget } from "./v2Budget"

const ROLES = Array.from({ length: 16 }, (_, i) => `r${String(i).padStart(2, "0")}${"x".repeat(27)}`)
const TARGET = "g1f5qqqqqqqqqqqqqqqqqqqqqqqqqqqq05299ypz"
const MAX_TITLE = "€".repeat(128)
const MAX_DESC = "𝄞".repeat(8000)

// Measured on an in-memory gnoland node at 31b6650a (3-member and 99-member DAOs, 16 roles).
// [call, executed action, max gas used, max storage bytes added]
const MEASURED: [DaoAction, V2ExecuteTarget | undefined, number, number][] = [
    [{ type: "propose-text", title: "t", description: "", category: "governance" }, undefined, 10_280_652, 6_724],
    [{ type: "propose-text", title: MAX_TITLE, description: MAX_DESC, category: "governance" }, undefined, 339_833_139, 40_036],
    [{ type: "propose-text", title: "ascii", description: "a".repeat(8000), category: "governance" }, undefined, 85_846_916, 15_254],
    [{ type: "propose-add-member", title: MAX_TITLE, description: MAX_DESC, target: TARGET, power: 1, roles: ROLES }, undefined, 350_348_900, 42_402],
    [{ type: "propose-change-role", title: "shrink", description: "", target: TARGET, roles: [] }, undefined, 15_835_553, 7_626],
    [{ type: "propose-change-role", title: "grow", description: "", target: TARGET, roles: ROLES }, undefined, 23_361_295, 9_602],
    [{ type: "propose-remove-member", title: "rm", description: "", target: TARGET }, undefined, 15_817_113, 7_346],
    [{ type: "propose-archive", title: MAX_TITLE, description: MAX_DESC }, undefined, 342_676_032, 40_021],
    [{ type: "vote", id: 1, vote: "YES" }, undefined, 8_628_567, 1_580],
    [{ type: "execute", id: 1 }, { kind: "text", roles: [] }, 7_356_720, 0],
    [{ type: "execute", id: 1 }, { kind: "add_member", roles: ROLES }, 12_653_046, 4_912],
    [{ type: "execute", id: 1 }, { kind: "set_roles", roles: ROLES }, 11_176_711, 1_477],
    [{ type: "execute", id: 1 }, { kind: "remove_member", roles: [] }, 12_816_457, 0],
    [{ type: "execute", id: 1 }, { kind: "archive", roles: [] }, 8_371_800, 6],
]

describe("version-2 DAO call budgets", () => {
    it.each(MEASURED)("covers the measured cost of %o", (action, executes, gasUsed, storageBytes) => {
        const model = estimateV2Call(action, executes)
        expect(model.gas).toBeGreaterThanOrEqual(gasUsed)
        expect(model.storageBytes).toBeGreaterThanOrEqual(storageBytes)
        const budget = v2CallBudget(action, executes)
        // 20 % headroom on gas at least, and the deposit cap covers twice the measured storage.
        expect(budget.gasWanted).toBeGreaterThanOrEqual(Math.ceil(gasUsed * 1.2))
        expect(budget.maxDepositUgnot).toBeGreaterThanOrEqual(storageBytes * 2 * 100)
    })

    it("stays within the wallet broadcast ceiling for the largest proposal", () => {
        const largest = v2CallBudget({ type: "propose-add-member", title: "\u{10FFFF}".repeat(128), description: MAX_DESC, target: TARGET, power: 1_000_000_000, roles: ROLES })
        expect(largest.gasWanted).toBeLessThanOrEqual(V2_MAX_CALL_GAS)
        expect(V2_MAX_CALL_GAS).toBeLessThanOrEqual(MAX_GAS_WANTED)
    })

    it("sizes short calls far below long ones", () => {
        expect(v2CallBudget({ type: "vote", id: 3, vote: "NO" })).toEqual({ gasWanted: 15_000_000, maxDepositUgnot: 400_000 })
        const short = v2CallBudget({ type: "propose-text", title: "Hello", description: "", category: "governance" })
        expect(short.gasWanted).toBe(26_000_000)
        expect(short.maxDepositUgnot).toBe(1_610_000)
        const long = v2CallBudget({ type: "propose-text", title: MAX_TITLE, description: MAX_DESC, category: "governance" })
        expect(long.gasWanted).toBeGreaterThan(400_000_000)
        expect(long.maxDepositUgnot).toBeLessThan(10_000_000)
    })

    it("formats deposit caps in GNOT", () => {
        expect(formatUgnot(400_000)).toBe("0.4 GNOT")
        expect(formatUgnot(8_830_000)).toBe("8.83 GNOT")
    })

    it("caps the storage deposit of one call at 10 GNOT unless the member explicitly overrides it", () => {
        expect(V2_MAX_DEPOSIT_UGNOT).toBe(10_000_000)
        expect(depositNeedsOverride(10_000_000)).toBe(false)
        expect(depositNeedsOverride(10_000_001)).toBe(true)
        expect(depositNeedsOverride(0)).toBe(false)
    })

    it("keeps every modelled call under the deposit ceiling, so the default flow never needs an override", () => {
        const largest = v2CallBudget({ type: "propose-add-member", title: "\u{10FFFF}".repeat(128), description: MAX_DESC, target: TARGET, power: 1_000_000_000, roles: ROLES })
        expect(depositNeedsOverride(largest.maxDepositUgnot)).toBe(false)
        for (const [action, executes] of MEASURED) expect(depositNeedsOverride(v2CallBudget(action, executes).maxDepositUgnot)).toBe(false)
    })

    it("formats an exact GNOT amount without rounding away a single ugnot", () => {
        expect(formatUgnotExact(10_000_001)).toBe("10.000001 GNOT")
        expect(formatUgnotExact(10_000_000)).toBe("10 GNOT")
        expect(formatUgnotExact(1_610_000)).toBe("1.61 GNOT")
        expect(formatUgnotExact(123_456_789_012)).toBe("123,456.789012 GNOT")
        expect(formatUgnotExact(1)).toBe("0.000001 GNOT")
    })
})
