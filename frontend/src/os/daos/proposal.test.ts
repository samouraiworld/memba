import { describe, expect, it } from "vitest"
import type { DAOMember } from "../../lib/dao"
import { emptyDraft, evaluateProposal, parsePower, proposalEffect } from "./proposal"

const ALICE = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const BOB = "g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c"
const config = { categories: ["governance", "ops"], roles: ["lead", "member"] }
const m = (address: string, votingPower: number, roles: string[] = []): DAOMember => ({ address, votingPower, roles, tier: "", username: "" })
const members = [m(ALICE, 2, ["lead"]), m(BOB, 1)]

describe("evaluateProposal (mirrors the classic form)", () => {
    it("builds a text proposal in the first category by default", () => {
        const e = evaluateProposal({ ...emptyDraft("text"), title: "Adopt the roadmap" }, config, members)
        expect(e.problems).toEqual({})
        expect(e.action).toEqual({ type: "propose-text", title: "Adopt the roadmap", description: "", category: "governance" })
    })

    it("needs a title", () => {
        expect(evaluateProposal(emptyDraft("text"), config, members).problems.title).toBeTruthy()
    })

    it("checks the member address for member proposals", () => {
        const add = (target: string) => evaluateProposal({ ...emptyDraft("add_member"), title: "t", target }, config, members).problems.target
        expect(add("")).toMatch(/Enter the member/)
        expect(add("g1nope")).toMatch(/not a valid/)
        expect(add(ALICE.toUpperCase())).toBeTruthy()
        expect(add(ALICE)).toMatch(/already a member/)
        const remove = (target: string) => evaluateProposal({ ...emptyDraft("remove_member"), title: "t", target }, config, members).problems.target
        expect(remove("g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqz6anv")).toBeTruthy()
    })

    it("refuses removing the last voting power", () => {
        const solo = [m(ALICE, 1)]
        expect(evaluateProposal({ ...emptyDraft("remove_member"), title: "t", target: ALICE }, config, solo).problems.target).toMatch(/without voting power/)
    })

    it("validates voting power and keeps only the DAO's roles", () => {
        expect(parsePower("1,000")).toBe(1000)
        expect(parsePower("0")).toBeNull()
        expect(parsePower("1.5")).toBeNull()
        const e = evaluateProposal({ ...emptyDraft("add_member"), title: "t", target: "g1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqz6anv", powerText: "x" }, config, members)
        expect(e.problems.power).toBeTruthy()
        const roles = evaluateProposal({ ...emptyDraft("change_role"), title: "t", target: BOB, roles: ["lead", "admin"] }, config, members)
        expect(roles.problems.roles).toMatch(/not roles of this DAO/)
    })

    it("describes the effect in one sentence", () => {
        const d = { ...emptyDraft("archive"), title: "t" }
        expect(proposalEffect(d, evaluateProposal(d, config, members), "Team Two")).toBe("Team Two is archived for good. No more proposals.")
    })
})
