/**
 * The Safe{Core} SDK, pinned (protocol-kit 8.0.7, api-kit 5.0.3): the only
 * module that imports it. It is reached through `loadSafeSdk()` (./load.ts)
 * alone, so it and the vendor-safe chunk load when a Safe screen first needs
 * them and never ship in a flag-off build (check:bundle:safe).
 *
 * Two decisions live here so no screen can get them wrong:
 * - the Transaction Service is always reached through Memba's backend proxy
 *   (/api/safe-tx/, backend/internal/service/safe_tx_proxy.go): the browser
 *   never holds the Safe API key;
 * - a new Safe is always SafeL2 v1.5.0 from the canonical deployment
 *   (protocol-kit defaults to 1.4.1).
 *
 * @module lib/chain/evm/safe/sdk
 */
import SafeApiKit from "@safe-global/api-kit"
import Safe, { type Eip1193Provider, type PredictedSafeProps } from "@safe-global/protocol-kit"

/** The version Memba creates Safes with (docs/evm/PHASE0.md). */
export const NEW_SAFE_VERSION = "1.5.0" as const

/** The proxy's base for one chain; the API client appends /v1/… and /v2/…. */
export function txServiceUrl(apiBase: string, chainId: number): string {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(`Not a chain id: ${chainId}`)
    return `${apiBase.replace(/\/+$/, "")}/api/safe-tx/${chainId}`
}

/** The Transaction Service for `chainId`, through Memba's proxy, without an API key. */
export function safeApiKit(apiBase: string, chainId: number): SafeApiKit {
    return new SafeApiKit({ chainId: BigInt(chainId), txServiceUrl: txServiceUrl(apiBase, chainId) })
}

/** A Safe that does not exist yet: SafeL2 v1.5.0, canonical deployment, the version's fallback handler. */
export function newSafeConfig(owners: readonly string[], threshold: number, saltNonce: bigint): PredictedSafeProps {
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) throw new Error("The threshold must be between 1 and the number of owners.")
    if (saltNonce < 0n) throw new Error("The salt nonce must not be negative.")
    return {
        safeAccountConfig: { owners: [...owners], threshold },
        safeDeploymentConfig: { safeVersion: NEW_SAFE_VERSION, deploymentType: "canonical", saltNonce: saltNonce.toString() },
    }
}

/** protocol-kit for a Safe to create; the L2 singleton is forced, whatever the chain. */
export function initNewSafe(provider: Eip1193Provider, signer: string, config: PredictedSafeProps): Promise<Safe> {
    return Safe.init({ provider, signer, predictedSafe: config, isL1SafeSingleton: false })
}

/** protocol-kit for an existing Safe (any version protocol-kit supports; inspect it first). */
export function initSafe(provider: Eip1193Provider, signer: string, safeAddress: string): Promise<Safe> {
    return Safe.init({ provider, signer, safeAddress })
}
