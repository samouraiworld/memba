/**
 * Centralized environment configuration for the Memba frontend.
 * All env vars read from Vite's import.meta.env with sensible defaults.
 */

/** Application version — single source of truth for header/footer badges. */
export const APP_VERSION = "1.3.0"

/** GitHub OAuth App Client ID (must be set via VITE_GITHUB_CLIENT_ID env var). */
export const GITHUB_OAUTH_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID || ""

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
    staging: {
        chainId: "staging",
        rpcUrl: "https://rpc.gno.land:443",
        label: "Staging",
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

/** Explorer base URL for the active network (for user profile links, realm links, etc). */
export function getExplorerBaseUrl(): string {
    const chain = NETWORKS[_activeNetwork]?.chainId || "test11"
    switch (chain) {
        case "staging": return "https://staging.gno.land"
        case "portal-loop": return "https://gno.land"
        default: return `https://${chain}.testnets.gno.land`
    }
}

/** Bech32 human-readable part (HRP) for Gno addresses. */
export const GNO_BECH32_HRP = import.meta.env.VITE_GNO_BECH32_PREFIX || "g"

/** @deprecated Use GNO_BECH32_HRP for HRP or BECH32_PREFIX for address validation. */
export const GNO_BECH32_PREFIX = GNO_BECH32_HRP

/** Full bech32 address prefix (HRP + separator) used for address validation. */
export const BECH32_PREFIX = GNO_BECH32_HRP + "1"

/** Conversion factor: 1 GNOT = 1,000,000 ugnot. */
export const UGNOT_PER_GNOT = 1_000_000

/** DAO realm path on-chain. Update when the DAO realm is deployed. */
export const DAO_REALM_PATH = import.meta.env.VITE_DAO_REALM_PATH || "gno.land/r/samcrew/samourai_dao"

/** Gnolove API base URL for profile enrichment and contribution data. */
export const GNOLOVE_API_URL = import.meta.env.VITE_GNOLOVE_API_URL || "https://gnolove.world"

// ── RPC Domain Security ──────────────────────────────────────

/**
 * Trusted RPC domain patterns. Only these domains are considered safe.
 * A malicious RPC with a valid chain ID (e.g. https://test11.evil.com)
 * would pass chain ID checks but could intercept/manipulate queries.
 */
export const TRUSTED_RPC_DOMAINS = [
    "gno.land",
    "testnets.gno.land",
    "rpc.gno.land",
    "rpc.test11.testnets.gno.land",
]

/**
 * Check if an RPC URL belongs to a trusted domain.
 * Returns true if the URL's hostname is or ends with a trusted domain.
 *
 * Examples:
 *   isTrustedRpcDomain("https://rpc.test11.testnets.gno.land:443") → true
 *   isTrustedRpcDomain("https://rpc.gno.land:443") → true
 *   isTrustedRpcDomain("https://test11.malicious.land:443") → false
 *   isTrustedRpcDomain("https://fakegno.land:443") → false
 */
export function isTrustedRpcDomain(url: string): boolean {
    try {
        const hostname = new URL(url).hostname.toLowerCase()
        return TRUSTED_RPC_DOMAINS.some(domain => {
            const d = domain.toLowerCase()
            // Exact match or subdomain match (preceded by a dot)
            return hostname === d || hostname.endsWith("." + d)
        })
    } catch {
        return false // invalid URL = untrusted
    }
}

/**
 * Validate that the active network config uses a trusted RPC domain.
 * Returns an error message if untrusted, or null if safe.
 */
export function validateActiveRpcDomain(): string | null {
    if (!isTrustedRpcDomain(GNO_RPC_URL)) {
        return `Untrusted RPC domain detected: ${GNO_RPC_URL}. Expected a *.gno.land domain.`
    }
    return null
}

