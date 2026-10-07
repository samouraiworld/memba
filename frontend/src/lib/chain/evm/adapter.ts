/**
 * The EVM adapter: the only module that imports viem and @wagmi/core. It is
 * reached through `loadEvmAdapter()` (./load.ts) alone, so it and the
 * vendor-evm chunk load on first use and never ship in a flag-off build.
 *
 * @module lib/chain/evm/adapter
 */
import { createConfig, createStorage, getPublicClient, http, injected } from "@wagmi/core"
import { base, baseSepolia, type Chain } from "viem/chains"
import type { Read } from "../types"
import { readChainStatus, type ChainStatus } from "./chainCheck"
import { EVM_NETWORKS } from "./networks"

const CHAINS: Readonly<Record<string, Chain>> = { "base-sepolia": baseSepolia, base }

/** The viem chain for a registry key. Throws for a key the registry doesn't have. */
export function chainFor(key: string): Chain {
    if (!Object.hasOwn(CHAINS, key)) throw new Error(`Unknown EVM network: ${key}`)
    return CHAINS[key]
}

/** Storage that never throws: a browser that refuses storage keeps the wallet for this visit only. */
const safeLocalStorage = {
    getItem: (key: string) => { try { return localStorage.getItem(key) } catch { return null } },
    setItem: (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* refused */ } },
    removeItem: (key: string) => { try { localStorage.removeItem(key) } catch { /* refused */ } },
}

/**
 * Injected wallets only (M1): the announced ones (ERC-6963) and window.ethereum.
 * Each chain talks to the RPC in the registry (lib/chain/evm/networks.ts).
 */
export const evmConfig = createConfig({
    chains: [baseSepolia, base],
    connectors: [injected()],
    multiInjectedProviderDiscovery: true,
    storage: createStorage({ storage: safeLocalStorage, key: "memba.evm" }),
    pollingInterval: 4_000,
    transports: {
        [baseSepolia.id]: http(EVM_NETWORKS["base-sepolia"].rpcUrl),
        [base.id]: http(EVM_NETWORKS.base.rpcUrl),
    },
})

/** The network's RPC, proven to serve that chain, and its latest block. */
export function readNetworkStatus(key: string): Promise<Read<ChainStatus>> {
    const chain = chainFor(key)
    return readChainStatus(chain.id, getPublicClient(evmConfig, { chainId: chain.id as typeof baseSepolia.id }))
}
