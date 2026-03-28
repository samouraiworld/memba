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
import { TimeFilter, MILESTONE_NUMBER, TEAMS } from "../../lib/gnoloveConstants"

const STALE_DEFAULT = 30_000 // 30s — matches gnolove's REVALIDATE_SECONDS.DEFAULT
const STALE_ONCHAIN = 300_000 // 5m — on-chain data changes slowly

// ── Leaderboard / Contributors ───────────────────────────────

export function useGnoloveContributors(
    timeFilter: TimeFilter = TimeFilter.ALL_TIME,
    excludeCoreTeam: boolean = false,
    repositories?: string[],
) {
    const coreTeam = TEAMS.find(t => t.name === "Core Team")
    return useQuery({
        queryKey: ["gnolove", "contributors", timeFilter, excludeCoreTeam, repositories],
        queryFn: ({ signal }) =>
            api.getContributors(timeFilter, excludeCoreTeam, repositories, coreTeam?.members, signal),
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

// ── Heatmap (aggregate daily contributions) ─────────────────

export function useGnoloveHeatmapData(topLogins: string[]) {
    return useQuery({
        queryKey: ["gnolove", "heatmap", topLogins],
        queryFn: async ({ signal }) => {
            if (topLogins.length === 0) return []
            const profiles = await Promise.all(
                topLogins.slice(0, 20).map(login => api.getContributor(login, signal))
            )
            // Aggregate contributionsPerDay across all fetched contributors
            const dayMap = new Map<string, number>()
            for (const profile of profiles) {
                if (!profile?.contributionsPerDay) continue
                for (const { period, count } of profile.contributionsPerDay) {
                    dayMap.set(period, (dayMap.get(period) ?? 0) + count)
                }
            }
            return Array.from(dayMap.entries())
                .map(([date, count]) => ({ date, count }))
                .sort((a, b) => a.date.localeCompare(b.date))
        },
        enabled: topLogins.length > 0,
        staleTime: STALE_ONCHAIN, // 5 min — aggregated data, not real-time
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
