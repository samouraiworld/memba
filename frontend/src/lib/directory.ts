/**
 * directory — Centralized data layer for the Organization Directory.
 *
 * Extracts token and user registry parsing from Directory.tsx into
 * testable pure functions. Uses sessionStorage for per-tab caching
 * with 5-minute TTL.
 *
 * DAO discovery uses seed list + saved DAOs (v2.2a scope).
 */

import { getSavedDAOs, type SavedDAO } from "./daoSlug"
import { ACTIVE_NETWORK_KEY, GNO_RPC_URL, currentNetworkKey } from "./config"
import { directorySeeds } from "./directorySeeds"
import { directorySeedData, fetchDirectoryDiscovery } from "./directoryDiscovery"
export { SEED_PACKAGES, SEED_REALMS } from "./directorySeeds"
import { listFactoryTokens } from "./grc20"

// ── Types ────────────────────────────────────────────────────

export type DAOCategory = "governance" | "community" | "treasury" | "defi" | "infrastructure" | "unknown"

export interface DirectoryDAO {
    name: string
    path: string
    isSaved: boolean
    category: DAOCategory
}

/**
 * I3 fix: Word-boundary matcher to prevent false positives.
 * e.g. "antinode" should NOT match "node", but "node-dao" should.
 */
function wordMatch(text: string, ...words: string[]): boolean {
    return words.some(w => new RegExp(`\\b${w}\\b`, "i").test(text))
}

/**
 * Heuristic DAO categorization based on realm path patterns.
 * Falls back to "unknown" for unrecognized paths.
 *
 * I3 fix: Uses word-boundary matching to prevent false positives
 * (e.g. "AntiNode" no longer matches infrastructure category).
 */
export function getDAOCategory(path: string, name: string): DAOCategory {
    const p = path.toLowerCase()
    const n = name.toLowerCase()

    // Governance DAOs (gov, vote, council, senate)
    if (p.includes("/gov/") || p.includes("/gov_") || wordMatch(n, "gov", "council", "senate")) {
        return "governance"
    }
    // Treasury / Finance
    if (wordMatch(n, "treasury", "finance", "fund") || p.includes("/treasury")) {
        return "treasury"
    }
    // DeFi (swap, pool, liquidity, dex)
    if (wordMatch(n, "swap", "pool", "liquidity", "dex") || p.includes("/swap")) {
        return "defi"
    }
    // Infrastructure (infra, validator, node, ops)
    if (wordMatch(n, "infra", "validator", "node", "ops") || p.includes("/infra")) {
        return "infrastructure"
    }
    // Community (everything else with demo, worx, social, community)
    if (p.includes("/demo/") || wordMatch(n, "community", "social", "worx", "club")) {
        return "community"
    }

    return "unknown"
}

export interface DirectoryToken {
    slug: string
    name: string
    symbol: string
    path: string
}

export interface DirectoryUser {
    name: string
    address: string
    avatarUrl?: string
}

// ── Cache ────────────────────────────────────────────────────

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/** P1 fix: scope cache keys by active network to prevent stale cross-network data. */
function _cacheKey(key: string): string {
    return `memba_dir_${_activeNetworkKey()}_${key}`
}

function getCached<T>(key: string): T | null {
    try {
        const raw = sessionStorage.getItem(_cacheKey(key))
        if (!raw) return null
        const entry = JSON.parse(raw)
        // C2 audit fix: validate schema before trusting cached data
        if (
            typeof entry !== "object" || entry === null ||
            typeof entry.ts !== "number" || !("data" in entry)
        ) {
            sessionStorage.removeItem(_cacheKey(key))
            return null
        }
        if (Date.now() - entry.ts > CACHE_TTL) {
            sessionStorage.removeItem(_cacheKey(key))
            return null
        }
        return entry.data as T
    } catch {
        return null
    }
}

function setCache<T>(key: string, data: T): void {
    try {
        sessionStorage.setItem(
            _cacheKey(key),
            JSON.stringify({ data, ts: Date.now() }),
        )
    } catch { /* quota exceeded */ }
}

// ── Network Helpers ─────────────────────────────────────────

/** Returns the active network key for gnoweb lookups and cache keys: the
 *  network in the current URL, else the stored explicit choice, else the
 *  default (`currentNetworkKey`). It used to read the raw URL echo
 *  (`memba_network`), which could name a hidden or retired network (pearl)
 *  after the redirects had moved the user elsewhere. */
function _activeNetworkKey(): string {
    return currentNetworkKey()
}

// ── Known Seed DAOs ──────────────────────────────────────────

export const SEED_DAOS: Array<{ name: string; path: string }> = [
    // Only realms whose identity is verified on the supported chains. Demo DAO
    // realms are never seeded.
    { name: "GovDAO", path: "gno.land/r/gov/dao" },
]

/**
 * Build a directory user list from DAO membership.
 *
 * On test13 the on-chain user registry (r/sys/users) renders stats only and
 * cannot be enumerated, so the Directory sources its "users" from real on-chain
 * DAO membership instead. Unions member addresses across the given DAO member
 * map (deduped case-insensitively, first-seen order). Usernames are left blank —
 * resolved to gnolove handles/avatars at the UI layer.
 */
export function unionDaoMembers(memberMap: Map<string, string[]>): DirectoryUser[] {
    const seen = new Set<string>()
    const users: DirectoryUser[] = []
    for (const members of memberMap.values()) {
        for (const addr of members) {
            const key = addr.toLowerCase()
            if (!seen.has(key)) {
                seen.add(key)
                users.push({ name: "", address: addr })
            }
        }
    }
    return users
}

// ── DAO Fetching ─────────────────────────────────────────────

/**
 * Get all known DAOs: seed list + user's saved DAOs (deduplicated).
 */
export function getDirectoryDAOs(networkKey = ACTIVE_NETWORK_KEY): DirectoryDAO[] {
    // Saved storage is scoped to the chain loaded by config. Never retag its
    // records when a caller explicitly asks for another network.
    const saved = networkKey === ACTIVE_NETWORK_KEY ? getSavedDAOs() : []
    const savedPaths = new Set(saved.map((s: SavedDAO) => s.realmPath))
    const result: DirectoryDAO[] = []

    // Add seeds (mark as saved if in saved list)
    for (const seed of SEED_DAOS) {
        result.push({
            name: seed.name,
            path: seed.path,
            isSaved: savedPaths.has(seed.path),
            category: getDAOCategory(seed.path, seed.name),
        })
    }

    // Add saved DAOs not already in seeds
    for (const dao of saved) {
        if (!SEED_DAOS.some(s => s.path === dao.realmPath)) {
            result.push({
                name: dao.name,
                path: dao.realmPath,
                isSaved: true,
                category: getDAOCategory(dao.realmPath, dao.name),
            })
        }
    }

    return result
}

// ── Token Parsing ────────────────────────────────────────────

/**
 * Parse GRC20 registry Render output into token entries.
 * Format: markdown table with | slug | name | symbol | path |
 */
export function parseTokenRegistry(raw: string): DirectoryToken[] {
    const entries: DirectoryToken[] = []
    const lines = raw.split("\n").filter(
        l => l.startsWith("|") && !l.startsWith("| slug") && !l.startsWith("|---"),
    )

    for (const line of lines) {
        const cols = line.split("|").map(c => c.trim()).filter(Boolean)
        if (cols.length >= 4) {
            const pathMatch = cols[3].match(/\[.*?\]\((.*?)\)/)
            entries.push({
                slug: cols[0],
                name: cols[1],
                symbol: cols[2],
                path: pathMatch ? pathMatch[1] : cols[3],
            })
        }
    }

    return entries
}

/**
 * Fetch tokens from the GRC20 factory (unified with TokenDashboard).
 * M-14 fix: Previously queried gno.land/r/demo/grc20reg which returned
 * different results than the Tokens page. Now uses the same factory source.
 * Uses sessionStorage cache.
 */
export async function fetchTokens(): Promise<DirectoryToken[]> {
    const cached = getCached<DirectoryToken[]>("tokens")
    if (cached) return cached

    try {
        const factoryTokens = await listFactoryTokens(GNO_RPC_URL)
        const tokens: DirectoryToken[] = factoryTokens.map(t => ({
            slug: t.symbol,
            name: t.name,
            symbol: t.symbol,
            path: `gno.land/r/samcrew/tokenfactory_v2:${t.symbol}`,
        }))
        setCache("tokens", tokens)
        return tokens
    } catch {
        return []
    }
}

// ── User Parsing ─────────────────────────────────────────────

/**
 * Parse user registry Render output into user entries.
 * Format: "* [username](link) - address" or "* username address"
 */
export function parseUserRegistry(raw: string): DirectoryUser[] {
    const entries: DirectoryUser[] = []
    const lines = raw.split("\n")

    for (const line of lines) {
        // Format 1: "* [username](link) - address"
        const match = line.match(/\*\s*\[([^\]]+)\]\([^)]*\)\s*-?\s*(`?)([a-z0-9]+)\2/)
        if (match) {
            entries.push({ name: match[1], address: match[3] })
            continue
        }
        // Format 2: "* username address"
        const simple = line.match(/\*\s*(\S+)\s+(\S+)/)
        if (simple && simple[2].startsWith("g1")) {
            entries.push({ name: simple[1], address: simple[2] })
        }
    }

    return entries
}

/**
 * Batch-fetch avatar URLs for a list of user addresses.
 * Queries gnolove API for GitHub avatars (lightweight — single GET per user).
 * Returns Map<address, avatarUrl>. Best-effort — missing avatars silently skipped.
 * Cached in sessionStorage for 5 minutes.
 *
 * @param addresses - User addresses to fetch avatars for
 * @param gnoloveApiUrl - Gnolove API base URL
 * @param maxConcurrent - Max parallel requests (default 10)
 */
export async function batchFetchUserAvatars(
    addresses: string[],
    gnoloveApiUrl: string,
    maxConcurrent = 10,
): Promise<Map<string, string>> {
    const cacheKey = "user_avatars"
    const cached = getCached<Record<string, string>>(cacheKey)
    const avatarMap = new Map<string, string>(cached ? Object.entries(cached) : [])

    // Only fetch addresses not already cached
    const toFetch = addresses.filter(a => !avatarMap.has(a)).slice(0, maxConcurrent)
    if (toFetch.length === 0) return avatarMap

    const results = await Promise.allSettled(
        toFetch.map(async addr => {
            const res = await fetch(`${gnoloveApiUrl}/users/${addr}`, {
                signal: AbortSignal.timeout(3000),
            })
            if (!res.ok) return null
            const data = await res.json()
            const avatar = data?.avatarURL || data?.avatar_url || ""
            return { addr, avatar }
        }),
    )

    for (const result of results) {
        if (result.status === "fulfilled" && result.value?.avatar) {
            avatarMap.set(result.value.addr, result.value.avatar)
        }
    }

    // Persist merged cache
    const cacheObj: Record<string, string> = {}
    for (const [k, v] of avatarMap.entries()) cacheObj[k] = v
    setCache(cacheKey, cacheObj)

    return avatarMap
}

// ── Contribution Scoring ─────────────────────────────────────

export interface ContributionScore {
    address: string
    daoCount: number
    level: "active" | "moderate" | "newcomer" | "observer"
}

/**
 * Classify activity level by DAO membership count.
 */
export function getActivityLevel(daoCount: number): ContributionScore["level"] {
    if (daoCount >= 3) return "active"
    if (daoCount >= 2) return "moderate"
    if (daoCount >= 1) return "newcomer"
    return "observer"
}

/**
 * Parse member addresses from a DAO Render output.
 * Looks for g1... addresses in member lists.
 */
export function parseDAOMemberAddresses(raw: string): string[] {
    const addresses: string[] = []
    const matches = raw.matchAll(/\b(g1[a-z0-9]{38})\b/g)
    for (const m of matches) {
        if (!addresses.includes(m[1])) {
            addresses.push(m[1])
        }
    }
    return addresses
}

/**
 * Calculate contribution scores for a list of users by cross-referencing
 * with DAO membership data. This is a client-side heuristic that counts
 * how many known DAOs each user address appears in.
 *
 * @param users - User list from the directory
 * @param daoMemberMap - Map of daoPath → member addresses
 */
/**
 * I1 fix: Pre-builds a Set<string> index per DAO for O(1) membership checks.
 * Previous O(n×m) approach iterated all members for every user×DAO pair.
 * New approach: O(n + m) index build + O(n × d) lookups where d = DAO count.
 */
export function calculateContributionScores(
    users: DirectoryUser[],
    daoMemberMap: Map<string, string[]>,
): Map<string, ContributionScore> {
    const scores = new Map<string, ContributionScore>()

    // I1: Pre-build Set index for O(1) member lookups
    const daoMemberSets = new Map<string, Set<string>>()
    for (const [daoPath, members] of daoMemberMap.entries()) {
        daoMemberSets.set(daoPath, new Set(members.map(m => m.toLowerCase())))
    }

    for (const user of users) {
        const addr = user.address.toLowerCase()
        let daoCount = 0

        for (const memberSet of daoMemberSets.values()) {
            if (memberSet.has(addr)) {
                daoCount++
            }
        }

        scores.set(user.address, {
            address: user.address,
            daoCount,
            level: getActivityLevel(daoCount),
        })
    }

    return scores
}

// ── Package Discovery ────────────────────────────────────────

export interface DiscoveryProvenance {
    networkKey?: string
    provenance?: "editorial" | "reference" | "saved" | "namespace"
    checkedAt?: string
}
export interface DirectoryPackage extends DiscoveryProvenance {
    name: string
    path: string
    description: string
    /** Live deployment status from gnoweb. undefined = not checked. */
    deploymentStatus?: "live" | "unknown"
    /** Gnoweb URL for this package (if deployed). */
    gnowebUrl?: string
}

/** Selected-network discovery; unscoped indexer rows are deliberately excluded. */
export async function fetchPackagesLive(networkKey = ACTIVE_NETWORK_KEY): Promise<DirectoryPackage[]> {
    return (await fetchDirectoryDiscovery(networkKey, [])).packages
}
export function fetchPackages(networkKey = ACTIVE_NETWORK_KEY): DirectoryPackage[] {
    return directorySeeds(networkKey).packages
}

// ── Realm Discovery ──────────────────────────────────────────

export interface DirectoryRealm extends DiscoveryProvenance {
    name: string
    path: string
    description: string
    category: "standard" | "defi" | "social" | "utility" | "game" | "unknown"
    /** Live deployment status from gnoweb. undefined = not checked. */
    deploymentStatus?: "live" | "unknown"
    /** Gnoweb URL for this realm (if deployed). */
    gnowebUrl?: string
}

/** Selected-network discovery; no chain identity is inferred from a path/height. */
export async function fetchRealmsLive(networkKey = ACTIVE_NETWORK_KEY): Promise<DirectoryRealm[]> {
    return (await fetchDirectoryDiscovery(networkKey, getDirectoryDAOs(networkKey))).realms
}
export function fetchRealms(networkKey = ACTIVE_NETWORK_KEY): DirectoryRealm[] {
    return directorySeedData(networkKey, getDirectoryDAOs(networkKey)).realms
}
