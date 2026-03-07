/**
 * Shared types, ABCI helpers, and constants for the dao/ sub-modules.
 *
 * This module is internal to the dao/ package and provides:
 * - Type definitions (DAOMember, DAOProposal, DAOConfig, etc.)
 * - Low-level ABCI query helpers (queryRender, queryEval)
 * - Username resolution (cache + batch resolve)
 */

import type { AminoMsg } from "../grc20"
import { getUserRegistryPath } from "../config"

// ── Types ─────────────────────────────────────────────────────

export interface DAOMember {
    address: string
    roles: string[]
    tier: string               // "T1" | "T2" | "T3" | ""
    votingPower: number        // VPPM value (0 if unknown)
    username: string           // @username from profile (empty if unknown)
}

export interface DAOProposal {
    id: number
    title: string
    description: string
    category: string           // proposal category ("governance", "treasury", etc.)
    status: "open" | "passed" | "rejected" | "executed"
    author: string             // @username or address
    authorProfile: string      // profile URL (empty if unknown)
    tiers: string[]            // ["T1","T2","T3"] eligible tiers
    yesPercent: number         // 0-100
    noPercent: number          // 0-100
    yesVotes: number
    noVotes: number
    abstainVotes: number
    totalVoters: number
    proposer: string
}

export interface DAOConfig {
    name: string
    description: string
    threshold: string
    memberCount: number
    memberstorePath: string    // memberstore realm path (empty if N/A)
    tierDistribution: TierInfo[]
    isArchived: boolean        // true if DAO has been archived
}

export interface TierInfo {
    tier: string        // "T1", "T2", "T3"
    memberCount: number
    power: number
}

export interface VoteRecord {
    tier: string        // "T1" | "T2" | "T3"
    vppm: number        // voting power per member
    yesVoters: VoterEntry[]
    noVoters: VoterEntry[]
    abstainVoters: VoterEntry[]
}

export interface VoterEntry {
    username: string
    profileUrl: string
}

// Re-export AminoMsg for builders
export type { AminoMsg }

// ── ABCI Query Helpers ────────────────────────────────────────

/**
 * Query vm/qrender for a realm's Render(path) output.
 * Data format: "pkgpath:renderpath" (colon separator).
 */
export async function queryRender(rpcUrl: string, pkgPath: string, renderPath: string): Promise<string | null> {
    return abciQuery(rpcUrl, "vm/qrender", `${pkgPath}:${sanitize(renderPath)}`)
}

/**
 * Query vm/qeval for evaluating an expression in a realm.
 */
export async function queryEval(rpcUrl: string, pkgPath: string, expr: string): Promise<string | null> {
    return abciQuery(rpcUrl, "vm/qeval", `${pkgPath}.${expr}`)
}

/** Sanitize render path to prevent ABCI query injection.
 *  Allows query params (?key=val&key2=val2) for pagination and filtering. */
export function sanitize(str: string): string {
    return str.replace(/[^a-zA-Z0-9_./:\-?=&]/g, "")
}

/** Low-level ABCI query via JSON-RPC POST. Returns decoded string or null.
 *  Uses TextDecoder for proper UTF-8 handling (atob alone corrupts multi-byte chars like em dash). */
async function abciQuery(rpcUrl: string, path: string, data: string): Promise<string | null> {
    try {
        const b64Data = btoa(data)
        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "memba-dao",
                method: "abci_query",
                params: { path, data: b64Data },
            }),
        })
        const json = await res.json()
        const value = json?.result?.response?.ResponseBase?.Data
        if (!value) return null
        // Decode base64 → binary string → Uint8Array → UTF-8 string
        const binaryStr = atob(value)
        const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0))
        return new TextDecoder().decode(bytes)
    } catch {
        return null
    }
}

// ── Username Resolution ───────────────────────────────────────

/** User registry realm path on gno.land. */
const USER_REGISTRY = getUserRegistryPath()

/** Username cache key in localStorage. */
const USERNAME_CACHE_KEY = "memba_usernames"

/** Cache TTL: 1 hour (in ms). */
const USERNAME_CACHE_TTL = 60 * 60 * 1000

interface UsernameCache {
    entries: Record<string, { username: string; ts: number }>
}

/** Read username cache from localStorage. */
function readUsernameCache(): UsernameCache {
    try {
        const raw = localStorage.getItem(USERNAME_CACHE_KEY)
        if (!raw) return { entries: {} }
        const parsed = JSON.parse(raw)
        if (typeof parsed === "object" && parsed.entries) return parsed as UsernameCache
    } catch { /* ignore corrupt cache */ }
    return { entries: {} }
}

/** Write username cache to localStorage. */
function writeUsernameCache(cache: UsernameCache): void {
    try {
        localStorage.setItem(USERNAME_CACHE_KEY, JSON.stringify(cache))
    } catch { /* quota exceeded */ }
}

/**
 * Resolve a single g1 address to @username via gno.land user registry.
 * Queries Render(address) which returns: "# User - `username`"
 * Returns "@username" or empty string if not registered.
 */
async function resolveUsername(rpcUrl: string, address: string): Promise<string> {
    try {
        const data = await queryRender(rpcUrl, USER_REGISTRY, address)
        if (!data) return ""
        // Parse: "# User - `username`"
        const m = data.match(/# User - `([^`]+)`/)
        return m ? `@${m[1]}` : ""
    } catch {
        return ""
    }
}

/**
 * Batch-resolve addresses to usernames for a list of members.
 * Uses localStorage cache with 1-hour TTL:
 * - Cache hit (fresh): use cached username instantly, no ABCI call
 * - Cache miss or stale: resolve via ABCI, update cache
 * Resolves cache misses in parallel for speed.
 */
export async function resolveUsernames(rpcUrl: string, members: DAOMember[]): Promise<void> {
    const cache = readUsernameCache()
    const now = Date.now()
    const toResolve: number[] = [] // indices of members needing ABCI resolution

    // Phase 1: populate from cache, identify misses
    for (let i = 0; i < members.length; i++) {
        const entry = cache.entries[members[i].address]
        if (entry && (now - entry.ts) < USERNAME_CACHE_TTL) {
            // Cache hit — use cached username
            members[i].username = entry.username
        } else {
            toResolve.push(i)
        }
    }

    // Phase 2: resolve cache misses in parallel
    if (toResolve.length > 0) {
        const results = await Promise.all(
            toResolve.map((idx) => resolveUsername(rpcUrl, members[idx].address)),
        )
        results.forEach((username, j) => {
            const idx = toResolve[j]
            members[idx].username = username
            cache.entries[members[idx].address] = { username, ts: now }
        })
        writeUsernameCache(cache)
    }
}

/** Normalize status string from various dao formats. */
export function normalizeStatus(s: string): DAOProposal["status"] {
    const lower = s.toLowerCase()
    if (lower.includes("accept") || lower.includes("pass")) return "passed"
    if (lower.includes("reject") || lower.includes("fail")) return "rejected"
    if (lower.includes("exec") || lower.includes("complete")) return "executed"
    if (lower.includes("active") || lower.includes("open")) return "open"
    return "open"
}
