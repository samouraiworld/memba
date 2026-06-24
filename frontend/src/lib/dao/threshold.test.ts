import { describe, it, expect } from "vitest"
import { parseDaoThreshold } from "./config"

describe("parseDaoThreshold", () => {
    it("parses the basedao MembersThreshold condition render", () => {
        // daocond.MembersThreshold(0.66).Render() => "66% of members"
        expect(parseDaoThreshold("  - **Condition:** 66% of members")).toBe("66%")
    })

    it("parses the voting-power condition render", () => {
        expect(parseDaoThreshold("50% of total voting power | dev | finance")).toBe("50%")
    })

    it("parses an explicit GovDAO Threshold: line", () => {
        expect(parseDaoThreshold("Threshold: 75%")).toBe("75%")
    })

    it("parses Quorum: line", () => {
        expect(parseDaoThreshold("Quorum: 40%")).toBe("40%")
    })

    it("parses 'Threshold needed: X%'", () => {
        expect(parseDaoThreshold("Threshold needed: 66% of total voting power")).toBe("66%")
    })

    it("parses a decimal threshold", () => {
        expect(parseDaoThreshold("66.7% of members")).toBe("66.7%")
    })

    it("prefers the first resource's condition on a config page", () => {
        const configRender = [
            "- **Resource #0: gov.proposal**",
            "  - **Condition:** 66% of members",
            "- **Resource #1: gov.vote**",
            "  - **Condition:** 66% of members",
        ].join("\n")
        expect(parseDaoThreshold(configRender)).toBe("66%")
    })

    it("returns '' when no threshold is present — never fabricates a default", () => {
        expect(parseDaoThreshold("# Memba DAO\n\nA cool DAO\n\n> Realm address: g1abc")).toBe("")
        expect(parseDaoThreshold("")).toBe("")
    })
})
