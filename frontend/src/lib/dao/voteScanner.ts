/**
 * Vote scanner — shared utility for scanning saved DAOs for vote data.
 *
 * Used by useUnvotedCount (notification dot) and useMyVotes (profile page).
 * Caps: max 5 DAOs × 5 proposals per DAO. Sequential with 100ms delay.
 */
import { getDAOMembers } from "./members"
import { getDAOProposals, getProposalVotes } from "./proposals"
import { getDAOConfig } from "./config"
import { GNO_CHAIN_ID, GNO_RPC_URL, networkScopedKey } from "../config"
import { kindSupportsVoting, resolveDaoKind } from "./kind"
import { getSavedDAOs, FEATURED_DAO, encodeSlug } from "../daoSlug"
import { resolveOnChainUsername } from "../profile"
import { sameFullAddress } from "../addressMatch"

// ── Types ─────────────────────────────────────────────────────

export interface MyVoteEntry {
    daoName: string
    daoSlug: string
    proposalId: number
    proposalTitle: string
    vote: "YES" | "NO" | "ABSTAIN"
    proposalStatus: string
}

export interface UnvotedProposal {
    daoName: string
    daoSlug: string
    realmPath: string
    proposalId: number
    proposalTitle: string
    proposalStatus: string
}

// ── Cache ─────────────────────────────────────────────────────
// Module configuration is fixed until a network reload. Session storage
// survives that reload, so every chain-derived aggregate needs its chain ID.
// Ignore legacy unscoped entries: their proposal provenance is unknowable.
// Results depend on the wallet too, so every entry is also keyed by address.

const UNVOTED_CACHE_KEY = networkScopedKey("memba_unvoted_cache")
const UNVOTED_DETAILS_CACHE_KEY = networkScopedKey("memba_unvoted_details_cache")
const MYVOTES_CACHE_KEY = networkScopedKey("memba_myvotes_cache")
const UNVOTED_TTL = 2 * 60 * 1000 // 2 minutes
const MYVOTES_TTL = 5 * 60 * 1000 // 5 minutes

interface CacheEntry<T> {
    data: T
    ts: number
}

/** Cache key for one chain-scoped aggregate and one wallet. */
function walletKey(key: string, address: string): string {
    return `${key}::${address.toLowerCase()}`
}

function readCache<T>(key: string, ttl: number): T | null {
    try {
        const raw = sessionStorage.getItem(key)
        if (!raw) return null
        const entry: CacheEntry<T> = JSON.parse(raw)
        if (Date.now() - entry.ts > ttl) {
            sessionStorage.removeItem(key)
            return null
        }
        return entry.data
    } catch { return null }
}

function writeCache<T>(key: string, data: T) {
    try {
        sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }))
    } catch { /* no-op */ }
}

/** Clear vote caches — call after voting to immediately update notification dot + Quick Vote. */
export function clearVoteCache() {
    try {
        const prefixes = [UNVOTED_CACHE_KEY, UNVOTED_DETAILS_CACHE_KEY, MYVOTES_CACHE_KEY]
        const stale: string[] = []
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i)
            if (k && prefixes.some((p) => k === p || k.startsWith(`${p}::`))) stale.push(k)
        }
        for (const k of stale) sessionStorage.removeItem(k)
        // Notify hooks that cache was cleared so they re-scan immediately
        window.dispatchEvent(new Event("memba:voteCacheCleared"))
    } catch { /* no-op */ }
}

// ── Helpers ───────────────────────────────────────────────────

const MAX_DAOS = 5
const MAX_PROPOSALS = 5

/** Sequential delay between DAO scans (respect gno.land RPC). */
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

/** Get list of DAOs to scan (saved + featured, deduplicated, max 5). */
function getDAOsToScan(): { path: string; name: string }[] {
    const saved = getSavedDAOs()
    const all = new Map<string, string>()
    // Featured DAO first
    all.set(FEATURED_DAO.realmPath, FEATURED_DAO.name)
    // Then saved DAOs
    for (const s of saved) {
        if (!all.has(s.realmPath)) {
            all.set(s.realmPath, s.name)
        }
    }
    return Array.from(all.entries())
        .slice(0, MAX_DAOS)
        .map(([path, name]) => ({ path, name }))
}

/** Whether Memba can build a vote for this DAO's contract (unreadable → no). */
async function daoAcceptsVotes(realmPath: string): Promise<boolean> {
    try {
        return kindSupportsVoting(await resolveDaoKind({ rpcUrl: GNO_RPC_URL, chainId: GNO_CHAIN_ID, realmPath }))
    } catch {
        return false
    }
}

/**
 * Does one rendered voter entry identify the connected user?
 *
 * Voter entries are either a linked "@username" or a bare full address
 * (see parseVoters), so a match must be exact: the entry equals the user's
 * full bech32 address (case-insensitive), or equals the user's resolved
 * username with any leading "@" stripped on both sides (case-insensitive).
 * Prefixes, truncated addresses and substrings never match — another account
 * sharing a few leading characters must not count as the user's vote.
 */
export function voterMatchesUser(
    voter: string,
    address: string,
    username?: string | null,
): boolean {
    const entry = (voter || "").trim()
    if (!entry) return false

    if (sameFullAddress(entry, address)) return true

    const name = (username || "").trim().replace(/^@/, "").toLowerCase()
    const entryName = entry.replace(/^@/, "").toLowerCase()
    return name !== "" && entryName === name
}

/**
 * Check if a user appears in a voter list.
 * VoterEntry only has {username, profileUrl} — no address field; matching is
 * delegated to voterMatchesUser (shared with ProposalView and DAOHome).
 */
function isInVoterList(
    voters: Array<{ username: string; profileUrl?: string }>,
    address: string,
    username: string,
): boolean {
    return voters.some(v => voterMatchesUser(v.username, address, username))
}

/** @internal Exported for testing only. */
export const _isInVoterList = isInVoterList

// ── Scanners ──────────────────────────────────────────────────

/**
 * Scan saved DAOs for open proposals the user hasn't voted on.
 * Returns the count of unvoted proposals.
 */
export async function scanUnvotedProposals(address: string): Promise<number> {
    // Check cache first
    if (!address) return 0
    const cacheKey = walletKey(UNVOTED_CACHE_KEY, address)
    const cached = readCache<number>(cacheKey, UNVOTED_TTL)
    if (cached !== null) return cached

    let username = ""
    try { username = (await resolveOnChainUsername(address) || "").replace("@", "") } catch { /* silent */ }

    const daos = getDAOsToScan()
    let unvotedCount = 0

    for (const dao of daos) {
        try {
            // Only DAOs whose contract accepts votes from Memba are offered.
            if (!(await daoAcceptsVotes(dao.path))) { await delay(100); continue }
            // Get config for memberstore path
            let memberstorePath: string | undefined
            try {
                const config = await getDAOConfig(GNO_RPC_URL, dao.path)
                memberstorePath = config?.memberstorePath
            } catch { /* use default */ }

            // Check membership
            const members = await getDAOMembers(GNO_RPC_URL, dao.path, memberstorePath)
            const isMember = members.some(m =>
                m.address.toLowerCase() === address.toLowerCase() ||
                (username && m.username && m.username.replace("@", "").toLowerCase() === username.toLowerCase())
            )
            if (!isMember) { await delay(100); continue }

            // Fetch open proposals
            const proposals = await getDAOProposals(GNO_RPC_URL, dao.path)
            // daokit rows (titleIsPlaceholder) are excluded: that realm family renders
            // aggregate tallies only, never per-voter lists, so "has this user
            // voted" is unknowable — including them would nag members with
            // phantom unvoted counts that can never clear.
            const active = proposals.filter(p => p.status === "open" && !p.titleIsPlaceholder).slice(0, MAX_PROPOSALS)

            for (const prop of active) {
                try {
                    const voteRecords = await getProposalVotes(GNO_RPC_URL, dao.path, prop.id)
                    // VoteRecord[] — one per tier. Flatten all voters across tiers.
                    const allVoters = voteRecords.flatMap(vr => [
                        ...vr.yesVoters,
                        ...vr.noVoters,
                        ...vr.abstainVoters,
                    ])
                    if (!isInVoterList(allVoters, address, username)) {
                        unvotedCount++
                    }
                } catch { /* skip proposal on error */ }
            }
        } catch { /* skip DAO on error */ }
        await delay(100) // Rate limit between DAOs
    }

    writeCache(cacheKey, unvotedCount)
    return unvotedCount
}

const MAX_UNVOTED_DETAILS = 3

/**
 * Scan saved DAOs for open proposals the user hasn't voted on.
 * Returns up to 3 proposal details (for Quick Vote widget on Dashboard).
 */
export async function scanUnvotedProposalDetails(address: string): Promise<UnvotedProposal[]> {
    // Check cache first
    if (!address) return []
    const cacheKey = walletKey(UNVOTED_DETAILS_CACHE_KEY, address)
    const cached = readCache<UnvotedProposal[]>(cacheKey, UNVOTED_TTL)
    if (cached !== null) return cached

    let username = ""
    try { username = (await resolveOnChainUsername(address) || "").replace("@", "") } catch { /* silent */ }

    const daos = getDAOsToScan()
    const results: UnvotedProposal[] = []

    for (const dao of daos) {
        if (results.length >= MAX_UNVOTED_DETAILS) break
        try {
            // Only DAOs whose contract accepts votes from Memba are offered.
            if (!(await daoAcceptsVotes(dao.path))) { await delay(100); continue }
            // Get config for memberstore path
            let memberstorePath: string | undefined
            try {
                const config = await getDAOConfig(GNO_RPC_URL, dao.path)
                memberstorePath = config?.memberstorePath
            } catch { /* use default */ }

            // Check membership
            const members = await getDAOMembers(GNO_RPC_URL, dao.path, memberstorePath)
            const isMember = members.some(m =>
                m.address.toLowerCase() === address.toLowerCase() ||
                (username && m.username && m.username.replace("@", "").toLowerCase() === username.toLowerCase())
            )
            if (!isMember) { await delay(100); continue }

            // Fetch open proposals
            const proposals = await getDAOProposals(GNO_RPC_URL, dao.path)
            // daokit rows (titleIsPlaceholder) are excluded: that realm family renders
            // aggregate tallies only, never per-voter lists, so "has this user
            // voted" is unknowable — including them would nag members with
            // phantom unvoted counts that can never clear.
            const active = proposals.filter(p => p.status === "open" && !p.titleIsPlaceholder).slice(0, MAX_PROPOSALS)

            for (const prop of active) {
                if (results.length >= MAX_UNVOTED_DETAILS) break
                try {
                    const voteRecords = await getProposalVotes(GNO_RPC_URL, dao.path, prop.id)
                    const allVoters = voteRecords.flatMap(vr => [
                        ...vr.yesVoters,
                        ...vr.noVoters,
                        ...vr.abstainVoters,
                    ])
                    if (!isInVoterList(allVoters, address, username)) {
                        results.push({
                            daoName: dao.name,
                            daoSlug: encodeSlug(dao.path),
                            realmPath: dao.path,
                            proposalId: prop.id,
                            proposalTitle: prop.title,
                            proposalStatus: prop.status,
                        })
                    }
                } catch { /* skip proposal on error */ }
            }
        } catch { /* skip DAO on error */ }
        await delay(100) // Rate limit between DAOs
    }

    writeCache(cacheKey, results)
    return results
}

/**
 * Scan saved DAOs for all proposals the user has voted on.
 * Returns a list of vote entries with DAO context.
 */
export async function scanMyVotes(address: string): Promise<MyVoteEntry[]> {
    // Check cache first
    if (!address) return []
    const cacheKey = walletKey(MYVOTES_CACHE_KEY, address)
    const cached = readCache<MyVoteEntry[]>(cacheKey, MYVOTES_TTL)
    if (cached !== null) return cached

    let username = ""
    try { username = (await resolveOnChainUsername(address) || "").replace("@", "") } catch { /* silent */ }

    const daos = getDAOsToScan()
    const votes: MyVoteEntry[] = []

    for (const dao of daos) {
        try {
            const proposals = await getDAOProposals(GNO_RPC_URL, dao.path)

            for (const prop of proposals.filter(p => !p.titleIsPlaceholder).slice(0, MAX_PROPOSALS * 2)) { // scan more for history; daokit rows have no voter lists (see above)
                try {
                    const voteRecords = await getProposalVotes(GNO_RPC_URL, dao.path, prop.id)

                    // Check each vote record (one per tier)
                    let found = false
                    for (const vr of voteRecords) {
                        if (isInVoterList(vr.yesVoters, address, username)) {
                            votes.push({
                                daoName: dao.name,
                                daoSlug: encodeSlug(dao.path),
                                proposalId: prop.id,
                                proposalTitle: prop.title,
                                vote: "YES",
                                proposalStatus: prop.status,
                            })
                            found = true
                            break
                        }
                        if (isInVoterList(vr.noVoters, address, username)) {
                            votes.push({
                                daoName: dao.name,
                                daoSlug: encodeSlug(dao.path),
                                proposalId: prop.id,
                                proposalTitle: prop.title,
                                vote: "NO",
                                proposalStatus: prop.status,
                            })
                            found = true
                            break
                        }
                        if (isInVoterList(vr.abstainVoters, address, username)) {
                            votes.push({
                                daoName: dao.name,
                                daoSlug: encodeSlug(dao.path),
                                proposalId: prop.id,
                                proposalTitle: prop.title,
                                vote: "ABSTAIN",
                                proposalStatus: prop.status,
                            })
                            found = true
                            break
                        }
                    }
                    if (found) continue
                } catch { /* skip proposal on error */ }
            }
        } catch { /* skip DAO on error */ }
        await delay(100)
    }

    writeCache(cacheKey, votes)
    return votes
}
