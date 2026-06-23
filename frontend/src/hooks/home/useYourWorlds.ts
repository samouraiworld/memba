/**
 * useYourWorlds — TanStack Query hook for the member "your worlds" panel.
 *
 * Reads saved DAOs from localStorage (via getSavedDAOsForOrg) and fetches
 * per-DAO activity (getDAOConfig + getDAOProposals) via useQueries — no
 * imperative forEach/catch-swallow, no races.
 *
 * Honesty contract:
 *   - openCount/health omitted (undefined) when the value is 0 or absent
 *   - name/href always present (from localStorage as fallback when RPC fails)
 *
 * State contract:
 *   - "empty"   → no saved DAOs (UI shows only the "Add a world" invitation)
 *   - "loading" → ≥1 saved DAO, fetches in flight
 *   - "ready"   → ≥1 query settled (success or error); individual errors degrade
 *                 that card but do NOT propagate to board state
 *   - "error"   → reserved for future total failures; individual errors use "ready"
 *                 with degraded card data
 *
 * @module hooks/home/useYourWorlds
 */

import { useQueries } from "@tanstack/react-query"
import type { DoorState } from "../../components/home/Door"
import { getSavedDAOsForOrg } from "../../lib/daoSlug"
import { getDAOConfig, getDAOProposals } from "../../lib/dao"
import { NETWORKS } from "../../lib/config"

export interface YourWorld {
    name: string
    role?: string
    openCount?: number
    health?: number
    href: string
    /** true when the per-world RPC fetch failed */
    degraded?: boolean
}

export interface YourWorldsResult {
    state: DoorState
    worlds: YourWorld[]
    refetch: () => void
}

/**
 * Resolve the member's saved worlds for the given network.
 *
 * @param networkKey  - active network identifier (e.g. "test13")
 * @param orgId       - active org id from OrgContext (null = personal)
 */
export function useYourWorlds(networkKey: string, orgId: string | null): YourWorldsResult {
    const savedDAOs = getSavedDAOsForOrg(orgId)
    const rpcUrl: string = NETWORKS[networkKey]?.rpcUrl ?? ""

    // useQueries — one query per saved DAO; rules-of-hooks safe (count may be 0)
    const queries = useQueries({
        queries: savedDAOs.map((dao) => ({
            queryKey: ["useYourWorlds", networkKey, dao.realmPath],
            queryFn: async () => {
                const [config, proposals] = await Promise.all([
                    getDAOConfig(rpcUrl, dao.realmPath),
                    getDAOProposals(rpcUrl, dao.realmPath),
                ])
                const openCount = proposals.filter((p) => p.status === "open").length
                return {
                    name: config?.name ?? dao.name,
                    openCount: openCount > 0 ? openCount : undefined,
                }
            },
            staleTime: 60_000,
        })),
    })

    /** Refetch all per-world queries (wires the error-state retry button). */
    const refetch = () => { queries.forEach((q) => { void q.refetch() }) }

    // ── Empty: no saved DAOs ─────────────────────────────────
    if (savedDAOs.length === 0) {
        return { state: "empty", worlds: [], refetch }
    }

    // ── Loading: any query still pending (none settled yet) ──
    const anyPending = queries.some((q) => q.isPending)
    const anySettled = queries.some((q) => q.isSuccess || q.isError)

    if (anyPending && !anySettled) {
        return { state: "loading", worlds: [], refetch }
    }

    // ── Ready: at least one query settled ────────────────────
    // Individual errors degrade the card (use saved name/href as fallback)
    // but do not elevate board state to "error".
    const worlds: YourWorld[] = savedDAOs.map((dao, i) => {
        const q = queries[i]
        const href = `/${networkKey}/dao/${dao.realmPath}`

        if (q?.isError || !q?.data) {
            // Degraded card — name/href from localStorage, no metrics
            return { name: dao.name, href, degraded: true }
        }

        const { name, openCount } = q.data
        return {
            name,
            href,
            openCount,
        }
    })

    return { state: "ready", worlds, refetch }
}
