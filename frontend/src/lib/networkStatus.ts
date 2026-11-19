/**
 * networkStatus.ts — Network health detection for status toasts.
 *
 * Sprint 12: Polls RPC /status endpoint to detect halted or slow networks.
 * v2.29: Uses resilient RPC fallback for health checks.
 */

import { GNO_CHAIN_ID } from "./config"
import { getRpcUrlsInOrder, preferRpcEndpoint } from "./rpcFallback"

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
 * A node whose last block is older than this, while another node on the same
 * chain is younger and higher, has stopped following the chain (for example, a
 * node not yet restarted after a coordinated upgrade halt). It still answers,
 * so error-based failover never leaves it.
 */
const STALE_NODE_SEC = 60

/**
 * A block time further than this past the node's own clock is not believable:
 * such a node could claim any height. It neither judges the chain nor is moved
 * to first place, unless every node on the chain reads ahead (our clock is off).
 */
const FUTURE_SKEW_SEC = 30

interface NodeReading extends NetworkStatusResult {
    url: string
    height: number
    ahead: boolean
}

async function readNode(url: string): Promise<NodeReading | null> {
    try {
        const response = await fetch(`${url}/status`, {
            signal: AbortSignal.timeout(5000),
        })
        if (!response.ok) return null

        const data = await response.json()
        const syncInfo = data?.result?.sync_info
        if (!syncInfo?.latest_block_time) return null

        const chainId = data?.result?.node_info?.network || ""
        const latestBlockTime = new Date(syncInfo.latest_block_time)
        // An unreadable block time says nothing about the chain: not a reading.
        if (Number.isNaN(latestBlockTime.getTime())) return null
        const height = Number(syncInfo.latest_block_height)

        // Use the serving endpoint's clock (the HTTP `Date` response header from
        // the RPC node or its proxy) as "now", not the client's. A user whose
        // machine clock is minutes fast must not see a false "slow"/"halted"
        // reading for a chain that is actually fine — a server-side clock is
        // NTP-synced and reflects real elapsed time since the last block, whereas
        // the viewer's clock is arbitrary. Fall back to the client clock only when
        // the header is missing/unparseable. Clamp sub-second rounding to >= 0.
        const serverDateHeader = response.headers.get("date")
        const serverNow = serverDateHeader ? new Date(serverDateHeader).getTime() : NaN
        const nowMs = Number.isNaN(serverNow) ? Date.now() : serverNow
        const blockAge = Math.max(0, Math.floor((nowMs - latestBlockTime.getTime()) / 1000))

        let health: NetworkHealth = "healthy"
        if (blockAge > HALTED_THRESHOLD_SEC) {
            health = "halted"
        } else if (blockAge > SLOW_THRESHOLD_SEC) {
            health = "slow"
        }

        const ahead = latestBlockTime.getTime() - nowMs > FUTURE_SKEW_SEC * 1000
        return { url, height: Number.isFinite(height) ? height : -1, health, chainId, latestBlockTime, blockAge, ahead }
    } catch {
        return null
    }
}

/**
 * Check the health of a network by querying the /status endpoint of every RPC
 * node (primary + fallbacks).
 *
 * The chain is as live as the most advanced node on it: a node left behind
 * (still answering, but frozen at an old height) must not make a running chain
 * look halted, nor hide a halt. When the node tried first is that stale one,
 * the most advanced node becomes the first one tried for every later RPC call.
 *
 * @param rpcUrl - RPC endpoint URL
 * @returns Network health status
 */
export async function checkNetworkHealth(rpcUrl: string): Promise<NetworkStatusResult> {
    // The network may be healthy even if our primary RPC is down.
    const urls = getRpcUrlsInOrder()
    // Always include the passed-in URL as first candidate
    if (!urls.includes(rpcUrl)) urls.unshift(rpcUrl)

    const readings = await Promise.all(urls.map(readNode))
    const answered = readings.filter((r): r is NodeReading => r !== null)
    if (answered.length === 0) {
        return { health: "unreachable", chainId: "", latestBlockTime: null, blockAge: Infinity }
    }

    // Judge the chain only from nodes on it: a fallback serving another chain
    // must not stand in for this one. With none on it, keep the old reading.
    const onChain = answered.filter((r) => r.chainId === GNO_CHAIN_ID)
    // A node whose block is from its own future cannot hide a halt either.
    // Every node reading ahead means our clock is off (no Date header): use them all.
    const believable = onChain.filter((r) => !r.ahead)
    const candidates = believable.length > 0 ? believable : onChain.length > 0 ? onChain : answered
    // The highest block; on a tie (the same block), the node tried first.
    const best = candidates.reduce((a, b) => (b.height > a.height ? b : a))

    const first = readings[0]
    if (
        first && first.url !== best.url
        && first.chainId === GNO_CHAIN_ID && best.chainId === GNO_CHAIN_ID
        && first.blockAge > STALE_NODE_SEC && best.blockAge <= STALE_NODE_SEC
        && best.height > first.height
    ) {
        preferRpcEndpoint(best.url)
    }

    return { health: best.health, chainId: best.chainId, latestBlockTime: best.latestBlockTime, blockAge: best.blockAge }
}

/**
 * Format block age as human-readable string.
 */
export function formatBlockAge(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "Unavailable"
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
}
