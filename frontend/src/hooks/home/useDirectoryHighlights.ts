/**
 * useDirectoryHighlights — member count + registry preview for the DirectoryPanel.
 *
 * Two cheap sources:
 *   1. Member count: fetchTractionMetrics() -> contributorCount (gnolove API)
 *   2. A few members: one ABCI Render of the users registry realm via
 *      queryRender + parseUserRegistry. Registry realm is gated by
 *      isRealmValidOn — if absent on this network, members is [].
 *
 * HONESTY: members are shown in registry order (NOT "newest" or "recent").
 * True newest-by-join requires a backend ListProfiles endpoint (Phase 2).
 *
 * staleTime: 300_000 ms (5 min).
 * Never rejects — errors produce empty members and memberCount 0.
 *
 * @module hooks/home/useDirectoryHighlights
 */

import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { fetchTractionMetrics } from "../../lib/traction"
import { parseUserRegistry, type DirectoryUser } from "../../lib/directory"
import { queryRender } from "../../lib/dao/shared"
import { isRealmValidOn, getUserRegistryPath } from "../../lib/config"

const STALE_TIME = 300_000 // 5 minutes
const MEMBER_PREVIEW_COUNT = 4

export interface DirectoryHighlights {
    memberCount: number
    /** First few registry entries (registry order — not "newest"). */
    members: DirectoryUser[]
    loading: boolean
}

async function fetchDirectoryHighlights(
    networkKey: string,
    rpcUrl: string,
): Promise<{ memberCount: number; members: DirectoryUser[] }> {
    const registryPath = getUserRegistryPath()
    const registryValid = isRealmValidOn(networkKey, registryPath)

    const [tractionResult, registryResult] = await Promise.allSettled([
        // Member count from gnolove stats
        fetchTractionMetrics().then(m => m.contributorCount),

        // Registry members — skipped when realm not deployed on this network
        registryValid
            ? queryRender(rpcUrl, registryPath, "").then(raw =>
                  raw ? parseUserRegistry(raw).slice(0, MEMBER_PREVIEW_COUNT) : [],
              )
            : Promise.resolve([] as DirectoryUser[]),
    ])

    return {
        memberCount:
            tractionResult.status === "fulfilled" ? tractionResult.value : 0,
        members:
            registryResult.status === "fulfilled" ? registryResult.value : [],
    }
}

/**
 * useDirectoryHighlights — React Query hook for the DirectoryPanel.
 *
 * Returns member count (from gnolove) and up to 4 registry members.
 * Degrades gracefully: count 0 / members [] on any failure.
 */
export function useDirectoryHighlights(): DirectoryHighlights {
    const { networkKey, rpcUrl } = useNetwork()

    const query = useQuery({
        queryKey: ["home", "directory", networkKey],
        queryFn: () => fetchDirectoryHighlights(networkKey, rpcUrl),
        staleTime: STALE_TIME,
    })

    return {
        memberCount: query.data?.memberCount ?? 0,
        members: query.data?.members ?? [],
        loading: query.isLoading,
    }
}
