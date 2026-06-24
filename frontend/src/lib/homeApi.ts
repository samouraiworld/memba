/**
 * homeApi.ts — typed wrapper over the GetHomeSnapshot ConnectRPC endpoint.
 * Returns the snapshot, or null on any error (the endpoint may be undeployed).
 * Callers MUST treat null as "use the Phase-1 per-source hooks".
 */
import { api } from "./api"

export type { HomeSnapshot } from "../gen/memba/v1/memba_pb"
import type { HomeSnapshot } from "../gen/memba/v1/memba_pb"

export async function fetchHomeSnapshot(chainId: string): Promise<HomeSnapshot | null> {
  try {
    const res = await api.getHomeSnapshot({ chainId })
    return res.snapshot ?? null
  } catch {
    return null
  }
}
