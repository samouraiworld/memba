/**
 * useResolvedDirectoryDaos — filter the Directory DAO list down to the DAOs
 * that actually render on the active network (R2-D2), and hand back their card
 * metadata in the same pass.
 *
 * The Directory's DAO list (getDirectoryDAOs) is a static seed list + the user's
 * localStorage saves — none of which is network-aware. On test13 that means
 * legacy/other-network entries (FOUFOU DAO CLUB, hihihi, Surf Club DAO, French
 * Boulangerie, …) render as dead "404" cards. This hook resolves each entry
 * on-chain and keeps only those that respond, mirroring the home "your worlds"
 * pattern (useYourWorlds): per-DAO query, drop on null/error, stay in a loading
 * state until the first query settles.
 *
 * W3.2 (perf): resolution + card metadata now come from a SINGLE `Render("")`
 * per DAO, React-Query-cached (staleTime 60s). Previously the resolve step
 * called the heavy `getDAOConfig` (Render + a memberstore/IsArchived follow-up =
 * 2-4 reads) only to test non-null, and DAOsTab then ran a SECOND fan-out
 * (`batchGetDAOMetadata`, also a Render per DAO, capped at 10) — so the
 * Directory▸DAOs tab issued ~2-4× the reads it needed and re-fetched the same
 * render twice. Both concerns derive from that one render, so we do it once,
 * cache it, and parse metadata from the cached body. Resolution is
 * behaviour-preserving: `getDAOConfig` returned null exactly when its first
 * `Render("")` was falsy, which is the same signal we key on here.
 *
 * Honesty contract:
 *   - loading=true while any per-DAO render query is still pending and none has
 *     settled → callers render a loading state, never a stale DAO.
 *   - a DAO whose render is null/empty (realm doesn't render here) is dropped.
 *   - a DAO whose render throws (RPC error) is also dropped — we never want to
 *     surface a DAO we couldn't confirm is live on this network.
 *   - resolved DAOs keep their original metadata (name/category/isSaved); this
 *     hook only filters, it does not rewrite card content.
 *   - metadata only contains entries for resolved DAOs (parsed from the render).
 *   - localStorage is never mutated — stale saves simply don't appear.
 *
 * @module hooks/useResolvedDirectoryDaos
 */

import { useMemo } from "react"
import { useQueries } from "@tanstack/react-query"
import { queryRender } from "../lib/dao/shared"
import { parseDAORender, type DAOMetadata } from "../lib/daoMetadata"
import type { DirectoryDAO } from "../lib/directory"

export interface ResolvedDirectoryDaosResult {
    /** DAOs confirmed to render on the active network (input metadata preserved). */
    daos: DirectoryDAO[]
    /** Parsed card metadata for the resolved DAOs, keyed by realm path. */
    metadata: Map<string, DAOMetadata>
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
    // One render query per candidate DAO. The queryFn returns the raw Render("")
    // body (or null); an RPC error is caught and treated as "did not resolve" so
    // a transient failure can't surface an unconfirmed DAO. staleTime keeps the
    // fan-out from re-firing on every tab re-render.
    const queries = useQueries({
        queries: daos.map((dao) => ({
            queryKey: ["directoryDaoRender", rpcUrl, dao.path],
            queryFn: async (): Promise<string | null> => {
                try {
                    return await queryRender(rpcUrl, dao.path, "")
                } catch {
                    return null
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
    // into memo deps — a fresh array each render would thrash downstream memos).
    // A DAO resolves iff its render body is truthy (non-null, non-empty).
    const resolvedFlags = queries.map((q) => (q?.data ? "1" : "0")).join("")

    return useMemo<ResolvedDirectoryDaosResult>(() => {
        if (daos.length === 0) return { daos: [], metadata: new Map(), loading: false }
        if (loading) return { daos: [], metadata: new Map(), loading: true }
        const resolved: DirectoryDAO[] = []
        const metadata = new Map<string, DAOMetadata>()
        daos.forEach((dao, i) => {
            if (resolvedFlags[i] !== "1") return
            resolved.push(dao)
            // Parse card metadata from the render we already fetched — no 2nd read.
            metadata.set(dao.path, parseDAORender(dao.path, queries[i].data ?? null))
        })
        return { daos: resolved, metadata, loading: false }
        // `queries` is intentionally omitted: its render bodies are read only to
        // build metadata, and `resolvedFlags` (derived from that same data)
        // changes precisely when a body arrives — so the memo already recomputes
        // at the right moments without depending on the unstable queries array.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [daos, loading, resolvedFlags])
}
