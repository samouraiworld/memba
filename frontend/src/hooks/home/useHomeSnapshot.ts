/**
 * useHomeSnapshot — react-query hook for the backend GetHomeSnapshot endpoint.
 *
 * Gated to SNAPSHOT_NETWORK ("test13"): the query is disabled on all other
 * networks, so Phase-1 per-source hooks remain the fallback everywhere else.
 * Phase E will wire this into the home panels to replace the on-chain fan-out.
 */
import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../useNetwork"
import { fetchHomeSnapshot, type HomeSnapshot } from "../../lib/homeApi"
import { SNAPSHOT_NETWORK } from "../../lib/config"

const STALE_TIME = 30_000

export interface HomeSnapshotResult {
  snapshot: HomeSnapshot | null
  usable: boolean
  isLoading: boolean
}

export function useHomeSnapshot(): HomeSnapshotResult {
  const { networkKey, chainId } = useNetwork()
  const onSnapshotNetwork = networkKey === SNAPSHOT_NETWORK

  const query = useQuery({
    queryKey: ["home", "snapshot", chainId ?? networkKey],
    queryFn: () => fetchHomeSnapshot(chainId ?? networkKey),
    enabled: onSnapshotNetwork,
    staleTime: STALE_TIME,
    retry: false,
  })

  const snapshot = query.data ?? null
  const populated =
    !!snapshot &&
    !(snapshot.staleSources?.length === 1 && snapshot.staleSources[0] === "all")

  return {
    snapshot,
    usable: onSnapshotNetwork && !query.isLoading && populated,
    isLoading: onSnapshotNetwork && query.isLoading,
  }
}
