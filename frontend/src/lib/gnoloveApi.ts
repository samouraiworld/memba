/**
 * Gnolove Go Backend API — client-side fetch wrappers.
 *
 * Every response is validated through Zod schemas at the API boundary.
 * Errors propagate to callers (React Query) so isError, retries, and
 * Sentry breadcrumbs work correctly.
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
    NotablePRSchema,
    BoardMetaSchema,
} from "./gnoloveSchemas"
import type {
    TContributorsResponse,
    TIssue,
    TPullRequestReport,
    TPullRequest,
    TNotablePR,
    TBoardMeta,
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

export class HttpError extends Error {
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

export async function getContributors(
    timeFilter: TimeFilter = TimeFilter.ALL_TIME,
    excludeLogins?: string[],
    repositories?: string[],
    signal?: AbortSignal,
): Promise<TContributorsResponse> {
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
}

export async function getLastIssues(signal?: AbortSignal): Promise<TIssue[]> {
    const data = await fetchJson(apiUrl("/issues?labels=help wanted,bounty"), signal)
    return z.array(IssueSchema).parse(data)
}

export async function getPullRequestsReport(
    startDate: Date,
    endDate: Date,
    signal?: AbortSignal,
): Promise<TPullRequestReport> {
    const url = new URL("/pull-requests/report", GNOLOVE_API_URL)
    url.searchParams.set("startdate", startDate.toISOString())
    url.searchParams.set("enddate", endDate.toISOString())
    const data = await fetchJson(url.toString(), signal)
    return PullRequestReportSchema.parse(data)
}

export async function getNewContributors(signal?: AbortSignal): Promise<TUser[]> {
    const data = await fetchJson(apiUrl("/contributors/newest?number=5"), signal)
    return z.array(UserSchema).parse(data)
}

export async function getFreshlyMerged(signal?: AbortSignal): Promise<TPullRequest[] | null> {
    const data = await fetchJson(apiUrl("/last-prs"), signal)
    return z.array(PullRequestSchema).nullish().parse(data) ?? null
}

/** Mirrored GitHub project boards and their taxonomy. */
export async function getBoards(signal?: AbortSignal): Promise<TBoardMeta[]> {
    const data = await fetchJson(apiUrl("/projects/boards"), signal)
    return z.array(BoardMetaSchema).nullish().parse(data) ?? []
}

/** One board's items (PRs/issues). Returns [] when empty/not synced. */
export async function getNotablePRs(boardId?: string, signal?: AbortSignal): Promise<TNotablePR[]> {
    const path = boardId ? `/projects/notable?board=${encodeURIComponent(boardId)}` : "/projects/notable"
    const data = await fetchJson(apiUrl(path), signal)
    return z.array(NotablePRSchema).nullish().parse(data) ?? []
}

export async function getMilestone(milestoneNumber: number, signal?: AbortSignal): Promise<TMilestone> {
    const data = await fetchJson(apiUrl(`/milestones/${milestoneNumber}`), signal)
    return MilestoneSchema.parse(data)
}

export async function getRepositories(signal?: AbortSignal): Promise<TRepository[]> {
    const data = await fetchJson(apiUrl("/repositories"), signal)
    return z.array(RepositorySchema).parse(data)
}

export async function getContributor(login: string, signal?: AbortSignal): Promise<TContributor | null> {
    if (!login) return null
    const data = await fetchJson(apiUrl(`/contributors/${encodeURIComponent(login)}`), signal)
    return ContributorSchema.parse(data)
}

export async function getPackages(signal?: AbortSignal): Promise<TPackage[]> {
    const data = await fetchJson(apiUrl("/onchain/packages"), signal)
    return PackagesSchema.parse(data)
}

export async function getNamespaces(signal?: AbortSignal): Promise<TNamespace[]> {
    const data = await fetchJson(apiUrl("/onchain/namespaces"), signal)
    return NamespacesSchema.parse(data)
}

export async function getProposals(signal?: AbortSignal): Promise<TProposal[]> {
    const data = await fetchJson(apiUrl("/onchain/proposals"), signal)
    return ProposalsSchema.parse(data)
}

export async function getGovdaoMembers(signal?: AbortSignal): Promise<TGovdaoMember[]> {
    const data = await fetchJson(apiUrl("/onchain/govdao-members"), signal)
    return GovdaoMembersSchema.parse(data)
}

export async function getScoreFactors(signal?: AbortSignal): Promise<TScoreFactors> {
    const data = await fetchJson(apiUrl("/score-factors"), signal)
    return ScoreFactorsSchema.parse(data)
}

// ── AI Reports ──────────────────────────────────────────────────

export async function getAIReports(signal?: AbortSignal): Promise<TAIReport[]> {
    const data = await fetchJson(apiUrl("/ai/reports"), signal)
    return AIReportsSchema.parse(data)
}

export async function getAIReportByWeek(start: string, end: string, signal?: AbortSignal): Promise<TAIReport> {
    const data = await fetchJson(apiUrl(`/ai/report/weekly?start=${start}&end=${end}`), signal)
    return AIReportSchema.parse(data)
}

// ── Teams (Phase 3) ─────────────────────────────────────────────

export async function getTeams(signal?: AbortSignal): Promise<TTeamsResponse> {
    const data = await fetchJson(apiUrl("/teams"), signal)
    return TeamsResponseSchema.parse(data)
}

export async function getTeam(slug: string, signal?: AbortSignal): Promise<TTeamResponse | null> {
    if (!slug) return null
    const data = await fetchJson(apiUrl(`/teams/${encodeURIComponent(slug)}`), signal)
    return TeamResponseSchema.parse(data)
}

export async function getTeamActiveRepos(
    slug: string,
    period: string = "",
    signal?: AbortSignal,
): Promise<TActiveReposResponse | null> {
    if (!slug) return null
    const url = new URL(`/teams/${encodeURIComponent(slug)}/active-repos`, GNOLOVE_API_URL)
    if (period) url.searchParams.set("time", period)
    const data = await fetchJson(url.toString(), signal)
    return ActiveReposResponseSchema.parse(data)
}

// ── Topics (Phase 2c) ───────────────────────────────────────────

export async function getTopics(signal?: AbortSignal): Promise<TTopicsResponse> {
    const data = await fetchJson(apiUrl("/topics"), signal)
    return TopicsResponseSchema.parse(data)
}

// ── Analytics (v6.2.2 — panels 4 & 5) ──────────────────────────

export async function getContributorCohorts(signal?: AbortSignal): Promise<TCohortsResponse> {
    const data = await fetchJson(apiUrl("/contributors/cohorts"), signal)
    return CohortsResponseSchema.parse(data)
}

export async function getTeamCollab(period: string = "", signal?: AbortSignal): Promise<TTeamCollabResponse> {
    const url = new URL("/team-collab", GNOLOVE_API_URL)
    if (period) url.searchParams.set("time", period)
    const data = await fetchJson(url.toString(), signal)
    return TeamCollabResponseSchema.parse(data)
}

export async function getTeamStats(
    slug: string,
    period: string = "",
    repos: string[] = [],
    signal?: AbortSignal,
): Promise<TTeamStatsResponse | null> {
    if (!slug) return null
    const url = new URL(`/teams/${encodeURIComponent(slug)}/team-stats`, GNOLOVE_API_URL)
    if (period) url.searchParams.set("time", period)
    for (const r of repos) {
        if (r.trim()) url.searchParams.append("repos", r.trim())
    }
    const data = await fetchJson(url.toString(), signal)
    return TeamStatsResponseSchema.parse(data)
}
