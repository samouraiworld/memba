/**
 * useValidatorHealth — cheap validator network-health hook for the home panel.
 *
 * CHEAP SUBSET ONLY: calls getValidators() + computeNetworkHealth().
 * Does NOT call fetchLastBlockSignatures, fetchValoperMonikers, or
 * getAggregatedNetPeers (those are the heavy /validators-page enrichment,
 * ~100+ RPC calls). Home panel needs only a quick health signal.
 *
 * Status derivation:
 *   down > 0    → 'down'
 *   degraded > 0 → 'degraded'
 *   else         → 'healthy'
 *
 * @module hooks/home/useValidatorHealth
 */

import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { useHomeSnapshot } from "./useHomeSnapshot"
import { getValidators } from "../../lib/validators"
import { computeNetworkHealth } from "../../lib/validatorHealth"

export interface ValidatorHealth {
    /** Network-wide health status */
    status: "healthy" | "degraded" | "down"
    /** Active validators (from consensus active set) */
    active: number
    /** Total validators fetched */
    total: number
    /** Average uptime across validators with monitoring data (null = no data) */
    avgUptime: number | null
    /** Most recent incident across all validators (null = none) */
    latestIncident: {
        severity: string
        moniker: string
        details: string
    } | null
    loading: boolean
}

const STALE_TIME = 60_000 // 1 minute

async function fetchValidatorHealth(rpcUrl: string): Promise<Omit<ValidatorHealth, "loading">> {
    const validators = await getValidators(rpcUrl)
    const summary = computeNetworkHealth(validators)

    const status: ValidatorHealth["status"] =
        summary.down > 0 ? "down" :
        summary.degraded > 0 ? "degraded" :
        "healthy"

    const active = validators.filter((v) => v.active).length

    const latestIncident = summary.latestIncident
        ? {
            severity: summary.latestIncident.severity,
            moniker: summary.latestIncident.moniker,
            details: summary.latestIncident.details,
        }
        : null

    return {
        status,
        active,
        total: validators.length,
        avgUptime: summary.avgUptime,
        latestIncident,
    }
}

/**
 * useValidatorHealth — React Query hook for network-wide validator health.
 *
 * Never throws: returns loading=true while fetching, graceful defaults on error.
 *
 * Snapshot-first: when the home snapshot is available, returns the cheap
 * validatorsHealth subset (status/active/total). avgUptime and latestIncident
 * are null under the snapshot (v1 limitation — panel shows "—" for uptime and
 * hides the incident card, which is expected per spec).
 */
export function useValidatorHealth(): ValidatorHealth {
    const { rpcUrl } = useNetwork()
    const { snapshot, usable } = useHomeSnapshot()

    const query = useQuery({
        queryKey: ["home", "validators", rpcUrl],
        queryFn: () => fetchValidatorHealth(rpcUrl),
        staleTime: STALE_TIME,
        enabled: !usable,
    })

    if (usable) {
        return {
            status: (snapshot?.validatorsHealth?.status as ValidatorHealth["status"]) ?? "healthy",
            active: Number(snapshot?.validatorsHealth?.active ?? 0),
            total: Number(snapshot?.validatorsHealth?.total ?? 0),
            avgUptime: null,
            latestIncident: null,
            loading: false,
        }
    }

    return {
        status: query.data?.status ?? "healthy",
        active: query.data?.active ?? 0,
        total: query.data?.total ?? 0,
        avgUptime: query.data?.avgUptime ?? null,
        latestIncident: query.data?.latestIncident ?? null,
        loading: query.isLoading,
    }
}
