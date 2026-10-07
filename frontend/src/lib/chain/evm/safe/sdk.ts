/**
 * The Safe{Core} SDK, pinned (protocol-kit 8.0.7, api-kit 5.0.3): this module
 * and those it re-exports (./create.ts, ./verify.ts, ./reader.ts) are the only
 * ones that import it or viem for Safes. It is reached through `loadSafeSdk()` (./load.ts)
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
import Safe, { type Eip1193Provider } from "@safe-global/protocol-kit"
import { getPublicClient } from "@wagmi/core"
import { getAddress, keccak256 } from "viem"
import type { Read } from "../../types"
import { chainFor, evmConfig } from "../adapter"
import { inspectSafe, type SafeInspection } from "./inspect"
import { safeReader } from "./reader"
import type { Hex } from "./known"

export { checkQueuedTx, type QueuedSafeTx, type TxCheck } from "./verify"
export { deployNewSafe, initNewSafe, NEW_SAFE_VERSION, newSafeConfig, planNewSafe, randomSalt, SafeCreateError, type CreateError, type NewSafePlan } from "./create"

/** The proxy's base for one chain; the API client appends /v1/… and /v2/…. */
export function txServiceUrl(apiBase: string, chainId: number): string {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(`Not a chain id: ${chainId}`)
    return `${apiBase.replace(/\/+$/, "")}/api/safe-tx/${chainId}`
}

/** The Transaction Service for `chainId`, through Memba's proxy, without an API key. */
export function safeApiKit(apiBase: string, chainId: number): SafeApiKit {
    return new SafeApiKit({ chainId: BigInt(chainId), txServiceUrl: txServiceUrl(apiBase, chainId) })
}

/** protocol-kit for an existing Safe (any version protocol-kit supports; inspect it first). */
export function initSafe(provider: Eip1193Provider, signer: string, safeAddress: string): Promise<Safe> {
    return Safe.init({ provider, signer, safeAddress })
}

/** What the chain says `address` is on this network (lib/chain/evm/safe/inspect.ts). */
export function inspect(networkKey: string, address: string): Promise<Read<SafeInspection>> {
    return inspectSafe(safeReader(networkKey), keccak256, chainFor(networkKey).id, address)
}

/** The native balance in wei, from a node proven to serve the chain. */
export async function readBalance(networkKey: string, address: string): Promise<Read<bigint>> {
    const chain = chainFor(networkKey)
    const client = getPublicClient(evmConfig, { chainId: chain.id as (typeof evmConfig.chains)[number]["id"] })
    try {
        if ((await client.getChainId()) !== chain.id) return { kind: "unavailable", reason: "the RPC answered as another chain" }
        return { kind: "ok", value: await client.getBalance({ address: address as Hex }) }
    } catch {
        return { kind: "unavailable", reason: "the RPC did not answer" }
    }
}

/** EIP-55 spelling of an address, for display only (addresses are kept lowercase). */
export function toChecksum(address: string): Hex {
    return getAddress(address)
}
