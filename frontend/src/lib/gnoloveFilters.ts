/**
 * gnoloveFilters — Extracted filtering/sorting logic for the Gnolove contributor leaderboard.
 *
 * Extracted from GnoloveHome.tsx to enable unit testing.
 * The core insight: when team filters are active, we must client-side filter
 * because the API `exclude` param only removes excluded team members but
 * non-team contributors still pass through.
 *
 * @module lib/gnoloveFilters
 */

import { TEAMS } from "./gnoloveConstants"

export type SortKey = "score" | "TotalCommits" | "TotalPrs" | "TotalIssues" | "TotalReviewedPullRequests"

/** Minimal shape for filtering/sorting. Real data (TEnhancedUserWithStats) has more fields. */
export interface ContributorEntry {
    login: string
    score?: number
    TotalCommits?: number
    TotalPrs?: number
    TotalIssues?: number
    TotalReviewedPullRequests?: number
}

/**
 * Derive logins to exclude from the set of excluded team names.
 * Returns undefined if no teams are excluded (= show everyone).
 */
export function deriveExcludeLogins(excludedTeams: Set<string>): string[] | undefined {
    if (excludedTeams.size === 0) return undefined
    const logins: string[] = []
    for (const team of TEAMS) {
        if (excludedTeams.has(team.name)) {
            logins.push(...team.members)
        }
    }
    return logins.length > 0 ? logins : undefined
}

/**
 * Filter and sort contributors based on excluded teams and sort config.
 *
 * When any team is excluded, only show members of the remaining active teams.
 * The API exclude param filters out excluded team members, but non-team
 * contributors still pass through — this client-side filter catches those.
 *
 * Generic over T to preserve the full input type (e.g. TEnhancedUserWithStats).
 */
export function filterAndSortContributors<T extends ContributorEntry>(
    users: T[],
    excludedTeams: Set<string>,
    sortBy: SortKey,
    sortDir: "asc" | "desc",
): T[] {
    let filtered = users

    if (excludedTeams.size > 0) {
        const includedLogins = new Set<string>()
        for (const team of TEAMS) {
            if (!excludedTeams.has(team.name)) {
                for (const login of team.members) includedLogins.add(login)
            }
        }
        filtered = users.filter(u => includedLogins.has(u.login))
    }

    return [...filtered].sort((a, b) => {
        const diff = (b[sortBy] ?? 0) - (a[sortBy] ?? 0)
        return sortDir === "desc" ? diff : -diff
    })
}
