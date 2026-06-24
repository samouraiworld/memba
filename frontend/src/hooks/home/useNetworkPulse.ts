/**
 * useNetworkPulse — shared network heartbeat hook for the home StatusStrip.
 *
 * Polls block height, avg block time, and validator count every 30s via
 * React Query.
 *
 * Phase E1: reads from the GetHomeSnapshot cache when available (snapshot-first
 * pattern). The statsQuery is disabled while the snapshot is usable so we avoid
 * a redundant on-chain /status call.
 *
 * Known v1 limitation: the snapshot sets avgBlockTimeMs = 0, so avgBlockTime
 * will be 0 when the snapshot is active. This is acceptable.
 *
 * @module hooks/home/useNetworkPulse
 */

import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { getNetworkStats } from "../../lib/validators"
import { useHomeSnapshot } from "./useHomeSnapshot"

export interface NetworkPulse {
    blockHeight: number
    avgBlockTime: number
    totalValidators: number
    loading: boolean
    /** true when the on-chain stats query failed (RPC unreachable) — lets the
     *  StatusStrip show "offline" instead of a misleading "live" dot. Always
     *  false on the snapshot path (the snapshot serves last-good data). */
    offline: boolean
}

const PULSE_INTERVAL = 30_000

export function useNetworkPulse(): NetworkPulse {
    const { rpcUrl } = useNetwork()
    const { snapshot, usable } = useHomeSnapshot()

    const statsQuery = useQuery({
        queryKey: ["home", "pulse", rpcUrl],
        queryFn: ({ signal }) => getNetworkStats(rpcUrl, undefined, signal),
        enabled: !usable,
        staleTime: PULSE_INTERVAL,
        refetchInterval: PULSE_INTERVAL,
    })

    if (usable) {
        return {
            blockHeight: Number(snapshot!.network?.blockHeight ?? 0),
            avgBlockTime: Number(snapshot!.network?.avgBlockTimeMs ?? 0) / 1000,
            totalValidators: Number(snapshot!.network?.validatorsTotal ?? 0),
            loading: false,
            offline: false,
        }
    }

    const stats = statsQuery.data

    return {
        blockHeight: stats?.blockHeight ?? 0,
        avgBlockTime: stats?.avgBlockTime ?? 0,
        totalValidators: stats?.totalValidators ?? 0,
        loading: statsQuery.isLoading,
        offline: statsQuery.isError,
    }
}
