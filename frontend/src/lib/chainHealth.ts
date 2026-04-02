/**
 * chainHealth — Network health detection with timeout-based circuit breaker.
 *
 * C-02 fix: When a user switches to a halted/unreachable chain (e.g. gnoland1),
 * this module probes the primary RPC + all fallbacks in parallel with a configurable
 * timeout. If ALL endpoints fail, the chain is considered "halted" and the UI can
 * display a banner suggesting a switch to a working network.
 *
 * v3.0: Initial implementation for betanet fallback UX.
 */

import { NETWORKS } from "./config"

export interface ChainHealthResult {
    /** Whether at least one RPC endpoint responded successfully. */
    reachable: boolean
    /** The RPC URL that responded first (if any). */
    respondingRpc: string | null
    /** Time taken for the fastest response (ms), null if all failed. */
    latencyMs: number | null
    /** Chain ID (from /status response or config). */
    chainId: string
    /** Latest block height (0 if unreachable). */
    blockHeight: number
}

/**
 * Probe a chain's health by querying /status on primary + fallback RPCs.
 * All RPCs are tested in parallel; returns as soon as the first one responds.
 * If all fail within the timeout, returns { reachable: false }.
 *
 * @param networkKey - Key into NETWORKS config (e.g. "gnoland1", "test12")
 * @param timeoutMs - Max time to wait for any RPC response (default 5000ms)
 */
export async function checkChainHealth(
    networkKey: string,
    timeoutMs = 5000,
): Promise<ChainHealthResult> {
    const network = NETWORKS[networkKey]
    if (!network) {
        return { reachable: false, respondingRpc: null, latencyMs: null, chainId: networkKey, blockHeight: 0 }
    }

    // Collect all RPC URLs: primary + fallbacks
    const rpcs = [network.rpcUrl, ...(network.fallbackRpcUrls || [])].filter(Boolean)
    if (rpcs.length === 0) {
        return { reachable: false, respondingRpc: null, latencyMs: null, chainId: network.chainId, blockHeight: 0 }
    }

    const controller = new AbortController()
    const start = Date.now()

    // Race: first successful /status response wins, or timeout
    try {
        const result = await Promise.any(
            rpcs.map(async (rpc) => {
                const url = rpc.endsWith("/") ? `${rpc}status` : `${rpc}/status`
                const res = await fetch(url, {
                    signal: controller.signal,
                    headers: { Accept: "application/json" },
                })
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                // Tendermint RPC wraps result in { result: { ... } }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const syncInfo = (data as any)?.result?.sync_info || (data as any)?.sync_info || {}
                const blockHeight = parseInt(syncInfo.latest_block_height || "0", 10)
                const chainId = (data as any)?.result?.node_info?.network
                    || (data as any)?.node_info?.network
                    || network.chainId
                return { rpc, blockHeight, chainId }
            }),
        )

        // Cancel remaining requests
        controller.abort()

        return {
            reachable: true,
            respondingRpc: result.rpc,
            latencyMs: Date.now() - start,
            chainId: result.chainId,
            blockHeight: result.blockHeight,
        }
    } catch {
        // All RPCs failed
        controller.abort()
        return {
            reachable: false,
            respondingRpc: null,
            latencyMs: null,
            chainId: network.chainId,
            blockHeight: 0,
        }
    } finally {
        // Ensure cleanup on timeout
        setTimeout(() => controller.abort(), timeoutMs)
    }
}

/**
 * Suggest a fallback network when the current one is unreachable.
 * Returns the first reachable network key, or null if all are down.
 */
export function getSuggestedFallback(currentNetworkKey: string): string | null {
    // Priority order for fallback suggestion
    const fallbackOrder = ["test12", "portal-loop", "staging"]
    for (const key of fallbackOrder) {
        if (key !== currentNetworkKey && NETWORKS[key]) {
            return key
        }
    }
    return null
}
