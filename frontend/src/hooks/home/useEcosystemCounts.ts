/**
 * useEcosystemCounts — per-feature live count snapshot for the EcosystemPanel.
 *
 * Snapshot-first (Phase E2): when `useHomeSnapshot()` returns a usable snapshot
 * the four on-chain counts (tokens/agents/validators/collections) are read directly
 * from the backend-assembled snapshot, skipping all on-chain fan-out. The `daos`
 * count is always sourced from a separate always-on traction query so it continues
 * to work on every network, independent of the snapshot gate.
 *
 * Gate logic:
 *   - tokens:      snapshot.counts.tokens OR (if !usable) isTokenFactoryValid() gate
 *   - agents:      snapshot.counts.agents OR (if !usable) agent_registry allowlist gate
 *   - validators:  snapshot.counts.validators OR (if !usable) consensus endpoint
 *   - daos:        ALWAYS from fetchTractionMetrics — never gated by snapshot
 *   - collections: snapshot.counts.collections OR (if !usable) isNftLaunchpadValid() gate
 *
 * staleSources: if a source name appears in snapshot.staleSources the corresponding
 * field is returned as null so the panel renders "—" for that tile.
 *
 * @module hooks/home/useEcosystemCounts
 */

import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { useHomeSnapshot } from "./useHomeSnapshot"
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
 * Fetch tokens/agents/validators/collections with per-source isolation.
 * daos is intentionally excluded — it lives in a separate always-on query.
 * Network-gated: sources whose backing realm is not in the allowlist return null
 * immediately without making a network request.
 */
async function fetchEcosystemCounts(
    rpcUrl: string,
): Promise<Omit<EcosystemCounts, "daos">> {
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
        collections: get(3),
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
    const { snapshot, usable } = useHomeSnapshot()

    // daos is always sourced from traction — independent of snapshot gating
    const daosQuery = useQuery({
        queryKey: ["home", "ecosystem-daos"],
        queryFn: () => fetchTractionMetrics().then((m) => m.daoCount),
        staleTime: STALE_TIME,
    })

    // Main on-chain query — disabled when the snapshot is usable
    const query = useQuery({
        queryKey: ["home", "ecosystem", rpcUrl],
        queryFn: () => fetchEcosystemCounts(rpcUrl),
        staleTime: STALE_TIME,
        enabled: !usable,
    })

    const daos = daosQuery.data ?? null

    if (usable && snapshot) {
        // staleSources-aware mapping: if the backend flagged a source as stale,
        // return null so the panel shows "—" rather than a potentially stale 0.
        const stale = (name: string) =>
            snapshot.staleSources?.includes(name) ?? false
        const fromSnap = (
            name: "tokens" | "agents" | "validators" | "collections",
            v: number | undefined,
        ): number | null => (stale(name) ? null : Number(v ?? 0))

        return {
            tokens: fromSnap("tokens", snapshot.counts?.tokens),
            agents: fromSnap("agents", snapshot.counts?.agents),
            validators: fromSnap("validators", snapshot.counts?.validators),
            collections: fromSnap("collections", snapshot.counts?.collections),
            daos,
            loading: false,
        }
    }

    return {
        tokens: query.data?.tokens ?? null,
        agents: query.data?.agents ?? null,
        validators: query.data?.validators ?? null,
        collections: query.data?.collections ?? null,
        daos,
        loading: query.isLoading,
    }
}
