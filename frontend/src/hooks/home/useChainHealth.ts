/**
 * useChainHealth — a single, shared chain-liveness signal for the home, so the
 * page tells ONE consistent story when the network is in trouble.
 *
 * It polls checkNetworkHealth (the same /status liveness check the network-status
 * toast uses; clock-independent via the server Date header — see lib/networkStatus)
 * through React Query, so multiple consumers (NetworkHealthDoor, ActivityFeed)
 * share one poll. `degraded` is true only for a genuine outage — halted or
 * unreachable — NOT for a merely "slow" block. Optimistic while loading: never
 * flashes a false "stalled" on first paint.
 *
 * @module hooks/home/useChainHealth
 */
import { useQuery } from "@tanstack/react-query"
import { checkNetworkHealth, type NetworkHealth } from "../../lib/networkStatus"
import { GNO_RPC_URL } from "../../lib/config"

export interface ChainHealth {
    health: NetworkHealth
    /** True when the chain is halted or unreachable (the page should reflect it). */
    degraded: boolean
    /** Seconds since the last block (for an honest "last block …" line). */
    blockAge: number
    loading: boolean
}

export function useChainHealth(): ChainHealth {
    const query = useQuery({
        queryKey: ["home", "chain-health", GNO_RPC_URL],
        queryFn: () => checkNetworkHealth(GNO_RPC_URL),
        staleTime: 30_000,
        refetchInterval: 60_000, // pauses on a hidden tab (React Query default)
    })

    // Optimistic default: assume healthy until we have a real reading, so the UI
    // never flashes "stalled" before the first poll resolves.
    const health: NetworkHealth = query.data?.health ?? "healthy"

    return {
        health,
        degraded: health === "halted" || health === "unreachable",
        blockAge: query.data?.blockAge ?? 0,
        loading: query.isLoading,
    }
}
