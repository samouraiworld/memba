/**
 * getDAOProposals strict-mode probe regression (the GovDAO mobile bug).
 *
 * DAOHome reads proposals with strict=true (W2.2: real failures must surface,
 * not render as a blank card). The W1.4 JSON-first probe passed that strict
 * flag into the GetProposalsJSON() qeval — but GovDAO v3 (gno.land/r/gov/dao)
 * never exported that function, so the chain answers with a VM panic
 * ("name GetProposalsJSON not declared"), the strict probe THREW, and the
 * Render-markdown fallback that exists precisely for GovDAO never ran:
 * every GovDAO page showed "Blockchain query failed" instead of proposals.
 *
 * The fix: the probe is ALWAYS non-strict (missing JSON API is an expected,
 * designed-for condition); strictness is enforced by the fallback Render read,
 * so genuine transport/realm failures still throw for strict callers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { getDAOProposals } from "./proposals"
import { resilientAbciQuery } from "../rpcFallback"

vi.mock("../rpcFallback", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../rpcFallback")>()),
    resilientAbciQuery: vi.fn(),
}))

const mockQuery = vi.mocked(resilientAbciQuery)

const RPC = "https://rpc.example"

/** Minimal GovDAO v3 Render("") page in the format parseProposalList handles. */
const GOVDAO_RENDER_PAGE = `# GovDAO

## Proposals

### [Prop #42 - Add validator node alpha](/r/gov/dao:42)
Author: [@zooma](https://gno.land/u/zooma)
Status: ACTIVE
Tiers eligible to vote: T1, T2, T3
`

/** qeval wire form of a GetProposalsJSON payload (Go-quoted JSON string). */
const QEVAL_JSON = `(${JSON.stringify(JSON.stringify([{ id: 7, title: "From JSON", status: "active" }]))} string)`

const NOT_DECLARED = new Error(
    "ABCI query failed for vm/qeval: VM panic: gno.land/r/gov/dao:0:0: name GetProposalsJSON not declared",
)

beforeEach(() => {
    mockQuery.mockReset()
})

describe("getDAOProposals strict-mode JSON probe", () => {
    it("GovDAO regression: strict read falls back to Render when GetProposalsJSON is not declared", async () => {
        mockQuery.mockImplementation(async (path, _data, strict = false) => {
            if (path === "vm/qeval") {
                // The chain's real behavior for an undeclared name is an ABCI
                // error: strict throws, non-strict nulls. If the probe ever goes
                // back to strict, this throw reproduces the GovDAO breakage.
                if (strict) throw NOT_DECLARED
                return null
            }
            if (path === "vm/qrender") return GOVDAO_RENDER_PAGE
            return null
        })

        const proposals = await getDAOProposals(RPC, "gno.land/r/gov/dao_probe1", true)

        expect(proposals).toHaveLength(1)
        expect(proposals[0]).toMatchObject({ id: 42, title: "Add validator node alpha" })

        // Pin the fix shape itself: the qeval probe must be NON-strict.
        const qevalCalls = mockQuery.mock.calls.filter(([p]) => p === "vm/qeval")
        expect(qevalCalls.length).toBeGreaterThan(0)
        for (const call of qevalCalls) {
            expect(call[2] ?? false).toBe(false)
        }
        // ...while the fallback Render read carries the caller's strict flag.
        const renderCalls = mockQuery.mock.calls.filter(([p]) => p === "vm/qrender")
        expect(renderCalls.some(([, , strict]) => strict === true)).toBe(true)
    })

    it("realms WITH the JSON export still use it (no Render round-trips)", async () => {
        mockQuery.mockImplementation(async (path) => {
            if (path === "vm/qeval") return QEVAL_JSON
            throw new Error("unexpected non-qeval query")
        })

        const proposals = await getDAOProposals(RPC, "gno.land/r/samcrew/dao_probe2", true)

        expect(proposals).toHaveLength(1)
        expect(proposals[0]).toMatchObject({ id: 7, title: "From JSON" })
        expect(mockQuery.mock.calls.every(([p]) => p === "vm/qeval")).toBe(true)
    })

    it("strict callers still see REAL failures: probe nulls, Render transport failure throws", async () => {
        const transportDown = new Error("all RPC endpoints failed")
        mockQuery.mockImplementation(async (path, _data, strict = false) => {
            if (path === "vm/qeval") return null // non-strict probe swallows
            if (path === "vm/qrender") {
                if (strict) throw transportDown
                return null
            }
            return null
        })

        await expect(getDAOProposals(RPC, "gno.land/r/gov/dao_probe3", true)).rejects.toThrow(
            "all RPC endpoints failed",
        )
    })
})
