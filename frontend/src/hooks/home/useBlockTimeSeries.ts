/**
 * useBlockTimeSeries — recent block-interval series for the NetworkHealthDoor
 * sparkline (R2-H4a).
 *
 * Fetches the last ~SERIES_WINDOW blocks' timestamps from the tx-indexer and
 * computes consecutive deltas (seconds per block). Requests go through the
 * SAME backend proxy as the activity feed (`getIndexerUrl()` → `/api/indexer`):
 * the browser can't call the public indexer directly (no CORS), so the proxy
 * forwards server-side. Reuses the `gql` helper and the `getBlocks` query shape
 * from lib/activity.
 *
 * HONESTY: an empty / single-block / unavailable window yields an EMPTY series;
 * the door then renders NO sparkline rather than a flat fake line. The query is
 * disabled entirely when the active network has no indexer (getIndexerUrl null).
 *
 * @module hooks/home/useBlockTimeSeries
 */

import { useQuery } from "@tanstack/react-query"
import { gql } from "../../lib/activity"
import { getIndexerUrl } from "../../lib/config"

/** How many recent blocks to sample for the sparkline. ~24 → 23 intervals. */
const SERIES_WINDOW = 24
/** Re-poll cadence — matches the network pulse (30s) so the sparkline stays fresh. */
const REFETCH_INTERVAL = 30_000

export interface BlockTimeSeries {
    /** Seconds-per-block intervals, oldest→newest. Empty when unavailable. */
    series: number[]
    loading: boolean
    /** true when the indexer call failed — door omits the sparkline regardless. */
    error: boolean
}

/**
 * Pure: map raw {height,time} blocks → consecutive second-deltas.
 * Sorts by height ascending, drops unparseable timestamps, clamps negatives to 0.
 * Exported for direct unit testing of the interval math.
 */
export function computeBlockIntervals(blocks: { height: number; time: string }[]): number[] {
    const times = [...blocks]
        .sort((a, b) => a.height - b.height)
        .map((b) => Date.parse(b.time))
        .filter((t) => !Number.isNaN(t))
    const intervals: number[] = []
    for (let i = 1; i < times.length; i++) {
        intervals.push(Math.max(0, Math.round((times[i] - times[i - 1]) / 1000)))
    }
    return intervals
}

/**
 * Fetch the last SERIES_WINDOW blocks' timestamps and reduce them to an interval
 * series. Best-effort: a missing/empty window resolves to [] (no throw on the
 * empty path); a hard indexer error throws so React Query surfaces `isError`.
 */
async function fetchBlockTimeSeries(indexerUrl: string, signal?: AbortSignal): Promise<number[]> {
    const { latestBlockHeight: tip } = await gql<{ latestBlockHeight: number }>(
        indexerUrl, `{ latestBlockHeight }`, signal,
    )
    if (!tip || tip <= 0) return []
    const from = Math.max(1, tip - SERIES_WINDOW + 1)

    const { getBlocks } = await gql<{ getBlocks: { height: number; time: string }[] }>(
        indexerUrl,
        `{ getBlocks(where:{height:{gt:${from - 1}, lt:${tip + 1}}}) { height time } }`,
        signal,
    )
    return computeBlockIntervals(getBlocks ?? [])
}

/**
 * useBlockTimeSeries — React Query hook for the block-interval sparkline.
 * Returns an empty series (and never throws to the caller) when the network has
 * no indexer or the window is empty; `error` is true only on a hard fetch error.
 */
export function useBlockTimeSeries(): BlockTimeSeries {
    const indexerUrl = getIndexerUrl()

    const query = useQuery({
        queryKey: ["home", "block-time-series", indexerUrl],
        queryFn: ({ signal }) => fetchBlockTimeSeries(indexerUrl as string, signal),
        enabled: indexerUrl != null,
        staleTime: REFETCH_INTERVAL,
        refetchInterval: REFETCH_INTERVAL,
    })

    return {
        series: query.data ?? [],
        loading: query.isLoading && indexerUrl != null,
        error: query.isError,
    }
}
