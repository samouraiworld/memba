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
 * Heuristic DAO categorization based on realm path patterns.
 * Falls back to "unknown" for unrecognized paths.
 */
export function getDAOCategory(path: string, name: string): DAOCategory {
    const p = path.toLowerCase()
    const n = name.toLowerCase()

    // Governance DAOs (gov, vote, council, senate)
    if (p.includes("/gov/") || p.includes("/gov_") || n.includes("gov") || n.includes("council") || n.includes("senate")) {
        return "governance"
    }
    // Treasury / Finance
    if (n.includes("treasury") || n.includes("finance") || n.includes("fund") || p.includes("/treasury")) {
        return "treasury"
    }
    // DeFi (swap, pool, liquidity, dex)
    if (n.includes("swap") || n.includes("pool") || n.includes("liquidity") || n.includes("dex") || p.includes("/swap")) {
        return "defi"
    }
    // Infrastructure (infra, validator, node, ops)
    if (n.includes("infra") || n.includes("validator") || n.includes("node") || n.includes("ops") || p.includes("/infra")) {
        return "infrastructure"
    }
    // Community (everything else with demo, worx, social, community)
    if (p.includes("/demo/") || n.includes("community") || n.includes("social") || n.includes("worx") || n.includes("club")) {
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
 */
export const DISCOVERY_PROBES: Array<{ name: string; path: string }> = [
    { name: "GovDAO", path: "gno.land/r/gov/dao" },
    { name: "Worx DAO", path: "gno.land/r/demo/worx" },
    { name: "GovDAO v2", path: "gno.land/r/gov/dao/v2" },
    { name: "Faucet Hub", path: "gno.land/r/faucet/admin" },
]

/**
 * Probe a list of known DAO paths via ABCI Render("").
 * Returns only paths that respond successfully (valid deployed DAOs).
 * Results are cached in sessionStorage with 5-minute TTL.
 */
export async function discoverDAOs(rpcUrl: string): Promise<Array<{ name: string; path: string }>> {
    const cached = getCached<Array<{ name: string; path: string }>>("discovered_daos")
    if (cached) return cached

    const discovered: Array<{ name: string; path: string }> = []

    const results = await Promise.allSettled(
        DISCOVERY_PROBES.map(async probe => {
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
export function calculateContributionScores(
    users: DirectoryUser[],
    daoMemberMap: Map<string, string[]>,
): Map<string, ContributionScore> {
    const scores = new Map<string, ContributionScore>()

    for (const user of users) {
        const addr = user.address.toLowerCase()
        let daoCount = 0

        for (const members of daoMemberMap.values()) {
            if (members.some(m => m.toLowerCase() === addr)) {
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
