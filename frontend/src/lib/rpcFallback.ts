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

/** W3.4: extra attempts on the SAME url before failing over, and the backoff
 *  between them. One retry absorbs a transient blip on a healthy primary so it
 *  isn't demoted to a fallback; timeouts/aborts are never retried here. */
const SAME_URL_RETRIES = 1
const SAME_URL_RETRY_BACKOFF_MS = 150

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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
        // W3.4: retry the SAME url on a fast transient failure (a network blip
        // or a 5xx) before failing over, so one hiccup on a healthy primary
        // doesn't demote it to a fallback. A timeout/abort is NOT retried (the
        // url already spent its full budget, or the caller cancelled) — we fail
        // over to the next url instead.
        for (let attempt = 0; ; attempt++) {
            let retryable = false
            try {
                const { url, init } = buildRequest(rpcUrl)
                const controller = new AbortController()
                const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT)

                // Combine external signal with timeout
                if (signal) {
                    signal.addEventListener("abort", () => controller.abort(), { once: true })
                }

                let res: Response
                try {
                    res = await fetch(url, { ...init, signal: controller.signal })
                } finally {
                    clearTimeout(timeout)
                }

                if (res.ok) {
                    // Mark this URL as working for future calls
                    if (rpcUrl !== GNO_RPC_URL) {
                        _lastWorkingRpcUrl = rpcUrl
                    } else {
                        // Primary is back — reset fallback preference
                        _lastWorkingRpcUrl = null
                    }
                    return res
                }

                lastError = new Error(`HTTP ${res.status}`)
                // 5xx is a server-side transient → worth a same-url retry;
                // a 4xx won't change on retry → fail over.
                retryable = res.status >= 500
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err))
                // Retry a genuine network error, but not a timeout/abort.
                retryable = lastError.name !== "AbortError"
            }

            if (retryable && attempt < SAME_URL_RETRIES) {
                await sleep(SAME_URL_RETRY_BACKOFF_MS)
                continue
            }
            break // give up on this url, fail over to the next
        }
    }

    throw lastError || new Error("All RPC endpoints unreachable")
}

/**
 * ABCI-level query error (W2.2): the RPC transport worked but the VM/handler
 * rejected the query — realm not deployed, invalid path, panic during render.
 * Distinct from a transport failure (all endpoints down), which surfaces as a
 * plain Error from resilientFetch. `instanceof AbciQueryError` is the
 * discriminator.
 */
export class AbciQueryError extends Error {
    readonly path: string
    readonly abciError: unknown
    readonly log: string

    constructor(path: string, abciError: unknown, log = "") {
        super(`ABCI query failed for ${path}: ${log || JSON.stringify(abciError)}`)
        this.name = "AbciQueryError"
        this.path = path
        this.abciError = abciError
        this.log = log
    }
}

/** Discriminated ABCI query outcome — "not deployed" ≠ "empty" ≠ "RPC down". */
export type AbciQueryResult =
    | { kind: "ok"; text: string }
    | { kind: "empty" }
    | { kind: "abci-error"; error: AbciQueryError }

/**
 * Whether ResponseBase.Error carries a REAL error. gno.land encodes "no error"
 * as JSON null but has also been observed with "" — and a present error may be
 * a string ("not found") OR an object ({"@type":"/std.InvalidAddressError"}).
 * Mirrors the backend's abciErrorPresent (render_proxy.go).
 */
export function abciErrorPresent(e: unknown): boolean {
    if (e == null) return false
    if (typeof e === "string") return e.trim() !== ""
    return true
}

/** W3.3: in-flight ABCI reads keyed by path+data, so concurrent identical
 *  queries share one round-trip. Cleared on settle → coalescing, not caching. */
const _inflightAbci = new Map<string, Promise<AbciQueryResult>>()

/**
 * ABCI query with automatic RPC failover, returning a DISCRIMINATED result
 * (W2.2, R2-CHN-D): a set `ResponseBase.Error` (realm missing, bad path, VM
 * panic) is reported as `abci-error`, an absent `Data` as `empty`, and a
 * transport failure (all endpoints down) THROWS — the three cases were
 * previously conflated into one falsy return.
 *
 * W3.3: concurrent identical reads are coalesced. The same qrender/qeval fires
 * from several unrelated call-sites during a render pass; this collapses them to
 * one round-trip. Signal-less, so there is no per-caller abort to share. The
 * in-flight entry is removed once the read settles, so a later call re-reads the
 * chain — this is coalescing, never a stale cache.
 */
export async function resilientAbciQueryDetailed(
    path: string,
    data: string,
): Promise<AbciQueryResult> {
    const key = path + "\u0000" + data
    const existing = _inflightAbci.get(key)
    if (existing) return existing

    // Kick off the read; the promise is registered synchronously (before any
    // await) so a same-tick duplicate observes it and coalesces.
    const p = abciQueryDetailedUncoalesced(path, data)
    _inflightAbci.set(key, p)
    try {
        return await p
    } finally {
        _inflightAbci.delete(key)
    }
}

async function abciQueryDetailedUncoalesced(
    path: string,
    data: string,
): Promise<AbciQueryResult> {
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
    const base = json?.result?.response?.ResponseBase
    if (abciErrorPresent(base?.Error)) {
        const log = typeof base?.Log === "string" ? base.Log : ""
        return { kind: "abci-error", error: new AbciQueryError(path, base.Error, log) }
    }
    const value = base?.Data
    if (!value) return { kind: "empty" } // realm rendered nothing — legitimate
    const binaryStr = atob(value)
    const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0))
    return { kind: "ok", text: new TextDecoder().decode(bytes) }
}

/**
 * ABCI query with automatic RPC failover.
 * Drop-in replacement for the direct fetch in shared.ts abciQuery.
 *
 * Back-compat wrapper over {@link resilientAbciQueryDetailed}: non-strict
 * callers still get `null` for both "empty" and any failure; strict callers
 * (the DAO read path) now get an {@link AbciQueryError} for VM-level errors
 * (previously silently `null` — a non-deployed realm looked like a blank
 * render) in addition to the transport throw they already had (FE-2).
 */
export async function resilientAbciQuery(
    path: string,
    data: string,
    strict = false,
): Promise<string | null> {
    try {
        const result = await resilientAbciQueryDetailed(path, data)
        if (result.kind === "ok") return result.text
        if (result.kind === "abci-error") {
            if (strict) throw result.error
            return null
        }
        return null // legitimate empty
    } catch (err) {
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
