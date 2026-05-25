/**
 * Tests for gnoloveReportUrl.ts — URL schema for shareable Gnolove report state.
 *
 * Plan reference: docs/planning/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md §3.4.
 * Must-fix coverage: MF-1 (period rename mapping), MF-3 (pinAt mode + buildShareUrl),
 * MF-4 (period-switch end-of-range), MF-6 (Sentry breadcrumb on fallback),
 * MF-8 (repos as readonly string[] sorted), MF-9 (week-53 / year-rollover / stale-at
 * / URL-encoded team / idempotency / dedupe-sort), MF-12 (team charset), MF-18
 * (stale-team allowlist), MF-23 (year range), MF-24 (repos size cap).
 *
 * @module lib/gnoloveReportUrl.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
    parseReportUrl,
    serializeReportUrl,
    buildShareUrl,
    rangeFromKey,
    defaultKey,
    weekKeyFromDate,
    monthKeyFromDate,
    yearKeyFromDate,
    nextAtForPeriodSwitch,
    DEFAULT_REPORT_STATE,
    WEEK_RE,
    MONTH_RE,
    YEAR_RE,
    __resetFallbackRateLimitForTests,
    type ReportUrlState,
    type ReportPeriod,
} from "./gnoloveReportUrl"

// Mock Sentry — breadcrumb assertions go through the mock
vi.mock("@sentry/react", () => ({
    addBreadcrumb: vi.fn(),
    captureMessage: vi.fn(),
}))
import * as Sentry from "@sentry/react"

beforeEach(() => {
    vi.mocked(Sentry.addBreadcrumb).mockClear()
    vi.mocked(Sentry.captureMessage).mockClear()
    __resetFallbackRateLimitForTests()
})

// ── Regex pins (year-range cap [MF-23]) ─────────────────────

describe("regex year-range cap [MF-23]", () => {
    it("WEEK_RE accepts 2010–2039 only", () => {
        expect(WEEK_RE.test("2010-W01")).toBe(true)
        expect(WEEK_RE.test("2026-W18")).toBe(true)
        expect(WEEK_RE.test("2039-W52")).toBe(true)
        expect(WEEK_RE.test("2009-W01")).toBe(false)
        expect(WEEK_RE.test("2040-W01")).toBe(false)
        expect(WEEK_RE.test("9999-W01")).toBe(false)
        expect(WEEK_RE.test("0000-W01")).toBe(false)
    })

    it("MONTH_RE accepts 2010-01 .. 2039-12 only", () => {
        expect(MONTH_RE.test("2026-05")).toBe(true)
        expect(MONTH_RE.test("2010-01")).toBe(true)
        expect(MONTH_RE.test("2039-12")).toBe(true)
        expect(MONTH_RE.test("2026-13")).toBe(false)
        expect(MONTH_RE.test("2026-00")).toBe(false)
        expect(MONTH_RE.test("2040-01")).toBe(false)
        expect(MONTH_RE.test("9999-99")).toBe(false)
    })

    it("YEAR_RE accepts 2010..2039 only", () => {
        expect(YEAR_RE.test("2010")).toBe(true)
        expect(YEAR_RE.test("2039")).toBe(true)
        expect(YEAR_RE.test("2026")).toBe(true)
        expect(YEAR_RE.test("2009")).toBe(false)
        expect(YEAR_RE.test("2040")).toBe(false)
    })
})

// ── Period key helpers ──────────────────────────────────────

describe("weekKeyFromDate / monthKeyFromDate / yearKeyFromDate", () => {
    it("returns ISO week key for a Monday in 2026", () => {
        // 2026-05-04 is the Monday of ISO week 19 of 2026
        expect(weekKeyFromDate(new Date(2026, 4, 4))).toBe("2026-W19")
    })

    it("handles ISO year-week rollover at end of year [MF-9]", () => {
        // 2025-12-31 (Wed) is in ISO week 1 of 2026 per ISO 8601
        expect(weekKeyFromDate(new Date(2025, 11, 31))).toBe("2026-W01")
    })

    it("returns yyyy-MM for monthKeyFromDate", () => {
        expect(monthKeyFromDate(new Date(2026, 4, 15))).toBe("2026-05")
    })

    it("returns yyyy for yearKeyFromDate", () => {
        expect(yearKeyFromDate(new Date(2026, 4, 15))).toBe("2026")
    })
})

describe("rangeFromKey", () => {
    it("weekly with valid key → Monday→Sunday range whose ISO week matches", () => {
        const { start, end } = rangeFromKey("weekly", "2026-W18")
        // ISO W18 of 2026: Mon 2026-04-27 → Sun 2026-05-03
        expect(start.getDay()).toBe(1) // Monday
        expect(end.getDay()).toBe(0)   // Sunday
        expect(weekKeyFromDate(start)).toBe("2026-W18")
    })

    it("weekly with null falls back to previous week [no throw]", () => {
        const { start, end } = rangeFromKey("weekly", null)
        expect(start).toBeInstanceOf(Date)
        expect(end).toBeInstanceOf(Date)
        expect(start.getDay()).toBe(1)
    })

    it("monthly with valid key", () => {
        const { start, end } = rangeFromKey("monthly", "2026-05")
        expect(start.getMonth()).toBe(4) // May (0-indexed)
        expect(start.getFullYear()).toBe(2026)
        expect(start.getDate()).toBe(1)
        expect(end.getDate()).toBeGreaterThanOrEqual(30)
    })

    it("yearly with valid key", () => {
        const { start, end } = rangeFromKey("yearly", "2026")
        expect(start.getFullYear()).toBe(2026)
        expect(start.getMonth()).toBe(0)
        expect(end.getMonth()).toBe(11)
    })

    it("all_time spans 2010-01-01 to now", () => {
        const { start, end } = rangeFromKey("all_time", null)
        expect(start.getFullYear()).toBe(2010)
        expect(end.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
    })

    it("invalid weekly key falls back silently to previous week", () => {
        const { start } = rangeFromKey("weekly", "9999-W99")
        // Falls back (regex won't match) → previous week
        expect(start.getDay()).toBe(1)
    })

    it("ISO week 53 of 2020 (a long ISO year) produces a valid range [MF-9]", () => {
        const { start } = rangeFromKey("weekly", "2020-W53")
        // 2020 has 53 ISO weeks (Mon 2020-12-28 starts W53)
        expect(start.getFullYear()).toBe(2020)
        expect(start.getMonth()).toBe(11) // December
    })
})

describe("defaultKey", () => {
    it("weekly returns previous week", () => {
        const now = new Date(2026, 4, 15) // Fri May 15 2026
        const key = defaultKey("weekly", now)
        expect(key).toMatch(WEEK_RE)
        // Previous week of 2026-05-15 is 2026-W19 (W20 starts Mon 2026-05-11)
        // Actually 2026-05-15 is in W20; previous week is W19
        const { start } = rangeFromKey("weekly", key)
        expect(start.getTime()).toBeLessThan(now.getTime())
    })

    it("monthly returns current month", () => {
        const now = new Date(2026, 4, 15)
        expect(defaultKey("monthly", now)).toBe("2026-05")
    })

    it("yearly returns current year", () => {
        const now = new Date(2026, 4, 15)
        expect(defaultKey("yearly", now)).toBe("2026")
    })

    it("all_time returns null", () => {
        expect(defaultKey("all_time", new Date())).toBeNull()
    })
})

// ── nextAtForPeriodSwitch — BUG-5 fix, uses END of current range [MF-4] ──

describe("nextAtForPeriodSwitch [MF-4 / ADR-007]", () => {
    it("weekly→monthly uses month containing end of week (handles boundary)", () => {
        // ISO W18 2026 ends Sun 2026-05-03 (in May)
        // Cross-month boundary should land on May, not April
        expect(nextAtForPeriodSwitch("weekly", "2026-W18", "monthly")).toBe("2026-05")
    })

    it("weekly→monthly stays in the same month when week is fully inside it", () => {
        // ISO W19 2026 = Mon May 4 → Sun May 10, fully in May
        expect(nextAtForPeriodSwitch("weekly", "2026-W19", "monthly")).toBe("2026-05")
    })

    it("weekly→yearly uses year of end", () => {
        // ISO W1 2026 starts Mon Dec 29 2025 → Sun Jan 4 2026; end is in 2026
        expect(nextAtForPeriodSwitch("weekly", "2026-W01", "yearly")).toBe("2026")
    })

    it("monthly→weekly uses last week of the month", () => {
        const next = nextAtForPeriodSwitch("monthly", "2026-05", "weekly")
        expect(next).toMatch(WEEK_RE)
        // End of May 2026 = Sun May 31; ISO week containing it is W22
        const { start } = rangeFromKey("weekly", next)
        expect(start.getMonth()).toBe(4) // May or June (W22 starts May 25)
    })

    it("all_time→weekly falls back to defaultKey [MF-4 prevents 1980 teleport]", () => {
        const next = nextAtForPeriodSwitch("all_time", null, "weekly")
        // Should be a valid week-key for "previous week of now", not 2010-W01
        expect(next).toMatch(WEEK_RE)
        const { start } = rangeFromKey("weekly", next)
        const oneMonthAgo = new Date()
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)
        expect(start.getTime()).toBeGreaterThan(oneMonthAgo.getTime())
    })

    it("X → all_time returns null", () => {
        expect(nextAtForPeriodSwitch("monthly", "2026-05", "all_time")).toBeNull()
    })
})

// ── parseReportUrl ───────────────────────────────────────────

describe("parseReportUrl", () => {
    it("empty params returns defaults", () => {
        const s = parseReportUrl(new URLSearchParams(""))
        expect(s).toEqual(DEFAULT_REPORT_STATE)
        // DEFAULT_REPORT_STATE has frozen-ish repos; deep equality only
        expect(s.repos).toEqual(["gnolang/gno"])
    })

    it("period=monthly&at=2026-05 parses both", () => {
        const s = parseReportUrl(new URLSearchParams("period=monthly&at=2026-05"))
        expect(s.period).toBe("monthly")
        expect(s.at).toBe("2026-05")
    })

    it("period=all maps to runtime all_time [MF-1]", () => {
        const s = parseReportUrl(new URLSearchParams("period=all"))
        expect(s.period).toBe("all_time")
        expect(s.at).toBeNull()
    })

    it("invalid period silently falls back to weekly + fires breadcrumb [MF-6]", () => {
        const s = parseReportUrl(new URLSearchParams("period=wonky"))
        expect(s.period).toBe("weekly")
        expect(Sentry.addBreadcrumb).toHaveBeenCalled()
        const call = vi.mocked(Sentry.addBreadcrumb).mock.calls[0][0]
        expect(call.category).toBe("gnolove.url.fallback")
    })

    it("period=monthly&at=2026-13 drops invalid at [MF-9]", () => {
        const s = parseReportUrl(new URLSearchParams("period=monthly&at=2026-13"))
        expect(s.period).toBe("monthly")
        expect(s.at).toBeNull()
        expect(Sentry.addBreadcrumb).toHaveBeenCalled()
    })

    it("stale at vs period (period=monthly&at=2026-W18) drops at [MF-9]", () => {
        const s = parseReportUrl(new URLSearchParams("period=monthly&at=2026-W18"))
        expect(s.period).toBe("monthly")
        expect(s.at).toBeNull()
    })

    it("repos= (empty value) yields [] = all repositories", () => {
        const s = parseReportUrl(new URLSearchParams("repos="))
        expect(s.repos).toEqual([])
    })

    it("repos=foo/bar,bad,baz/qux drops malformed entry + sorts [MF-8]", () => {
        const s = parseReportUrl(new URLSearchParams("repos=foo/bar,bad,baz/qux"))
        expect(s.repos).toEqual(["baz/qux", "foo/bar"])
    })

    it("repos=foo/bar,foo/bar dedupes", () => {
        const s = parseReportUrl(new URLSearchParams("repos=foo/bar,foo/bar"))
        expect(s.repos).toEqual(["foo/bar"])
    })

    it("repos= with >50 entries truncates [MF-24]", () => {
        const huge = Array.from({ length: 80 }, (_, i) => `o/r${i}`).join(",")
        const s = parseReportUrl(new URLSearchParams(`repos=${huge}`))
        expect(s.repos.length).toBe(50)
    })

    it("repos= raw string > 4096 chars falls back to default [MF-24]", () => {
        const huge = "a/b,".repeat(2000) // ~8000 chars
        const s = parseReportUrl(new URLSearchParams(`repos=${huge}`))
        expect(s.repos).toEqual(["gnolang/gno"])
        expect(Sentry.addBreadcrumb).toHaveBeenCalled()
    })

    it("team with valid name in TEAMS passes through", () => {
        const s = parseReportUrl(new URLSearchParams("team=Samourai.world"))
        expect(s.team).toBe("Samourai.world")
    })

    it("team=NotARealTeam fails allowlist → null + breadcrumb [MF-18]", () => {
        const s = parseReportUrl(new URLSearchParams("team=NotARealTeam"))
        expect(s.team).toBeNull()
        expect(Sentry.addBreadcrumb).toHaveBeenCalled()
    })

    it("team with disallowed charset → null [MF-12]", () => {
        // URLSearchParams auto-decodes the value before regex check
        const s = parseReportUrl(new URLSearchParams("team=A%26B"))
        expect(s.team).toBeNull()
    })

    it("team URL-encoded %20 decodes to space (then fails allowlist)", () => {
        // "Samourai world" (space) isn't in TEAMS, so falls back to null
        const s = parseReportUrl(new URLSearchParams("team=Samourai%20world"))
        expect(s.team).toBeNull()
    })

    it("team=all is normalized to null", () => {
        const s = parseReportUrl(new URLSearchParams("team=all"))
        expect(s.team).toBeNull()
    })

    it("view=table parses", () => {
        const s = parseReportUrl(new URLSearchParams("view=table"))
        expect(s.view).toBe("table")
    })

    it("garbage view falls back to report", () => {
        const s = parseReportUrl(new URLSearchParams("view=nope"))
        expect(s.view).toBe("report")
    })
})

// ── serializeReportUrl ──────────────────────────────────────

describe("serializeReportUrl", () => {
    it("DEFAULT_REPORT_STATE serializes to empty string", () => {
        expect(serializeReportUrl(DEFAULT_REPORT_STATE).toString()).toBe("")
    })

    it("non-default period emits param", () => {
        const s: ReportUrlState = { ...DEFAULT_REPORT_STATE, period: "monthly" }
        expect(serializeReportUrl(s).get("period")).toBe("monthly")
    })

    it("all_time period serializes as 'all' in URL [MF-1]", () => {
        const s: ReportUrlState = { ...DEFAULT_REPORT_STATE, period: "all_time" }
        expect(serializeReportUrl(s).get("period")).toBe("all")
    })

    it("repos=[] (explicit all) emits repos=", () => {
        const s: ReportUrlState = { ...DEFAULT_REPORT_STATE, repos: [] }
        expect(serializeReportUrl(s).toString()).toContain("repos=")
    })

    it("repos default omitted", () => {
        const s: ReportUrlState = { ...DEFAULT_REPORT_STATE, repos: ["gnolang/gno"] }
        expect(serializeReportUrl(s).has("repos")).toBe(false)
    })

    it("repos multi-value joined by comma + sorted [MF-8]", () => {
        const s: ReportUrlState = {
            ...DEFAULT_REPORT_STATE,
            repos: ["zzz/last", "aaa/first", "mmm/middle"],
        }
        expect(serializeReportUrl(s).get("repos")).toBe("aaa/first,mmm/middle,zzz/last")
    })

    it("pinAt:true emits at even when state is at default [MF-3]", () => {
        const s = { ...DEFAULT_REPORT_STATE, period: "weekly" as ReportPeriod, at: null }
        const out = serializeReportUrl(s, { pinAt: true })
        expect(out.get("at")).toMatch(WEEK_RE)
    })

    it("pinAt:false (default) omits at when equal to defaultKey", () => {
        const def = defaultKey("weekly")
        const s = { ...DEFAULT_REPORT_STATE, period: "weekly" as ReportPeriod, at: def }
        expect(serializeReportUrl(s).has("at")).toBe(false)
    })
})

// ── Round-trip / idempotency [MF-9] ─────────────────────────

describe("parse ∘ serialize round-trip", () => {
    it("default state → empty params → default state", () => {
        const s = parseReportUrl(serializeReportUrl(DEFAULT_REPORT_STATE))
        expect(s).toEqual(DEFAULT_REPORT_STATE)
    })

    it("monthly+team+tab+repos round-trip (non-default at)", () => {
        // Use 2025-03 — not the current month, so serializer must emit `at=`
        const original: ReportUrlState = {
            period: "monthly",
            at: "2025-03",
            tab: "merged",
            team: "Samourai.world",
            repos: ["gnolang/gno", "samouraiworld/memba"],
            view: "table",
            from: null,
            to: null,
        }
        const round = parseReportUrl(serializeReportUrl(original))
        expect(round).toEqual(original)
    })

    it("idempotency: serialize(parse(serialize(s))) === serialize(s) for many states", () => {
        const fixtures: ReportUrlState[] = [
            DEFAULT_REPORT_STATE,
            { ...DEFAULT_REPORT_STATE, period: "all_time", at: null },
            { ...DEFAULT_REPORT_STATE, period: "yearly", at: "2025", tab: "blocked" },
            { ...DEFAULT_REPORT_STATE, team: "Onbloc", repos: [] },
            { ...DEFAULT_REPORT_STATE, repos: ["a/b", "c/d", "e/f"] },
            { ...DEFAULT_REPORT_STATE, view: "table" },
        ]
        for (const s of fixtures) {
            const once = serializeReportUrl(s).toString()
            const twice = serializeReportUrl(parseReportUrl(new URLSearchParams(once))).toString()
            expect(twice).toBe(once)
        }
    })
})

// ── buildShareUrl ───────────────────────────────────────────

describe("buildShareUrl [MF-3 / S-3]", () => {
    it("reconstructs URL from state, not from window.location", () => {
        const url = buildShareUrl(
            "https://memba.samourai.app",
            "gnoland1",
            DEFAULT_REPORT_STATE,
        )
        // Pinned variant always includes at=
        expect(url).toMatch(/^https:\/\/memba\.samourai\.app\/gnoland1\/gnolove\/report\?at=/)
    })

    it("stripView option drops view=table from the embedded URL [MF-32 / A-9]", () => {
        const s: ReportUrlState = { ...DEFAULT_REPORT_STATE, view: "table" }
        const url = buildShareUrl("https://x", "test12", s, { stripView: true })
        expect(url).not.toContain("view=table")
    })

    it("includes filter params in the produced URL", () => {
        const s: ReportUrlState = {
            ...DEFAULT_REPORT_STATE,
            period: "monthly",
            at: "2026-05",
            team: "Samourai.world",
            tab: "merged",
        }
        const url = buildShareUrl("https://x", "test12", s)
        expect(url).toContain("period=monthly")
        expect(url).toContain("at=2026-05")
        expect(url).toContain("team=Samourai.world")
        expect(url).toContain("tab=merged")
    })
})
