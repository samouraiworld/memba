/**
 * useResolvedDirectoryDaos — filter the Directory DAO list down to the DAOs
 * that actually render on the active network (R2-D2).
 *
 * The Directory's DAO list (getDirectoryDAOs) is a static seed list + the user's
 * localStorage saves — none of which is network-aware. On test13 that means
 * legacy/other-network entries (FOUFOU DAO CLUB, hihihi, Surf Club DAO, French
 * Boulangerie, …) render as dead "404" cards. This hook resolves each entry
 * on-chain via getDAOConfig and keeps only those that respond, mirroring the
 * home "your worlds" pattern (useYourWorlds): per-DAO query, drop on null/error,
 * stay in a loading state until the first query settles.
 *
 * Honesty contract:
 *   - loading=true while any per-DAO config query is still pending and none has
 *     settled → callers render a loading state, never a stale DAO.
 *   - a DAO whose getDAOConfig returns null (realm doesn't render here) is dropped.
 *   - a DAO whose getDAOConfig throws (RPC error) is also dropped — we never want
 *     to surface a DAO we couldn't confirm is live on this network.
 *   - resolved DAOs keep their original metadata (name/category/isSaved); this
 *     hook only filters, it does not rewrite card content.
 *   - localStorage is never mutated — stale saves simply don't appear.
 *
 * @module hooks/useResolvedDirectoryDaos
 */

import { useMemo } from "react"
import { useQueries } from "@tanstack/react-query"
import { getDAOConfig } from "../lib/dao"
import type { DirectoryDAO } from "../lib/directory"

export interface ResolvedDirectoryDaosResult {
    /** DAOs confirmed to render on the active network (input metadata preserved). */
    daos: DirectoryDAO[]
    /** True while resolution is in flight and nothing has settled yet. */
    loading: boolean
}

/**
 * Resolve the directory DAO list against the active network.
 *
 * @param daos    - candidate DAOs (getDirectoryDAOs(): seeds + saved)
 * @param rpcUrl  - active network RPC URL
 */
export function useResolvedDirectoryDaos(daos: DirectoryDAO[], rpcUrl: string): ResolvedDirectoryDaosResult {
    // One resolve query per candidate DAO. queryFn returns whether the realm
    // rendered on this network; an RPC error is caught and treated as "did not
    // resolve" so a transient failure can't surface an unconfirmed DAO.
    const queries = useQueries({
        queries: daos.map((dao) => ({
            queryKey: ["resolvedDirectoryDao", rpcUrl, dao.path],
            queryFn: async () => {
                try {
                    const config = await getDAOConfig(rpcUrl, dao.path)
                    return config != null
                } catch {
                    return false
                }
            },
            staleTime: 60_000,
        })),
    })

    // Loading while a query is pending and none has settled yet.
    const anyPending = queries.some((q) => q.isPending)
    const anySettled = queries.some((q) => q.isSuccess || q.isError)
    const loading = daos.length > 0 && anyPending && !anySettled

    // Per-DAO resolution flags as a stable string signature so the memoized
    // result keeps a stable identity across renders (consumers feed `daos`
    // into effect deps — a fresh array each render would refetch on loop).
    const resolvedFlags = queries.map((q) => (q?.data === true ? "1" : "0")).join("")

    return useMemo<ResolvedDirectoryDaosResult>(() => {
        if (daos.length === 0) return { daos: [], loading: false }
        if (loading) return { daos: [], loading: true }
        // resolvedFlags encodes the per-DAO outcome; daos is the input list.
        const resolved = daos.filter((_, i) => resolvedFlags[i] === "1")
        return { daos: resolved, loading: false }
    }, [daos, loading, resolvedFlags])
}
