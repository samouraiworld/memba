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

import { NETWORKS, networkHasRealms } from "./config"

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
 * @param networkKey - Key into NETWORKS config (e.g. "gnoland1", "test13")
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
    // Proper timeout: abort if no RPC responds within timeoutMs
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

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
                // Tendermint RPC response shape is dynamic — safe to cast here
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rpcData = data as any
                const syncInfo = rpcData?.result?.sync_info || rpcData?.sync_info || {}
                const blockHeight = parseInt(syncInfo.latest_block_height || "0", 10)
                const chainId = rpcData?.result?.node_info?.network
                    || rpcData?.node_info?.network
                    || network.chainId
                return { rpc, blockHeight, chainId }
            }),
        )

        // Cancel remaining requests + clear timeout
        clearTimeout(timeoutId)
        controller.abort()

        return {
            reachable: true,
            respondingRpc: result.rpc,
            latencyMs: Date.now() - start,
            chainId: result.chainId,
            blockHeight: result.blockHeight,
        }
    } catch {
        // All RPCs failed or timed out
        clearTimeout(timeoutId)
        controller.abort()
        return {
            reachable: false,
            respondingRpc: null,
            latencyMs: null,
            chainId: network.chainId,
            blockHeight: 0,
        }
    }
}

/**
 * Suggest a fallback network when the current one is unreachable.
 * Returns the first reachable network key, or null if all are down.
 */
export function getSuggestedFallback(currentNetworkKey: string): string | null {
    // Priority order for fallback suggestion. Only networks where Memba's realms
    // are actually deployed belong here — steering a user to a chain with no
    // Memba realms (e.g. Betanet/gnoland1) is worse than no suggestion. test13
    // was retired 2026-07-26 (RPCs dead) so it no longer belongs in the list;
    // gnoland1 is a last resort only.
    // The comment above was the intent; the code did not implement it — this
    // returned "gnoland1" whenever topaz was the degraded network, so
    // ChainHaltedBanner offered a one-click switch to a chain with no Memba
    // realms. Now filtered on the same signal the banner uses, and hidden
    // networks are never suggested.
    // topaz left this list at its 2026-08-12 retirement (also now hidden, so
    // the filter below would drop it anyway — belt and braces, like test13).
    // pearl leads once its realms deploy (the realms filter below keeps it
    // out of suggestions until then); sapphire follows until its 09-09
    // sunset; gnoland1 stays last (realm-free, filtered anyway).
    const fallbackOrder = ["pearl", "sapphire", "gnoland1"]
    for (const key of fallbackOrder) {
        const net = NETWORKS[key]
        if (key !== currentNetworkKey && net && !net.hidden && networkHasRealms(key)) {
            return key
        }
    }
    return null
}
