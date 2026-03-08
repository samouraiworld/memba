/**
 * daoMetadata.test — Tests for DAO Render output parsing.
 *
 * Verifies extraction of description, member count, proposal count
 * from various Render format variations.
 */

import { describe, test, expect } from "vitest"
import { parseDAORender } from "./daoMetadata"

describe("parseDAORender", () => {
    const PATH = "gno.land/r/gov/dao"

    test("returns defaults for null input", () => {
        const result = parseDAORender(PATH, null)
        expect(result).toEqual({
            path: PATH,
            description: "",
            memberCount: 0,
            proposalCount: 0,
            isActive: false,
        })
    })

    test("returns defaults for empty string", () => {
        const result = parseDAORender(PATH, "")
        expect(result.description).toBe("")
        expect(result.memberCount).toBe(0)
        expect(result.proposalCount).toBe(0)
        expect(result.isActive).toBe(false)
    })

    test("extracts member count from 'N members' format", () => {
        const raw = "# GovDAO\n\nA governance DAO for the network.\n\n5 members\n3 proposals"
        const result = parseDAORender(PATH, raw)
        expect(result.memberCount).toBe(5)
    })

    test("extracts proposal count from 'N proposals' format", () => {
        const raw = "# GovDAO\n\nA governance DAO.\n\n12 proposals\n5 members"
        const result = parseDAORender(PATH, raw)
        expect(result.proposalCount).toBe(12)
        expect(result.isActive).toBe(true)
    })

    test("extracts from 'Members: N' format", () => {
        const raw = "# DAO\n\nMembers: 7\nProposals: 3"
        const result = parseDAORender(PATH, raw)
        expect(result.memberCount).toBe(7)
        expect(result.proposalCount).toBe(3)
    })

    test("marks inactive when 0 proposals", () => {
        const raw = "# DAO\n\n0 proposals\n2 members"
        const result = parseDAORender(PATH, raw)
        expect(result.proposalCount).toBe(0)
        expect(result.isActive).toBe(false)
    })

    test("extracts description from first non-heading line", () => {
        const raw = "# GovDAO\n\nThe primary governance DAO for the gno.land network.\n\n5 members"
        const result = parseDAORender(PATH, raw)
        expect(result.description).toBe("The primary governance DAO for the gno.land network.")
    })

    test("truncates description to 200 chars", () => {
        const longDesc = "A".repeat(250)
        const raw = `# DAO\n\n${longDesc}`
        const result = parseDAORender(PATH, raw)
        expect(result.description.length).toBe(200)
    })

    test("skips table lines and separators for description", () => {
        const raw = "# DAO\n---\n| col1 | col2 |\n| --- | --- |\nActual description here.\n3 members"
        const result = parseDAORender(PATH, raw)
        expect(result.description).toBe("Actual description here.")
    })

    test("handles single proposal (singular)", () => {
        const raw = "# DAO\n\n1 proposal\n1 member"
        const result = parseDAORender(PATH, raw)
        expect(result.proposalCount).toBe(1)
        expect(result.memberCount).toBe(1)
        expect(result.isActive).toBe(true)
    })

    test("preserves path in result", () => {
        const customPath = "gno.land/r/demo/custom_dao"
        const result = parseDAORender(customPath, "# Custom\n\n2 members")
        expect(result.path).toBe(customPath)
    })
})
