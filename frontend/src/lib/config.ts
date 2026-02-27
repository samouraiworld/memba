/**
 * Centralized environment configuration for the Memba frontend.
 * All env vars read from Vite's import.meta.env with sensible defaults.
 */

/** Application version — single source of truth for header/footer badges. */
export const APP_VERSION = "4.1.0"

// Environment-driven config with sensible defaults.

/** Backend API base URL.
 * In dev: empty string → uses Vite proxy.
 * In production: must be set via VITE_API_URL build arg, or falls back to Fly.io. */
export const API_BASE_URL =
    import.meta.env.VITE_API_URL ||
    (import.meta.env.PROD ? "https://memba-backend.fly.dev" : "")

/** Available Gno networks for the chain selector. */
export const NETWORKS: Record<string, { chainId: string; rpcUrl: string; label: string }> = {
    test11: {
        chainId: "test11",
        rpcUrl: "https://rpc.test11.testnets.gno.land:443",
        label: "Testnet 11",
    },
    "portal-loop": {
        chainId: "portal-loop",
        rpcUrl: "https://rpc.gno.land:443",
        label: "Portal Loop",
    },
}

/** Default network key. */
export const DEFAULT_NETWORK = import.meta.env.VITE_GNO_CHAIN_ID || "test11"

/** Resolve active network from localStorage or env. */
function getActiveNetworkKey(): string {
    try {
        const stored = localStorage.getItem("memba_network")
        if (stored && NETWORKS[stored]) return stored
    } catch { /* SSR or missing localStorage */ }
    return DEFAULT_NETWORK
}

const _activeNetwork = getActiveNetworkKey()

/** Gno chain ID for all RPC calls. */
export const GNO_CHAIN_ID = NETWORKS[_activeNetwork]?.chainId || "test11"

/** Gno RPC endpoint for ABCI queries and broadcasting. */
export const GNO_RPC_URL = NETWORKS[_activeNetwork]?.rpcUrl || "https://rpc.test11.testnets.gno.land:443"

/** Bech32 prefix for Gno addresses. */
export const GNO_BECH32_PREFIX = import.meta.env.VITE_GNO_BECH32_PREFIX || "g"

/** Conversion factor: 1 GNOT = 1,000,000 ugnot. */
export const UGNOT_PER_GNOT = 1_000_000

/** DAO realm path on-chain. Update when the DAO realm is deployed. */
export const DAO_REALM_PATH = import.meta.env.VITE_DAO_REALM_PATH || "gno.land/r/samcrew/samourai_dao"

