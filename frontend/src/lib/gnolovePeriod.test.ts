import { describe, it, expect } from "vitest"
import {
    DEFAULT_TEAM_HUB_PERIOD,
    isTeamHubPeriod,
    parseTeamHubPeriod,
    periodToBackendParam,
    TEAM_HUB_PERIODS,
} from "./gnolovePeriod"

describe("gnolovePeriod", () => {
    it("exports five periods", () => {
        expect(TEAM_HUB_PERIODS).toHaveLength(5)
        expect(TEAM_HUB_PERIODS).toContain("all")
        expect(TEAM_HUB_PERIODS).toContain("monthly")
    })

    it("default is monthly (a useful middle ground)", () => {
        expect(DEFAULT_TEAM_HUB_PERIOD).toBe("monthly")
    })

    describe("isTeamHubPeriod", () => {
        it("accepts known values", () => {
            for (const p of TEAM_HUB_PERIODS) {
                expect(isTeamHubPeriod(p)).toBe(true)
            }
        })
        it("rejects everything else", () => {
            for (const x of ["", "ALL", "year", "hourly", null, undefined, 7]) {
                expect(isTeamHubPeriod(x)).toBe(false)
            }
        })
    })

    describe("periodToBackendParam", () => {
        it("maps 'all' to empty string for the backend's all-time sentinel", () => {
            expect(periodToBackendParam("all")).toBe("")
        })
        it("passes others through", () => {
            expect(periodToBackendParam("monthly")).toBe("monthly")
            expect(periodToBackendParam("weekly")).toBe("weekly")
        })
    })

    describe("parseTeamHubPeriod", () => {
        it("returns default for empty / null / garbage", () => {
            expect(parseTeamHubPeriod(null)).toBe(DEFAULT_TEAM_HUB_PERIOD)
            expect(parseTeamHubPeriod(undefined)).toBe(DEFAULT_TEAM_HUB_PERIOD)
            expect(parseTeamHubPeriod("")).toBe(DEFAULT_TEAM_HUB_PERIOD)
            expect(parseTeamHubPeriod("bogus")).toBe(DEFAULT_TEAM_HUB_PERIOD)
        })
        it("returns the value for known periods", () => {
            expect(parseTeamHubPeriod("weekly")).toBe("weekly")
            expect(parseTeamHubPeriod("all")).toBe("all")
        })
    })
})
