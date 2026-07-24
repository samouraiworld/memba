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
import { NETWORKS } from "../config"

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
 * Gno networks are DERIVED from config.ts's NETWORKS, so the CAL and the rest of the app can
 * never disagree on which Gno networks exist or their RPC endpoints. Previously this was a
 * hand-copied parallel list that could (and did) drift from config (B-3). config.ts stays the
 * single source of truth; the CAL just adds the family/explorer/native-token fields it needs.
 */
function deriveGnoNetworks(): CALNetworkConfig[] {
    // Derived from the FULL NETWORKS map (not VISIBLE_NETWORKS) so getNetworkConfig can resolve
    // whatever config.ts resolves as active — including a `hidden` network reached by direct
    // localStorage/URL. There are no hidden networks today; if one is added, the CAL selector
    // (which currently shows all of availableNetworks) must filter it, mirroring config's
    // NETWORKS-vs-VISIBLE_NETWORKS split.
    return Object.values(NETWORKS).map((n): CALNetworkConfig => {
        // gnoscan defaults to topaz-1; every other chain needs the ?chainId= query.
        const suffix = n.chainId === "topaz-1" ? "" : `?chainId=${n.chainId}`
        return {
            // config types chainId as `string`; every entry is in fact a ChainId union member.
            chainId: n.chainId as ChainId,
            family: "gno",
            label: n.label,
            rpcUrl: n.rpcUrl,
            fallbackRpcUrls: n.fallbackRpcUrls ?? [],
            explorerTxUrl: `https://gnoscan.io/transactions/{hash}${suffix}`,
            explorerAddressUrl: `https://gnoscan.io/accounts/{address}${suffix}`,
            nativeToken: GNO_NATIVE_TOKEN,
            isTestnet: true,
            faucetUrl: n.faucetUrl || undefined,
            userRegistryPath: n.userRegistryPath,
            indexerUrl: n.indexerUrl,
        }
    })
}

/**
 * EVM networks (Robinhood Chain) have no config.ts entry — they ride the EVM/CAL activation,
 * not the Gno network config. Kept here until that work lands.
 */
const EVM_NETWORKS: CALNetworkConfig[] = [
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

/** All available networks across both chain families (Gno derived from config, EVM static). */
export const ALL_NETWORKS: CALNetworkConfig[] = [...deriveGnoNetworks(), ...EVM_NETWORKS]

/** Get a network config by chainId. */
export function getNetworkConfig(chainId: ChainId): CALNetworkConfig | undefined {
    return ALL_NETWORKS.find(n => n.chainId === chainId)
}

/** Get all networks for a given chain family. */
export function getNetworksByFamily(family: ChainFamily): CALNetworkConfig[] {
    return ALL_NETWORKS.filter(n => n.family === family)
}
