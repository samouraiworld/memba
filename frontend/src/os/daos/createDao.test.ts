import { afterEach, describe, expect, it } from "vitest"
import { generateDAOCode } from "../../lib/daoTemplate"
import {
    applyPreset, clearDaoDraft, daoConfig, daoDraftError, emptyDaoDraft, firstInvalidStep, formatSeconds, readDaoDraft, realmPathFor,
    saveDaoDraft, slugForName, soloMembers, totalPower, type DaoDraft,
} from "./createDao"

const ME = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"
const OTHER = "g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj"

const named = (over: Partial<DaoDraft> = {}): DaoDraft => ({ ...emptyDaoDraft(ME), name: "Gno Builders", ...over })

afterEach(() => localStorage.clear())

describe("the realm path", () => {
    it("is derived from the name as on the classic page", () => {
        expect(slugForName("Gno Builders!")).toBe("gno_builders_")
        expect(slugForName("")).toBe("mydao")
        expect(slugForName("A very long DAO name indeed")).toBe("a_very_long_dao_name")
        expect(realmPathFor(ME, "Team")).toBe(`gno.land/r/${ME}/team`)
    })

    it("stays a valid package identifier when the name starts with a digit", () => {
        expect(slugForName("42 club")).toBe("dao_42_club")
        expect(daoDraftError(named({ name: "42 club" }), ME, 0)).toBeNull()
    })
})

describe("step validation (the classic daoStepError)", () => {
    it("Basics needs a 3–64 character name", () => {
        expect(daoDraftError(named({ name: "ab" }), ME, 0)).toMatch(/at least 3/)
        expect(daoDraftError(named({ description: "x".repeat(1001) }), ME, 0)).toMatch(/1000/)
        expect(daoDraftError(named(), ME, 0)).toBeNull()
    })

    it("Members refuses bad, duplicate and powerless rows; an untouched row isn't a member", () => {
        const d = named()
        expect(daoDraftError({ ...d, members: [...d.members, { address: "", powerText: "1", role: "member" }] }, ME, 1)).toBeNull()
        expect(daoDraftError({ ...d, members: [...d.members, { address: "g1nope", powerText: "1", role: "member" }] }, ME, 1)).toMatch(/valid g1/)
        expect(daoDraftError({ ...d, members: [...d.members, { address: ME, powerText: "1", role: "member" }] }, ME, 1)).toMatch(/Duplicate/)
        expect(daoDraftError({ ...d, members: [{ ...d.members[0], powerText: "0" }] }, ME, 1)).toMatch(/whole number/)
    })

    it("Rules keeps the threshold in 51–100 and at least one category", () => {
        expect(daoDraftError(named({ threshold: 50 }), ME, 2)).toMatch(/51 and 100/)
        expect(daoDraftError(named({ categories: [] }), ME, 2)).toMatch(/category/)
        expect(firstInvalidStep(named({ threshold: 50 }), ME)).toBe(2)
        expect(firstInvalidStep(named(), ME)).toBeNull()
    })
})

describe("presets and the generated contract", () => {
    it("applies a preset's rules and labels, first member admin", () => {
        const d = applyPreset({ ...named(), members: [{ address: ME, powerText: "1", role: "dev" }, { address: OTHER, powerText: "1", role: "admin" }] }, "enterprise")
        expect(d).toMatchObject({ preset: "enterprise", threshold: 66, quorum: 50, categories: ["governance", "membership", "operations"] })
        expect(d.members.map((m) => m.role)).toEqual(["admin", "member"])
    })

    it("builds the exact configuration the classic generator accepts", () => {
        const d = named({ members: [{ address: ME, powerText: "3", role: "admin" }, { address: OTHER, powerText: "1", role: "member" }] })
        const config = daoConfig(d, ME)
        expect(config).toMatchObject({
            realmPath: `gno.land/r/${ME}/gno_builders`, threshold: 51, quorum: 33, roles: ["admin", "dev", "member"],
            members: [{ address: ME, power: 3, roles: ["admin"] }, { address: OTHER, power: 1, roles: ["member"] }],
            votingPeriodSeconds: 2 * 86_400,
        })
        expect(generateDAOCode(config)).toContain("package gno_builders")
    })

    it("flags members who can pass proposals alone", () => {
        const d = named({ members: [{ address: ME, powerText: "3", role: "admin" }, { address: OTHER, powerText: "1", role: "member" }] })
        expect(soloMembers(d)).toEqual([ME])
        expect(totalPower(d)).toBe(4)
    })

    it("formats preset windows", () => {
        expect(formatSeconds(86_400)).toBe("1 day")
        expect(formatSeconds(7 * 86_400)).toBe("7 days")
        expect(formatSeconds(3600)).toBe("1 hour")
        expect(formatSeconds(24 * 3600)).toBe("1 day")
    })
})

describe("the draft", () => {
    it("is kept per network and wallet, and ignores anything malformed", () => {
        saveDaoDraft("gnoland-1", ME, named())
        expect(readDaoDraft("gnoland-1", ME)?.name).toBe("Gno Builders")
        expect(readDaoDraft("gnoland-1", OTHER)).toBeNull()
        localStorage.setItem(`memba_os_dao_draft:gnoland-1:${OTHER}`, JSON.stringify({ name: 1 }))
        expect(readDaoDraft("gnoland-1", OTHER)).toBeNull()
        clearDaoDraft("gnoland-1", ME)
        expect(readDaoDraft("gnoland-1", ME)).toBeNull()
    })

    it("drops a role the preset no longer has", () => {
        saveDaoDraft("gnoland-1", ME, named({ preset: "basic", members: [{ address: ME, powerText: "1", role: "finance" }] }))
        expect(readDaoDraft("gnoland-1", ME)?.members[0].role).toBe("admin")
    })
})
