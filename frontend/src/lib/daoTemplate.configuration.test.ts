import { describe, expect, it } from "vitest"
import { daoStepError, generateDAOCode, type DAOCreationConfig } from "./daoTemplate"

const alice = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const bob = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const config = (change: Partial<DAOCreationConfig> = {}): DAOCreationConfig => ({
    name: "Founding DAO", description: "Configuration contract", realmPath: "gno.land/r/test/founding",
    members: [{ address: alice, power: 2, roles: ["admin"] }, { address: bob, power: 1, roles: ["member"] }],
    roles: ["admin", "member"], proposalCategories: ["governance"], threshold: 51, quorum: 0,
    votingPeriodSeconds: 86400, executionDelaySeconds: 3600, executionWindowSeconds: 86400, ...change,
})

describe("DAO founding configuration must match the reviewed roster", () => {
    it("rejects duplicate addresses instead of overwriting the first member", () => {
        const d = config({ members: [{ address: alice, power: 2, roles: ["admin"] }, { address: alice, power: 1, roles: ["member"] }] })
        expect(daoStepError(2, d)).toMatch(/duplicate/i)
        expect(() => generateDAOCode(d)).toThrow(/duplicate/i)
    })
    it.each([
        { members: [] },
        { members: [{ address: "", power: 1, roles: ["admin"] }] },
        { members: [{ address: alice, power: 1, roles: ["admin"] }, { address: "invalid", power: 4, roles: [] }] },
    ])("refuses to silently drop members: %j", change => {
        expect(() => generateDAOCode(config(change))).toThrow(/member|address/i)
    })
    // v2: every member needs voting power >= 1, and no admin role is required
    // because roles grant no powers.
    it("requires positive power for every member but no admin", () => {
        expect(() => generateDAOCode(config({ members: [{ address: alice, power: 1, roles: [] }] }))).not.toThrow()
        const d = config({ members: [{ address: alice, power: 0, roles: ["admin"] }] })
        expect(daoStepError(2, d)).toMatch(/power/i)
        expect(() => generateDAOCode(d)).toThrow(/power/i)
    })
    it.each([
        { roles: [] }, { roles: ["admin", "BAD ROLE"] },
        { roles: ["admin", "admin"] }, { proposalCategories: [] },
        { proposalCategories: ["governance", "bad-category"] }, { proposalCategories: ["governance", "governance"] },
        { members: [{ address: alice, power: 1, roles: ["admin", "undeclared"] }] },
    ])("rejects invalid role/category configuration: %j", change => {
        expect(() => generateDAOCode(config(change))).toThrow(/role|categor/i)
    })
    it.each(["123dao", "for", "return"])("rejects an invalid Gno package name: %s", name => {
        const d = config({ realmPath: `gno.land/r/test/${name}` })
        expect(daoStepError(1, d)).toMatch(/package|identifier|reserved/i)
        expect(() => generateDAOCode(d)).toThrow(/package|identifier|reserved/i)
    })
    it("preserves a valid roster including role-less members", () => {
        const d = config({ members: [{ address: alice, power: 2, roles: ["admin"] }, { address: bob, power: 1, roles: [] }] })
        expect(daoStepError(2, d)).toBeNull()
        const code = generateDAOCode(d)
        expect(code).toContain(`addGenesisMember("${alice}", 2, []string{"admin"})`)
        expect(code).toContain(`addGenesisMember("${bob}", 1, []string{})`)
    })
})
