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
 * pattern (useYourWorlds): per-DAO query, drop only on the chain's own answer,
 * degrade on transport failure, stay in a loading state until the first query
 * settles.
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
 *   - a DAO is dropped only when the chain ANSWERS that it doesn't render here:
 *     a null/empty render, or a strict-read AbciQueryError (realm not deployed).
 *   - a DAO whose strict render throws a TRANSPORT error (no RPC answered) is
 *     KEPT and flagged in `degraded` — nothing was confirmed either way, and
 *     silently dropping it deleted the user's saved DAOs during any transient
 *     outage (B-9). The chain's retained "not here" verdict outranks a later
 *     refetch error, so a dead entry never resurrects as a degraded card.
 *   - resolved DAOs keep their original metadata (name/category/isSaved); this
 *     hook only filters, it does not rewrite card content.
 *   - metadata only contains entries for resolved DAOs (parsed from the render);
 *     degraded DAOs have none — nothing was read.
 *   - localStorage is never mutated — stale saves simply don't appear.
 *
 * @module hooks/useResolvedDirectoryDaos
 */

import { useMemo } from "react"
import { useQueries } from "@tanstack/react-query"
import { queryRender } from "../lib/dao/shared"
import { AbciQueryError } from "../lib/rpcFallback"
import { parseDAORender, type DAOMetadata } from "../lib/daoMetadata"
import type { DirectoryDAO } from "../lib/directory"

/** Re-poll cadence for UNVERIFIED queries only (transport error, no answer
 *  yet). The app pins refetchOnWindowFocus:false and its global retry ignores
 *  plain transport errors, so without this a degraded card would recover only
 *  on a full tab remount. Answered queries (resolved or chain-declared-dead)
 *  never poll, and refetchIntervalInBackground stays false app-wide, so a
 *  hidden tab never drains the network. */
const DEGRADED_REPOLL_MS = 30_000

export interface ResolvedDirectoryDaosResult {
    /**
     * DAOs confirmed to render on the active network (input metadata
     * preserved), plus unverified ones kept during a transport outage — those
     * are flagged in `degraded`.
     */
    daos: DirectoryDAO[]
    /** Parsed card metadata for the resolved DAOs, keyed by realm path. */
    metadata: Map<string, DAOMetadata>
    /**
     * Realm paths of DAOs whose strict render hit a transport error (no RPC
     * answered): unverified, kept in `daos`, no metadata entry (B-9).
     */
    degraded: Set<string>
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
    // One STRICT render query per candidate DAO (B-9): an all-RPCs-down outage
    // THROWS instead of returning null. The old non-strict catch-all conflated
    // "realm not deployed on this network" with "no RPC answered" and silently
    // dropped the user's saved DAOs during any transient outage. staleTime
    // keeps the fan-out from re-firing on every tab re-render.
    const queries = useQueries({
        queries: daos.map((dao) => ({
            queryKey: ["directoryDaoRender", rpcUrl, dao.path],
            queryFn: async (): Promise<string | null> => {
                try {
                    return await queryRender(rpcUrl, dao.path, "", true)
                } catch (err) {
                    // The chain answered: realm not deployed here → the R2-D2
                    // drop signal, same as a null render. Anything else is
                    // transport — rethrow so the card degrades instead.
                    if (err instanceof AbciQueryError) return null
                    throw err
                }
            },
            staleTime: 60_000,
            // Self-recovery (B-9): only while unverified — never answered AND
            // errored. The moment any answer lands (data set, even null) the
            // gate closes and this query stops polling.
            refetchInterval: (query: { state: { data: unknown; status: string } }) =>
                query.state.data === undefined && query.state.status === "error"
                    ? DEGRADED_REPOLL_MS
                    : false,
        })),
    })

    // Loading while a query is pending and none has settled yet.
    const anyPending = queries.some((q) => q.isPending)
    const anySettled = queries.some((q) => q.isSuccess || q.isError)
    const loading = daos.length > 0 && anyPending && !anySettled

    // Per-DAO resolution flags as a stable string signature so the memoized
    // result keeps a stable identity across renders (consumers feed `daos`
    // into memo deps — a fresh array each render would thrash downstream memos).
    // Three states, decided on retained DATA first, not the error flag: React
    // Query keeps the previous data when a background refetch fails, and that
    // answer — the chain's own verdict — outranks a transient error.
    //   "1" resolved: render body is truthy → renders on this network.
    //   "0" dropped:  the chain answered nothing is here (null render or
    //       AbciQueryError→null above), or the query is still pending.
    //   "d" degraded: never got an answer AND the query errored → transport
    //       outage; keep the DAO, unverified (B-9).
    const resolvedFlags = queries
        .map((q) => {
            if (q?.data) return "1"
            if (q?.data === null) return "0"
            return q?.isError ? "d" : "0"
        })
        .join("")

    return useMemo<ResolvedDirectoryDaosResult>(() => {
        if (daos.length === 0) return { daos: [], metadata: new Map(), degraded: new Set(), loading: false }
        if (loading) return { daos: [], metadata: new Map(), degraded: new Set(), loading: true }
        const resolved: DirectoryDAO[] = []
        const metadata = new Map<string, DAOMetadata>()
        const degraded = new Set<string>()
        daos.forEach((dao, i) => {
            if (resolvedFlags[i] === "0") return
            resolved.push(dao)
            if (resolvedFlags[i] === "d") {
                // Unverified during the outage: keep the card, no metadata.
                degraded.add(dao.path)
                return
            }
            // Parse card metadata from the render we already fetched — no 2nd read.
            metadata.set(dao.path, parseDAORender(dao.path, queries[i].data ?? null))
        })
        return { daos: resolved, metadata, degraded, loading: false }
        // `queries` is intentionally omitted: its render bodies are read only to
        // build metadata, and `resolvedFlags` (derived from that same data)
        // changes precisely when a body arrives — so the memo already recomputes
        // at the right moments without depending on the unstable queries array.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [daos, loading, resolvedFlags])
}
