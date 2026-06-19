/**
 * useEcosystemCounts — per-feature live count snapshot for the EcosystemPanel.
 *
 * Uses Promise.allSettled so each count source fails independently — a single
 * broken realm never blanks the whole tile grid.
 *
 * Gate logic:
 *   - tokens:      isTokenFactoryValid()  → tokenfactory_v2 allowlist
 *   - agents:      agent_registry in allowlist (isRealmValid)
 *   - validators:  always available (consensus endpoint, no realm gate)
 *   - daos:        always available (gnoweb namespace count via traction)
 *   - collections: isNftLaunchpadValid() → memba_collections allowlist
 *
 * @module hooks/home/useEcosystemCounts
 */

import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { listFactoryTokens } from "../../lib/grc20"
import { fetchAgents } from "../../lib/agentRegistry"
import { getValidators } from "../../lib/validators"
import { fetchTractionMetrics } from "../../lib/traction"
import { fetchCollectionList } from "../../lib/launchpadReads"
import {
    isTokenFactoryValid,
    isNftLaunchpadValid,
    isRealmValid,
    MEMBA_DAO,
} from "../../lib/config"

export interface EcosystemCounts {
    /** Number of GRC-20 tokens in the factory, or null when not deployed on this network. */
    tokens: number | null
    /** Number of agents in the registry, or null on failure / not deployed. */
    agents: number | null
    /** Number of active validators from consensus, or null on failure. */
    validators: number | null
    /** DAO count from gnoweb namespace, or null on failure. */
    daos: number | null
    /** Number of NFT collections in the registry, or null when not deployed. */
    collections: number | null
}

const STALE_TIME = 120_000 // 2 minutes

/**
 * Fetch all ecosystem counts with per-source isolation.
 * Network-gated: sources whose backing realm is not in the allowlist return null
 * immediately without making a network request.
 */
async function fetchEcosystemCounts(rpcUrl: string): Promise<EcosystemCounts> {
    // Build gated tasks — null placeholder = realm not valid on this network
    const tasks: (() => Promise<number | null>)[] = [
        // tokens
        isTokenFactoryValid()
            ? () => listFactoryTokens(rpcUrl).then((t) => t.length)
            : () => Promise.resolve(null),

        // agents — gate by agent_registry realm allowlist
        isRealmValid(MEMBA_DAO.agentRegistryPath)
            ? () => fetchAgents().then((a) => a.length)
            : () => Promise.resolve(null),

        // validators — no realm gate (consensus endpoint always available)
        () => getValidators(rpcUrl).then((v) => v.length),

        // daos — gnoweb namespace count, always available
        () => fetchTractionMetrics().then((m) => m.daoCount),

        // collections — gate by isNftLaunchpadValid (memba_collections allowlist)
        isNftLaunchpadValid()
            ? () => fetchCollectionList(rpcUrl).then((c) => c.length)
            : () => Promise.resolve(null),
    ]

    const results = await Promise.allSettled(tasks.map((fn) => fn()))

    const get = (i: number): number | null => {
        const r = results[i]
        return r.status === "fulfilled" ? r.value : null
    }

    return {
        tokens: get(0),
        agents: get(1),
        validators: get(2),
        daos: get(3),
        collections: get(4),
    }
}

/**
 * useEcosystemCounts — React Query hook wrapping fetchEcosystemCounts.
 *
 * staleTime: 120 000 ms — snapshot tier, refreshed on focus/reconnect by default.
 * Never rejects: allSettled ensures the hook always resolves with partial counts.
 */
export function useEcosystemCounts(): EcosystemCounts & { loading: boolean } {
    const { rpcUrl } = useNetwork()

    const query = useQuery({
        queryKey: ["home", "ecosystem", rpcUrl],
        queryFn: () => fetchEcosystemCounts(rpcUrl),
        staleTime: STALE_TIME,
    })

    return {
        tokens: query.data?.tokens ?? null,
        agents: query.data?.agents ?? null,
        validators: query.data?.validators ?? null,
        daos: query.data?.daos ?? null,
        collections: query.data?.collections ?? null,
        loading: query.isLoading,
    }
}
