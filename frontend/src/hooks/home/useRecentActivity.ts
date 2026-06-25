/**
 * useRecentActivity — recent on-chain activity across gno.land for the home
 * "Live across gno.land" feed. Reads the official tx-indexer GraphQL
 * (see lib/activity.ts). Honest: empty window → empty list (UI shows an
 * invitation), error → error flag (UI shows retry), no indexer configured for
 * the network → `available: false` (the feed hides entirely).
 *
 * @module hooks/home/useRecentActivity
 */
import { useQuery } from "@tanstack/react-query"
import { fetchRecentActivity, type ActivityItem } from "../../lib/activity"
import { getIndexerUrl } from "../../lib/config"

export interface RecentActivityResult {
    items: ActivityItem[]
    loading: boolean
    error: boolean
    /** False when the active network has no indexer — the feed should not render. */
    available: boolean
    refetch: () => void
}

const LIMIT = 12

export function useRecentActivity(networkKey: string): RecentActivityResult {
    const indexerUrl = getIndexerUrl()

    const query = useQuery({
        queryKey: ["useRecentActivity", networkKey, indexerUrl],
        queryFn: ({ signal }) => fetchRecentActivity(indexerUrl as string, { limit: LIMIT, signal }),
        enabled: !!indexerUrl,
        staleTime: 30_000,
        refetchInterval: 60_000, // pauses automatically while the tab is hidden
        retry: false,
    })

    if (!indexerUrl) {
        return { items: [], loading: false, error: false, available: false, refetch: () => {} }
    }
    return {
        items: query.data ?? [],
        loading: query.isPending,
        error: query.isError,
        available: true,
        refetch: query.refetch,
    }
}
