/**
 * useNetworkPulse — shared network heartbeat hook for the Control Room home.
 *
 * Polls block height, avg block time, and validator count every 30s via
 * React Query. Also fetches traction metrics (DAO + contributor counts).
 *
 * Designed as the shared source of truth — StatusStrip and the upcoming
 * NetworkPulsePanel (Task 1.4) both consume this hook.
 *
 * @module hooks/home/useNetworkPulse
 */

import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { getNetworkStats } from "../../lib/validators"
import { fetchTractionMetrics } from "../../lib/traction"

export interface NetworkPulse {
    blockHeight: number
    avgBlockTime: number
    totalValidators: number
    daoCount: number
    memberCount: number
    loading: boolean
}

const PULSE_INTERVAL = 30_000

export function useNetworkPulse(): NetworkPulse {
    const { rpcUrl } = useNetwork()

    const statsQuery = useQuery({
        queryKey: ["home", "pulse", rpcUrl],
        queryFn: ({ signal }) => getNetworkStats(rpcUrl, undefined, signal),
        staleTime: PULSE_INTERVAL,
        refetchInterval: PULSE_INTERVAL,
    })

    const tractionQuery = useQuery({
        queryKey: ["home", "traction"],
        queryFn: () => fetchTractionMetrics(),
        staleTime: 5 * 60_000,
        refetchInterval: 5 * 60_000,
    })

    const stats = statsQuery.data
    const traction = tractionQuery.data

    return {
        blockHeight: stats?.blockHeight ?? 0,
        avgBlockTime: stats?.avgBlockTime ?? 0,
        totalValidators: stats?.totalValidators ?? 0,
        daoCount: traction?.daoCount ?? 0,
        memberCount: traction?.contributorCount ?? 0,
        loading: statsQuery.isLoading,
    }
}
