/**
 * Gnolove report URL schema — shareable query-string state for /:network/gnolove/report.
 *
 * Encodes period, at (absolute period key), tab, team, repos, view as URL params.
 * Designed for durability (ISO-8601 absolute keys, not relative offsets), safe
 * parsing (every field has `.catch(default)` + Sentry breadcrumb on fallback),
 * and minimal URLs (defaults are omitted in normal serialization).
 *
 * Plan: docs/planning/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md §3.4.
 *
 * @module lib/gnoloveReportUrl
 */

import { z } from "zod"
import * as Sentry from "@sentry/react"
import {
    startOfWeek, endOfWeek, addWeeks,
    startOfMonth, endOfMonth,
    startOfYear, endOfYear,
    getISOWeek, getISOWeekYear, format,
} from "date-fns"
import { TEAMS, type ReportTab } from "./gnoloveConstants"

/** Runtime period type. URL boundary maps "all" ↔ "all_time" [MF-1]. */
export type ReportPeriod = "weekly" | "monthly" | "yearly" | "all_time" | "custom"
export type ReportTabOrAll = ReportTab | "all"
export type ReportView = "report" | "table"

/** Parsed, validated report URL state. Every field has a safe default. */
export interface ReportUrlState {
    period: ReportPeriod
    /** Absolute period key (e.g. "2026-W18", "2026-05", "2026"). null for all_time/custom. */
    at: string | null
    tab: ReportTabOrAll
    /** null = "All Teams". */
    team: string | null
    /** Sorted, deduped. [] = "All Repositories"; non-empty = explicit subset [MF-8]. */
    repos: readonly string[]
    view: ReportView
    /** Custom period start date (YYYY-MM-DD). Only used when period === "custom". */
    from: string | null
    /** Custom period end date (YYYY-MM-DD). Only used when period === "custom". */
    to: string | null
}

// ── URL ↔ runtime period mapping ────────────────────────────

const URL_PERIOD_TO_RUNTIME: Record<string, ReportPeriod> = {
    weekly: "weekly", monthly: "monthly", yearly: "yearly", all: "all_time", custom: "custom",
}
const RUNTIME_PERIOD_TO_URL: Record<ReportPeriod, string> = {
    weekly: "weekly", monthly: "monthly", yearly: "yearly", all_time: "all", custom: "custom",
}

// ── Allowlist of known teams (for stale-team detection [MF-18]) ──

const KNOWN_TEAMS = new Set(TEAMS.map(t => t.name))

// ── Hard caps [MF-24] ──────────────────────────────────────

const MAX_REPOS = 50
const MAX_REPOS_RAW_LEN = 4096

// ── Period-key regexes [MF-23: year range 2010–2039] ──────

export const WEEK_RE = /^(20[1-3]\d)-W(0[1-9]|[1-4]\d|5[0-3])$/
export const MONTH_RE = /^(20[1-3]\d)-(0[1-9]|1[0-2])$/
export const YEAR_RE = /^20[1-3]\d$/

const REPO_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/
export const DATE_RE = /^(20[1-3]\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

// ── Rate-limited fallback breadcrumb [MF-6] ────────────────

let lastFallbackMs = 0
function breadcrumbFallback(field: string, raw: unknown): void {
    const now = Date.now()
    if (now - lastFallbackMs < 60_000) return // ≤ 1/min
    lastFallbackMs = now
    Sentry.addBreadcrumb({
        category: "gnolove.url.fallback",
        level: "info",
        data: { field, raw: String(raw).slice(0, 120) },
    })
}

/** Test-only helper to reset the breadcrumb rate-limit between tests. */
export function __resetFallbackRateLimitForTests(): void {
    lastFallbackMs = 0
}

// ── Period-key helpers ──────────────────────────────────────

/** Returns the ISO week key for a given Date (Monday start). */
export function weekKeyFromDate(d: Date): string {
    return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`
}

/** Returns "YYYY-MM" for a given Date. */
export function monthKeyFromDate(d: Date): string {
    return format(d, "yyyy-MM")
}

/** Returns "YYYY" for a given Date. */
export function yearKeyFromDate(d: Date): string {
    return format(d, "yyyy")
}

/**
 * Parses a period key into an absolute date range.
 * For custom periods, pass `from`/`to` as ISO dates (YYYY-MM-DD).
 * Never throws — falls back to safe defaults with a Sentry capture.
 */
export function rangeFromKey(
    period: ReportPeriod,
    key: string | null,
    custom?: { from: string | null; to: string | null },
): { start: Date; end: Date } {
    try {
        const now = new Date()
        switch (period) {
            case "weekly": {
                const m = (key ?? "").match(WEEK_RE)
                if (!m) {
                    const ref = addWeeks(now, -1)
                    return {
                        start: startOfWeek(ref, { weekStartsOn: 1 }),
                        end: endOfWeek(ref, { weekStartsOn: 1 }),
                    }
                }
                const year = Number(m[1])
                const week = Number(m[2])
                // ISO 8601: Jan 4 is always in ISO week 1
                const jan4 = new Date(year, 0, 4)
                const week1Start = startOfWeek(jan4, { weekStartsOn: 1 })
                const target = addWeeks(week1Start, week - 1)
                return { start: target, end: endOfWeek(target, { weekStartsOn: 1 }) }
            }
            case "monthly": {
                const m = (key ?? "").match(MONTH_RE)
                if (!m) return { start: startOfMonth(now), end: endOfMonth(now) }
                const d = new Date(Number(m[1]), Number(m[2]) - 1, 1)
                return { start: startOfMonth(d), end: endOfMonth(d) }
            }
            case "yearly": {
                const m = (key ?? "").match(YEAR_RE)
                if (!m) return { start: startOfYear(now), end: endOfYear(now) }
                const d = new Date(Number(m[0]), 0, 1)
                return { start: startOfYear(d), end: endOfYear(d) }
            }
            case "all_time":
                return { start: new Date(2010, 0, 1), end: now }
            case "custom": {
                const fromStr = custom?.from
                const toStr = custom?.to
                if (fromStr && toStr && DATE_RE.test(fromStr) && DATE_RE.test(toStr)) {
                    const s = new Date(fromStr + "T00:00:00")
                    const e = new Date(toStr + "T23:59:59")
                    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s <= e) {
                        return { start: s, end: e }
                    }
                }
                const weekAgo = new Date(now)
                weekAgo.setDate(weekAgo.getDate() - 7)
                return { start: weekAgo, end: now }
            }
        }
    } catch (err) {
        Sentry.captureMessage(`rangeFromKey threw: ${String(err)}`, "warning")
        const now = new Date()
        const ref = addWeeks(now, -1)
        return {
            start: startOfWeek(ref, { weekStartsOn: 1 }),
            end: endOfWeek(ref, { weekStartsOn: 1 }),
        }
    }
}

/** Default period key for a given period (used when URL omits `at`). */
export function defaultKey(period: ReportPeriod, now: Date = new Date()): string | null {
    switch (period) {
        case "weekly":   return weekKeyFromDate(addWeeks(now, -1))
        case "monthly":  return monthKeyFromDate(now)
        case "yearly":   return yearKeyFromDate(now)
        case "all_time": return null
        case "custom":   return null
    }
}

/**
 * Compute next `at` when switching period A → B.
 * Uses END of current range so weeks spanning month boundaries land on the
 * month containing the week's last day [MF-4 / ADR-007].
 * Guards `all_time → X` so users aren't teleported to 2010-W01.
 */
export function nextAtForPeriodSwitch(
    currentPeriod: ReportPeriod,
    currentAt: string | null,
    nextPeriod: ReportPeriod,
): string | null {
    if (nextPeriod === "all_time") return null
    if (currentPeriod === "all_time" || currentPeriod === "custom") return defaultKey(nextPeriod)
    const { end } = rangeFromKey(currentPeriod, currentAt ?? defaultKey(currentPeriod))
    switch (nextPeriod) {
        case "weekly":  return weekKeyFromDate(end)
        case "monthly": return monthKeyFromDate(end)
        case "yearly":  return yearKeyFromDate(end)
        case "custom":  return null
    }
}

// ── Zod schemas ─────────────────────────────────────────────

const UrlPeriodSchema = z.enum(["weekly", "monthly", "yearly", "all", "custom"]).catch("monthly")
const TabSchema = z.enum([
    "all", "merged", "in_progress", "waiting_for_review", "reviewed", "blocked",
]).catch("all")
const ViewSchema = z.enum(["report", "table"]).catch("report")

/** Team charset/length restriction [MF-12]. Blocks RTL-override / length-DoS attacks. */
const TeamCharsetRe = /^[A-Za-z0-9 ._-]{1,64}$/

/**
 * Parse a `URLSearchParams` into a fully-validated `ReportUrlState`.
 * Every field is best-effort: bad input falls back to default with a breadcrumb.
 */
export function parseReportUrl(params: URLSearchParams): ReportUrlState {
    // ── period ──
    const periodRaw = params.get("period")
    const urlPeriod = UrlPeriodSchema.parse(periodRaw ?? "monthly")
    if (periodRaw && !["weekly", "monthly", "yearly", "all", "custom"].includes(periodRaw)) {
        breadcrumbFallback("period", periodRaw)
    }
    const period = URL_PERIOD_TO_RUNTIME[urlPeriod]

    // ── at ──
    const atRaw = params.get("at")
    let at: string | null = null
    if (atRaw) {
        const ok =
            (period === "weekly"  && WEEK_RE.test(atRaw)) ||
            (period === "monthly" && MONTH_RE.test(atRaw)) ||
            (period === "yearly"  && YEAR_RE.test(atRaw))
        if (ok) at = atRaw
        else breadcrumbFallback("at", atRaw)
    }

    // ── tab ──
    const tabRaw = params.get("tab")
    const tab = TabSchema.parse(tabRaw ?? "all")
    if (tabRaw && tabRaw !== tab) breadcrumbFallback("tab", tabRaw)

    // ── team: charset + allowlist [MF-12, MF-18] ──
    const teamRaw = params.get("team")
    let team: string | null = null
    if (teamRaw && teamRaw !== "all") {
        if (TeamCharsetRe.test(teamRaw) && KNOWN_TEAMS.has(teamRaw)) {
            team = teamRaw
        } else {
            breadcrumbFallback("team", teamRaw)
        }
    }

    // ── repos: caps + dedupe + sort [MF-8, MF-24] ──
    const reposRaw = params.get("repos")
    let repos: readonly string[]
    if (reposRaw === null) {
        repos = ["gnolang/gno"]
    } else if (reposRaw === "") {
        repos = []
    } else if (reposRaw.length > MAX_REPOS_RAW_LEN) {
        breadcrumbFallback("repos.length", reposRaw.length)
        repos = ["gnolang/gno"]
    } else {
        const parsed = reposRaw.split(",")
            .map(s => s.trim())
            .filter(s => REPO_RE.test(s))
        const unique = Array.from(new Set(parsed)).sort().slice(0, MAX_REPOS)
        repos = unique.length === 0 ? ["gnolang/gno"] : unique
    }

    // ── view ──
    const viewRaw = params.get("view")
    const view = ViewSchema.parse(viewRaw ?? "report")
    if (viewRaw && viewRaw !== view) breadcrumbFallback("view", viewRaw)

    // ── from / to (custom period) ──
    const fromRaw = params.get("from")
    const toRaw = params.get("to")
    let from: string | null = null
    let to: string | null = null
    if (period === "custom") {
        if (fromRaw && DATE_RE.test(fromRaw)) from = fromRaw
        if (toRaw && DATE_RE.test(toRaw)) to = toRaw
        if (!from || !to) {
            const now = new Date()
            const weekAgo = new Date(now)
            weekAgo.setDate(weekAgo.getDate() - 7)
            from = from ?? format(weekAgo, "yyyy-MM-dd")
            to = to ?? format(now, "yyyy-MM-dd")
        }
    }

    return { period, at, tab, team, repos, view, from, to }
}

/**
 * Serialize a `ReportUrlState` to a `URLSearchParams`.
 * In default mode, fields equal to defaults are omitted (minimum-length URLs).
 * In `pinAt: true` mode, `at` is always emitted (used by Copy Link) [MF-3].
 */
export function serializeReportUrl(
    s: ReportUrlState,
    opts: { pinAt?: boolean } = {},
): URLSearchParams {
    const out = new URLSearchParams()
    const urlPeriod = RUNTIME_PERIOD_TO_URL[s.period]
    if (urlPeriod !== "monthly") out.set("period", urlPeriod)

    const effectiveAt = s.at ?? defaultKey(s.period)
    if (opts.pinAt && effectiveAt) {
        out.set("at", effectiveAt)
    } else if (s.at && s.at !== defaultKey(s.period)) {
        out.set("at", s.at)
    }

    if (s.tab !== "all") out.set("tab", s.tab)
    if (s.team !== null) out.set("team", s.team)

    // repos: omit when equals default ["gnolang/gno"]; emit "" for explicit "all"
    const isDefaultRepos = s.repos.length === 1 && s.repos[0] === "gnolang/gno"
    if (s.repos.length === 0) {
        out.set("repos", "")
    } else if (!isDefaultRepos) {
        out.set("repos", [...s.repos].sort().join(","))
    }

    if (s.view !== "report") out.set("view", s.view)

    if (s.period === "custom") {
        if (s.from) out.set("from", s.from)
        if (s.to) out.set("to", s.to)
    }

    return out
}

/**
 * Reconstruct a shareable URL from validated state (NOT from window.location.href).
 * Used by `<CopyLinkButton>` and MD-export footer [MF-3 / Security S-3 / A-9].
 * @param stripView drop `view=table` from the URL (for MD-export "filter URL" footer).
 */
export function buildShareUrl(
    origin: string,
    networkKey: string,
    state: ReportUrlState,
    opts: { stripView?: boolean } = {},
): string {
    const effective: ReportUrlState = opts.stripView ? { ...state, view: "report" } : state
    const params = serializeReportUrl(effective, { pinAt: true }).toString()
    return `${origin}/${networkKey}/gnolove/report${params ? "?" + params : ""}`
}

/** Bare default state. Reads return new instances; consumers should not mutate. */
export const DEFAULT_REPORT_STATE: ReportUrlState = {
    period: "monthly",
    at: null,
    tab: "all",
    team: null,
    repos: ["gnolang/gno"],
    view: "report",
    from: null,
    to: null,
}
