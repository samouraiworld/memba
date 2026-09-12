/**
 * useValidatorHealth — cheap validator network-health hook for the home panel.
 *
 * CHEAP SUBSET ONLY: getValidators() + fetchAllMonitoringData() + the health
 * pass. Does NOT call fetchLastBlockSignatures, fetchValoperMonikers, or
 * getAggregatedNetPeers (the heavy /validators-page enrichment, ~100+ RPC
 * calls). The monitoring fetch is a handful of HTTP calls to gnomonitoring, not
 * per-block RPC, so it stays inside the cheap budget.
 *
 * ⚠️ It is also MANDATORY, not enrichment. `/validators` is a consensus read:
 * the chain reports who is in the set and with what power, and nothing about
 * whether they are healthy. getValidators() therefore hardcodes
 * healthStatus: Unknown / uptimePercent: null / incidents: [] on every row.
 * Feeding that straight to computeNetworkHealth yields down === 0 &&
 * degraded === 0 for any input whatsoever — which is exactly what this hook
 * used to do, making the home panel a green light wired to nothing that could
 * not be made to show anything else.
 *
 * Status derivation — note the asymmetry, it is the point:
 *   down > 0     → 'down'
 *   degraded > 0 → 'degraded'
 *   healthy > 0  → 'healthy'   ← requires POSITIVE evidence
 *   else         → 'unknown'
 *
 * "No data" is never "healthy". A gnomonitoring outage must read as an absence
 * of information, not as a clean bill of health — the same reason the roster
 * renders an em dash rather than 0% for an absent metric.
 *
 * @module hooks/home/useValidatorHealth
 */

import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { useHomeSnapshot } from "./useHomeSnapshot"
import { getValidators, mergeWithMonitoringData } from "../../lib/validators"
import { computeNetworkHealth, computeHealthStatus } from "../../lib/validatorHealth"
import { fetchAllMonitoringData } from "../../lib/gnomonitoring"

export interface ValidatorHealth {
    /** Network-wide health status ("unknown" = data unavailable / query errored) */
    status: "healthy" | "degraded" | "down" | "unknown"
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
    // Monitoring is best-effort: a gnomonitoring outage must still render the
    // roster (count, active) — it just cannot produce a health verdict.
    const [validators, monitoring] = await Promise.all([
        getValidators(rpcUrl),
        fetchAllMonitoringData().catch(() => null),
    ])

    const enriched = monitoring
        ? mergeWithMonitoringData(validators, monitoring).map((v) => {
            const healthMeta = computeHealthStatus(v)
            return { ...v, healthStatus: healthMeta.status, healthMeta }
        })
        : validators

    const summary = computeNetworkHealth(enriched)

    // 'healthy' requires at least one validator we can positively vouch for.
    // Without that the honest answer is 'unknown' — see the module docstring.
    const status: ValidatorHealth["status"] =
        summary.down > 0 ? "down" :
        summary.degraded > 0 ? "degraded" :
        summary.healthy > 0 ? "healthy" :
        "unknown"

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
            status: (snapshot?.validatorsHealth?.status as ValidatorHealth["status"]) ?? "unknown",
            active: Number(snapshot?.validatorsHealth?.active ?? 0),
            total: Number(snapshot?.validatorsHealth?.total ?? 0),
            avgUptime: null,
            latestIncident: null,
            loading: false,
        }
    }

    return {
        status: query.data?.status ?? "unknown",
        active: query.data?.active ?? 0,
        total: query.data?.total ?? 0,
        avgUptime: query.data?.avgUptime ?? null,
        latestIncident: query.data?.latestIncident ?? null,
        loading: query.isLoading,
    }
}
