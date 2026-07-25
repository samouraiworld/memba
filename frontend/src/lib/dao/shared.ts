/**
 * Shared types, ABCI helpers, and constants for the dao/ sub-modules.
 *
 * This module is internal to the dao/ package and provides:
 * - Type definitions (DAOMember, DAOProposal, DAOConfig, etc.)
 * - Low-level ABCI query helpers (queryRender, queryEval)
 * - Username resolution (cache + batch resolve)
 */

import type { AminoMsg } from "../grc20"
import { getUserRegistryPath, networkScopedKey, NETWORKS } from "../config"
import { resilientAbciQuery, abciQueryAt, isActivePrimaryRpcUrl } from "../rpcFallback"

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
    // P1-8: set when BOTH vote-detail and vote RPCs failed during enrichment, so the
    // card can show "couldn't load votes" instead of reading as a genuine no-votes proposal.
    enrichFailed?: boolean
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
export async function queryRender(rpcUrl: string, pkgPath: string, renderPath: string, strict = false): Promise<string | null> {
    return abciQuery(rpcUrl, "vm/qrender", `${pkgPath}:${sanitize(renderPath)}`, strict)
}

/**
 * Query vm/qeval for evaluating an expression in a realm.
 */
export async function queryEval(rpcUrl: string, pkgPath: string, expr: string, strict = false): Promise<string | null> {
    return abciQuery(rpcUrl, "vm/qeval", `${pkgPath}.${expr}`, strict)
}

/**
 * Decode a `vm/qeval` string return that carries a JSON payload —
 * `("<go-quoted-json>" string)` — into the parsed value, or null on any failure
 * (so callers can fall back to Render scraping).
 *
 * qeval re-quotes the returned Go string with strconv.Quote-style escaping,
 * which — for our realm encoders that pre-escape control chars to `\uXXXX` —
 * coincides exactly with JSON string escaping. So the correct decode is a
 * DOUBLE JSON.parse: parse the quoted literal to undo the Go-quote, then parse
 * the JSON payload. The old single-pass `.replace(/\\"/g,'"')` corrupted any
 * field carrying a backslash or newline (a title like `Adopt "v2"` round-tripped
 * by luck; `a\b` or a real newline did not — the escapes doubled).
 */
export function parseQevalJSON(raw: string): unknown {
    const m = raw.match(/^\(\s*("[\s\S]*")\s+string\s*\)\s*$/)
    if (!m) return null
    try {
        const payload = JSON.parse(m[1]) // undo the Go-quote → the raw JSON text
        if (typeof payload !== "string") return null
        return JSON.parse(payload) // parse the JSON payload
    } catch {
        return null
    }
}

/**
 * Strip markdown escape backslashes from Render output text.
 * gno#5418 escapes special chars in titles: `\(`, `\)`, `\[`, `\]`, `\_`, `\*`, etc.
 * We strip these so titles display cleanly in the UI.
 */
export function unescapeMarkdown(str: string): string {
    return str.replace(/\\([[\]()_*`~#>+\-.!|{}])/g, "$1")
}

/** Sanitize render path to prevent ABCI query injection.
 *  Allows query params (?key=val&key2=val2) for pagination and filtering. */
export function sanitize(str: string): string {
    return str.replace(/[^a-zA-Z0-9_./:\-?=&]/g, "")
}

/** Low-level ABCI query. Uses TextDecoder for proper UTF-8 handling (atob
 *  alone corrupts multi-byte chars like em dash). */
async function abciQuery(rpcUrl: string, path: string, data: string, strict = false): Promise<string | null> {
    // B-4: the rpcUrl argument used to be DISCARDED here — every caller's
    // "explicit endpoint" silently routed to the active network's resilient
    // chain. It now discriminates two lanes:
    //   active-network endpoint (or null) → resilientAbciQuery, byte-identical
    //     to the old behavior (failover chain, memo, coalescing);
    //   any other endpoint → abciQueryAt, which queries exactly that endpoint —
    //     failing over to the primary would answer from a DIFFERENT CHAIN.
    if (isActivePrimaryRpcUrl(rpcUrl)) {
        return resilientAbciQuery(path, data, strict)
    }
    return abciQueryAt(rpcUrl, path, data, strict)
}

// ── Username Resolution ───────────────────────────────────────

/** User registry realm path on gno.land (ACTIVE network). */
const USER_REGISTRY = getUserRegistryPath()

/** Username cache key in localStorage (W2.2: network-scoped — usernames are
 *  resolved from the chain that was QUERIED; a test12 resolution must not be
 *  served while reading test13). Legacy unscoped entries just age out — the
 *  cache has a 1h TTL, no migration needed. */
const USERNAME_CACHE_KEY = networkScopedKey("memba_usernames")

/** Cache TTL: 1 hour (in ms). */
const USERNAME_CACHE_TTL = 60 * 60 * 1000

interface UsernameCache {
    entries: Record<string, { username: string; ts: number }>
}

/**
 * B-5 Phase 0 (G2): resolve the cache key + registry path for the network the
 * caller is actually QUERYING. Before B-4 the rpcUrl argument was decorative,
 * so keying the cache to the active network was harmlessly equivalent; now a
 * CAL read against another network is real, and writing its results under the
 * ACTIVE network's key would poison it with foreign-chain usernames.
 *
 *   active endpoint  → the existing key + registry constant (byte-identical);
 *   known network    → that network's chainId-scoped key + its registry path;
 *   unknown endpoint → NO cache at all (never write under a guessed identity).
 *
 * The known-network match is EXACT-string on purpose (vs the active check's
 * light normalization): a cosmetic variant of a known network's url falls to
 * the unknown branch — fail-safe, the right endpoint is still queried and
 * nothing is cached. Widening the match would risk caching under the wrong
 * identity, which is the exact bug this function exists to prevent.
 */
function registryContextFor(rpcUrl: string): { cacheKey: string | null; registryPath: string } {
    if (isActivePrimaryRpcUrl(rpcUrl)) {
        return { cacheKey: USERNAME_CACHE_KEY, registryPath: USER_REGISTRY }
    }
    const net = Object.values(NETWORKS).find((n) => n.rpcUrl === rpcUrl)
    if (net) {
        return {
            cacheKey: `memba_usernames::${net.chainId}`,
            registryPath: net.userRegistryPath || "gno.land/r/sys/users",
        }
    }
    return { cacheKey: null, registryPath: "gno.land/r/sys/users" }
}

/** Read username cache from localStorage. */
function readUsernameCache(cacheKey: string): UsernameCache {
    try {
        const raw = localStorage.getItem(cacheKey)
        if (!raw) return { entries: {} }
        const parsed = JSON.parse(raw)
        if (typeof parsed === "object" && parsed.entries) return parsed as UsernameCache
    } catch { /* ignore corrupt cache */ }
    return { entries: {} }
}

/** Write username cache to localStorage. */
function writeUsernameCache(cacheKey: string, cache: UsernameCache): void {
    try {
        localStorage.setItem(cacheKey, JSON.stringify(cache))
    } catch { /* quota exceeded */ }
}

/**
 * Resolve a single g1 address to @username via gno.land user registry.
 * Queries Render(address) which returns: "# User - `username`"
 * Returns "@username" or empty string if not registered.
 */
async function resolveUsername(rpcUrl: string, registryPath: string, address: string): Promise<string> {
    try {
        const data = await queryRender(rpcUrl, registryPath, address)
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
    const { cacheKey, registryPath } = registryContextFor(rpcUrl)
    const cache = cacheKey ? readUsernameCache(cacheKey) : { entries: {} }
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
            toResolve.map((idx) => resolveUsername(rpcUrl, registryPath, members[idx].address)),
        )
        results.forEach((username, j) => {
            const idx = toResolve[j]
            members[idx].username = username
            cache.entries[members[idx].address] = { username, ts: now }
        })
        if (cacheKey) writeUsernameCache(cacheKey, cache)
    }
}

/** Normalize status string from various dao formats. */
export function normalizeStatus(s: string): DAOProposal["status"] {
    const lower = s.toLowerCase()
    if (lower.includes("accept") || lower.includes("pass")) return "passed"
    // "deni"/"deny" covers GovDAO v3's detail-render prose "PROPOSAL HAS BEEN DENIED"
    if (lower.includes("reject") || lower.includes("fail") || lower.includes("deni") || lower.includes("deny")) return "rejected"
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
