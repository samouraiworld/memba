/**
 * useLaneQuery — one TanStack Query per lane (marketplace-v2 Phase 2.2).
 *
 * Replaces the lanes' ad-hoc `useEffect` + `setState` + manual-cancel fetches (audit:
 * no cache, refetch-everything on every tab switch) with a cached query keyed by lane
 * (+ optional filters). Maps the lane's rows through its adapter into `CardModel`s the
 * shared `MarketCard`/`ListingGrid` render. Trades should `invalidateQueries(['market', lane])`
 * instead of reloading the page.
 *
 * @module lib/marketplace/useLaneQuery
 */
import { useQuery } from "@tanstack/react-query"
import type { AssetType, CardModel } from "./types"

export interface LaneQueryResult {
    cards: CardModel[]
    isLoading: boolean
    isError: boolean
    error: unknown
    refetch: () => void
}

export interface LaneQueryOptions {
    /** Extra query-key segments (e.g. filters) so distinct filter sets cache separately. */
    key?: readonly unknown[]
    /** Gate the fetch (e.g. lane not live / wallet not connected). */
    enabled?: boolean
    /** Cache freshness window; defaults to 30s. */
    staleTimeMs?: number
}

/**
 * @param lane     the asset lane (part of the cache key)
 * @param fetchFn  fetches the lane's rows (already validated by the codec)
 * @param toCard   pure adapter mapping a row to the shared CardModel
 */
export function useLaneQuery<T>(
    lane: AssetType,
    fetchFn: () => Promise<T[]>,
    toCard: (item: T) => CardModel,
    opts: LaneQueryOptions = {},
): LaneQueryResult {
    const q = useQuery({
        queryKey: ["market", lane, ...(opts.key ?? [])],
        queryFn: fetchFn,
        enabled: opts.enabled ?? true,
        staleTime: opts.staleTimeMs ?? 30_000,
    })

    return {
        cards: (q.data ?? []).map(toCard),
        isLoading: q.isLoading,
        isError: q.isError,
        error: q.error,
        refetch: () => {
            void q.refetch()
        },
    }
}
