/**
 * directory — Centralized data layer for the Organization Directory.
 *
 * Extracts token and user registry parsing from Directory.tsx into
 * testable pure functions. Uses sessionStorage for per-tab caching
 * with 5-minute TTL.
 *
 * DAO discovery uses seed list + saved DAOs (v2.2a scope).
 */

import { queryRender } from "./dao/shared"
import { getSavedDAOs, type SavedDAO } from "./daoSlug"
import { GNO_RPC_URL } from "./config"

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

function getCached<T>(key: string): T | null {
    try {
        const raw = sessionStorage.getItem(`memba_dir_${key}`)
        if (!raw) return null
        const entry = JSON.parse(raw)
        // C2 audit fix: validate schema before trusting cached data
        if (
            typeof entry !== "object" || entry === null ||
            typeof entry.ts !== "number" || !("data" in entry)
        ) {
            sessionStorage.removeItem(`memba_dir_${key}`)
            return null
        }
        if (Date.now() - entry.ts > CACHE_TTL) {
            sessionStorage.removeItem(`memba_dir_${key}`)
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
            `memba_dir_${key}`,
            JSON.stringify({ data, ts: Date.now() }),
        )
    } catch { /* quota exceeded */ }
}

// ── Known Seed DAOs ──────────────────────────────────────────

export const SEED_DAOS: Array<{ name: string; path: string }> = [
    { name: "GovDAO", path: "gno.land/r/gov/dao" },
    { name: "Worx DAO", path: "gno.land/r/demo/worx" },
]

/**
 * Known DAO paths to probe for auto-discovery.
 * Each path is queried via ABCI Render("") — if it responds, it's a valid DAO.
 *
 * I2 fix: Mutable array with addDiscoveryProbe() for runtime extensibility.
 * External integrations can register new probes without code changes.
 */
const _discoveryProbes: Array<{ name: string; path: string }> = [
    { name: "GovDAO", path: "gno.land/r/gov/dao" },
    { name: "Worx DAO", path: "gno.land/r/demo/worx" },
    { name: "GovDAO v2", path: "gno.land/r/gov/dao/v2" },
    { name: "Faucet Hub", path: "gno.land/r/faucet/admin" },
]

/** Read-only snapshot of current discovery probes. */
export function getDiscoveryProbes(): ReadonlyArray<{ name: string; path: string }> {
    return [..._discoveryProbes]
}

/**
 * Register a new DAO path to probe during auto-discovery.
 * Deduplicates by path — silently ignores duplicates.
 */
export function addDiscoveryProbe(name: string, path: string): void {
    if (!_discoveryProbes.some(p => p.path === path)) {
        _discoveryProbes.push({ name, path })
    }
}

/**
 * Probe a list of known DAO paths via ABCI Render("").
 * Returns only paths that respond successfully (valid deployed DAOs).
 * Results are cached in sessionStorage with 5-minute TTL.
 */
export async function discoverDAOs(rpcUrl: string): Promise<Array<{ name: string; path: string }>> {
    const cached = getCached<Array<{ name: string; path: string }>>("discovered_daos")
    if (cached) return cached

    const discovered: Array<{ name: string; path: string }> = []

    const probes = getDiscoveryProbes()
    const results = await Promise.allSettled(
        probes.map(async probe => {
            const raw = await queryRender(rpcUrl, probe.path, "")
            // A valid DAO returns non-empty Render output
            if (raw && raw.length > 10) {
                return probe
            }
            return null
        }),
    )

    for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
            discovered.push(result.value)
        }
    }

    setCache("discovered_daos", discovered)
    return discovered
}

/**
 * Enhanced DAO list: seed + saved + discovered (deduplicated by path).
 * Use this instead of getDirectoryDAOs() when auto-discovery is desired.
 */
export async function getDirectoryDAOsWithDiscovery(rpcUrl: string): Promise<DirectoryDAO[]> {
    const base = getDirectoryDAOs()
    const existingPaths = new Set(base.map(d => d.path))

    try {
        const discovered = await discoverDAOs(rpcUrl)
        for (const dao of discovered) {
            if (!existingPaths.has(dao.path)) {
                base.push({
                    name: dao.name,
                    path: dao.path,
                    isSaved: false,
                    category: getDAOCategory(dao.path, dao.name),
                })
                existingPaths.add(dao.path)
            }
        }
    } catch {
        // Discovery failed — return base list only
    }

    return base
}

// ── DAO Fetching ─────────────────────────────────────────────

/**
 * Get all known DAOs: seed list + user's saved DAOs (deduplicated).
 */
export function getDirectoryDAOs(): DirectoryDAO[] {
    const saved = getSavedDAOs()
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
 * Fetch token registry from GRC20 registry realm.
 * Uses sessionStorage cache.
 */
export async function fetchTokens(): Promise<DirectoryToken[]> {
    const cached = getCached<DirectoryToken[]>("tokens")
    if (cached) return cached

    const raw = await queryRender(GNO_RPC_URL, "gno.land/r/demo/grc20reg", "")
    if (!raw) return []

    const tokens = parseTokenRegistry(raw)
    setCache("tokens", tokens)
    return tokens
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
 * Fetch user registry from users realm.
 * Uses sessionStorage cache.
 */
export async function fetchUsers(): Promise<DirectoryUser[]> {
    const cached = getCached<DirectoryUser[]>("users")
    if (cached) return cached

    const raw = await queryRender(GNO_RPC_URL, "gno.land/r/demo/users", "")
    if (!raw) return []

    const users = parseUserRegistry(raw)
    setCache("users", users)
    return users
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

export interface DirectoryPackage {
    name: string
    path: string
    description: string
}

/** Well-known standard library and community packages on gno.land. */
export const SEED_PACKAGES: DirectoryPackage[] = [
    { name: "GRC20", path: "gno.land/p/demo/grc/grc20", description: "Fungible token standard (ERC-20 equivalent)" },
    { name: "GRC721", path: "gno.land/p/demo/grc/grc721", description: "Non-fungible token standard (ERC-721 equivalent)" },
    { name: "GRC1155", path: "gno.land/p/demo/grc/grc1155", description: "Multi-token standard" },
    { name: "AVL Tree", path: "gno.land/p/demo/avl", description: "Self-balancing binary search tree" },
    { name: "DAO", path: "gno.land/p/demo/dao", description: "Core DAO primitives (proposals, votes)" },
    { name: "Ownable", path: "gno.land/p/demo/ownable", description: "Ownership management pattern" },
    { name: "Pausable", path: "gno.land/p/demo/pausable", description: "Contract pause/unpause pattern" },
    { name: "Seqid", path: "gno.land/p/demo/seqid", description: "Sequential ID generator" },
    { name: "uassert", path: "gno.land/p/demo/uassert", description: "Assertion helpers for testing" },
    { name: "ufmt", path: "gno.land/p/demo/ufmt", description: "String formatting utilities" },
    { name: "json", path: "gno.land/p/demo/json", description: "JSON parser and builder" },
    { name: "Membstore", path: "gno.land/p/demo/membstore", description: "DAO member storage" },
    { name: "Simpledao", path: "gno.land/p/demo/simpledao", description: "Simple DAO implementation" },
    { name: "Entropy", path: "gno.land/p/demo/entropy", description: "Pseudo-random number generation" },
    { name: "Boards", path: "gno.land/p/demo/boards2", description: "Discussion board framework" },
]

/**
 * Fetch packages — returns the static seed list.
 * Future: could probe ABCI for package availability.
 */
export function fetchPackages(): DirectoryPackage[] {
    return [...SEED_PACKAGES]
}

// ── Realm Discovery ──────────────────────────────────────────

export interface DirectoryRealm {
    name: string
    path: string
    description: string
    category: "standard" | "defi" | "social" | "utility" | "game" | "unknown"
}

/** Well-known realms deployed on gno.land. */
export const SEED_REALMS: DirectoryRealm[] = [
    { name: "GRC20 Registry", path: "gno.land/r/demo/grc20reg", description: "Token registry — lists all GRC20 tokens", category: "standard" },
    { name: "Users v1", path: "gno.land/r/gnoland/users/v1", description: "On-chain username registry", category: "standard" },
    { name: "GnoSwap", path: "gno.land/r/gnoswap/v1/router", description: "Decentralized token exchange", category: "defi" },
    { name: "GRC20 Factory", path: "gno.land/r/demo/defi/grc20factory", description: "Deploy new GRC20 tokens", category: "defi" },
    { name: "Boards v2", path: "gno.land/r/gnoland/boards2/v1", description: "Discussion boards with threads", category: "social" },
    { name: "Blog", path: "gno.land/r/gnoland/blog", description: "Official gno.land blog", category: "social" },
    { name: "Faucet", path: "gno.land/r/gnoland/faucet", description: "Faucet for ugnot", category: "utility" },
    { name: "GovDAO", path: "gno.land/r/gov/dao", description: "Chain governance DAO", category: "standard" },
    { name: "GovDAO v2", path: "gno.land/r/gov/dao/v2", description: "Governance DAO v2", category: "standard" },
    { name: "Worx", path: "gno.land/r/demo/worx", description: "Community workspace DAO", category: "social" },
    { name: "Faucet Admin", path: "gno.land/r/faucet/admin", description: "Faucet administration realm", category: "utility" },
]

/**
 * Fetch realms: seed + user's saved DAOs (deduplicated).
 * Merges DAOs from the DAO list as "standard" category realms.
 */
export function fetchRealms(): DirectoryRealm[] {
    const result = [...SEED_REALMS]
    const existingPaths = new Set(result.map(r => r.path))

    // Merge saved DAOs as realms
    const savedDAOs = getDirectoryDAOs()
    for (const dao of savedDAOs) {
        if (!existingPaths.has(dao.path)) {
            result.push({
                name: dao.name,
                path: dao.path,
                description: "DAO governance realm",
                category: "standard",
            })
            existingPaths.add(dao.path)
        }
    }

    return result
}
