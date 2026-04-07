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
            for (const login of excludeLogins) url.searchParams.append("exclude", login)
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
