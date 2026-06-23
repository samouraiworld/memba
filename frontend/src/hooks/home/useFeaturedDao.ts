/**
 * useFeaturedDao — per-network featured-DAO resolution with invitation fallback.
 *
 * Strategy:
 *  - Snapshot-first: when useHomeSnapshot is usable, maps featuredDao from the
 *    snapshot (avoids the on-chain fan-out).
 *  - On-chain fallback: fetches getDAOConfig + getDAOProposals when the snapshot
 *    is not usable and a featured DAO realm is configured + valid.
 *  - Invitation guarantee: resolves to state:"empty" (never 0/—/hidden) when no
 *    featured DAO exists on the active network, so the Door can offer a call-to-
 *    action instead of a blank card.
 *
 * @module hooks/home/useFeaturedDao
 */

import { useQuery } from "@tanstack/react-query"
import type { DoorState } from "../../components/home/Door"
import { getFeaturedDaoRealm, NETWORKS } from "../../lib/config"
import { getDAOConfig, getDAOProposals } from "../../lib/dao"
import { useHomeSnapshot } from "./useHomeSnapshot"

export interface FeaturedDao {
    name: string
    members?: number
    health?: number
    href: string
}

export interface FeaturedDaoResult {
    state: DoorState
    dao?: FeaturedDao
    /** Always set — `/${networkKey}/dao` — so the Door can invite in any non-ready state. */
    invitationHref: string
    /**
     * Trigger a fresh re-fetch of the on-chain query (no-op on the snapshot
     * path, since the snapshot has no underlying query to re-trigger here).
     * Always a stable function — wire directly to Door's onRetry.
     */
    refetch: () => void
}

/**
 * Resolve the featured DAO for the given network.
 *
 * - Configured + valid network with loaded data → state:"ready", dao populated.
 * - While loading → state:"loading".
 * - No configured/valid DAO, or data resolves to nothing → state:"empty".
 * - Fetch error → state:"error".
 * - invitationHref is ALWAYS `/${networkKey}/dao`.
 */
export function useFeaturedDao(networkKey: string): FeaturedDaoResult {
    const invitationHref = `/${networkKey}/dao`
    const realmPath = getFeaturedDaoRealm(networkKey)
    const { snapshot, usable, isLoading: snapshotLoading } = useHomeSnapshot()
    const rpcUrl: string = NETWORKS[networkKey]?.rpcUrl ?? ""

    // On-chain query — enabled only when snapshot is not usable, realm is
    // configured+valid, and we have an rpcUrl. The `enabled` flag keeps the
    // hook call unconditional (rules-of-hooks safe) while suppressing the
    // fetch on every non-on-chain path.
    const onChainQuery = useQuery({
        queryKey: ["useFeaturedDao", networkKey, realmPath],
        queryFn: async () => {
            if (!realmPath) return null
            const [config, proposals] = await Promise.all([
                getDAOConfig(rpcUrl, realmPath),
                getDAOProposals(rpcUrl, realmPath),
            ])
            if (!config) return null
            const openCount = proposals.filter(p => p.status === "open").length
            return { name: config.name, memberCount: config.memberCount, openCount }
        },
        enabled: !usable && !snapshotLoading && !!realmPath && !!rpcUrl,
        staleTime: 60_000,
    })

    // Stable refetch — delegates to react-query's refetch on the on-chain query.
    // On the snapshot path there is no underlying query to re-trigger, so refetch
    // is a no-op (snapshot data is managed externally). Always included so callers
    // can unconditionally wire it to onRetry.
    const refetch = () => { onChainQuery.refetch() }

    // ── Snapshot path ─────────────────────────────────────────
    if (usable) {
        const fd = snapshot?.featuredDao
        if (!fd?.realmPath || !fd?.name) {
            return { state: "empty", invitationHref, refetch }
        }
        return {
            state: "ready",
            dao: {
                name: fd.name,
                members: Number(fd.members) || undefined,
                href: `/${networkKey}/dao/${fd.realmPath}`,
            },
            invitationHref,
            refetch,
        }
    }

    // ── Snapshot still loading ────────────────────────────────
    if (snapshotLoading) {
        return { state: "loading", invitationHref, refetch }
    }

    // ── No featured DAO configured/valid on this network ─────
    if (!realmPath) {
        return { state: "empty", invitationHref, refetch }
    }

    // ── On-chain path ─────────────────────────────────────────
    if (onChainQuery.isLoading) {
        return { state: "loading", invitationHref, refetch }
    }

    if (onChainQuery.isError) {
        return { state: "error", invitationHref, refetch }
    }

    const data = onChainQuery.data
    if (!data) {
        return { state: "empty", invitationHref, refetch }
    }

    return {
        state: "ready",
        dao: {
            name: data.name,
            members: data.memberCount || undefined,
            href: `/${networkKey}/dao/${realmPath}`,
        },
        invitationHref,
        refetch,
    }
}
