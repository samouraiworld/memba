/**
 * Tests for gnoloveHomeUrl.ts.
 *
 * Plan: docs/planning/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md §8 Task 2.1.
 *
 * @module lib/gnoloveHomeUrl.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
    parseHomeUrl,
    serializeHomeUrl,
    DEFAULT_HOME_STATE,
    __resetHomeFallbackRateLimitForTests,
    type HomeUrlState,
} from "./gnoloveHomeUrl"
import { TimeFilter } from "./gnoloveConstants"

vi.mock("@sentry/react", () => ({
    addBreadcrumb: vi.fn(),
    captureMessage: vi.fn(),
}))
import * as Sentry from "@sentry/react"

beforeEach(() => {
    vi.mocked(Sentry.addBreadcrumb).mockClear()
    __resetHomeFallbackRateLimitForTests()
})

describe("parseHomeUrl", () => {
    it("empty params returns defaults", () => {
        expect(parseHomeUrl(new URLSearchParams(""))).toEqual(DEFAULT_HOME_STATE)
    })

    it("time=monthly parses", () => {
        const s = parseHomeUrl(new URLSearchParams("time=monthly"))
        expect(s.time).toBe(TimeFilter.MONTHLY)
    })

    it("garbage time falls back to ALL_TIME with breadcrumb", () => {
        const s = parseHomeUrl(new URLSearchParams("time=wonky"))
        expect(s.time).toBe(TimeFilter.ALL_TIME)
        expect(Sentry.addBreadcrumb).toHaveBeenCalled()
    })

    it("sortBy=TotalCommits&sortDir=asc parses both", () => {
        const s = parseHomeUrl(new URLSearchParams("sortBy=TotalCommits&sortDir=asc"))
        expect(s.sortBy).toBe("TotalCommits")
        expect(s.sortDir).toBe("asc")
    })

    it("excludeTeams=Samourai.world,Onbloc deduped+sorted", () => {
        const s = parseHomeUrl(new URLSearchParams("excludeTeams=Onbloc,Samourai.world,Onbloc"))
        expect(s.excludedTeams).toEqual(["Onbloc", "Samourai.world"])
    })

    it("excludeTeams with unknown team filters out unknowns + breadcrumb", () => {
        const s = parseHomeUrl(new URLSearchParams("excludeTeams=Samourai.world,FakeTeam"))
        expect(s.excludedTeams).toEqual(["Samourai.world"])
        expect(Sentry.addBreadcrumb).toHaveBeenCalled()
    })

    it("repos= (empty) → []", () => {
        expect(parseHomeUrl(new URLSearchParams("repos=")).repos).toEqual([])
    })

    it("repos with >50 entries truncates", () => {
        const huge = Array.from({ length: 80 }, (_, i) => `o/r${i}`).join(",")
        const s = parseHomeUrl(new URLSearchParams(`repos=${huge}`))
        expect(s.repos.length).toBe(50)
    })

    it("page=5 parses to 5", () => {
        expect(parseHomeUrl(new URLSearchParams("page=5")).page).toBe(5)
    })

    it("page=0 falls back to 1 with breadcrumb", () => {
        const s = parseHomeUrl(new URLSearchParams("page=0"))
        expect(s.page).toBe(1)
        expect(Sentry.addBreadcrumb).toHaveBeenCalled()
    })

    it("page=abc falls back to 1", () => {
        const s = parseHomeUrl(new URLSearchParams("page=abc"))
        expect(s.page).toBe(1)
    })

    it("page=99999999 caps at MAX_PAGE (10000)", () => {
        expect(parseHomeUrl(new URLSearchParams("page=99999999")).page).toBe(10_000)
    })
})

describe("serializeHomeUrl", () => {
    it("default state → empty string", () => {
        expect(serializeHomeUrl(DEFAULT_HOME_STATE).toString()).toBe("")
    })

    it("time=MONTHLY emits param", () => {
        const s: HomeUrlState = { ...DEFAULT_HOME_STATE, time: TimeFilter.MONTHLY }
        expect(serializeHomeUrl(s).get("time")).toBe(TimeFilter.MONTHLY)
    })

    it("page=2 emits ?page=2; page=1 omits", () => {
        expect(serializeHomeUrl({ ...DEFAULT_HOME_STATE, page: 2 }).get("page")).toBe("2")
        expect(serializeHomeUrl({ ...DEFAULT_HOME_STATE, page: 1 }).has("page")).toBe(false)
    })

    it("excludedTeams + repos sort on output", () => {
        const s: HomeUrlState = {
            ...DEFAULT_HOME_STATE,
            excludedTeams: ["Samourai.world", "Onbloc"],
            repos: ["zzz/last", "aaa/first"],
        }
        const out = serializeHomeUrl(s)
        expect(out.get("excludeTeams")).toBe("Onbloc,Samourai.world")
        expect(out.get("repos")).toBe("aaa/first,zzz/last")
    })
})

describe("parse ∘ serialize round-trip", () => {
    it("complex state round-trips identically", () => {
        const original: HomeUrlState = {
            time: TimeFilter.YEARLY,
            excludedTeams: ["Onbloc", "Samourai.world"],
            sortBy: "TotalPrs",
            sortDir: "asc",
            repos: ["gnolang/gno", "samouraiworld/memba"],
            page: 3,
        }
        const round = parseHomeUrl(serializeHomeUrl(original))
        expect(round).toEqual(original)
    })
})
