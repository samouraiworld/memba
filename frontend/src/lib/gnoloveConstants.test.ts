/**
 * Tests for gnoloveConstants.ts — Teams, TimeFilter, and helpers.
 *
 * @module lib/gnoloveConstants.test
 */

import { describe, it, expect } from "vitest"
import {
    TEAMS, TimeFilter, TIME_FILTER_LABELS, TEAM_CSS_COLORS,
    isTimeFilter, MILESTONE_NUMBER, REPORT_TAB_LABELS,
} from "./gnoloveConstants"

describe("TEAMS", () => {
    it("has 8 teams", () => {
        expect(TEAMS).toHaveLength(8)
    })

    it("each team has name, color, and members", () => {
        for (const team of TEAMS) {
            expect(team.name).toBeTruthy()
            expect(team.color).toBeTruthy()
            expect(team.members.length).toBeGreaterThan(0)
        }
    })

    it("Core Team has expected members", () => {
        const core = TEAMS.find(t => t.name === "Core Team")
        expect(core).toBeDefined()
        expect(core!.members).toContain("moul")
        expect(core!.members).toContain("jaekwon")
    })

    it("Samourai.world team exists", () => {
        const sam = TEAMS.find(t => t.name === "Samourai.world")
        expect(sam).toBeDefined()
        expect(sam!.color).toBe("red")
    })

    it("Samourai.world includes davd-gzl", () => {
        const sam = TEAMS.find(t => t.name === "Samourai.world")
        expect(sam!.members).toContain("davd-gzl")
        expect(sam!.members).not.toContain("Davphla")
    })

    it("Samourai.world includes zxxma, clegirar, omniwired, AmozPay", () => {
        const sam = TEAMS.find(t => t.name === "Samourai.world")
        expect(sam!.members).toContain("zxxma")
        expect(sam!.members).toContain("clegirar")
        expect(sam!.members).toContain("omniwired")
        // AmozPay was added in Phase 1 via the backend teams.yaml; mirrored
        // into the seed here in Phase 3.
        expect(sam!.members).toContain("AmozPay")
    })

    it("Onbloc roster matches the Phase 1 backend fixes", () => {
        const onbloc = TEAMS.find(t => t.name === "Onbloc")
        // Typo fix: dongonw8247 → dongwon8247.
        expect(onbloc!.members).toContain("dongwon8247")
        expect(onbloc!.members).not.toContain("dongonw8247")
        // New members from the operator brief.
        for (const m of ["aronpark1007", "HeesungB", "junghoon-vans", "gihun508443"]) {
            expect(onbloc!.members).toContain(m)
        }
    })

    it("every team has a slug matching the backend teams.yaml", () => {
        const slugs = TEAMS.map(t => t.slug)
        expect(new Set(slugs).size).toBe(slugs.length)
        for (const team of TEAMS) {
            expect(team.slug).toBeTruthy()
            expect(team.slug).toBe(team.slug.toLowerCase())
            expect(team.slug.trim()).toBe(team.slug)
        }
    })
})

describe("TEAMS invariants (lock in)", () => {
    // These tests catch silent drift when the Onbloc/AmozPay-style roster
    // expansion lands. Without them, last-write-wins in loginToTeam.set()
    // (GnoloveHome.tsx) would silently misattribute contributors.

    it("contains no duplicate member logins across teams (case-insensitive)", () => {
        const all = TEAMS.flatMap(t => t.members.map(m => m.toLowerCase()))
        const dupes = all.filter((m, i) => all.indexOf(m) !== i)
        expect(dupes).toEqual([])
    })

    it("uses only documented team colors", () => {
        const allowed = new Set(["blue", "yellow", "purple", "red", "green", "brown", "pink"])
        for (const team of TEAMS) {
            expect(allowed.has(team.color)).toBe(true)
        }
    })

    it("rejects whitespace-only or empty member logins", () => {
        for (const team of TEAMS) {
            for (const member of team.members) {
                expect(member.trim().length).toBeGreaterThan(0)
            }
        }
    })

    it("uses unique team names", () => {
        const names = TEAMS.map(t => t.name)
        expect(new Set(names).size).toBe(names.length)
    })
})

describe("TEAMS invariants (lock in)", () => {
    // These tests catch silent drift when the Onbloc/AmozPay-style roster
    // expansion lands. Without them, last-write-wins in loginToTeam.set()
    // (GnoloveHome.tsx) would silently misattribute contributors.

    it("contains no duplicate member logins across teams (case-insensitive)", () => {
        const all = TEAMS.flatMap(t => t.members.map(m => m.toLowerCase()))
        const dupes = all.filter((m, i) => all.indexOf(m) !== i)
        expect(dupes).toEqual([])
    })

    it("uses only documented team colors", () => {
        const allowed = new Set(["blue", "yellow", "purple", "red", "green", "brown", "pink"])
        for (const team of TEAMS) {
            expect(allowed.has(team.color)).toBe(true)
        }
    })

    it("rejects whitespace-only or empty member logins", () => {
        for (const team of TEAMS) {
            for (const member of team.members) {
                expect(member.trim().length).toBeGreaterThan(0)
            }
        }
    })

    it("uses unique team names", () => {
        const names = TEAMS.map(t => t.name)
        expect(new Set(names).size).toBe(names.length)
    })
})

describe("TEAM_CSS_COLORS", () => {
    it("maps all team colors", () => {
        for (const team of TEAMS) {
            expect(TEAM_CSS_COLORS[team.color]).toBeTruthy()
            expect(TEAM_CSS_COLORS[team.color]).toMatch(/^#/)
        }
    })
})

describe("TimeFilter", () => {
    it("has 4 values", () => {
        expect(Object.values(TimeFilter)).toHaveLength(4)
    })

    it("has corresponding labels", () => {
        for (const value of Object.values(TimeFilter)) {
            expect(TIME_FILTER_LABELS[value]).toBeTruthy()
        }
    })
})

describe("isTimeFilter", () => {
    it("returns true for valid values", () => {
        expect(isTimeFilter("all")).toBe(true)
        expect(isTimeFilter("weekly")).toBe(true)
        expect(isTimeFilter("monthly")).toBe(true)
        expect(isTimeFilter("yearly")).toBe(true)
    })

    it("returns false for invalid values", () => {
        expect(isTimeFilter("daily")).toBe(false)
        expect(isTimeFilter("")).toBe(false)
        expect(isTimeFilter("ALL")).toBe(false)
    })
})

describe("MILESTONE_NUMBER", () => {
    it("is a positive integer", () => {
        expect(MILESTONE_NUMBER).toBeGreaterThan(0)
        expect(Number.isInteger(MILESTONE_NUMBER)).toBe(true)
    })
})

describe("REPORT_TAB_LABELS", () => {
    it("has 5 tabs", () => {
        expect(Object.keys(REPORT_TAB_LABELS)).toHaveLength(5)
    })

    it("includes merged and blocked", () => {
        expect(REPORT_TAB_LABELS.merged).toBe("Merged")
        expect(REPORT_TAB_LABELS.blocked).toBe("Blocked")
    })
})
