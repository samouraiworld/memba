/**
 * React Query hooks for the Gnolove data layer.
 *
 * All queries are scoped to the GnoloveLayout QueryClientProvider
 * and automatically cleaned up when navigating away from /gnolove.
 *
 * @module hooks/gnolove
 */

import { useQuery } from "@tanstack/react-query"
import * as api from "../../lib/gnoloveApi"
import { TimeFilter, MILESTONE_NUMBER } from "../../lib/gnoloveConstants"

const STALE_DEFAULT = 30_000 // 30s — matches gnolove's REVALIDATE_SECONDS.DEFAULT
const STALE_ONCHAIN = 300_000 // 5m — on-chain data changes slowly

// ── Leaderboard / Contributors ───────────────────────────────

export function useGnoloveContributors(
    timeFilter: TimeFilter = TimeFilter.ALL_TIME,
    excludeLogins?: string[],
    repositories?: string[],
) {
    return useQuery({
        queryKey: ["gnolove", "contributors", timeFilter, excludeLogins, repositories],
        queryFn: ({ signal }) =>
            api.getContributors(timeFilter, excludeLogins, repositories, signal),
        staleTime: STALE_DEFAULT,
    })
}

// ── Issues (help wanted / bounty) ────────────────────────────

export function useGnoloveIssues() {
    return useQuery({
        queryKey: ["gnolove", "issues"],
        queryFn: ({ signal }) => api.getLastIssues(signal),
        staleTime: STALE_DEFAULT,
    })
}

// ── PR Report (date range) ───────────────────────────────────

export function useGnoloveReport(startDate: Date, endDate: Date) {
    return useQuery({
        queryKey: ["gnolove", "report", startDate.toISOString(), endDate.toISOString()],
        queryFn: ({ signal }) => api.getPullRequestsReport(startDate, endDate, signal),
        staleTime: STALE_DEFAULT,
    })
}

// ── New Contributors ─────────────────────────────────────────

export function useGnoloveNewContributors() {
    return useQuery({
        queryKey: ["gnolove", "newContributors"],
        queryFn: ({ signal }) => api.getNewContributors(signal),
        staleTime: STALE_DEFAULT,
    })
}

// ── Freshly Merged PRs ──────────────────────────────────────

export function useGnoloveFreshlyMerged() {
    return useQuery({
        queryKey: ["gnolove", "freshlyMerged"],
        queryFn: ({ signal }) => api.getFreshlyMerged(signal),
        staleTime: STALE_DEFAULT,
    })
}

// ── Milestone ────────────────────────────────────────────────

export function useGnoloveMilestone() {
    return useQuery({
        queryKey: ["gnolove", "milestone", MILESTONE_NUMBER],
        queryFn: ({ signal }) => api.getMilestone(MILESTONE_NUMBER, signal),
        staleTime: STALE_DEFAULT,
    })
}

// ── Repositories ─────────────────────────────────────────────

export function useGnoloveRepositories() {
    return useQuery({
        queryKey: ["gnolove", "repositories"],
        queryFn: ({ signal }) => api.getRepositories(signal),
        staleTime: STALE_DEFAULT,
    })
}

// ── Score Factors ────────────────────────────────────────────

export function useGnoloveScoreFactors() {
    return useQuery({
        queryKey: ["gnolove", "scoreFactors"],
        queryFn: ({ signal }) => api.getScoreFactors(signal),
        staleTime: STALE_DEFAULT,
    })
}

// ── Contributor Profile ──────────────────────────────────────

export function useGnoloveContributor(login: string) {
    return useQuery({
        queryKey: ["gnolove", "contributor", login],
        queryFn: ({ signal }) => api.getContributor(login, signal),
        enabled: !!login,
        staleTime: STALE_DEFAULT,
    })
}

// ── Repo Activity (aggregated from report) ───────────────────

export function useGnoloveRepoActivity() {
    return useQuery({
        queryKey: ["gnolove", "repoActivity"],
        queryFn: async ({ signal }) => {
            const yearAgo = new Date()
            yearAgo.setFullYear(yearAgo.getFullYear() - 1)
            const report = await api.getPullRequestsReport(yearAgo, new Date(), signal)
            if (!report?.merged) return []
            const repoMap = new Map<string, number>()
            for (const pr of report.merged) {
                const repo = api.extractRepoFromUrl(pr.url)
                if (repo) repoMap.set(repo, (repoMap.get(repo) ?? 0) + 1)
            }
            return Array.from(repoMap.entries())
                .map(([name, prs]) => ({ name, prs }))
                .sort((a, b) => b.prs - a.prs)
                .slice(0, 15)
        },
        staleTime: STALE_ONCHAIN,
    })
}

// ── Monthly Activity Trend (from report) ─────────────────────

export function useGnoloveMonthlyActivity() {
    return useQuery({
        queryKey: ["gnolove", "monthlyActivity"],
        queryFn: async ({ signal }) => {
            const yearAgo = new Date()
            yearAgo.setFullYear(yearAgo.getFullYear() - 1)
            const report = await api.getPullRequestsReport(yearAgo, new Date(), signal)
            if (!report) return []
            // Bucket all PRs by month using creation/merge date.
            // Note: "reviewed" from the API is a snapshot (currently OPEN + APPROVED),
            // not historical review count. We combine reviewed + waiting as "in review"
            // since both represent open PRs with review activity.
            const allPrs = [
                ...(report.merged ?? []).map(pr => ({ ...pr, _status: "merged" as const })),
                ...(report.in_progress ?? []).map(pr => ({ ...pr, _status: "open" as const })),
                ...(report.reviewed ?? []).map(pr => ({ ...pr, _status: "inReview" as const })),
                ...(report.waiting_for_review ?? []).map(pr => ({ ...pr, _status: "inReview" as const })),
                ...(report.blocked ?? []).map(pr => ({ ...pr, _status: "open" as const })),
            ]
            const monthMap = new Map<string, { merged: number; open: number; inReview: number }>()
            for (const pr of allPrs) {
                const date = pr.mergedAt ?? pr.createdAt
                if (!date) continue
                const month = date.slice(0, 7) // "YYYY-MM"
                const entry = monthMap.get(month) ?? { merged: 0, open: 0, inReview: 0 }
                if (pr._status === "merged") entry.merged++
                else if (pr._status === "inReview") entry.inReview++
                else entry.open++
                monthMap.set(month, entry)
            }
            return Array.from(monthMap.entries())
                .map(([month, counts]) => ({ month, ...counts }))
                .sort((a, b) => a.month.localeCompare(b.month))
        },
        staleTime: STALE_ONCHAIN,
    })
}

// ── On-Chain Data ────────────────────────────────────────────

export function useGnolovePackages() {
    return useQuery({
        queryKey: ["gnolove", "packages"],
        queryFn: ({ signal }) => api.getPackages(signal),
        staleTime: STALE_ONCHAIN,
    })
}

export function useGnoloveNamespaces() {
    return useQuery({
        queryKey: ["gnolove", "namespaces"],
        queryFn: ({ signal }) => api.getNamespaces(signal),
        staleTime: STALE_ONCHAIN,
    })
}

export function useGnoloveProposals() {
    return useQuery({
        queryKey: ["gnolove", "proposals"],
        queryFn: ({ signal }) => api.getProposals(signal),
        staleTime: STALE_ONCHAIN,
    })
}

export function useGnoloveGovdaoMembers() {
    return useQuery({
        queryKey: ["gnolove", "govdaoMembers"],
        queryFn: ({ signal }) => api.getGovdaoMembers(signal),
        staleTime: STALE_ONCHAIN,
    })
}
