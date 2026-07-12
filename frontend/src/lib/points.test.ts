import { describe, it, expect, vi, afterEach } from "vitest"
import * as shared from "./dao/shared"
import { getProfile, getTopN, getTopNPage, getTierBands } from "./points"

const A = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"

afterEach(() => vi.restoreAllMocks())

describe("points.ts", () => {
    it("getProfile parses a valid profile + queries ProfileJSON(addr)", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("[raw]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue({
            addr: A, points: 500, tier: "Gold", rank: 1, holders: 3,
        })
        expect(await getProfile(A)).toEqual({ addr: A, points: 500, tier: "Gold", rank: 1, holders: 3 })
        expect(qe.mock.calls[0][2]).toBe(`ProfileJSON(${JSON.stringify(A)})`)
    })

    it("getProfile returns null for a malformed address without querying (injection guard)", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("[raw]")
        expect(await getProfile('g1")+Evil("')).toBeNull()
        expect(qe).not.toHaveBeenCalled()
    })

    it("getProfile returns null on an empty chain response", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue("")
        expect(await getProfile(A)).toBeNull()
    })

    it("getProfile rejects a wrong-shaped payload", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue("[raw]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue({ addr: A }) // missing fields
        expect(await getProfile(A)).toBeNull()
    })

    it("getTopN clamps n to [1,200] and filters junk rows", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("[raw]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue([
            { rank: 1, addr: A, points: 300, tier: "Gold" },
            { rank: 2, addr: "bad" }, // junk → filtered
        ])
        const rows = await getTopN(9999)
        expect(rows).toHaveLength(1)
        expect(rows[0].rank).toBe(1)
        expect(qe.mock.calls[0][2]).toBe("TopN(200)")
    })

    it("getTopN returns [] on an empty response", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue("")
        expect(await getTopN(10)).toEqual([])
    })

    it("getTopNPage passes offset + clamped count", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("[raw]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue([{ rank: 51, addr: A, points: 10, tier: "Bronze" }])
        expect((await getTopNPage(50, 25))[0].rank).toBe(51)
        expect(qe.mock.calls[0][2]).toBe("TopNPage(50, 25)")
    })

    it("getTierBands parses the ladder and filters junk", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue("[raw]")
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue([
            { name: "Bronze", minPoints: 0 },
            { name: "Gold", minPoints: 500 },
            { bogus: true },
        ])
        expect(await getTierBands()).toEqual([
            { name: "Bronze", minPoints: 0 },
            { name: "Gold", minPoints: 500 },
        ])
    })
})
