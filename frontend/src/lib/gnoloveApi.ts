/**
 * Gnolove Go Backend API — client-side fetch wrappers.
 *
 * Ported from gnolove/src/app/actions.ts (SSR server actions → SPA client fetch).
 * Every response is validated through Zod schemas at the API boundary.
 *
 * Uses GNOLOVE_API_URL from existing config.ts.
 * Matches gnomonitoring.ts patterns: AbortSignal, 8s timeout, null on failure.
 *
 * @module lib/gnoloveApi
 */

import { GNOLOVE_API_URL } from "./config"
import {
    ContributorsResponseSchema,
    IssueSchema,
    PullRequestReportSchema,
    PullRequestSchema,
    UserSchema,
    MilestoneSchema,
    RepositorySchema,
    ContributorSchema,
    PackagesSchema,
    NamespacesSchema,
    ProposalsSchema,
    GovdaoMembersSchema,
    ScoreFactorsSchema,
    AIReportsSchema,
    AIReportSchema,
    TeamsResponseSchema,
    TeamResponseSchema,
    ActiveReposResponseSchema,
    TeamStatsResponseSchema,
    TopicsResponseSchema,
    CohortsResponseSchema,
    TeamCollabResponseSchema,
} from "./gnoloveSchemas"
import type {
    TContributorsResponse,
    TIssue,
    TPullRequestReport,
    TPullRequest,
    TUser,
    TMilestone,
    TRepository,
    TContributor,
    TPackage,
    TNamespace,
    TProposal,
    TGovdaoMember,
    TScoreFactors,
    TAIReport,
    TTeamsResponse,
    TTeamResponse,
    TActiveReposResponse,
    TTeamStatsResponse,
    TTopicsResponse,
    TCohortsResponse,
    TTeamCollabResponse,
} from "./gnoloveSchemas"
import { z } from "zod"
import { TimeFilter } from "./gnoloveConstants"

const FETCH_TIMEOUT_MS = 8_000

// ── Internal helpers ─────────────────────────────────────────

class HttpError extends Error {
    status: number
    constructor(message: string, status: number) {
        super(message)
        this.name = "HttpError"
        this.status = status
    }
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    // AbortSignal.any() requires Safari 17.4+. Fallback to timeout-only for older browsers.
    let combinedSignal: AbortSignal
    if (signal && typeof AbortSignal.any === "function") {
        combinedSignal = AbortSignal.any([signal, controller.signal])
    } else if (signal) {
        // Fallback: listen to external signal and abort our controller
        signal.addEventListener("abort", () => controller.abort(), { once: true })
        combinedSignal = controller.signal
    } else {
        combinedSignal = controller.signal
    }

    try {
        const res = await fetch(url, { signal: combinedSignal })
        if (!res.ok) {
            const body = await res.text().catch(() => "")
            throw new HttpError(
                `Gnolove API error: ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`,
                res.status,
            )
        }
        return (await res.json()) as T
    } finally {
        clearTimeout(timeout)
    }
}

function apiUrl(path: string): string {
    return `${GNOLOVE_API_URL}${path}`
}

/** Extract owner/repo from a GitHub URL. */
export function extractRepoFromUrl(url: string): string {
    const match = url.match(/github\.com\/([^/]+\/[^/]+)/)
    return match ? match[1] : ""
}

// ── Public API ───────────────────────────────────────────────

/**
 * Fetch the contributor leaderboard with optional time filter and exclusions.
 */
export async function getContributors(
    timeFilter: TimeFilter = TimeFilter.ALL_TIME,
    excludeLogins?: string[],
    repositories?: string[],
    signal?: AbortSignal,
): Promise<TContributorsResponse | null> {
    try {
        const url = new URL("/stats", GNOLOVE_API_URL)
        if (timeFilter !== TimeFilter.ALL_TIME) url.searchParams.set("time", timeFilter)
        if (excludeLogins?.length) {
            for (const login of excludeLogins) {
                const sanitized = login.trim()
                if (sanitized) url.searchParams.append("exclude", sanitized)
            }
        }
        if (repositories?.length) url.searchParams.set("repositories", repositories.join(","))
        const data = await fetchJson(url.toString(), signal)
        return ContributorsResponseSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getContributors failed:", err)
        return null
    }
}

/**
 * Fetch help-wanted / bounty issues.
 */
export async function getLastIssues(signal?: AbortSignal): Promise<TIssue[]> {
    try {
        const data = await fetchJson(apiUrl("/issues?labels=help wanted,bounty"), signal)
        return z.array(IssueSchema).parse(data)
    } catch (err) {
        console.error("[Gnolove] getLastIssues failed:", err)
        return []
    }
}

/**
 * Fetch PR report for a date range.
 */
export async function getPullRequestsReport(
    startDate: Date,
    endDate: Date,
    signal?: AbortSignal,
): Promise<TPullRequestReport | null> {
    try {
        const url = new URL("/pull-requests/report", GNOLOVE_API_URL)
        url.searchParams.set("startdate", startDate.toISOString())
        url.searchParams.set("enddate", endDate.toISOString())
        const data = await fetchJson(url.toString(), signal)
        return PullRequestReportSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getPullRequestsReport failed:", err)
        return null
    }
}

/**
 * Fetch newest contributors.
 */
export async function getNewContributors(signal?: AbortSignal): Promise<TUser[]> {
    try {
        const data = await fetchJson(apiUrl("/contributors/newest?number=5"), signal)
        return z.array(UserSchema).parse(data)
    } catch (err) {
        console.error("[Gnolove] getNewContributors failed:", err)
        return []
    }
}

/**
 * Fetch recently merged PRs.
 */
export async function getFreshlyMerged(signal?: AbortSignal): Promise<TPullRequest[] | null> {
    try {
        const data = await fetchJson(apiUrl("/last-prs"), signal)
        return z.array(PullRequestSchema).nullish().parse(data) ?? null
    } catch (err) {
        console.error("[Gnolove] getFreshlyMerged failed:", err)
        return null
    }
}

/**
 * Fetch a specific milestone.
 */
export async function getMilestone(milestoneNumber: number, signal?: AbortSignal): Promise<TMilestone | null> {
    try {
        const data = await fetchJson(apiUrl(`/milestones/${milestoneNumber}`), signal)
        return MilestoneSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getMilestone failed:", err)
        return null
    }
}

/**
 * Fetch all tracked repositories.
 */
export async function getRepositories(signal?: AbortSignal): Promise<TRepository[]> {
    try {
        const data = await fetchJson(apiUrl("/repositories"), signal)
        return z.array(RepositorySchema).parse(data)
    } catch (err) {
        console.error("[Gnolove] getRepositories failed:", err)
        return []
    }
}

/**
 * Fetch a single contributor's profile.
 */
export async function getContributor(login: string, signal?: AbortSignal): Promise<TContributor | null> {
    try {
        if (!login) return null
        const data = await fetchJson(apiUrl(`/contributors/${encodeURIComponent(login)}`), signal)
        return ContributorSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getContributor failed:", err)
        return null
    }
}

/**
 * Fetch on-chain packages.
 */
export async function getPackages(signal?: AbortSignal): Promise<TPackage[]> {
    try {
        const data = await fetchJson(apiUrl("/onchain/packages"), signal)
        return PackagesSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getPackages failed:", err)
        return []
    }
}

/**
 * Fetch on-chain namespaces.
 */
export async function getNamespaces(signal?: AbortSignal): Promise<TNamespace[]> {
    try {
        const data = await fetchJson(apiUrl("/onchain/namespaces"), signal)
        return NamespacesSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getNamespaces failed:", err)
        return []
    }
}

/**
 * Fetch on-chain proposals.
 */
export async function getProposals(signal?: AbortSignal): Promise<TProposal[]> {
    try {
        const data = await fetchJson(apiUrl("/onchain/proposals"), signal)
        return ProposalsSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getProposals failed:", err)
        return []
    }
}

/**
 * Fetch GovDAO member list.
 */
export async function getGovdaoMembers(signal?: AbortSignal): Promise<TGovdaoMember[]> {
    try {
        const data = await fetchJson(apiUrl("/onchain/govdao-members"), signal)
        return GovdaoMembersSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getGovdaoMembers failed:", err)
        return []
    }
}

/**
 * Fetch scoring factor weights.
 */
export async function getScoreFactors(signal?: AbortSignal): Promise<TScoreFactors | null> {
    try {
        const data = await fetchJson(apiUrl("/score-factors"), signal)
        return ScoreFactorsSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getScoreFactors failed:", err)
        return null
    }
}

// ── AI Reports ──────────────────────────────────────────────────

/**
 * Fetch all AI-generated weekly reports.
 */
export async function getAIReports(signal?: AbortSignal): Promise<TAIReport[]> {
    try {
        const data = await fetchJson(apiUrl("/ai/reports"), signal)
        return AIReportsSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getAIReports failed:", err)
        return []
    }
}

/**
 * Fetch a single AI report by week range.
 */
export async function getAIReportByWeek(start: string, end: string, signal?: AbortSignal): Promise<TAIReport | null> {
    try {
        const data = await fetchJson(apiUrl(`/ai/report/weekly?start=${start}&end=${end}`), signal)
        return AIReportSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getAIReportByWeek failed:", err)
        return null
    }
}

// ── Teams (Phase 3) ─────────────────────────────────────────────

/**
 * Fetch the team roster from the backend (gnolove `config/teams.yaml`).
 * Returns null on failure so callers can fall back to the seed roster.
 */
export async function getTeams(signal?: AbortSignal): Promise<TTeamsResponse | null> {
    try {
        const data = await fetchJson(apiUrl("/teams"), signal)
        return TeamsResponseSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getTeams failed:", err)
        return null
    }
}

/**
 * Fetch a single team by slug (case-insensitive on the backend).
 */
export async function getTeam(slug: string, signal?: AbortSignal): Promise<TTeamResponse | null> {
    try {
        if (!slug) return null
        const data = await fetchJson(apiUrl(`/teams/${encodeURIComponent(slug)}`), signal)
        return TeamResponseSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getTeam failed:", err)
        return null
    }
}

/**
 * Fetch active repos for a team using the dual-threshold rule.
 * period accepts "daily" | "weekly" | "monthly" | "yearly" | "" (all-time).
 */
export async function getTeamActiveRepos(
    slug: string,
    period: string = "",
    signal?: AbortSignal,
): Promise<TActiveReposResponse | null> {
    try {
        if (!slug) return null
        const url = new URL(`/teams/${encodeURIComponent(slug)}/active-repos`, GNOLOVE_API_URL)
        if (period) url.searchParams.set("time", period)
        const data = await fetchJson(url.toString(), signal)
        return ActiveReposResponseSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getTeamActiveRepos failed:", err)
        return null
    }
}

// ── Topics (Phase 2c) ───────────────────────────────────────────

/**
 * Fetch the Focus Areas taxonomy from the backend
 * (gnolove `config/topics.yaml`). Returns null on failure so callers
 * can fall back to the seed taxonomy.
 */
export async function getTopics(signal?: AbortSignal): Promise<TTopicsResponse | null> {
    try {
        const data = await fetchJson(apiUrl("/topics"), signal)
        return TopicsResponseSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getTopics failed:", err)
        return null
    }
}

// ── Analytics (v6.2.2 — panels 4 & 5) ──────────────────────────

/**
 * Fetch the contributor-cohort retention table.
 * Backend caches 5 min; no query params today.
 */
export async function getContributorCohorts(signal?: AbortSignal): Promise<TCohortsResponse | null> {
    try {
        const data = await fetchJson(apiUrl("/contributors/cohorts"), signal)
        return CohortsResponseSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getContributorCohorts failed:", err)
        return null
    }
}

/**
 * Fetch the cross-team review matrix. `?time=` accepts the same
 * `daily|weekly|monthly|yearly|""` values as the team-stats endpoint.
 */
export async function getTeamCollab(period: string = "", signal?: AbortSignal): Promise<TTeamCollabResponse | null> {
    try {
        const url = new URL("/team-collab", GNOLOVE_API_URL)
        if (period) url.searchParams.set("time", period)
        const data = await fetchJson(url.toString(), signal)
        return TeamCollabResponseSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getTeamCollab failed:", err)
        return null
    }
}

/**
 * Fetch (repo, author) stats for a team with optional repo filter.
 */
export async function getTeamStats(
    slug: string,
    period: string = "",
    repos: string[] = [],
    signal?: AbortSignal,
): Promise<TTeamStatsResponse | null> {
    try {
        if (!slug) return null
        const url = new URL(`/teams/${encodeURIComponent(slug)}/team-stats`, GNOLOVE_API_URL)
        if (period) url.searchParams.set("time", period)
        for (const r of repos) {
            if (r.trim()) url.searchParams.append("repos", r.trim())
        }
        const data = await fetchJson(url.toString(), signal)
        return TeamStatsResponseSchema.parse(data)
    } catch (err) {
        console.error("[Gnolove] getTeamStats failed:", err)
        return null
    }
}
