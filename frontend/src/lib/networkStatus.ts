/**
 * networkStatus.ts — Network health detection for status toasts.
 *
 * Sprint 12: Polls RPC /status endpoint to detect halted or slow networks.
 */

export type NetworkHealth = "healthy" | "slow" | "halted" | "unreachable"

export interface NetworkStatusResult {
    health: NetworkHealth
    chainId: string
    latestBlockTime: Date | null
    blockAge: number // seconds since last block
}

/** Thresholds for block age classification. */
const SLOW_THRESHOLD_SEC = 10
const HALTED_THRESHOLD_SEC = 300 // 5 minutes

/**
 * Check the health of a network by querying its /status endpoint.
 *
 * @param rpcUrl - RPC endpoint URL
 * @returns Network health status
 */
export async function checkNetworkHealth(rpcUrl: string): Promise<NetworkStatusResult> {
    try {
        const response = await fetch(`${rpcUrl}/status`, {
            signal: AbortSignal.timeout(5000),
        })
        if (!response.ok) {
            return { health: "unreachable", chainId: "", latestBlockTime: null, blockAge: Infinity }
        }

        const data = await response.json()
        const syncInfo = data?.result?.sync_info
        if (!syncInfo?.latest_block_time) {
            return { health: "unreachable", chainId: "", latestBlockTime: null, blockAge: Infinity }
        }

        const chainId = data?.result?.node_info?.network || ""
        const latestBlockTime = new Date(syncInfo.latest_block_time)
        const blockAge = Math.floor((Date.now() - latestBlockTime.getTime()) / 1000)

        let health: NetworkHealth = "healthy"
        if (blockAge > HALTED_THRESHOLD_SEC) {
            health = "halted"
        } else if (blockAge > SLOW_THRESHOLD_SEC) {
            health = "slow"
        }

        return { health, chainId, latestBlockTime, blockAge }
    } catch {
        return { health: "unreachable", chainId: "", latestBlockTime: null, blockAge: Infinity }
    }
}

/**
 * Format block age as human-readable string.
 */
export function formatBlockAge(seconds: number): string {
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
}
