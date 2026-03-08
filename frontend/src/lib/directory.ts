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

export interface DirectoryDAO {
    name: string
    path: string
    isSaved: boolean
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

interface CacheEntry<T> {
    data: T
    ts: number
}

function getCached<T>(key: string): T | null {
    try {
        const raw = sessionStorage.getItem(`memba_dir_${key}`)
        if (!raw) return null
        const entry: CacheEntry<T> = JSON.parse(raw)
        if (Date.now() - entry.ts > CACHE_TTL) {
            sessionStorage.removeItem(`memba_dir_${key}`)
            return null
        }
        return entry.data
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
        })
    }

    // Add saved DAOs not already in seeds
    for (const dao of saved) {
        if (!SEED_DAOS.some(s => s.path === dao.realmPath)) {
            result.push({
                name: dao.name,
                path: dao.realmPath,
                isSaved: true,
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
