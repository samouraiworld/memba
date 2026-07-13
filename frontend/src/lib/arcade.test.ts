import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import * as shared from "./dao/shared"
import { getBoard, submitRun, type ArcadeSubmitBody } from "./arcade"

describe("arcade board reader (qeval)", () => {
    afterEach(() => vi.restoreAllMocks())

    it("reads GetBoardJSON for a day and returns shape-validated entries", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue(`("{...}" string)`)
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue({
            day: "2026-07-13",
            total: 2,
            entries: [
                { addr: "g1alice", day: "2026-07-13", mode: "daily", score: 27150, waves: 5, won: false, overtimeRound: 0, simVersion: 2, stateHash: "abc", inputLogSha256: "def", attestedAt: 100 },
                { addr: "not-an-object" }, // junk row filtered out
            ],
        })
        const rows = await getBoard("2026-07-13", 0, 50)
        expect(rows).toHaveLength(1)
        expect(rows[0].addr).toBe("g1alice")
        expect(rows[0].score).toBe(27150)
        // The exact qeval expression (offset/limit clamped, day JSON-quoted).
        expect(qe.mock.calls[0][2]).toBe(`GetBoardJSON("2026-07-13", 0, 50)`)
    })

    it("rejects a day that isn't a plain YYYY-MM-DD (qeval injection guard)", async () => {
        const qe = vi.spyOn(shared, "queryEval")
        const rows = await getBoard(`2026-07-13") + evil(`, 0, 50)
        expect(rows).toEqual([])
        expect(qe).not.toHaveBeenCalled()
    })

    it("clamps offset/limit and returns [] on an empty/failed read", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("")
        const rows = await getBoard("2026-07-13", -5, 9999)
        expect(rows).toEqual([])
        expect(qe.mock.calls[0][2]).toBe(`GetBoardJSON("2026-07-13", 0, 100)`)
    })

    it("never throws on a malformed realm payload", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue(`("x" string)`)
        for (const bad of [null, {}, { entries: null }, { entries: "nope" }, { entries: 42 }, 7, "str"]) {
            vi.spyOn(shared, "parseQevalJSON").mockReturnValueOnce(bad as never)
            await expect(getBoard("2026-07-13", 0, 50)).resolves.toEqual([])
        }
    })
})

describe("arcade submitRun (REST)", () => {
    const body: ArcadeSubmitBody = {
        seed: "barricade-2026-07-13",
        simVersion: 2,
        events: [{ tick: 60, type: "move", lane: 1 }],
        claimedScore: 27150,
        claimedHash: "abc",
    }
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn())
    })
    afterEach(() => vi.restoreAllMocks())

    it("POSTs to /api/arcade/submit with the Bearer token and returns the verified result", async () => {
        const fetchMock = vi.mocked(fetch)
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ verified: true, logHash: "LH", day: "2026-07-13", mode: "daily", result: { score: 27150 } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        )
        const res = await submitRun(body, "TOKEN_JSON")
        expect(res.verified).toBe(true)
        expect(res.logHash).toBe("LH")
        const [url, init] = fetchMock.mock.calls[0]
        expect(String(url)).toContain("/api/arcade/submit")
        expect((init as RequestInit).method).toBe("POST")
        expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer TOKEN_JSON" })
    })

    it("throws a helpful error on a non-2xx (e.g. 422 rejection)", async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ verified: false, reason: "claim mismatch" }), { status: 422 }),
        )
        await expect(submitRun(body, "TOKEN_JSON")).rejects.toThrow(/claim mismatch/)
    })

    it("refuses to submit without an auth token", async () => {
        await expect(submitRun(body, "")).rejects.toThrow(/sign in|auth|token/i)
        expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    })
})
