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
import { resilientAbciQuery } from "../rpcFallback"

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
    // v2.13: On-chain action metadata (parsed from Render("proposal/{id}"))
    actionType?: string        // basedao Action.Type(), GovDAO executor type
    actionBody?: string        // basedao Action.String(), GovDAO ExecutorString()
    executorRealm?: string     // GovDAO ExecutorCreationRealm()
    // v3.2: Temporal metadata for date display
    createdAtBlock?: number    // Block height at proposal creation (if extractable)
    createdAt?: string         // Wall-clock timestamp ISO string (from tx-indexer, if available)
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

/** Low-level ABCI query with automatic RPC failover.
 *  Uses TextDecoder for proper UTF-8 handling (atob alone corrupts multi-byte chars like em dash).
 *  The rpcUrl parameter is kept for API compatibility but the resilient layer
 *  handles failover to backup endpoints automatically. */
async function abciQuery(_rpcUrl: string, path: string, data: string): Promise<string | null> {
    return resilientAbciQuery(path, data)
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
        // Primary format (r/gnoland/users/v1): "# User - `username`"
        // Secondary format (r/sys/users): may differ — try fallback patterns
        const m = data.match(/# User - `([^`]+)`/)
            || data.match(/\*\s+\[([^\]]+)\]\(/)           // " * [username](link)" list format
            || data.match(/username:\s*([a-zA-Z0-9_]+)/)   // structured fallback
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
    if (lower.includes("active") || lower.includes("open") || lower === "") return "open"
    console.warn(`[normalizeStatus] Unknown proposal status: "${s}" — defaulting to "open"`)
    return "open"
}

/** Status badge colors and labels — single source of truth for ProposalCard + ProposalView. */
export const PROPOSAL_STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
    open: { bg: "rgba(0,212,170,0.08)", color: "#00d4aa", label: "ACTIVE" },
    passed: { bg: "rgba(76,175,80,0.08)", color: "#4caf50", label: "PASSED" },
    rejected: { bg: "rgba(244,67,54,0.08)", color: "#f44336", label: "REJECTED" },
    executed: { bg: "rgba(33,150,243,0.08)", color: "#2196f3", label: "EXECUTED" },
}
