import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import * as shared from "./dao/shared"
import { getBoard, submitRun, type ArcadeSubmitBody } from "./arcade"

const entry = (over: Record<string, unknown> = {}) => ({
    game: "invaders",
    addr: "g1alice",
    day: "2026-07-13",
    mode: "daily",
    score: 300,
    simVersion: 1,
    stateHash: "a7d393c2",
    inputLogSha256: "def",
    stats: `{"wave":1,"shots":48,"hits":11}`,
    attestedAt: 100,
    ...over,
})

describe("arcade board reader (qeval, multi-game)", () => {
    afterEach(() => vi.restoreAllMocks())

    it("reads GetBoardJSON for a game-day and returns shape-validated entries", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue(`("{...}" string)`)
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue({
            game: "invaders",
            day: "2026-07-13",
            total: 2,
            entries: [
                entry(),
                { addr: "not-an-object" }, // junk row filtered out
            ],
        })
        const rows = await getBoard("invaders", "2026-07-13", 0, 50)
        expect(rows).toHaveLength(1)
        expect(rows[0].addr).toBe("g1alice")
        expect(rows[0].game).toBe("invaders")
        expect(rows[0].score).toBe(300)
        expect(rows[0].stats).toContain("wave")
        // The exact qeval expression (offset/limit clamped, game+day JSON-quoted).
        expect(qe.mock.calls[0][2]).toBe(`GetBoardJSON("invaders", "2026-07-13", 0, 50)`)
    })

    it("filters a barricade-era row that lacks the multi-game fields", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue(`("x" string)`)
        vi.spyOn(shared, "parseQevalJSON").mockReturnValue({
            entries: [
                // old shape: waves/won/overtimeRound, no game/stats — not a BoardEntry
                { addr: "g1old", day: "2026-07-13", mode: "daily", score: 1, waves: 5, won: false, overtimeRound: 0, simVersion: 2, stateHash: "abc", inputLogSha256: "def", attestedAt: 1 },
                entry({ game: "barricade" }),
            ],
        })
        const rows = await getBoard("barricade", "2026-07-13", 0, 50)
        expect(rows).toHaveLength(1)
        expect(rows[0].game).toBe("barricade")
    })

    it("rejects a day that isn't a plain YYYY-MM-DD (qeval injection guard)", async () => {
        const qe = vi.spyOn(shared, "queryEval")
        const rows = await getBoard("invaders", `2026-07-13") + evil(`, 0, 50)
        expect(rows).toEqual([])
        expect(qe).not.toHaveBeenCalled()
    })

    it("rejects a game outside the realm's slug charset BEFORE any qeval (injection guard)", async () => {
        const qe = vi.spyOn(shared, "queryEval")
        for (const bad of [`invaders") + evil(`, "INVADERS", "in vaders", "", "a".repeat(33), 'inv"aders', "inv_aders"]) {
            expect(await getBoard(bad, "2026-07-13", 0, 50)).toEqual([])
        }
        expect(qe).not.toHaveBeenCalled()
    })

    it("clamps offset/limit and returns [] on an empty/failed read", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue("")
        const rows = await getBoard("invaders", "2026-07-13", -5, 9999)
        expect(rows).toEqual([])
        expect(qe.mock.calls[0][2]).toBe(`GetBoardJSON("invaders", "2026-07-13", 0, 100)`)
    })

    it("never throws on a malformed realm payload", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValue(`("x" string)`)
        for (const bad of [null, {}, { entries: null }, { entries: "nope" }, { entries: 42 }, 7, "str"]) {
            vi.spyOn(shared, "parseQevalJSON").mockReturnValueOnce(bad as never)
            await expect(getBoard("invaders", "2026-07-13", 0, 50)).resolves.toEqual([])
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
        // BARRICADE bodies must NOT grow a finalTick key (the backend rejects it).
        expect(JSON.parse((init as RequestInit).body as string)).not.toHaveProperty("finalTick")
    })

    it("carries finalTick for a Space Invaders submission (and only then)", async () => {
        const fetchMock = vi.mocked(fetch)
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ verified: true, logHash: "x", day: "d", mode: "daily", result: {} }), { status: 200 }))
        const siBody: ArcadeSubmitBody = {
            seed: "invaders-2026-07-13",
            simVersion: 1,
            events: [[5, 10, 0, 0], [60, 10, 1, 0]],
            finalTick: 600,
            claimedScore: 300,
            claimedHash: "a7d393c2",
        }
        await submitRun(siBody, "TOKEN_JSON")
        const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
        expect(sent).toMatchObject({
            seed: "invaders-2026-07-13",
            simVersion: 1,
            finalTick: 600,
            claimedScore: 300,
            claimedHash: "a7d393c2",
        })
        expect(sent.events).toEqual([[5, 10, 0, 0], [60, 10, 1, 0]])
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
