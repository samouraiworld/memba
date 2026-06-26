/**
 * useBlockTime — resolve a block height to its exact wall-clock time (epoch ms).
 *
 * Backed by react-query (block times are immutable, so cached forever) over the
 * single-flight resolver in lib/blockTimeRpc. Returns { ms, loading }:
 *   - loading=true while the height is being resolved
 *   - ms=null when height < 1 or resolution failed (caller shows a fallback)
 */
import { useQuery } from "@tanstack/react-query"
import { fetchBlockTime } from "../lib/blockTimeRpc"

export function useBlockTime(height: number): { ms: number | null; loading: boolean } {
    const enabled = !!height && height >= 1
    const query = useQuery({
        queryKey: ["blockTime", height],
        queryFn: () => fetchBlockTime(height),
        enabled,
        staleTime: Infinity, // a mined block's time never changes
        gcTime: Infinity,
        retry: false,
    })
    return {
        ms: query.data ?? null,
        loading: enabled && query.isPending,
    }
}
