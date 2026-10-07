/**
 * The Safe Transaction Service client, always through Memba's backend proxy
 * (/api/safe-tx/, backend/internal/service/safe_tx_proxy.go): the browser
 * never holds the Safe API key. Part of the lazy Safe SDK chunk.
 *
 * @module lib/chain/evm/safe/txService
 */
import SafeApiKit from "@safe-global/api-kit"

/** The proxy's base for one chain; the API client appends /v1/… and /v2/…. */
export function txServiceUrl(apiBase: string, chainId: number): string {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(`Not a chain id: ${chainId}`)
    return `${apiBase.replace(/\/+$/, "")}/api/safe-tx/${chainId}`
}

/** The Transaction Service for `chainId`, through Memba's proxy, without an API key. */
export function safeApiKit(apiBase: string, chainId: number): SafeApiKit {
    return new SafeApiKit({ chainId: BigInt(chainId), txServiceUrl: txServiceUrl(apiBase, chainId) })
}

