/**
 * The contracts Memba calls on an EVM chain, from deployments/evm (checked against the chains in CI). Every
 * protocol target comes from here: an address that is not a manifest key does not type-check. Plain data, no EVM
 * library; import it only from EVM code so a flag-off build drops it.
 *
 * @module lib/chain/evm/manifest
 */
import { EVM_MANIFEST } from "./manifest.generated"

export type EvmAddress = `0x${string}`
export type EvmManifestChainId = keyof typeof EVM_MANIFEST
export type EvmContractKey = keyof (typeof EVM_MANIFEST)[EvmManifestChainId]["contracts"]

export interface EvmContractEntry {
    address: EvmAddress
    /** Runtime codehash on this chain (it can differ between chains). */
    codehash: EvmAddress
    version?: string
    build?: { release: number; build: number }
    proxy?: { implementation: EvmAddress; implementationCodehash: EvmAddress }
}

function chainEntry(chainId: number) {
    const key = String(chainId)
    if (!Object.hasOwn(EVM_MANIFEST, key)) throw new Error(`No EVM manifest for chain ${chainId}.`)
    return EVM_MANIFEST[key as EvmManifestChainId]
}

/** Whether Memba has a manifest (and so any contract) for this chain id. */
export function hasEvmManifest(chainId: number): boolean {
    return Object.hasOwn(EVM_MANIFEST, String(chainId))
}

/** The manifest entry for `key` on `chainId`. Throws for a chain Memba has no manifest for. */
export function evmContractEntry(chainId: number, key: EvmContractKey): EvmContractEntry {
    return chainEntry(chainId).contracts[key] as EvmContractEntry
}

/** The address of `key` on `chainId`. Throws for a chain Memba has no manifest for. */
export function evmContract(chainId: number, key: EvmContractKey): EvmAddress {
    return evmContractEntry(chainId, key).address
}

/**
 * Why `address` must never be called on `chainId` (a look-alike: a retired controller, a stale repo), or null.
 * Case-insensitive. Use it on any address that does not come from evmContract, such as an imported one.
 */
export function deniedReason(chainId: number, address: string): string | null {
    if (!hasEvmManifest(chainId)) return null
    const a = address.toLowerCase()
    const hit = Object.values(chainEntry(chainId).deny).find((d) => d.address.toLowerCase() === a)
    return hit ? hit.reason : null
}
