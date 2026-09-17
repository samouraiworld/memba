/**
 * RPC chain identity — an RPC that answers is not necessarily the chain the
 * app is configured for (hosts have been repointed between networks). Strict
 * DAO reads verify `node_info.network` once per endpoint per session and fail
 * closed on a mismatch.
 */
import { GNO_CHAIN_ID } from "../config"
import { directRpcCall, getRpcUrlsInOrder } from "../rpcFallback"

export class RpcChainMismatchError extends Error {
    constructor(readonly served: string, readonly expected: string) {
        super(`This RPC serves ${served || "an unknown network"}, not ${expected}`)
        this.name = "RpcChainMismatchError"
    }
}

const checks = new Map<string, Promise<void>>()

/** Test hook. */
export function clearRpcChainChecks(): void {
    checks.clear()
}

/**
 * Verify that `rpcUrl` serves `expectedChainId`. Memoized per endpoint and
 * chain; a transport failure is forgotten so the next read retries, while a
 * mismatch stays remembered for the session.
 */
export function assertRpcChain(rpcUrl: string, expectedChainId: string): Promise<void> {
    const key = JSON.stringify([rpcUrl, expectedChainId])
    const existing = checks.get(key)
    if (existing) return existing
    const check = directRpcCall(rpcUrl, "status").then((result) => {
        const network = (result as { node_info?: { network?: unknown } } | null)?.node_info?.network
        if (network !== expectedChainId) throw new RpcChainMismatchError(typeof network === "string" ? network : "", expectedChainId)
    })
    checks.set(key, check)
    check.catch((err) => {
        if (!(err instanceof RpcChainMismatchError)) checks.delete(key)
    })
    return check
}

/**
 * Verify every configured endpoint the failover layer may use. Any endpoint
 * serving another chain fails the read; unreachable endpoints are tolerated
 * as long as at least one endpoint is verified.
 */
export async function assertActiveRpcChain(): Promise<void> {
    const results = await Promise.allSettled(getRpcUrlsInOrder().map((url) => assertRpcChain(url, GNO_CHAIN_ID)))
    const mismatch = results.find((r): r is PromiseRejectedResult => r.status === "rejected" && r.reason instanceof RpcChainMismatchError)
    if (mismatch) throw mismatch.reason
    if (!results.some((r) => r.status === "fulfilled")) {
        throw new Error("Could not verify which network the RPC serves")
    }
}
