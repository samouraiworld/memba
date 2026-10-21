import { afterEach, describe, expect, it, vi } from "vitest"
import * as shared from "./dao/shared"
import { GNO_RPC_URL } from "./config"
import {
    arenaLabel,
    byScoreThenMoniker,
    compareTotals,
    fetchLatestSelectionScores,
    formatEditionDate,
    formatHundredths,
    formatSelectionScore,
    parseSelectionScores,
    selectionScoreFor,
    selectionScoresQuery,
    selectionScoresQueryKey,
    SELECTION_SCORES_STALE_MS,
} from "./validatorSelectionScores"

// Real config, except the realm path per network, which a test can pin.
const config = vi.hoisted(() => ({ realmFor: vi.fn() }))
vi.mock("./config", async (actual) => {
    const real = await actual<typeof import("./config")>()
    config.realmFor.mockImplementation(real.validatorScoresRealmFor)
    return { ...real, validatorScoresRealmFor: config.realmFor }
})

const REALM = "gno.land/r/samcrew/validator_scores"
const AVIAONE = `g1${"a".repeat(38)}`
const BASALT = `g1${"c".repeat(38)}`
const CEDAR = `g1${"e".repeat(38)}`
const ARENAS = ["challenge", "test13", "topaz", "sapphire", "pearl", "firedrill"]

// The contract's own example (spec, "JSON shapes"): AviaOne at 87.43, rank 3.
const candidate = (over: Record<string, unknown> = {}) => ({
    operator: AVIAONE, moniker: "AviaOne", total: 8743, rank: 3, github: 230,
    arenaScores: [9000, 8500, 8000, 9100, 8800, 7500], ...over,
})
const latest = (over: Record<string, unknown> = {}) => ({
    number: 1, computedAt: "2026-10-13T09:00:00Z", scorecardSHA256: "ab".repeat(32), arenas: ARENAS,
    candidates: [candidate()], ...over,
})
/** What vm/qeval prints for a realm function returning this value as JSON text. */
const qeval = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`

describe("parseSelectionScores", () => {
    it("reads the latest edition and keys its candidates by operator address", () => {
        const edition = parseSelectionScores(qeval(latest({
            candidates: [candidate(), candidate({ operator: BASALT, moniker: "Basalt", total: 9120, rank: 1, github: 0 })],
        })))
        expect(edition).toMatchObject({ number: 1, computedAt: "2026-10-13T09:00:00Z", scorecardSHA256: "ab".repeat(32), arenas: ARENAS })
        expect(edition?.candidates.size).toBe(2)
        expect(edition?.candidates.get(AVIAONE)).toEqual(candidate())
        expect(edition?.candidates.get(BASALT)?.total).toBe(9120)
    })

    it("gives null when no edition is sealed, the read failed, or the answer is not the contract", () => {
        const answers = [
            null, "", "garbage", "(\"not json\" string)", qeval(null), qeval([]), qeval("text"),
            qeval(latest({ number: 0 })), qeval(latest({ number: 1.5 })), qeval(latest({ number: "1" })),
            qeval(latest({ computedAt: "" })), qeval(latest({ computedAt: 20261013 })),
            qeval(latest({ scorecardSHA256: "AB".repeat(32) })), qeval(latest({ scorecardSHA256: "ab" })),
            qeval(latest({ arenas: [] })), qeval(latest({ arenas: ["challenge", 7] })), qeval(latest({ arenas: ["challenge", ""] })),
            qeval(latest({ candidates: {} })), qeval(latest({ candidates: undefined })),
        ]
        for (const raw of answers) expect(parseSelectionScores(raw), String(raw)).toBeNull()
    })

    it("leaves out a candidate that breaks the contract, keeping the others", () => {
        const broken = [
            candidate({ operator: "g1short" }), candidate({ operator: 42 }), candidate({ moniker: null }),
            candidate({ total: 87.43 }), candidate({ total: "8743" }), candidate({ rank: 0 }), candidate({ rank: 2.5 }),
            candidate({ github: null }), candidate({ arenaScores: [9000] }),
            candidate({ arenaScores: [9000, 8500, 8000, 9100, 8800, "7500"] }), candidate({ arenaScores: "9000" }),
            "AviaOne", null,
        ]
        const edition = parseSelectionScores(qeval(latest({ candidates: [...broken, candidate({ operator: BASALT })] })))
        expect([...(edition?.candidates.keys() ?? [])]).toEqual([BASALT])
    })

    it("keeps an empty sealed edition: a realm with no candidate yet hides every score, not the parse", () => {
        expect(parseSelectionScores(qeval(latest({ candidates: [] })))?.candidates.size).toBe(0)
    })

    it("keeps the first row for an operator listed twice, and matches addresses whatever their case", () => {
        const upper = AVIAONE.toUpperCase()
        const edition = parseSelectionScores(qeval(latest({ candidates: [candidate({ operator: upper }), candidate({ total: 1 })] })))
        expect(edition?.candidates.size).toBe(1)
        expect(selectionScoreFor(edition!, AVIAONE)?.total).toBe(8743)
        expect(selectionScoreFor(edition!, upper)?.operator).toBe(AVIAONE)
        expect(selectionScoreFor(edition!, BASALT)).toBeUndefined()
    })

    it("decodes a moniker the node prints as a Go escape (an emoji past what it can print)", () => {
        const json = JSON.stringify(latest({ candidates: [candidate({ moniker: "AviaOne \u{1FAE9}" })] }))
        const raw = `(${JSON.stringify(json).replace("\u{1FAE9}", "\\U0001fae9")} string)`
        expect(raw).toContain("\\U0001fae9")
        expect(parseSelectionScores(raw)?.candidates.get(AVIAONE)?.moniker).toBe("AviaOne \u{1FAE9}")
    })

    it("keeps negative sub-scores as given (a penalty is a real figure)", () => {
        const edition = parseSelectionScores(qeval(latest({ candidates: [candidate({ arenaScores: [9000, 8500, 8000, 9100, 8800, -150] })] })))
        expect(edition?.candidates.get(AVIAONE)?.arenaScores.at(-1)).toBe(-150)
    })
})

describe("fetchLatestSelectionScores", () => {
    afterEach(() => vi.restoreAllMocks())

    it("evaluates LatestJSON() on the realm through the resilient RPC helpers", async () => {
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue(qeval(latest()))
        const edition = await fetchLatestSelectionScores(REALM)
        expect(qe).toHaveBeenCalledWith(GNO_RPC_URL, REALM, "LatestJSON()")
        expect(edition?.candidates.get(AVIAONE)?.total).toBe(8743)
    })

    it("gives null, never a throw, when the read fails or returns nothing", async () => {
        vi.spyOn(shared, "queryEval").mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("RPC down"))
        await expect(fetchLatestSelectionScores(REALM)).resolves.toBeNull()
        await expect(fetchLatestSelectionScores(REALM)).resolves.toBeNull()
    })

    it("reads nothing without a realm path", async () => {
        const qe = vi.spyOn(shared, "queryEval")
        await expect(fetchLatestSelectionScores("")).resolves.toBeNull()
        expect(qe).not.toHaveBeenCalled()
    })
})

describe("formatting", () => {
    it("shows hundredths with one decimal, rounding half away from zero with no float drift", () => {
        expect([8743, 8745, 8749, 0, 4, 5, 10000, -15, -4].map(formatHundredths))
            .toEqual(["87.4", "87.5", "87.5", "0.0", "0.0", "0.1", "100.0", "-0.2", "0.0"])
    })

    it("writes a score as total and rank", () => {
        expect(formatSelectionScore({ total: 8743, rank: 3 })).toBe("87.4 · #3")
    })

    it("dates an edition by its UTC day, and keeps text that is not a date", () => {
        expect(formatEditionDate("2026-10-13T09:00:00Z")).toBe("13 Oct 2026")
        expect(formatEditionDate("2026-10-13T23:30:00-05:00")).toBe("14 Oct 2026")
        expect(formatEditionDate("soon")).toBe("soon")
    })

    it("names the arenas, and keeps an unknown one as written (never a prototype key)", () => {
        expect(ARENAS.map(arenaLabel)).toEqual(["Challenge", "Test13", "Topaz", "Sapphire", "Pearl", "Fire drill"])
        expect(arenaLabel("onyx")).toBe("onyx")
        expect(arenaLabel("constructor")).toBe("constructor")
    })
})

describe("ordering", () => {
    it("compares totals ascending, a missing one below every real one", () => {
        expect([5, null, -3, 0].sort(compareTotals)).toEqual([null, -3, 0, 5])
        expect(compareTotals(null, null)).toBe(0)
    })

    it("orders candidates by total, highest first, then by name, those without a score last", () => {
        const edition = parseSelectionScores(qeval(latest({
            candidates: [candidate({ operator: AVIAONE, total: 8743 }), candidate({ operator: BASALT, total: 8743 }), candidate({ operator: CEDAR, total: 9000 })],
        })))!
        const rows = [
            { moniker: "Zulu", operatorAddress: AVIAONE },
            { moniker: "Nope", operatorAddress: `g1${"z".repeat(38)}` },
            { moniker: "Alpha", operatorAddress: BASALT },
            { moniker: "Mid", operatorAddress: CEDAR },
            { moniker: "Also none", operatorAddress: `g1${"y".repeat(38)}` },
        ]
        expect(rows.sort(byScoreThenMoniker(edition)).map((r) => r.moniker)).toEqual(["Mid", "Alpha", "Zulu", "Also none", "Nope"])
    })

    it("shares one cache entry per network, fresh for five minutes", () => {
        expect(selectionScoresQueryKey("mainnet")).toEqual(["validators", "selection-scores", "mainnet"])
        expect(SELECTION_SCORES_STALE_MS).toBe(300_000)
    })
})

describe("selectionScoresQuery", () => {
    afterEach(() => vi.restoreAllMocks())

    it("carries the shared key and freshness, and reads the network's realm", async () => {
        config.realmFor.mockImplementation((network: string) => network === "mainnet" ? REALM : null)
        const qe = vi.spyOn(shared, "queryEval").mockResolvedValue(qeval(latest()))
        const query = selectionScoresQuery("mainnet")
        expect(query.queryKey).toEqual(selectionScoresQueryKey("mainnet"))
        expect(query.staleTime).toBe(SELECTION_SCORES_STALE_MS)
        expect((await query.queryFn())?.number).toBe(1)
        expect(qe).toHaveBeenCalledWith(GNO_RPC_URL, REALM, "LatestJSON()")
    })

    it("reads nothing on a network without the realm", async () => {
        const qe = vi.spyOn(shared, "queryEval")
        await expect(selectionScoresQuery("no-such-network").queryFn()).resolves.toBeNull()
        expect(qe).not.toHaveBeenCalled()
    })
})
