/**
 * RPC Fallback — resilient fetch with automatic failover to backup RPC endpoints.
 *
 * When the primary RPC is unreachable (502, timeout, network error), tries
 * fallback URLs in order. Once a fallback succeeds, it becomes the preferred
 * endpoint for subsequent calls (until page reload resets to primary).
 *
 * This module is the single source of truth for RPC resilience. All ABCI
 * queries and Tendermint RPC calls should use these helpers instead of
 * calling fetch() directly.
 */

import { GNO_RPC_URL, GNO_FALLBACK_RPC_URLS } from "./config"

/** Timeout for a single RPC attempt (ms). */
const RPC_TIMEOUT = 8_000

/** In-memory cache of the last working RPC URL (resets on page reload). */
let _lastWorkingRpcUrl: string | null = null

/**
 * Returns the ordered list of RPC URLs to try: last-known-good first,
 * then primary, then fallbacks (deduplicated).
 */
export function getRpcUrlsInOrder(): string[] {
    const urls: string[] = []
    // If we found a working fallback previously, try it first
    if (_lastWorkingRpcUrl && _lastWorkingRpcUrl !== GNO_RPC_URL) {
        urls.push(_lastWorkingRpcUrl)
    }
    urls.push(GNO_RPC_URL)
    for (const url of GNO_FALLBACK_RPC_URLS) {
        if (!urls.includes(url)) urls.push(url)
    }
    return urls
}

/**
 * Fetch with RPC failover. Tries each URL in order until one succeeds.
 * Returns the Response from the first successful attempt.
 * Throws the last error if all URLs fail.
 */
export async function resilientFetch(
    buildRequest: (rpcUrl: string) => { url: string; init: RequestInit },
    signal?: AbortSignal,
): Promise<Response> {
    const urls = getRpcUrlsInOrder()
    let lastError: Error | null = null

    for (const rpcUrl of urls) {
        try {
            const { url, init } = buildRequest(rpcUrl)
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT)

            // Combine external signal with timeout
            if (signal) {
                signal.addEventListener("abort", () => controller.abort(), { once: true })
            }

            const res = await fetch(url, { ...init, signal: controller.signal })
            clearTimeout(timeout)

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`)
            }

            // Mark this URL as working for future calls
            if (rpcUrl !== GNO_RPC_URL) {
                _lastWorkingRpcUrl = rpcUrl
            } else {
                // Primary is back — reset fallback preference
                _lastWorkingRpcUrl = null
            }

            return res
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err))
            // Continue to next fallback
        }
    }

    throw lastError || new Error("All RPC endpoints unreachable")
}

/**
 * ABCI query with automatic RPC failover.
 * Drop-in replacement for the direct fetch in shared.ts abciQuery.
 */
export async function resilientAbciQuery(
    path: string,
    data: string,
    strict = false,
): Promise<string | null> {
    try {
        const b64Data = btoa(data)
        const res = await resilientFetch((rpcUrl) => ({
            url: rpcUrl,
            init: {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: "memba-dao",
                    method: "abci_query",
                    params: { path, data: b64Data },
                }),
            },
        }))
        const json = await res.json()
        const value = json?.result?.response?.ResponseBase?.Data
        if (!value) return null // realm rendered nothing — a legitimate empty, not a failure
        const binaryStr = atob(value)
        const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0))
        return new TextDecoder().decode(bytes)
    } catch (err) {
        // strict callers (the DAO read path) need to distinguish "all endpoints down"
        // from "empty" so they can show an error + retry instead of a blank card (FE-2).
        if (strict) throw err instanceof Error ? err : new Error(String(err))
        return null
    }
}

/**
 * Tendermint RPC call (GET-style) with automatic failover.
 * Drop-in replacement for validators.ts rpcCall.
 */
export async function resilientRpcCall(
    method: string,
    params: Record<string, string> = {},
    signal?: AbortSignal,
): Promise<unknown> {
    const res = await resilientFetch((rpcUrl) => {
        const url = new URL(rpcUrl)
        url.pathname = method
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
        return {
            url: url.toString(),
            init: { headers: { Accept: "application/json" } },
        }
    }, signal)
    const json = await res.json()
    if (json.error) throw new Error(`RPC error: ${json.error.message || json.error}`)
    return json.result
}

/**
 * Tendermint RPC call (GET-style) against ONE SPECIFIC node — no failover.
 *
 * Unlike {@link resilientRpcCall}, this queries exactly the URL passed and does
 * not fall back to the global primary. Required when the caller needs results
 * from a *particular* node (e.g. aggregating node-local `/net_info` across the
 * network — failover would silently query the primary N times instead).
 * Single 8s timeout; throws on HTTP/RPC error so callers can treat a node as
 * unreachable.
 */
export async function directRpcCall(
    rpcUrl: string,
    method: string,
    params: Record<string, string> = {},
    signal?: AbortSignal,
): Promise<unknown> {
    const url = new URL(rpcUrl)
    url.pathname = method
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT)
    if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true })

    try {
        const res = await fetch(url.toString(), {
            headers: { Accept: "application/json" },
            signal: controller.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (json.error) throw new Error(`RPC error: ${json.error.message || json.error}`)
        return json.result
    } finally {
        clearTimeout(timeout)
    }
}
