/**
 * fetchValidatorReports — gnomonitoring's scored validator report.
 *
 * One unauthenticated call returns, per validator and per reporting window, a
 * 0-100 score, a tier, sign rate, proposer reliability, flap-collapsed incident
 * counts and downtime — replacing most of what the roster assembles from seven
 * separate endpoints, and adding what it has no source for at all.
 *
 * THE ONE THING THIS MODULE MUST GET RIGHT. gnomonitoring computes an absent
 * validator's report from zero-valued inputs, and `score.Compute(Inputs{})`
 * returns score 0 — which `tierFor` maps to "Critical". So a monitoring outage,
 * an indexer stall, or a validator that simply joined an hour ago are all
 * reported with the same numbers as total, sustained failure. Rendering that
 * verbatim would tell users the entire validator set is Critical every time our
 * own monitoring hiccups.
 *
 * `hasData` is the guard: a window with no signing evidence AND no failure
 * evidence is an absence of information, not a verdict of zero.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("./config", () => ({
    GNO_MONITORING_API_URL: "https://monitoring.example",
    GNO_MONITORING_CHAIN: "gnoland-1",
    GNO_CHAIN_ID: "gnoland-1",
}))

const { fetchValidatorReports, __resetReportCacheForTests } = await import("./validatorReports")

/**
 * Fixture captured from a live `gnoland-1` response and VERIFIED field-for-field
 * on 2026-09-12: every key this parser reads exists upstream, and every key
 * upstream sends is read here — no drift in either direction, top level or
 * period. Windows confirmed as exactly: last_24h, current_week, current_month,
 * current_year.
 *
 * Keeping that check explicit matters: the consensus parser on the hacker page
 * went dead for the life of the feature because it read `round_state.votes` as an
 * array (it is an object) and a composite `height/round/step` key that gno never
 * sends — with the failure swallowed by a catch. A fixture that was never
 * measured against the wire is the same bug waiting to happen.
 */
function period(over: Record<string, unknown> = {}) {
    return {
        score: 96, tier: "Excellent", sign_rate: 99.69, proposer_reliability: 99.69,
        voting_power: 60, critical_count: 0, warning_count: 0, incident_count: 0,
        incident_rate_per_week: 0, downtime_blocks: 0, missed_blocks: 2,
        ...over,
    }
}
function report(addr: string, over: Record<string, unknown> = {}) {
    return {
        addr, moniker: "val-" + addr.slice(-2), days_since_last_alert: 4,
        periods: {
            last_24h: period(), current_week: period(),
            current_month: period(), current_year: period(),
        },
        ...over,
    }
}

function mockJson(body: unknown, ok = true, status = 200) {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
        ok, status, json: () => Promise.resolve(body),
    } as unknown as Response)))
}

describe("fetchValidatorReports", () => {
    beforeEach(() => __resetReportCacheForTests())
    afterEach(() => vi.unstubAllGlobals())

    it("maps the wire payload into a map keyed by lowercased address", async () => {
        mockJson([report("g1AAA"), report("g1BBB")])
        const map = await fetchValidatorReports()

        expect(map!.size).toBe(2)
        const a = map!.get("g1aaa")!
        expect(a.moniker).toBe("val-AA")
        expect(a.daysSinceLastAlert).toBe(4)
        expect(a.periods.current_month!.score).toBe(96)
        expect(a.periods.current_month!.tier).toBe("Excellent")
        expect(a.periods.current_month!.signRate).toBeCloseTo(99.69)
        expect(a.periods.current_month!.missedBlocks).toBe(2)
    })

    it("requests the active monitoring chain", async () => {
        mockJson([report("g1AAA")])
        await fetchValidatorReports()
        const url = String(vi.mocked(fetch).mock.calls[0][0])
        expect(url).toContain("/api/reports/validators")
        expect(url).toContain("chain=gnoland-1")
    })

    // ── the no-data guard ────────────────────────────────────────
    it("marks a window with no evidence at all as hasData=false, not Critical", async () => {
        // Exactly what score.Compute(Inputs{}) produces for an unmonitored validator.
        const empty = period({
            score: 0, tier: "Critical", sign_rate: 0, proposer_reliability: null,
            critical_count: 0, warning_count: 0, incident_count: 0,
            downtime_blocks: 0, missed_blocks: 0,
        })
        mockJson([report("g1AAA", { periods: { last_24h: empty, current_week: empty, current_month: empty, current_year: empty } })])

        const map = await fetchValidatorReports()
        const p = map!.get("g1aaa")!.periods.current_month!
        expect(p.hasData).toBe(false)
        expect(map!.get("g1aaa")!.hasData).toBe(false)
    })

    it("treats a genuine zero score as real when there IS failure evidence", async () => {
        // Same score, opposite meaning: this validator was measured and failed.
        const bad = period({
            score: 0, tier: "Critical", sign_rate: 0,
            critical_count: 3, incident_count: 3, downtime_blocks: 900, missed_blocks: 900,
        })
        mockJson([report("g1AAA", { periods: { last_24h: bad, current_week: bad, current_month: bad, current_year: bad } })])

        const map = await fetchValidatorReports()
        expect(map!.get("g1aaa")!.periods.current_month!.hasData).toBe(true)
        expect(map!.get("g1aaa")!.hasData).toBe(true)
    })

    it("counts signing evidence alone as data — a flawless validator is not an absent one", async () => {
        const perfect = period({ score: 100, tier: "Excellent", sign_rate: 100, missed_blocks: 0, downtime_blocks: 0, incident_count: 0, critical_count: 0, warning_count: 0 })
        mockJson([report("g1AAA", { periods: { last_24h: perfect, current_week: perfect, current_month: perfect, current_year: perfect } })])

        const map = await fetchValidatorReports()
        expect(map!.get("g1aaa")!.periods.current_month!.hasData).toBe(true)
    })

    it("tolerates a missing or malformed period without discarding the validator", async () => {
        mockJson([report("g1AAA", { periods: { current_month: period(), last_24h: null } })])
        const map = await fetchValidatorReports()
        const r = map!.get("g1aaa")!
        expect(r.periods.last_24h).toBeNull()
        expect(r.periods.current_week).toBeNull()
        expect(r.periods.current_month!.score).toBe(96)
    })

    it("returns null — not an empty map — when the endpoint fails", async () => {
        // An empty map means "no validators"; null means "we could not ask".
        // Collapsing the two is how an outage renders as an empty network.
        mockJson(null, false, 503)
        expect(await fetchValidatorReports()).toBeNull()
    })

    it("returns null when the response is not an array", async () => {
        mockJson({ error: "boom" })
        expect(await fetchValidatorReports()).toBeNull()
    })

    it("survives a network error without throwing", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))))
        await expect(fetchValidatorReports()).resolves.toBeNull()
    })
})
