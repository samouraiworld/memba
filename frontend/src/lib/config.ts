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

/**
 * Treasury spend kill-switch (AAA-0 A1.a — CRITICAL fund safety).
 *
 * When false (default): hides "Propose Spend" UI, replaces deposit-inviting
 * copy with a fund-safety warning, and blocks deep-links to /treasury/propose.
 *
 * WHY: ExecuteProposal in the DAO template has no banker code — spends never
 * execute, but the UI invites deposits that are permanently irrecoverable.
 * This flag stays false until A1.c implements the real banker treasury.
 *
 * @see docs/planning/MEMBA_AAA_IMPLEMENTATION_PLAN.md §5/A1
 */
export const TREASURY_SPEND_ENABLED = import.meta.env.VITE_ENABLE_TREASURY_SPEND === "true"

/**
 * Agent credit deposit kill-switch (AAA-0 A5.ui — fail-closed).
 *
 * When false (default): disables "Deposit Credits" and "Refund Credits"
 * actions in the Marketplace CreditSection. The agent_registry realm's
 * UseCredit was historically unguarded, and depositing into an undeployed
 * or misconfigured registry would lose funds permanently.
 *
 * @see docs/planning/MEMBA_AAA_IMPLEMENTATION_PLAN.md §5/A5
 */
export const AGENT_CREDITS_ENABLED = import.meta.env.VITE_ENABLE_AGENT_CREDITS === "true"

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

/** Network configuration type. */
interface NetworkConfig {
    chainId: string
    rpcUrl: string
    fallbackRpcUrls: string[]
    /** Well-connected nodes to poll for network telemetry (peer topology via
     *  /net_info, consensus state). `/net_info` is node-local, so the primary
     *  RPC — often behind sentries — sees only a partial peer set; these nodes
     *  see more and are unioned by getAggregatedNetPeers. Must be trusted
     *  domains. Optional; falls back to rpcUrl + fallbackRpcUrls. */
    telemetryRpcUrls?: string[]
    label: string
    userRegistryPath: string
    faucetUrl: string
    /** When true, the network is reachable by URL/env but hidden from the selector. */
    hidden?: boolean
    /** When false, Memba's realms are NOT deployed on this network — the app shows
     *  a notice instead of letting DAO/channel features fail with 404s. Omitted
     *  (or true) means the realms are deployed. */
    realmsDeployed?: boolean
}

/** Available Gno networks for the chain selector. */
export const NETWORKS: Record<string, NetworkConfig> = {
    // Testnet 13 — the official Gno testnet (gno v0.9 / pre-interrealm-v2).
    // On-wire chainId is "test-13" (HYPHEN) — it is embedded in the ADR-036 sign
    // doc, so it MUST match the chain exactly or every login fails "invalid user
    // signature". The map KEY ("test13") stays identifier-safe.
    //
    // Canonical RPC is gno-core's official node (rpc.test13.testnets.gno.land,
    // verified live). Kept env-overridable (VITE_TEST13_RPC_URL); onbloc's node
    // (Adena's GetNetwork() default since v1.19.5 #856) and aeddi's node remain as
    // fallbacks — all three are CSP- and TRUSTED_RPC_DOMAINS-covered.
    //
    // The official Gno testnet. Memba's frozen realm set (memba_dao,
    // candidature_v2, channels_v2, agent_registry) + gnodaokit are deployed here
    // (interrealm-v2, 2026-06-16), so DAO features are live — realmsDeployed
    // omitted (defaults to deployed).
    test13: {
        chainId: "test-13",
        rpcUrl: import.meta.env.VITE_TEST13_RPC_URL || "https://rpc.test13.testnets.gno.land:443",
        fallbackRpcUrls: [
            "https://test13.rpc.onbloc.xyz:443",
            "https://rpc.test-13-aeddi-1.gnoland.network:443",
        ],
        // Telemetry sources for the Validators monitoring view. The canonical RPC
        // and onbloc sit behind sentries and each see only ~5 /net_info peers
        // (not even the validator nodes). aeddi-1 (gno-core, what gnockpit uses)
        // sees the full ~13-node topology; samourai-dev-sentry-1 is our own
        // well-connected node. Unioned by getAggregatedNetPeers so the peer list
        // matches the real network. Both are TRUSTED_RPC_DOMAINS-covered.
        telemetryRpcUrls: [
            "https://rpc.test-13-aeddi-1.gnoland.network:443",
            "https://rpc.testnet13.samourai.live:443",
        ],
        label: "Testnet 13",
        userRegistryPath: "gno.land/r/sys/users",
        faucetUrl: "https://faucet.gno.land",
    },
    gnoland1: {
        chainId: "gnoland1",
        rpcUrl: "https://rpc.gnoland1.samourai.live:443",
        fallbackRpcUrls: [
            "https://rpc.gnoland1.moul.p2p.team",
            "https://rpc.gnoland1.aeddi.org",
            "https://rpc.betanet.testnets.gno.land",
        ],
        label: "Betanet (gnoland1)",
        userRegistryPath: "gno.land/r/sys/users",
        faucetUrl: "",
    },
}

/** Networks shown in the selector (all non-hidden ones). NETWORKS stays the
 *  full map for resolution by URL/env/localStorage. */
export const VISIBLE_NETWORKS: Record<string, NetworkConfig> = Object.fromEntries(
    Object.entries(NETWORKS).filter(([, n]) => !n.hidden),
)

/** Default network key. */
export const DEFAULT_NETWORK = import.meta.env.VITE_GNO_CHAIN_ID || "test13"

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
 * On test13/betanet this is `gno.land/r/sys/users` (upstream migration).
 */
export function getUserRegistryPath(): string {
    return NETWORKS[_activeNetwork]?.userRegistryPath || "gno.land/r/sys/users"
}

/**
 * Whether Memba's realms are deployed on the given network. A network may be
 * official and reachable (e.g. test13) while Memba's own contracts are not yet
 * deployed there — in that case DAO/channel features would 404. Returns false
 * only when the network explicitly sets `realmsDeployed: false`; unknown
 * networks default to true (don't gate the UI on a typo'd key).
 */
export function networkHasRealms(networkKey: string): boolean {
    return NETWORKS[networkKey]?.realmsDeployed !== false
}

/** Whether Memba's realms are deployed on the currently active network. */
export function areRealmsDeployed(): boolean {
    return networkHasRealms(_activeNetwork)
}

/**
 * Per-realm validity allowlist, keyed by network. `networkHasRealms` is coarse
 * (all-or-nothing); test13 is the first "partial" network where some realms are
 * deployed & valid (interrealm-v2) while others are stale v1 packages the v2 VM
 * can't evaluate (calls throw "unexpected node …:0:0") or simply absent. List
 * here ONLY the realms confirmed callable on that network; a network with no
 * entry = all realms assumed valid (gnoland1). When a realm is
 * (re)deployed to a new valid path, add that path here.
 */
const REALM_ALLOWLIST: Record<string, readonly string[] | undefined> = {
    test13: [
        "gno.land/r/samcrew/memba_dao",
        "gno.land/r/samcrew/memba_dao_candidature_v2",
        "gno.land/r/samcrew/memba_dao_channels_v2",
        "gno.land/r/samcrew/agent_registry",
        // Commerce realms redeployed to interrealm-v2 _v2 paths (2026-06-16).
        "gno.land/r/samcrew/tokenfactory_v2",
        "gno.land/r/samcrew/escrow_v2",
        "gno.land/r/samcrew/gnobuilders_badges_v2",
        "gno.land/r/samcrew/memba_feedback_v2",
        // NFT realms deployed 2026-06-16.
        "gno.land/r/samcrew/memba_nft_v2",
        "gno.land/r/samcrew/memba_nft_market_v2",
        // Phase 2 canonical launchpad registry — deployed 2026-06-17 (multisig
        // seq 43). isNftLaunchpadValid() now flips true so /nft/create,
        // /nft/collection/:id and /nft/creator/:address surface, along with the
        // verified-collection badge (both key off this registry). The v3 trading
        // engine (memba_nft_market_v3) is live but not yet frontend-wired — it
        // lands with the Phase 3 multi-engine router, so it stays out of the
        // allowlist until then.
        "gno.land/r/samcrew/memba_collections",
    ],
}

/**
 * Is a realm callable on the given network? Networks without an allowlist entry
 * default to true (don't gate gnoland1).
 */
export function isRealmValidOn(networkKey: string, realmPath: string): boolean {
    const allow = REALM_ALLOWLIST[networkKey]
    return !allow || allow.includes(realmPath)
}

/**
 * Is a realm callable on the currently active network? Use this to hide
 * features whose backing realm is missing or invalid on the active chain,
 * instead of letting a maketx fail with a raw VM error.
 */
export function isRealmValid(realmPath: string): boolean {
    return isRealmValidOn(_activeNetwork, realmPath)
}


/** Gno chain ID for all RPC calls. */
export const GNO_CHAIN_ID = NETWORKS[_activeNetwork]?.chainId || "test-13"

/**
 * Normal Gno RPC endpoint for standard ABCI queries and broadcasting.
 * Defaults to the active network's RPC URL.
 */
export const GNO_RPC_URL = NETWORKS[_activeNetwork]?.rpcUrl || "https://rpc.test13.testnets.gno.land:443"

/** Fallback RPC URLs for the active network (tried in order if primary fails). */
export const GNO_FALLBACK_RPC_URLS: string[] = NETWORKS[_activeNetwork]?.fallbackRpcUrls || []

/**
 * Samourai Sentry RPC URL (Dual-RPC Strategy).
 * Used optionally by Hacker Mode for direct, high-frequency, uncached consensus telemetry
 * (e.g. /net_info, /dump_consensus_state) when available on gnoland1.
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
    // Prefer the best-connected telemetry node (fresher consensus state) over the
    // sentry-fronted primary; falls back to GNO_RPC_URL if none configured.
    return getTelemetryRpcUrls()[0] || GNO_RPC_URL
}

/**
 * Ordered, deduped list of TRUSTED RPC nodes to poll for network telemetry.
 *
 * `/net_info` is node-local, so a single RPC gives a partial peer view. This
 * unions the env sentry override, the network's dedicated telemetry nodes, the
 * primary RPC, and the fallbacks — letting getAggregatedNetPeers reconstruct the
 * full topology. Untrusted entries are dropped (the env override warns).
 *
 * Priority: VITE_SAMOURAI_SENTRY_RPC_URL → network.telemetryRpcUrls →
 *           GNO_RPC_URL → GNO_FALLBACK_RPC_URLS
 */
export function getTelemetryRpcUrls(): string[] {
    const net = NETWORKS[_activeNetwork]
    const candidates = [
        SAMOURAI_SENTRY_RPC_URL,
        ...(net?.telemetryRpcUrls || []),
        GNO_RPC_URL,
        ...GNO_FALLBACK_RPC_URLS,
    ]
    const out: string[] = []
    const seen = new Set<string>()
    for (const url of candidates) {
        if (!url || seen.has(url)) continue
        if (!isTrustedRpcDomain(url)) {
            if (url === SAMOURAI_SENTRY_RPC_URL) {
                console.warn(
                    `[Memba] VITE_SAMOURAI_SENTRY_RPC_URL is not a trusted domain: ${url}. ` +
                    "Excluding it from telemetry. Add the domain to TRUSTED_RPC_DOMAINS if intentional."
                )
            }
            continue
        }
        seen.add(url)
        out.push(url)
    }
    return out
}

/** External faucet URL for the active network (empty = no faucet). */
export const GNO_FAUCET_URL = NETWORKS[_activeNetwork]?.faucetUrl || ""

/** Explorer base URL for the active network (for user profile links, realm links, etc). */
export function getExplorerBaseUrl(): string {
    const chain = NETWORKS[_activeNetwork]?.chainId || "test-13"
    switch (chain) {
        case "gnoland1": return "https://betanet.gno.land"
        // Official test13 gnoweb (verified live). Env override stays available.
        case "test-13": return import.meta.env.VITE_TEST13_EXPLORER_URL || "https://test13.testnets.gno.land"
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
export const DAO_REALM_PATH = import.meta.env.VITE_DAO_REALM_PATH || "gno.land/r/samcrew/memba_dao"

/** Gnolove API base URL for profile enrichment and contribution data. */
export const GNOLOVE_API_URL = import.meta.env.VITE_GNOLOVE_API_URL || "https://backend.gnolove.world"

/** Gnomonitoring API base URL for validator metrics (monikers, uptime, participation).
 *  Serves Memba's /validators dashboard. Public, no auth required.
 *  Override via VITE_GNO_MONITORING_API_URL if you run your own instance. */
/** Trusted domains for the monitoring API. */
const TRUSTED_MONITORING_DOMAINS = ["gnolove.world", "monitoring.gnolove.world", "localhost"]

function isTrustedMonitoringDomain(url: string): boolean {
    try {
        const hostname = new URL(url).hostname.toLowerCase()
        return TRUSTED_MONITORING_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`))
    } catch { return false }
}

export const GNO_MONITORING_API_URL = (() => {
    const url = import.meta.env.VITE_GNO_MONITORING_API_URL || "https://monitoring.gnolove.world"
    if (url !== "https://monitoring.gnolove.world" && !isTrustedMonitoringDomain(url)) {
        console.warn(`[Memba] Untrusted monitoring API URL: ${url}. Falling back to default.`)
        return "https://monitoring.gnolove.world"
    }
    return url
})()

/** Clerk publishable key for alerting feature auth.
 *  Shared Clerk app instance for Memba alerting.
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
    test13: { pool: "", router: "", position: "", gns: "" },
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
 * A malicious RPC with a valid chain ID (e.g. https://test13.evil.com)
 * would pass chain ID checks but could intercept/manipulate queries.
 *
 * Samourai Coop sentry nodes are included as trusted for Hacker View telemetry.
 */
export const TRUSTED_RPC_DOMAINS = [
    "gno.land",
    "testnets.gno.land", // covers rpc.test13.testnets.gno.land (official test13) + others
    "rpc.gno.land",
    "gnoland.network", // test-13 indexer/gnoweb + gnoland1 fallbacks, suffix-matched
    "onbloc.xyz",      // test-13 canonical RPC (test13.rpc.onbloc.xyz) — Adena moved here in v1.19.5 (#856)
    // Samourai Coop sentry/validator nodes — trusted for Hacker View dual-RPC strategy.
    // Convention: https://rpc.{chain}.samourai.live
    //   - gnoland1:  https://rpc.gnoland1.samourai.live  (live)
    //   - testnet13: https://rpc.testnet13.samourai.live (live)
    "samourai.live",
    "p2p.team",       // moul's infra + team nodes (gnoland1.moul.p2p.team etc.)
    "aeddi.org",      // aeddi's gnoland1 validator node
    "gnoland1.io",    // gnoland1 betanet official
    "163.172.33.181", // gno core team bare-metal node
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
export const GRC20_FACTORY_PATH = "gno.land/r/samcrew/tokenfactory_v2"

/** Memba token config for development (test13). */
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
    channelsPath: import.meta.env.VITE_CHANNELS_REALM_PATH || "gno.land/r/samcrew/memba_dao_channels_v2",
    candidaturePath: import.meta.env.VITE_CANDIDATURE_REALM_PATH || "gno.land/r/samcrew/memba_dao_candidature_v2",
    agentRegistryPath: "gno.land/r/samcrew/agent_registry",
    escrowPath: "gno.land/r/samcrew/escrow_v2",
    nftMarketPath: "gno.land/r/samcrew/memba_nft_market_v2",
    nftCollectionsPath: "gno.land/r/samcrew/memba_collections", // Phase 2 launchpad registry (pending deploy)
    badgesPath: "gno.land/r/samcrew/gnobuilders_badges_v2",
    deployFee: 10_000_000, // 10 GNOT in ugnot
} as const

/** Feedback board realm path (shared with FeedbackFeed). */
export const FEEDBACK_REALM_PATH = "gno.land/r/samcrew/memba_feedback_v2"

/**
 * The network key the backend home snapshot is scoped to.
 * useHomeSnapshot gates its query on this key so it never fires on other networks.
 */
export const SNAPSHOT_NETWORK = "test13"

/**
 * Featured DAO realm path per network key — the DAO surfaced on the home
 * StateBoard for everyone (members + visitors). Null means the panel
 * self-hides on that network.
 *
 * Only networks where the realm is confirmed callable are populated; an
 * absent/null entry causes FeaturedDaoPanel to render null (no error).
 */
export const FEATURED_DAO_REALM: Record<string, string | null> = {
    test13: MEMBA_DAO.realmPath, // "gno.land/r/samcrew/memba_dao" — live on test13
    gnoland1: null,
}

/**
 * Get the featured DAO realm path for a given network key.
 * Returns null when no featured DAO is configured or the realm is not valid.
 */
export function getFeaturedDaoRealm(networkKey: string): string | null {
    const path = FEATURED_DAO_REALM[networkKey] ?? null
    if (!path) return null
    // Guard: realm must also be valid on the network (covers REALM_ALLOWLIST)
    if (!isRealmValidOn(networkKey, path)) return null
    return path
}

// ── Per-feature validity predicates (back each feature by its realm) ──
// These let a page short-circuit to a "not on this network" gate when its
// realm isn't valid on the active chain. Env feature-flags (VITE_ENABLE_*)
// are ANDed by the consuming page where they apply.
export const isTokenFactoryValid = () => isRealmValid(GRC20_FACTORY_PATH)
export const isEscrowValid = () => isRealmValid(MEMBA_DAO.escrowPath)
export const isNftMarketValid = () => isRealmValid(MEMBA_DAO.nftMarketPath)
/** Phase 2 launchpad — backed by the canonical memba_collections registry. */
export const isNftLaunchpadValid = () => isRealmValid(MEMBA_DAO.nftCollectionsPath)
export const isFeedbackValid = () => isRealmValid(FEEDBACK_REALM_PATH)

/**
 * NFT feature flag (VITE_ENABLE_NFT). The canonical reader for the whole NFT /
 * launchpad / studio surface — use this everywhere instead of re-deriving
 * `import.meta.env.VITE_ENABLE_NFT` per page, so a new NFT route can't silently
 * ship ungated (the P0 that left on-chain mint reachable by direct URL while the
 * feature was "off"). Pages still AND it with the relevant realm-validity
 * predicate (e.g. isNftMarketValid) where a tx targets a specific realm.
 */
export const isNftEnabled = (): boolean => import.meta.env.VITE_ENABLE_NFT === "true"

/** Token allocation percentages (total = 100%). */
export const MEMBA_TOKEN_ALLOCATION = {
    community: 40,    // 40% — airdrops, candidature rewards
    treasury: 30,     // 30% — DAO treasury
    development: 20,  // 20% — engineering & ops
    founders: 10,     // 10% — founding team, 12-month vesting
} as const
