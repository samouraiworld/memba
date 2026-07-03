/** W6.3 PR1 — route-meta map + matcher. */
import { describe, it, expect } from "vitest"
import { matchRouteMeta, stripNetworkPrefix, ROUTE_META } from "./routeMeta"

describe("stripNetworkPrefix", () => {
    it("strips the active network segment", () => {
        expect(stripNetworkPrefix("/test13/dao", "test13")).toBe("/dao")
        expect(stripNetworkPrefix("/test13", "test13")).toBe("/")
        expect(stripNetworkPrefix("/test13/dao/my~dao", "test13")).toBe("/dao/my~dao")
    })
    it("leaves non-prefixed paths alone (incl. other networks' names in slugs)", () => {
        expect(stripNetworkPrefix("/dao", "test13")).toBe("/dao")
        expect(stripNetworkPrefix("/test13x/dao", "test13")).toBe("/test13x/dao")
    })
})

describe("matchRouteMeta", () => {
    it("resolves key routes to distinct payloads", () => {
        const dao = matchRouteMeta("/test13/dao", "test13")
        const dir = matchRouteMeta("/test13/directory", "test13")
        expect(dao.title).toContain("DAOs")
        expect(dir.title).toContain("Directory")
        expect(dao.description).not.toBe(dir.description)
    })
    it("specific patterns beat general ones (validators hacker view)", () => {
        expect(matchRouteMeta("/test13/validators/hacker", "test13").title).toContain("Hacker")
        expect(matchRouteMeta("/test13/validators/g1abc", "test13").title).toBe("Validators — Memba")
    })
    it("nested paths inherit their section meta", () => {
        expect(matchRouteMeta("/test13/dao/my~dao/proposals", "test13").title).toContain("DAOs")
    })
    it("unknown routes fall back to the site default (never null)", () => {
        const m = matchRouteMeta("/test13/no-such-page", "test13")
        expect(m.title).toContain("Memba")
        expect(m.description.length).toBeGreaterThan(20)
    })
    it("every entry has a bounded, human description (SEO snippet length)", () => {
        for (const e of ROUTE_META) {
            expect(e.description.length).toBeGreaterThan(40)
            expect(e.description.length).toBeLessThan(180)
            expect(e.title).toMatch(/Memba/)
        }
    })
})
