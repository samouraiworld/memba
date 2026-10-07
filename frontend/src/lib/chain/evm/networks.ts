/**
 * EVM networks Memba OS can run on, apart from the Gno registry (lib/config.ts
 * NETWORKS) on purpose: every Gno module-load constant is computed from that
 * registry, and an EVM key must never reach it. Plain data, no EVM library.
 *
 * The RPCs can be overridden per build (VITE_BASE_SEPOLIA_RPC_URL, VITE_BASE_RPC_URL),
 * e.g. a keyed provider URL on deploy-previews; its host must be in the CSP
 * connect-src (netlify.toml, index.html). Whatever the URL, the adapter checks
 * `eth_chainId` before trusting it (chainCheck.ts).
 *
 * Identity checked 2026-10-07: `eth_chainId` on sepolia.base.org = 0x14a34
 * (84532) and on mainnet.base.org = 0x2105 (8453). Re-check the chain id, not
 * the reply, before changing an RPC here.
 *
 * @module lib/chain/evm/networks
 */

export interface EvmNetwork {
    /** EIP-155 chain id. */
    chainId: number
    label: string
    isTestnet: boolean
    rpcUrl: string
    explorerUrl: string
    /** Hidden networks are never offered nor restored from storage. */
    hidden: boolean
}

/** Base mainnet is defined but not offered until launch. Launch is a reviewed change of this constant. */
const BASE_MAINNET_VISIBLE = false

export const EVM_NETWORKS: Readonly<Record<string, EvmNetwork>> = Object.freeze({
    "base-sepolia": {
        chainId: 84532,
        label: "Base Sepolia",
        isTestnet: true,
        rpcUrl: import.meta.env.VITE_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
        explorerUrl: "https://sepolia.basescan.org",
        hidden: false,
    },
    base: {
        chainId: 8453,
        label: "Base",
        isTestnet: false,
        rpcUrl: import.meta.env.VITE_BASE_RPC_URL || "https://mainnet.base.org",
        explorerUrl: "https://basescan.org",
        hidden: !BASE_MAINNET_VISIBLE,
    },
})

/** Whether `key` names an EVM network that may be offered or restored. Only the registry's own keys count. */
export function isVisibleEvmNetworkKey(key: string | null | undefined): key is string {
    return !!key && Object.hasOwn(EVM_NETWORKS, key) && !EVM_NETWORKS[key].hidden
}
