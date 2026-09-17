/**
 * RPC chain identity — an RPC that answers is not necessarily the chain the
 * app is configured for (hosts have been repointed between networks). Strict
 * DAO reads first make sure the endpoint the failover layer will use serves
 * the configured chain.
 *
 * - Endpoints are checked in failover order; the first verified one lets the
 *   read proceed, and the remaining endpoints are checked in the background.
 * - An endpoint serving another chain is remembered and excluded from the
 *   failover list for the session, so it is never used.
 * - An unreachable endpoint is remembered for UNREACHABLE_RETRY_MS so a dead
 *   fallback is not probed again on every read.
 */
import { GNO_CHAIN_ID } from "../config"
import { directRpcCall, excludeRpcEndpoint, getRpcUrlsInOrder } from "../rpcFallback"

export class RpcChainMismatchError extends Error {
    constructor(readonly served: string, readonly expected: string) {
        super(`This RPC serves ${served || "an unknown network"}, not ${expected}`)
        this.name = "RpcChainMismatchError"
    }
}

/** How long an unreachable endpoint is skipped before it is probed again. */
export const UNREACHABLE_RETRY_MS = 60_000

type EndpointState =
    | { kind: "verified" }
    | { kind: "mismatch"; error: RpcChainMismatchError }
    | { kind: "unreachable"; until: number; error: Error }

const states = new Map<string, EndpointState>()
const inflight = new Map<string, Promise<void>>()
const keyOf = (rpcUrl: string, chainId: string) => JSON.stringify([rpcUrl, chainId])

/** Test hook. */
export function clearRpcChainChecks(): void {
    states.clear()
    inflight.clear()
}

function probe(rpcUrl: string, expectedChainId: string, key: string): Promise<void> {
    const running = inflight.get(key)
    if (running) return running
    const check = directRpcCall(rpcUrl, "status")
        .then((result) => {
            const network = (result as { node_info?: { network?: unknown } } | null)?.node_info?.network
            if (network !== expectedChainId) {
                const error = new RpcChainMismatchError(typeof network === "string" ? network : "", expectedChainId)
                states.set(key, { kind: "mismatch", error })
                excludeRpcEndpoint(rpcUrl)
                throw error
            }
            states.set(key, { kind: "verified" })
        }, (err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err))
            states.set(key, { kind: "unreachable", until: Date.now() + UNREACHABLE_RETRY_MS, error })
            throw error
        })
        .finally(() => inflight.delete(key))
    inflight.set(key, check)
    return check
}

/** Verify that `rpcUrl` serves `expectedChainId`, using remembered answers when available. */
export function assertRpcChain(rpcUrl: string, expectedChainId: string): Promise<void> {
    const key = keyOf(rpcUrl, expectedChainId)
    const state = states.get(key)
    if (state?.kind === "verified") return Promise.resolve()
    if (state?.kind === "mismatch") return Promise.reject(state.error)
    if (state?.kind === "unreachable" && Date.now() < state.until) return Promise.reject(state.error)
    return probe(rpcUrl, expectedChainId, key)
}

function needsCheck(rpcUrl: string): boolean {
    const state = states.get(keyOf(rpcUrl, GNO_CHAIN_ID))
    return !state || (state.kind === "unreachable" && Date.now() >= state.until)
}

/**
 * Ensure the endpoint the failover layer will use serves the configured chain.
 * Resolves as soon as one endpoint (in failover order) is verified; throws when
 * none can be verified.
 */
export async function assertActiveRpcChain(): Promise<void> {
    const urls = getRpcUrlsInOrder()
    let mismatch: RpcChainMismatchError | null = null
    for (let i = 0; i < urls.length; i++) {
        try {
            await assertRpcChain(urls[i], GNO_CHAIN_ID)
        } catch (err) {
            if (err instanceof RpcChainMismatchError) mismatch ??= err
            continue
        }
        // Check the remaining endpoints without holding the read, so a fallback
        // serving another chain is excluded before it could ever be used.
        for (const url of urls.slice(i + 1)) {
            if (needsCheck(url)) assertRpcChain(url, GNO_CHAIN_ID).catch(() => {})
        }
        return
    }
    throw mismatch ?? new Error("Could not verify which network the RPC serves")
}
