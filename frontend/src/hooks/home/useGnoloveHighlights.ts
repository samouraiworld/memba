/**
 * useGnoloveHighlights — top-3 contributors from the Gnolove API for the
 * GnolovePanel home preview.
 *
 * 1 HTTP call (getContributors, ALL_TIME); result sorted by score desc,
 * sliced to top 3. staleTime: 300 000 ms (5 min cache).
 *
 * Never rejects — isError from React Query means the panel degrades to "—".
 *
 * @module hooks/home/useGnoloveHighlights
 */

import { useQuery } from "@tanstack/react-query"
import { getContributors } from "../../lib/gnoloveApi"
import { TimeFilter } from "../../lib/gnoloveConstants"

export interface GnoloveTopEntry {
    login: string
    score: number
    avatarUrl?: string
}

export interface GnoloveHighlights {
    top: GnoloveTopEntry[]
    contributorCount: number
    loading: boolean
}

/**
 * useGnoloveHighlights — React Query hook wrapping getContributors.
 *
 * Returns the top 3 contributors by score (descending) and the total
 * contributor count. On error/loading, `top` is [] and count is 0.
 */
export function useGnoloveHighlights(): GnoloveHighlights {
    const query = useQuery({
        queryKey: ["home", "gnolove"],
        queryFn: ({ signal }) => getContributors(TimeFilter.ALL_TIME, undefined, undefined, signal),
        staleTime: 300_000,
    })

    if (!query.data) {
        return { top: [], contributorCount: 0, loading: query.isLoading }
    }

    const sorted = [...query.data.users].sort((a, b) => b.score - a.score)
    const top: GnoloveTopEntry[] = sorted.slice(0, 3).map(u => ({
        login: u.login,
        score: u.score,
        avatarUrl: u.avatarUrl,
    }))

    return {
        top,
        contributorCount: query.data.users.length,
        loading: query.isLoading,
    }
}
