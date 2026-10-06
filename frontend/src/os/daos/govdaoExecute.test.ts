import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** gnoland-1's answer to qeval gno.land/r/gov/dao.dao (2026-10-06), its ref shortened. */
const ACTIVE_V0 = vi.hoisted(() => "(&(struct{(ref(01bb…:68) gno.land/r/gov/dao/impl/v0.ProposalsStatuses),(&<nil> *gno.land/r/gov/dao/impl/v0.render)} gno.land/r/gov/dao/impl/v0.GovDAO) *gno.land/r/gov/dao/impl/v0.GovDAO)")
const chain = vi.hoisted(() => ({
    page: null as string | null, tx: false as boolean | "failed",
    allowed: '(slice[("gno.land/r/gov/dao/impl/v0" string)] []string)' as string | null, law: "(66.66 float64)" as string | null,
    active: ACTIVE_V0 as string | null,
}))
vi.mock("../../lib/dao/shared", async (orig) => ({
    ...(await orig<typeof import("../../lib/dao/shared")>()),
    queryRender: vi.fn(async () => chain.page),
    queryEval: vi.fn(async (_rpc: string, pkg: string, expr: string) => (pkg === "gno.land/r/gov/dao" && expr === "AllowedDAOs()" ? chain.allowed
        : pkg === "gno.land/r/gov/dao" && expr === "dao" ? chain.active
            : expr === "law.Supermajority" && pkg === "gno.land/r/gov/dao/impl/v0" ? chain.law : null)),
}))
vi.mock("../../lib/grc20", async (orig) => ({
    ...(await orig<typeof import("../../lib/grc20")>()),
    networkGasPriceFresh: vi.fn(async () => ({ gas: 1000, ugnot: 1 })),
}))
vi.mock("../wallet/sendRequest", async (orig) => ({
    ...(await orig<typeof import("../wallet/sendRequest")>()),
    verifySendTx: vi.fn(async () => chain.tx),
}))

import { queryEval, queryRender } from "../../lib/dao/shared"
import { executeScope } from "./executeRequest"
import { GOVDAO_REALM, govDaoExecuteRequest, govDaoResolution, parseGovDaoStats, plainReason, readGovDaoSupermajority, readGovDaoTally, type GovDaoExecuteContext, type GovDaoTally } from "./govdaoExecute"

/** A GovDAO proposal page as impl/v0 renders it (types.gno), with the given Stats lines. */
const page = (stats: string, description = "Upsert operator g1manfred47kzduec920z88wfr64ylksmdcedlf5 to voting power 1.") => `## Prop #10 - Set validator moul to voting power 1
Author: [@moul](/u/moul)

${description}

Executor created in: \`gno.land/r/sys/validators/v0\`

---

### Stats
${stats}
- Tiers eligible to vote: T1, T2, T3
- YES PERCENT: 33.33333333333333%
- NO PERCENT: 0%
- ABSTAIN PERCENT: 0%

[Detailed voting list](/r/gov/dao:10/votes)

---

### Actions
`
const withTally = (head: string, yes: string, no: string, extra = "") => `### Stats
${head}
${extra}- Tiers eligible to vote: T1, T2, T3
- YES PERCENT: ${yes}%
- NO PERCENT: ${no}%
- ABSTAIN PERCENT: 0%
`
const OPEN = "- **Proposal is open for votes**"

describe("parseGovDaoStats", () => {
    it("reads gnoland-1's open proposal #10 (captured 2026-10-06) and the accepted #4 capture", () => {
        expect(parseGovDaoStats(page(OPEN))).toEqual({ state: "open", reason: null, yes: 33.33333333333333, no: 0, abstain: 0 })
        const captured = readFileSync(resolve(__dirname, "../../lib/dao/testdata/gnoland-1/govdao-proposal-4.md"), "utf-8")
        expect(parseGovDaoStats(captured)).toEqual({ state: "accepted", reason: null, yes: 66.66666666666666, no: 0, abstain: 0 })
    })

    it("reads a denial and its reason", () => {
        expect(parseGovDaoStats(withTally("- **PROPOSAL HAS BEEN DENIED**", "100", "0", "REASON: execution failed: validator not found\n")))
            .toEqual({ state: "denied", reason: "execution failed: validator not found", yes: 100, no: 0, abstain: 0 })
    })

    it("reads only the realm's own Stats section, never one written into the proposal's text", () => {
        const fake = withTally("- **PROPOSAL HAS BEEN ACCEPTED**", "100", "0")
        expect(parseGovDaoStats(page(OPEN, fake))).toMatchObject({ state: "open", yes: 33.33333333333333 })
    })

    it("refuses a page without the exact shape", () => {
        expect(parseGovDaoStats("# GovDAO\nNo proposals yet.")).toBeNull()
        expect(parseGovDaoStats(withTally("- **Something else**", "50", "0"))).toBeNull()
        expect(parseGovDaoStats(withTally(OPEN, "abc", "0"))).toBeNull()
        expect(parseGovDaoStats(withTally(OPEN, "120", "0"))).toBeNull()
    })
})

describe("govDaoResolution", () => {
    const t = (yes: number, no: number, state: GovDaoTally["state"] = "open", supermajority = 66.66) => ({ tally: { state, reason: null, yes, no, abstain: 0 }, supermajority })
    it("holds the tally to the law read from the chain", () => {
        expect(govDaoResolution(t(70, 0, "open", 75))).toBeNull()
        expect(govDaoResolution(t(75, 0, "open", 75))).toBe("execute")
    })

    it("is the contract's rule: YES or NO at 66.66% or more, on an open proposal", () => {
        expect(govDaoResolution(t(66.66, 0))).toBe("execute")
        expect(govDaoResolution(t(66.66666666666666, 0))).toBe("execute")
        expect(govDaoResolution(t(66.65999, 0))).toBeNull()
        expect(govDaoResolution(t(0, 66.66))).toBe("close")
        expect(govDaoResolution(t(33.3, 33.3))).toBeNull()
        expect(govDaoResolution(t(100, 0, "accepted"))).toBeNull()
        expect(govDaoResolution(t(0, 100, "denied"))).toBeNull()
    })
})

const CALLER = "g1caller"
const ctx = (tally: GovDaoTally, over: Partial<GovDaoExecuteContext> = {}): GovDaoExecuteContext => ({
    id: 10, title: "Set validator moul to voting power 1", state: { tally, supermajority: 66.66 },
    caller: CALLER, gasPrice: { gas: 1000, ugnot: 1 }, refresh: vi.fn(), ...over,
})
const PASSING: GovDaoTally = { state: "open", reason: null, yes: 100, no: 0, abstain: 0 }
const REFUSING: GovDaoTally = { state: "open", reason: null, yes: 0, no: 100, abstain: 0 }

beforeEach(() => {
    chain.page = withTally(OPEN, "100", "0")
    chain.tx = false
    chain.allowed = '(slice[("gno.land/r/gov/dao/impl/v0" string)] []string)'
    chain.law = "(66.66 float64)"
    chain.active = ACTIVE_V0
    vi.mocked(queryEval).mockClear()
    vi.mocked(queryRender).mockClear()
})

describe("govDaoExecuteRequest", () => {
    it("signs ExecuteOrRejectProposal on r/gov/dao, says what it does, and keeps a receipt", () => {
        const req = govDaoExecuteRequest(ctx(PASSING))
        // The measured cap bounds what the proposal's code can charge its caller (the chain's default is 100 GNOT).
        expect(req.prepare(undefined).msgs).toEqual([{ type: "vm/MsgCall", value: { caller: CALLER, send: "", pkg_path: GOVDAO_REALM, func: "ExecuteOrRejectProposal", args: ["10"], max_deposit: "1000000ugnot" } }])
        expect(req.title).toBe("Execute")
        expect(req.lines(undefined)).toEqual(expect.arrayContaining([
            ["Effect", "Runs the proposal's action with GovDAO's authority"],
            ["Yes", "100% (needs 66.66%)"],
            ["Storage deposit", "up to 1 GNOT, paid by you for what the proposal's action stores"],
            ["Network fee", "0.0432 GNOT"],
        ]))
        expect(req.warns).toContain("If the action needs more than 36M gas or 1 GNOT of storage, the chain refuses this transaction: the proposal stays open and the network fee is still charged.")
        expect(req.warns).toContain("If the proposal's action fails, GovDAO marks the proposal denied instead. Your transaction still goes through and pays the network fee.")
        expect(req.receipt).toEqual(executeScope(GOVDAO_REALM, CALLER, 10))
        expect(govDaoExecuteRequest(ctx(REFUSING)).title).toBe("Close as rejected")
    })

    it("refuses to build while neither side has the supermajority", () => {
        expect(() => govDaoExecuteRequest(ctx({ state: "open", reason: null, yes: 66.6, no: 0, abstain: 0 }))).toThrow("supermajority")
    })

    it("refuses before signing when GovDAO's law or implementation changed", async () => {
        chain.law = "(75 float64)"
        chain.page = withTally(OPEN, "70", "0")
        await expect(govDaoExecuteRequest(ctx({ state: "open", reason: null, yes: 70, no: 0, abstain: 0 })).recheck!(undefined)).rejects.toThrow("changed since you opened this")
        // Still executable, but the review's "(needs 66.66%)" would no longer be true.
        chain.law = "(60 float64)"
        chain.page = withTally(OPEN, "100", "0")
        await expect(govDaoExecuteRequest(ctx(PASSING)).recheck!(undefined)).rejects.toThrow("changed since you opened this")
        chain.law = "(66.66 float64)"
        chain.allowed = '(slice[("gno.land/r/gov/dao/impl/v1" string)] []string)'
        await expect(govDaoExecuteRequest(ctx(PASSING)).recheck!(undefined)).rejects.toThrow("implementation isn't the one Memba knows")
        chain.allowed = '(slice[("gno.land/r/gov/dao/impl/v0" string)] []string)'
        chain.active = "(&(struct{} gno.land/r/gov/dao/impl/v1.GovDAO) *gno.land/r/gov/dao/impl/v1.GovDAO)"
        await expect(govDaoExecuteRequest(ctx(PASSING)).recheck!(undefined)).rejects.toThrow("implementation isn't the one Memba knows")
    })

    it("re-reads the tally before signing and stops when the proposal changed", async () => {
        const c = ctx(PASSING)
        await expect(govDaoExecuteRequest(c).recheck!(undefined)).resolves.toBeUndefined()
        expect(queryRender).toHaveBeenCalledWith(expect.any(String), GOVDAO_REALM, "10", true)
        chain.page = withTally("- **PROPOSAL HAS BEEN ACCEPTED**", "100", "0")
        await expect(govDaoExecuteRequest(c).recheck!(undefined)).rejects.toThrow("changed since you opened this")
        expect(c.refresh).toHaveBeenCalled()
        chain.page = withTally(OPEN, "66.6", "0")
        await expect(govDaoExecuteRequest(ctx(PASSING)).recheck!(undefined)).rejects.toThrow("changed")
        chain.page = null
        await expect(govDaoExecuteRequest(ctx(PASSING)).recheck!(undefined)).rejects.toThrow("couldn't be read")
    })

    it("confirms an execution only when GovDAO reads it accepted", async () => {
        const req = govDaoExecuteRequest(ctx(PASSING))
        chain.tx = true
        chain.page = withTally("- **PROPOSAL HAS BEEN ACCEPTED**", "100", "0")
        await expect(req.verify!(undefined, "AB", undefined)).resolves.toBe(true)
    })

    it("never reports an action that failed as success: GovDAO denied it while the transaction went through", async () => {
        const req = govDaoExecuteRequest(ctx(PASSING))
        chain.tx = true
        chain.page = withTally("- **PROPOSAL HAS BEEN DENIED**", "100", "0", "REASON: execution failed: validator not found\n")
        await expect(req.verify!(undefined, "AB", undefined)).resolves.toBe("failed")
        expect(req.failedTitle!()).toBe("Denied by GovDAO")
        expect(req.failedNote!()).toBe("the proposal's action failed, so GovDAO marked proposal #10 denied (execution failed: validator not found). Your transaction went through and paid the network fee; the action did not take effect.")
        // No reason: NO can also win between the re-check and the block.
        chain.page = withTally("- **PROPOSAL HAS BEEN DENIED**", "60", "70")
        await expect(req.verify!(undefined, "AB", undefined)).resolves.toBe("failed")
        expect(req.failedNote!()).toBe("GovDAO marked proposal #10 denied: its action did not run. Your transaction went through and paid the network fee.")
    })

    it("confirms a close only when GovDAO reads it denied", async () => {
        const req = govDaoExecuteRequest(ctx(REFUSING))
        chain.tx = true
        chain.page = withTally("- **PROPOSAL HAS BEEN DENIED**", "0", "100")
        await expect(req.verify!(undefined, "AB", undefined)).resolves.toBe(true)
        expect(req.failedTitle!()).toBeUndefined()
    })

    it("says who got there first when the chain refused the transaction", async () => {
        const req = govDaoExecuteRequest(ctx(PASSING))
        chain.tx = "failed"
        chain.page = withTally("- **PROPOSAL HAS BEEN ACCEPTED**", "100", "0")
        await expect(req.verify!(undefined, "AB", undefined)).resolves.toBe("failed")
        expect(req.failedNote!()).toContain("resolved by another transaction first")
        expect(req.failedTitle!()).toBeUndefined()
        chain.page = withTally(OPEN, "100", "0")
        await expect(req.verify!(undefined, "AB", undefined)).resolves.toBe("failed")
        expect(req.failedNote!()).toContain("is still open")
        chain.page = null
        await expect(req.verify!(undefined, "AB", undefined)).resolves.toBe("failed")
        expect(req.failedNote!()).toContain("state couldn't be read right now")
    })

    it("waits while the transaction or the new state isn't visible yet", async () => {
        const req = govDaoExecuteRequest(ctx(PASSING))
        chain.tx = false
        await expect(req.verify!(undefined, "AB", undefined)).resolves.toBe(false)
        chain.tx = true
        chain.page = withTally(OPEN, "100", "0")
        await expect(req.verify!(undefined, "AB", undefined)).resolves.toBe(false)
        expect(req.pendingNote!()).toContain("Don't send it again")
    })
})

describe("readGovDaoSupermajority", () => {
    it("reads the law of the implementation Memba knows, and refuses to guess otherwise", async () => {
        await expect(readGovDaoSupermajority()).resolves.toBe(66.66)
        chain.law = "(0 float64)"
        await expect(readGovDaoSupermajority()).rejects.toThrow("couldn't be read")
        chain.law = null
        await expect(readGovDaoSupermajority()).rejects.toThrow("couldn't be read")
        chain.law = "(66.66 float64)"
        chain.allowed = '(slice[("gno.land/r/gov/dao/impl/v0" string),("gno.land/r/gov/dao/impl/v1" string)] []string)'
        await expect(readGovDaoSupermajority()).rejects.toThrow("implementation")
        expect(queryEval).toHaveBeenCalledWith(expect.any(String), "gno.land/r/gov/dao/impl/v0", "law.Supermajority", true)
    })
})

describe("plainReason", () => {
    it("drops the markdown escapes the realm adds", () => {
        expect(plainReason("execution failed: power \\(1\\) \\* not\\_allowed \\<b\\>")).toBe("execution failed: power (1) * not_allowed <b>")
    })
})

describe("readGovDaoTally", () => {
    it("reads the chain-checked render of the proposal, and nothing from a page of another shape", async () => {
        chain.page = page(OPEN)
        await expect(readGovDaoTally(10)).resolves.toMatchObject({ state: "open", yes: 33.33333333333333 })
        chain.page = "# Prop #4\nStatus: ACTIVE"
        await expect(readGovDaoTally(4)).resolves.toBeNull()
    })
})
