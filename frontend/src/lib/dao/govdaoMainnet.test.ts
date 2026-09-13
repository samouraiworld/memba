/**
 * GovDAO discovery and parsing against the LIVE gnoland-1 renders.
 *
 * The dao/ parsers were written against test11's `r/gov/dao/v3/memberstore`.
 * Mainnet serves `r/gov/dao/memberstore/v0`, and the governance-readiness panel
 * depends on these parsers reading it correctly — so they are exercised here
 * against verbatim chain output (testdata/gnoland-1, captured with chain
 * identity verified), not against hand-written strings.
 *
 * The tier chips in those renders are full `data:image/svg+xml;base64,…` blobs.
 * Keeping them is the point: a loosely anchored regex could find a phantom tier
 * or address inside base64, and a trimmed fixture would never reveal it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

vi.mock("../rpcFallback", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
}))

import { resilientAbciQuery } from "../rpcFallback"
import { getDAOConfig, parseMemberstoreTiers } from "./config"
import { parseMemberstoreRows } from "./members"
import { clearDaoDialects } from "./shared"

// Resolved from the package root (vitest's cwd) and asserted to exist, so a
// wrong path fails loudly here instead of silently testing an empty string.
const FIXTURES = path.resolve(process.cwd(), "src/lib/dao/testdata/gnoland-1")
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8")

const ROOT = "gno.land/r/gov/dao"
const MEMBERSTORE = "gno.land/r/gov/dao/memberstore/v0"

describe("GovDAO on gnoland-1 (live render fixtures)", () => {
    beforeEach(() => {
        vi.mocked(resilientAbciQuery).mockReset()
        clearDaoDialects()
    })

    it("has the fixtures it claims to test", () => {
        for (const f of ["govdao-root.md", "memberstore-summary.md", "memberstore-members.md"]) {
            expect(existsSync(path.join(FIXTURES, f)), f).toBe(true)
        }
        // The base64 chips must actually be present, or the phantom-match cases
        // below prove nothing.
        expect(fixture("memberstore-summary.md")).toContain("base64,")
        expect(fixture("memberstore-members.md")).toContain("base64,")
    })

    it("discovers the v0 memberstore from the GovDAO root and reads its tiers", async () => {
        vi.mocked(resilientAbciQuery).mockImplementation(async (queryPath: string, data: string) => {
            if (queryPath !== "vm/qrender") return null
            if (data === `${ROOT}:`) return fixture("govdao-root.md")
            if (data === `${MEMBERSTORE}:`) return fixture("memberstore-summary.md")
            return null
        })

        const cfg = await getDAOConfig("https://rpc.example", ROOT)

        expect(cfg).not.toBeNull()
        expect(cfg!.name).toBe("GovDAO")
        // No double slash, no leftover "v3": the link is `(/r/gov/dao/memberstore/v0)`.
        expect(cfg!.memberstorePath).toBe(MEMBERSTORE)
        expect(cfg!.tierDistribution).toEqual([
            { tier: "T1", memberCount: 1, power: 3 },
            { tier: "T2", memberCount: 0, power: 0 },
            { tier: "T3", memberCount: 0, power: 0 },
        ])
        expect(cfg!.memberCount).toBe(1)
        // The root render publishes no threshold; it must not be invented.
        expect(cfg!.threshold).toBe("")
        // Discovery is what drove the second read — not a hardcoded path.
        expect(vi.mocked(resilientAbciQuery)).toHaveBeenCalledWith("vm/qrender", `${MEMBERSTORE}:`, false)
    })

    it("finds exactly three tiers — none hidden in the base64 chips", () => {
        expect(parseMemberstoreTiers(fixture("memberstore-summary.md"))).toHaveLength(3)
    })

    it("finds exactly one member row — not the tier-filter links in the header", () => {
        expect(parseMemberstoreRows(fixture("memberstore-members.md"))).toEqual([
            { tier: "T1", address: "g1aeddlftlfk27ret5rf750d7w5dume3kcsm8r8m" },
        ])
    })

    it("reports no memberstore for a DAO render that links none (negative control)", async () => {
        vi.mocked(resilientAbciQuery).mockImplementation(async (queryPath: string, data: string) =>
            queryPath === "vm/qrender" && data === "gno.land/r/demo/somedao:"
                ? "# Some DAO\n\nA community DAO.\n\n## Members (4)\n- g1aaa\n"
                : null)

        const cfg = await getDAOConfig("https://rpc.example", "gno.land/r/demo/somedao")
        expect(cfg!.memberstorePath).toBe("")
        expect(cfg!.tierDistribution).toEqual([])
    })
})
