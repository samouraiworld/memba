/**
 * Centralized environment configuration for the Memba frontend.
 *
 * Sections:
 * 1. App Identity — version, OAuth
 * 2. Backend API — base URL
 * 3. Gno Networks — chain configs, RPC, explorer
 * 4. Address Constants — bech32, units
 * 5. External Services — gnolove, DAO realm
 * 6. GnoSwap DEX — per-chain contract paths
 * 7. RPC Security — domain allowlist
 *
 * All env vars read from Vite's import.meta.env with sensible defaults.
 */

// ── 1. App Identity ──────────────────────────────────────────
export const APP_VERSION = __APP_VERSION__

/** GitHub OAuth App Client ID (must be set via VITE_GITHUB_CLIENT_ID env var). */
export const GITHUB_OAUTH_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID || ""

// ── 2. Backend API ───────────────────────────────────────────

/** Backend API base URL.
 * In dev: empty string → uses Vite proxy.
 * In production: must be set via VITE_API_URL build arg, or falls back to Fly.io. */
export const API_BASE_URL =
    import.meta.env.VITE_API_URL ||
    (import.meta.env.PROD ? "https://memba-backend.fly.dev" : "")

// ── 3. Gno Networks ──────────────────────────────────────────

/** Available Gno networks for the chain selector. */
export const NETWORKS: Record<string, { chainId: string; rpcUrl: string; label: string; userRegistryPath: string; faucetUrl: string }> = {
    test12: {
        chainId: "test12",
        rpcUrl: "https://rpc.testnet12.samourai.live:443",
        label: "Testnet 12",
        userRegistryPath: "gno.land/r/sys/users",
        faucetUrl: "https://faucet.gno.land",
    },
    test11: {
        chainId: "test11",
        rpcUrl: "https://rpc.test11.testnets.gno.land:443",
        label: "Testnet 11",
        userRegistryPath: "gno.land/r/gnoland/users/v1",
        faucetUrl: "https://faucet.gno.land",
    },
    staging: {
        chainId: "staging",
        rpcUrl: "https://rpc.gno.land:443",
        label: "Staging",
        userRegistryPath: "gno.land/r/gnoland/users/v1",
        faucetUrl: "",
    },
    "portal-loop": {
        chainId: "portal-loop",
        rpcUrl: "https://rpc.gno.land:443",
        label: "Portal Loop",
        userRegistryPath: "gno.land/r/gnoland/users/v1",
        faucetUrl: "",
    },
    gnoland1: {
        chainId: "gnoland1",
        rpcUrl: "https://rpc.gnoland1.samourai.live:443",
        label: "Betanet (gnoland1)",
        userRegistryPath: "gno.land/r/sys/users",
        faucetUrl: "",
        // Official RPC (currently down): https://rpc.betanet.testnets.gno.land:443
    },
}

/** Default network key. */
export const DEFAULT_NETWORK = import.meta.env.VITE_GNO_CHAIN_ID || "test12"

/** Resolve active network from localStorage or env.
 *  WARNING: shared.ts and profile.ts compute USER_REGISTRY at module load time.
 *  useNetwork.ts MUST call window.location.reload() on network switch to re-initialize.
 */
function getActiveNetworkKey(): string {
    try {
        const stored = localStorage.getItem("memba_network")
        if (stored && NETWORKS[stored]) return stored
    } catch { /* SSR or missing localStorage */ }
    return DEFAULT_NETWORK
}

const _activeNetwork = getActiveNetworkKey()

/**
 * Returns the user registry realm path for the active network.
 * On legacy chains (test11) this is `gno.land/r/gnoland/users/v1`.
 * On test12+/betanet this is `gno.land/r/sys/users` (upstream migration).
 */
export function getUserRegistryPath(): string {
    return NETWORKS[_activeNetwork]?.userRegistryPath || "gno.land/r/sys/users"
}


/** Gno chain ID for all RPC calls. */
export const GNO_CHAIN_ID = NETWORKS[_activeNetwork]?.chainId || "test12"

/**
 * Normal Gno RPC endpoint for standard ABCI queries and broadcasting.
 * Defaults to the active network's RPC URL.
 */
export const GNO_RPC_URL = NETWORKS[_activeNetwork]?.rpcUrl || "https://rpc.testnet12.samourai.live:443"

/**
 * Samourai Sentry RPC URL (Dual-RPC Strategy).
 * Used optionally by Hacker Mode for direct, high-frequency, uncached consensus telemetry
 * (e.g. /net_info, /dump_consensus_state) when available on gnoland1/testnet12.
 */
export const SAMOURAI_SENTRY_RPC_URL = import.meta.env.VITE_SAMOURAI_SENTRY_RPC_URL || ""

/**
 * Retrieves the optimal RPC URL for Hacker Mode telemetry.
 *
 * Security: validates the sentry URL against TRUSTED_RPC_DOMAINS before use.
 * If the sentry URL is not trusted (misconfigured env var), logs a warning
 * and falls back to the standard public RPC.
 *
 * Priority: SAMOURAI_SENTRY_RPC_URL (trusted) → GNO_RPC_URL
 */
export function getTelemetryRpcUrl(): string {
    if (SAMOURAI_SENTRY_RPC_URL) {
        if (isTrustedRpcDomain(SAMOURAI_SENTRY_RPC_URL)) {
            return SAMOURAI_SENTRY_RPC_URL
        }
        // Untrusted sentry URL — warn and fall back (security hardening S4)
        console.warn(
            `[Memba] VITE_SAMOURAI_SENTRY_RPC_URL is not a trusted domain: ${SAMOURAI_SENTRY_RPC_URL}. ` +
            "Falling back to GNO_RPC_URL. Add the domain to TRUSTED_RPC_DOMAINS in config.ts if intentional."
        )
    }
    return GNO_RPC_URL
}

/** External faucet URL for the active network (empty = no faucet). */
export const GNO_FAUCET_URL = NETWORKS[_activeNetwork]?.faucetUrl || ""

/** Explorer base URL for the active network (for user profile links, realm links, etc). */
export function getExplorerBaseUrl(): string {
    const chain = NETWORKS[_activeNetwork]?.chainId || "test12"
    switch (chain) {
        case "staging": return "https://staging.gno.land"
        case "portal-loop": return "https://gno.land"
        case "gnoland1": return "https://betanet.gno.land"
        case "test12": return "https://test12.gno.land"
        default: return `https://${chain}.testnets.gno.land`
    }
}

/** Bech32 human-readable part (HRP) for Gno addresses. */
export const GNO_BECH32_HRP = import.meta.env.VITE_GNO_BECH32_PREFIX || "g"

/** @deprecated Use GNO_BECH32_HRP for HRP or BECH32_PREFIX for address validation. */
export const GNO_BECH32_PREFIX = GNO_BECH32_HRP

// ── 4. Address Constants ─────────────────────────────────────

/** Full bech32 address prefix (HRP + separator) used for address validation. */
export const BECH32_PREFIX = GNO_BECH32_HRP + "1"

/** Conversion factor: 1 GNOT = 1,000,000 ugnot. */
export const UGNOT_PER_GNOT = 1_000_000

// ── 5. External Services ─────────────────────────────────────

/** DAO realm path on-chain. Update when the DAO realm is deployed. */
export const DAO_REALM_PATH = import.meta.env.VITE_DAO_REALM_PATH || "gno.land/r/samcrew/samourai_dao"

/** Gnolove API base URL for profile enrichment and contribution data. */
export const GNOLOVE_API_URL = import.meta.env.VITE_GNOLOVE_API_URL || "https://backend.gnolove.world"

/** Gnomonitoring API base URL for validator metrics (monikers, uptime, participation).
 *  Same service used by gnolove.world/validators. Public, no auth required.
 *  Override via VITE_GNO_MONITORING_API_URL if you run your own instance. */
export const GNO_MONITORING_API_URL = import.meta.env.VITE_GNO_MONITORING_API_URL || "https://monitoring.gnolove.world"

/** Clerk publishable key for alerting feature auth.
 *  Shared with gnolove.world — same Clerk app instance.
 *  Only loaded by the /alerts route (lazy). No impact on other pages. */
export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || ""

// ── 6. GnoSwap DEX Integration ───────────────────────────────

/** GnoSwap realm paths per chain. */
export interface GnoSwapPaths {
    pool: string
    router: string
    position: string
    /** GNS token realm — has working Render() for availability checks. */
    gns: string
}

/** Per-chain GnoSwap contract paths. Empty strings = not deployed on that chain. */
export const GNOSWAP_PATHS: Record<string, GnoSwapPaths> = {
    test11: {
        pool: "gno.land/r/gnoswap/pool",
        router: "gno.land/r/gnoswap/router",
        position: "gno.land/r/gnoswap/position",
        gns: "gno.land/r/gnoswap/gns",
    },
    staging: { pool: "", router: "", position: "", gns: "" },
    "portal-loop": { pool: "", router: "", position: "", gns: "" },
    test12: { pool: "", router: "", position: "", gns: "" },
    gnoland1: { pool: "", router: "", position: "", gns: "" },
}

/** Get GnoSwap paths for the active chain. Returns null if not deployed. */
export function getGnoSwapPaths(): GnoSwapPaths | null {
    const paths = GNOSWAP_PATHS[_activeNetwork]
    if (!paths || !paths.gns) return null
    return paths
}

// ── 7. RPC Domain Security ───────────────────────────────────

/**
 * Trusted RPC domain patterns. Only these domains are considered safe.
 * A malicious RPC with a valid chain ID (e.g. https://test12.evil.com)
 * would pass chain ID checks but could intercept/manipulate queries.
 *
 * Samourai Coop sentry nodes are included as trusted for Hacker View telemetry.
 */
export const TRUSTED_RPC_DOMAINS = [
    "gno.land",
    "testnets.gno.land",
    "rpc.gno.land",
    "rpc.test11.testnets.gno.land",
    "rpc.test12.gno.land",
    // Samourai Coop sentry/validator nodes — trusted for Hacker View dual-RPC strategy.
    // Convention: https://rpc.{chain}.samourai.live
    //   - gnoland1:  https://rpc.gnoland1.samourai.live  (live)
    //   - testnet12: https://rpc.testnet12.samourai.live (live)
    "samourai.live",
    "p2p.team",       // moul's infra + team nodes (gnoland1.moul.p2p.team etc.)
    "gnoland1.io",    // gnoland1 betanet official
    "localhost",      // local devnet
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

// ── 8. MembaDAO Token ────────────────────────────────────────

/** GRC20 factory realm path (shared with grc20.ts). */
export const GRC20_FACTORY_PATH = "gno.land/r/demo/defi/grc20factory"

/** Memba token config for development (test12). */
export const MEMBA_TOKEN_DEV = {
    symbol: "MEMBATEST",
    name: "Memba Governance Token (Testnet)",
    decimals: 6,
    totalSupply: "10000000000000", // 10M * 10^6
    factoryPath: GRC20_FACTORY_PATH,
} as const

/** Memba token config for production (betanet/mainnet). */
export const MEMBA_TOKEN_PROD = {
    symbol: "MEMBA",
    name: "Memba Governance Token",
    decimals: 6,
    totalSupply: "10000000000000",
    factoryPath: GRC20_FACTORY_PATH,
} as const

/** Active token config — MEMBATEST for dev, MEMBA for production. */
export const MEMBA_TOKEN = import.meta.env.PROD
    ? MEMBA_TOKEN_PROD
    : MEMBA_TOKEN_DEV

/** MembaDAO realm paths and deployment params. */
export const MEMBA_DAO = {
    realmPath: "gno.land/r/samcrew/memba_dao",
    channelsPath: "gno.land/r/samcrew/memba_dao_channels",
    candidaturePath: "gno.land/r/samcrew/memba_dao_candidature",
    deployFee: 10_000_000, // 10 GNOT in ugnot
} as const

/** Token allocation percentages (total = 100%). */
export const MEMBA_TOKEN_ALLOCATION = {
    community: 40,    // 40% — airdrops, candidature rewards
    treasury: 30,     // 30% — DAO treasury
    development: 20,  // 20% — engineering & ops
    founders: 10,     // 10% — founding team, 12-month vesting
} as const
