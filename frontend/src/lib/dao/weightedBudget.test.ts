import { describe, expect, it } from "vitest"
import measurements from "./testdata/weighted-v12/budget.json"
import native from "./testdata/weighted-v12/native.json"
import exportsText from "./testdata/weighted-v12/realm-exports.txt?raw"
import { V12_BUDGET_MARGIN, V12_CALL_BUDGETS, V12_EXECUTE_BUDGETS, V12_EXECUTE_FALLBACK, v12BudgetWithinCeiling, v12CallBudget, v12ExecuteBudget, v12ExecuteKey, type WeightedCallBudget } from "./weightedBudget"
import { ACCEPT_FUNCS } from "./weightedApplications"
import { V2_MAX_DEPOSIT_UGNOT } from "./v2Budget"
import { MAX_GAS_WANTED } from "../grc20"

type Call = { run: string; func: string; gasUsed: number; depositUgnot: number; operation?: string; choice?: string; ballot?: string }
const calls = measurements.calls as Call[]
const exported = exportsText.split("\n").filter(l => l && !l.startsWith("#")).map(l => l.split(" ")[1].split("(")[0])

/** The documented rule: 1.5 × the highest gas (up to 100k); 1.5 × the highest positive deposit (up to 10k), at least 10k. */
function derive(points: Call[]): WeightedCallBudget {
    const gas = Math.max(...points.map(c => c.gasUsed))
    const deposit = Math.max(0, ...points.map(c => c.depositUgnot))
    return {
        gasWanted: Math.ceil(gas * V12_BUDGET_MARGIN / 100_000) * 100_000,
        maxDepositUgnot: Math.max(10_000, Math.ceil(deposit * V12_BUDGET_MARGIN / 10_000) * 10_000),
    }
}
const group = (key: (c: Call) => string | null) => {
    const out = new Map<string, Call[]>()
    for (const c of calls) { const k = key(c); if (k !== null) out.set(k, [...(out.get(k) ?? []), c]) }
    return out
}

describe("weighted host v12 call budgets", () => {
    it("records where the measurements come from", () => {
        expect(measurements.provenance.node).toContain("e75fef82c02876a4df92ad6e325c5479b9532168")
        expect(measurements.provenance.node).toContain("storage_price 100")
        expect(new Set(calls.map(c => c.run))).toEqual(new Set(["real", "full"]))
        expect(calls.length).toBeGreaterThan(400)
    })

    it("derives every entry point's budget from its measurements, with the documented margin", () => {
        const byFunc = group(c => c.func === "Execute" ? null : c.func)
        expect(Object.fromEntries([...byFunc].map(([func, points]) => [func, derive(points)]))).toEqual(V12_CALL_BUDGETS)
        const byOperation = group(c => c.func === "Execute" ? c.operation! : null)
        expect(Object.fromEntries([...byOperation].map(([op, points]) => [op, derive(points)]))).toEqual(V12_EXECUTE_BUDGETS)
        expect(derive(calls.filter(c => c.func === "Execute"))).toEqual(V12_EXECUTE_FALLBACK)
    })

    it("covers every measured point with room to spare", () => {
        for (const c of calls) {
            const budget = c.func === "Execute" ? v12ExecuteBudget({ type: c.operation!.split(":")[0], operation: c.operation!.split(":")[1] }) : v12CallBudget(c.func)
            if (c.operation?.startsWith("set-role:")) continue
            expect(budget.gasWanted, c.func).toBeGreaterThanOrEqual(c.gasUsed * 1.5)
            expect(budget.maxDepositUgnot, c.func).toBeGreaterThanOrEqual(c.depositUgnot * 1.5)
        }
        expect(v12ExecuteBudget({ type: "set-role", grant: true })).toEqual(V12_EXECUTE_BUDGETS["set-role:grant"])
    })

    it("names only exported realm functions and budgets every exported mutation", () => {
        for (const func of Object.keys(V12_CALL_BUDGETS)) expect(exported, func).toContain(func)
        const mutations = exported.filter(f => /^(Propose|EmergencyPause|Vote$)/.test(f))
        expect(mutations.filter(f => !(f in V12_CALL_BUDGETS))).toEqual([])
        expect(mutations).toHaveLength(79)
        expect(exported).toHaveLength(87)
    })

    it("stays under the 10 GNOT deposit ceiling and the wallet gas cap", () => {
        for (const budget of [...Object.values(V12_CALL_BUDGETS), ...Object.values(V12_EXECUTE_BUDGETS), V12_EXECUTE_FALLBACK]) {
            expect(v12BudgetWithinCeiling(budget)).toBe(true)
            expect(budget.maxDepositUgnot).toBeLessThanOrEqual(V2_MAX_DEPOSIT_UGNOT)
            expect(budget.gasWanted).toBeLessThanOrEqual(MAX_GAS_WANTED)
        }
        expect(v12BudgetWithinCeiling({ gasWanted: 1, maxDepositUgnot: V2_MAX_DEPOSIT_UGNOT + 1 })).toBe(false)
        expect(v12BudgetWithinCeiling({ gasWanted: 1, maxDepositUgnot: 0 })).toBe(false)
        expect(v12BudgetWithinCeiling({ gasWanted: 1, maxDepositUgnot: 1.5 })).toBe(false)
    })

    it("sizes the ten acceptances, their execution and every ballot as the handoff plan expects", () => {
        const accepts = Object.values(ACCEPT_FUNCS).map(f => v12CallBudget(f))
        expect(Math.min(...accepts.map(b => b.gasWanted))).toBe(24_000_000)
        expect(Math.max(...accepts.map(b => b.gasWanted))).toBe(35_000_000)
        expect(v12CallBudget("ProposeMarketAccept")).toEqual({ gasWanted: 24_000_000, maxDepositUgnot: 2_130_000 })
        expect(v12CallBudget("ProposeEscrowAccept")).toEqual({ gasWanted: 34_200_000, maxDepositUgnot: 4_340_000 })
        expect(accepts.filter(b => b.maxDepositUgnot !== 4_340_000).every(b => b.maxDepositUgnot >= 2_060_000 && b.maxDepositUgnot <= 2_260_000)).toBe(true)
        expect(v12ExecuteBudget({ type: "reviews", operation: "accept-moderator" })).toEqual({ gasWanted: 50_300_000, maxDepositUgnot: 180_000 })
        expect(v12ExecuteBudget({ type: "feedback", operation: "accept-owner" })).toEqual({ gasWanted: 43_500_000, maxDepositUgnot: 500_000 })
        // One Vote budget covers every measured ballot: first, later, crossing, changed, yes/no/abstain.
        const ballots = calls.filter(c => c.func === "Vote")
        expect(new Set(ballots.map(c => c.choice))).toEqual(new Set(["yes", "no", "abstain"]))
        expect(new Set(ballots.map(c => c.ballot))).toEqual(new Set(["vote-first", "vote", "vote-crossing", "vote-after-qualified", "vote-change"]))
        expect(v12CallBudget("Vote")).toEqual({ gasWanted: 24_800_000, maxDepositUgnot: 40_000 })
    })

    it("keys Execute by the stored action and falls back to the largest execution when unmeasured", () => {
        expect(v12ExecuteKey({ type: "set-role", grant: false })).toBe("set-role:remove")
        expect(v12ExecuteKey({ type: "recover-member" })).toBe("recover-member")
        expect(v12ExecuteBudget({ type: "recover-member" })).toEqual(V12_EXECUTE_FALLBACK)
        expect(v12ExecuteBudget({ type: "appstore", operation: "reject" })).toEqual(V12_EXECUTE_FALLBACK)
        expect(v12ExecuteBudget({ type: "constructor", operation: "x" })).toEqual(V12_EXECUTE_FALLBACK)
        expect(() => v12CallBudget("Execute")).toThrow("No measured budget")
        expect(() => v12CallBudget("toString")).toThrow("No measured budget")
        // Every measured execution key is an operation the host records.
        const recorded = new Set(Object.values(native.records as Record<string, { proposal?: { action?: { type: string; operation?: string; grant?: boolean } } }>)
            .flatMap(r => r.proposal?.action ? [v12ExecuteKey(r.proposal.action)] : []))
        expect(Object.keys(V12_EXECUTE_BUDGETS).filter(k => !recorded.has(k))).toEqual([])
    })
})
