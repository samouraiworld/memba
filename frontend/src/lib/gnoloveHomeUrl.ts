/**
 * Gnolove Home URL schema — shareable query-string state for /:network/gnolove.
 *
 * Encodes time filter, excluded teams, sort, repos, and page as URL params.
 * Same design contract as gnoloveReportUrl.ts: durable, safe parse,
 * default-elision serializer, Sentry breadcrumb on fallback.
 *
 * Plan: docs/planning/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md §8 Task 2.1.
 *
 * @module lib/gnoloveHomeUrl
 */

import { z } from "zod"
import * as Sentry from "@sentry/react"
import { TimeFilter, TEAMS } from "./gnoloveConstants"
import type { SortKey } from "./gnoloveFilters"

const KNOWN_TEAMS = new Set(TEAMS.map(t => t.name))

const MAX_REPOS = 50
const MAX_REPOS_RAW_LEN = 4096
const MAX_PAGE = 10_000 // sanity cap so ?page=99999999 doesn't render millions of empty rows

const REPO_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/

export interface HomeUrlState {
    time: TimeFilter
    /** Sorted list of excluded team names. */
    excludedTeams: readonly string[]
    sortBy: SortKey
    sortDir: "asc" | "desc"
    /** Sorted, deduped. [] = all repositories. */
    repos: readonly string[]
    page: number
}

export const DEFAULT_HOME_STATE: HomeUrlState = {
    time: TimeFilter.ALL_TIME,
    excludedTeams: [],
    sortBy: "score",
    sortDir: "desc",
    repos: [],
    page: 1,
}

// Rate-limited fallback breadcrumb
let lastFallbackMs = 0
function breadcrumbFallback(field: string, raw: unknown): void {
    const now = Date.now()
    if (now - lastFallbackMs < 60_000) return
    lastFallbackMs = now
    Sentry.addBreadcrumb({
        category: "gnolove.url.fallback",
        level: "info",
        data: { field, raw: String(raw).slice(0, 120) },
    })
}

export function __resetHomeFallbackRateLimitForTests(): void {
    lastFallbackMs = 0
}

const TimeSchema = z.enum([
    TimeFilter.ALL_TIME, TimeFilter.YEARLY, TimeFilter.MONTHLY, TimeFilter.WEEKLY,
]).catch(TimeFilter.ALL_TIME)
const SortBySchema = z.enum([
    "score", "TotalCommits", "TotalPrs", "TotalIssues", "TotalReviewedPullRequests",
]).catch("score")
const SortDirSchema = z.enum(["asc", "desc"]).catch("desc")

export function parseHomeUrl(params: URLSearchParams): HomeUrlState {
    const timeRaw = params.get("time")
    const time = TimeSchema.parse(timeRaw ?? TimeFilter.ALL_TIME) as TimeFilter
    if (timeRaw && time !== timeRaw) breadcrumbFallback("time", timeRaw)

    const sortByRaw = params.get("sortBy")
    const sortBy = SortBySchema.parse(sortByRaw ?? "score") as SortKey
    if (sortByRaw && sortBy !== sortByRaw) breadcrumbFallback("sortBy", sortByRaw)

    const sortDirRaw = params.get("sortDir")
    const sortDir = SortDirSchema.parse(sortDirRaw ?? "desc")

    // excludedTeams: comma-separated team names (allowlist-checked)
    const exRaw = params.get("excludeTeams")
    let excludedTeams: readonly string[] = []
    if (exRaw) {
        const parts = exRaw.split(",").map(s => s.trim()).filter(s => KNOWN_TEAMS.has(s))
        excludedTeams = Array.from(new Set(parts)).sort()
        if (parts.length !== exRaw.split(",").filter(Boolean).length) {
            breadcrumbFallback("excludeTeams", exRaw)
        }
    }

    // repos: same shape as report
    const reposRaw = params.get("repos")
    let repos: readonly string[]
    if (reposRaw === null || reposRaw === "") {
        repos = []
    } else if (reposRaw.length > MAX_REPOS_RAW_LEN) {
        breadcrumbFallback("repos.length", reposRaw.length)
        repos = []
    } else {
        const parsed = reposRaw.split(",").map(s => s.trim()).filter(s => REPO_RE.test(s))
        repos = Array.from(new Set(parsed)).sort().slice(0, MAX_REPOS)
    }

    // page: positive integer, defaulted + capped
    const pageRaw = params.get("page")
    let page = 1
    if (pageRaw) {
        const parsed = Number(pageRaw)
        if (Number.isFinite(parsed) && parsed >= 1) {
            page = Math.min(Math.floor(parsed), MAX_PAGE)
        } else {
            breadcrumbFallback("page", pageRaw)
        }
    }

    return { time, excludedTeams, sortBy, sortDir, repos, page }
}

export function serializeHomeUrl(s: HomeUrlState): URLSearchParams {
    const out = new URLSearchParams()
    if (s.time !== TimeFilter.ALL_TIME) out.set("time", s.time)
    if (s.sortBy !== "score") out.set("sortBy", s.sortBy)
    if (s.sortDir !== "desc") out.set("sortDir", s.sortDir)
    if (s.excludedTeams.length > 0) {
        out.set("excludeTeams", [...s.excludedTeams].sort().join(","))
    }
    if (s.repos.length > 0) {
        out.set("repos", [...s.repos].sort().join(","))
    }
    if (s.page > 1) out.set("page", String(s.page))
    return out
}
