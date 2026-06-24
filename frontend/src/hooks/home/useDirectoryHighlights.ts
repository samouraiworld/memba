/**
 * useDirectoryHighlights — member count + registry preview for the DirectoryPanel.
 *
 * Snapshot-first (Phase E4): when `useHomeSnapshot()` returns a usable snapshot
 * the members preview list is read from `snapshot.directoryMembers` instead of
 * running a live ABCI Render of the users-registry realm. The member COUNT is
 * always sourced from a separate always-on traction query so it continues to
 * work on every network, independent of the snapshot gate.
 *
 * Gate logic:
 *   - memberCount: ALWAYS from fetchTractionMetrics().contributorCount (client-side)
 *   - members:     snapshot.directoryMembers (when usable) OR registry queryRender (!usable)
 *
 * Two sources:
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
import { useHomeSnapshot } from "./useHomeSnapshot"
import { fetchTractionMetrics } from "../../lib/traction"
import { parseUserRegistry, type DirectoryUser } from "../../lib/directory"
import { queryRender } from "../../lib/dao/shared"
import { isRealmValidOn, getUserRegistryPath } from "../../lib/config"
import type { DirectoryMember } from "../../gen/memba/v1/memba_pb"

const STALE_TIME = 300_000 // 5 minutes
const MEMBER_PREVIEW_COUNT = 4

export interface DirectoryHighlights {
    memberCount: number
    /** First few registry entries (registry order — not "newest"). */
    members: DirectoryUser[]
    loading: boolean
}

/**
 * Map snapshot DirectoryMember[] to the DirectoryUser shape used by the panel.
 * Sliced to MEMBER_PREVIEW_COUNT to match the on-chain registry path behavior.
 */
function mapSnapshotMembers(members: DirectoryMember[]): DirectoryUser[] {
    return members.slice(0, MEMBER_PREVIEW_COUNT).map((m) => ({
        name: m.name,
        address: m.address,
        // avatarUrl is optional on DirectoryUser; include only when non-empty
        ...(m.avatarUrl ? { avatarUrl: m.avatarUrl } : {}),
    }))
}

async function fetchRegistryMembers(
    networkKey: string,
    rpcUrl: string,
): Promise<DirectoryUser[]> {
    const registryPath = getUserRegistryPath()
    const registryValid = isRealmValidOn(networkKey, registryPath)

    if (!registryValid) return []

    try {
        const raw = await queryRender(rpcUrl, registryPath, "")
        return raw ? parseUserRegistry(raw).slice(0, MEMBER_PREVIEW_COUNT) : []
    } catch {
        return []
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
    const { snapshot, usable } = useHomeSnapshot()

    // memberCount is ALWAYS from traction — never gated by snapshot
    const memberCountQuery = useQuery({
        queryKey: ["home", "directory-member-count"],
        queryFn: () => fetchTractionMetrics().then((m) => m.contributorCount),
        staleTime: STALE_TIME,
    })

    // Registry members query — disabled when snapshot is usable
    const registryQuery = useQuery({
        queryKey: ["home", "directory-registry", networkKey],
        queryFn: () => fetchRegistryMembers(networkKey, rpcUrl),
        staleTime: STALE_TIME,
        enabled: !usable,
    })

    const memberCount = memberCountQuery.data ?? 0

    if (usable && snapshot) {
        return {
            memberCount,
            members: mapSnapshotMembers(snapshot.directoryMembers),
            loading: false,
        }
    }

    return {
        memberCount,
        members: registryQuery.data ?? [],
        loading: registryQuery.isLoading,
    }
}
