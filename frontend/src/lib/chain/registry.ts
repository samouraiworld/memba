/**
 * Chain Abstraction Layer (CAL) — Provider Registry
 *
 * Maps ChainId → ChainProvider factory. When the user switches chains,
 * the registry creates (or returns cached) the correct provider.
 *
 * @module lib/chain/registry
 */

import type { ChainProvider } from "./provider"
import type { ChainFamily, ChainId, CALNetworkConfig, NativeToken } from "./types"

// ── Provider Factory ─────────────────────────────────────────

/** Factory function that creates a ChainProvider for a given network. */
export type ProviderFactory = (config: CALNetworkConfig) => ChainProvider

/** Registered provider factories. */
const factories = new Map<ChainFamily, ProviderFactory>()

/** Register a provider factory for a chain family. */
export function registerProviderFactory(family: ChainFamily, factory: ProviderFactory): void {
    factories.set(family, factory)
}

/** Cache of created providers (one per chainId). */
const providerCache = new Map<ChainId, ChainProvider>()

/** Get or create a ChainProvider for the given network config. */
export function getProvider(config: CALNetworkConfig): ChainProvider {
    const cached = providerCache.get(config.chainId)
    if (cached) return cached

    const factory = factories.get(config.family)
    if (!factory) {
        throw new Error(`No provider factory registered for chain family: ${config.family}`)
    }

    const provider = factory(config)
    providerCache.set(config.chainId, provider)
    return provider
}

/** Clear the provider cache (e.g., on wallet disconnect). */
export function clearProviderCache(): void {
    providerCache.clear()
}

// ── Network Configurations ───────────────────────────────────

const GNO_NATIVE_TOKEN: NativeToken = {
    name: "Gno Token",
    symbol: "GNOT",
    microUnit: "ugnot",
    decimals: 6,
}

const ETH_NATIVE_TOKEN: NativeToken = {
    name: "Ether",
    symbol: "ETH",
    microUnit: "wei",
    decimals: 18,
}

/**
 * All available networks across both chain families.
 *
 * Gno networks mirror the existing NETWORKS config in config.ts.
 * EVM networks will be populated as Robinhood Chain testnet/mainnet go live.
 */
export const ALL_NETWORKS: CALNetworkConfig[] = [
    // ── Gno Networks ─────────────────────────────────────────
    {
        chainId: "topaz-1",
        family: "gno",
        label: "Topaz",
        rpcUrl: "https://rpc.topaz.testnets.gno.land:443",
        fallbackRpcUrls: ["https://rpc.topaz.samourai.live:443"],
        explorerTxUrl: "https://gnoscan.io/transactions/{hash}",
        explorerAddressUrl: "https://gnoscan.io/accounts/{address}",
        nativeToken: GNO_NATIVE_TOKEN,
        isTestnet: true,
        faucetUrl: "https://faucet.gno.land",
        userRegistryPath: "gno.land/r/sys/users",
    },
    {
        chainId: "test-13",
        family: "gno",
        label: "Testnet 13",
        rpcUrl: "https://rpc.test13.testnets.gno.land:443",
        fallbackRpcUrls: ["https://test13.rpc.onbloc.xyz:443"],
        explorerTxUrl: "https://gnoscan.io/transactions/{hash}?chainId=test-13",
        explorerAddressUrl: "https://gnoscan.io/accounts/{address}?chainId=test-13",
        nativeToken: GNO_NATIVE_TOKEN,
        isTestnet: true,
        faucetUrl: "https://faucet.gno.land",
        userRegistryPath: "gno.land/r/sys/users",
        indexerUrl: "https://indexer.test13.testnets.gno.land/graphql/query",
    },

    // ── EVM Networks (Robinhood Chain) ────────────────────────
    {
        chainId: "rh-testnet-46630",
        family: "evm",
        label: "Robinhood Chain Testnet",
        rpcUrl: "https://rpc.testnet.chain.robinhood.com",
        fallbackRpcUrls: [],
        explorerTxUrl: "https://explorer.testnet.chain.robinhood.com/tx/{hash}",
        explorerAddressUrl: "https://explorer.testnet.chain.robinhood.com/address/{address}",
        nativeToken: ETH_NATIVE_TOKEN,
        isTestnet: true,
        evmChainId: 46630,
    },
    {
        chainId: "rh-mainnet-4663",
        family: "evm",
        label: "Robinhood Chain",
        rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
        fallbackRpcUrls: [],
        explorerTxUrl: "https://robinhoodchain.blockscout.com/tx/{hash}",
        explorerAddressUrl: "https://robinhoodchain.blockscout.com/address/{address}",
        nativeToken: ETH_NATIVE_TOKEN,
        isTestnet: false,
        evmChainId: 4663,
    },
]

/** Get a network config by chainId. */
export function getNetworkConfig(chainId: ChainId): CALNetworkConfig | undefined {
    return ALL_NETWORKS.find(n => n.chainId === chainId)
}

/** Get all networks for a given chain family. */
export function getNetworksByFamily(family: ChainFamily): CALNetworkConfig[] {
    return ALL_NETWORKS.filter(n => n.family === family)
}
