import { useQuery } from "@tanstack/react-query"
import { isAppReviewsAvailable } from "../../../lib/config"
import { fetchSummaries, type SubjectSummary } from "../../../lib/reviews"

const EMPTY: ReadonlyMap<string, SubjectSummary> = new Map()

/** On-chain rating summaries for many subjects; an unreadable one is simply absent. */
export function useReviewSummaries(chainId: string, subjects: readonly string[], enabled = true): ReadonlyMap<string, SubjectSummary> {
    const key = [...new Set(subjects)].sort()
    const query = useQuery({
        queryKey: ["reviews", "summaries", chainId, key],
        queryFn: () => fetchSummaries(key),
        enabled: enabled && key.length > 0 && isAppReviewsAvailable(),
        staleTime: 60_000, retry: 1,
    })
    return query.data ?? EMPTY
}
