/**
 * Vote scanner — shared utility for scanning saved DAOs for vote data.
 *
 * Used by useUnvotedCount (notification dot) and useMyVotes (profile page).
 * Caps: max 5 DAOs × 5 proposals per DAO. Sequential with 100ms delay.
 */
import { getDAOMembers } from "./members"
import { getDAOProposals, getProposalVotes } from "./proposals"
import { getDAOConfig } from "./config"
import { GNO_RPC_URL } from "../config"
import { getSavedDAOs, FEATURED_DAO } from "../daoSlug"
import { resolveOnChainUsername } from "../profile"

// ── Types ─────────────────────────────────────────────────────

export interface MyVoteEntry {
    daoName: string
    daoSlug: string
    proposalId: number
    proposalTitle: string
    vote: "YES" | "NO" | "ABSTAIN"
    proposalStatus: string
}

// ── Cache ─────────────────────────────────────────────────────

const UNVOTED_CACHE_KEY = "memba_unvoted_cache"
const MYVOTES_CACHE_KEY = "memba_myvotes_cache"
const UNVOTED_TTL = 2 * 60 * 1000 // 2 minutes
const MYVOTES_TTL = 5 * 60 * 1000 // 5 minutes

interface CacheEntry<T> {
    data: T
    ts: number
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

/** Clear vote caches — call after voting to immediately update notification dot. */
export function clearVoteCache() {
    try {
        sessionStorage.removeItem(UNVOTED_CACHE_KEY)
        sessionStorage.removeItem(MYVOTES_CACHE_KEY)
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

/**
 * Check if a user appears in a voter list.
 * VoterEntry only has {username, profileUrl} — no address field.
 * Matches by username (with @ prefix handling) and partial address in username
 * field (some DAOs render addresses instead of usernames).
 * This logic mirrors DAOHome.tsx lines 118-126.
 */
function isInVoterList(
    voters: Array<{ username: string; profileUrl?: string }>,
    address: string,
    username: string,
): boolean {
    const addrPrefix = address.toLowerCase().slice(0, 10)
    const userLower = username.toLowerCase()
    return voters.some(v => {
        const vLower = v.username.toLowerCase()
        if (userLower && (vLower === userLower || vLower === `@${userLower}` || vLower === userLower.replace(/^@/, ""))) return true
        if (addrPrefix && vLower.includes(addrPrefix)) return true
        return false
    })
}

// ── Scanners ──────────────────────────────────────────────────

/**
 * Scan saved DAOs for open proposals the user hasn't voted on.
 * Returns the count of unvoted proposals.
 */
export async function scanUnvotedProposals(address: string): Promise<number> {
    // Check cache first
    const cached = readCache<number>(UNVOTED_CACHE_KEY, UNVOTED_TTL)
    if (cached !== null) return cached

    if (!address) return 0

    let username = ""
    try { username = (await resolveOnChainUsername(address) || "").replace("@", "") } catch { /* silent */ }

    const daos = getDAOsToScan()
    let unvotedCount = 0

    for (const dao of daos) {
        try {
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
            const active = proposals.filter(p => p.status === "open").slice(0, MAX_PROPOSALS)

            for (const prop of active) {
                try {
                    const voteRecords = await getProposalVotes(GNO_RPC_URL, dao.path, prop.id)
                    // VoteRecord[] — one per tier. Flatten all voters across tiers.
                    const allVoters = voteRecords.flatMap(vr => [
                        ...vr.yesVoters,
                        ...vr.noVoters,
                    ])
                    if (!isInVoterList(allVoters, address, username)) {
                        unvotedCount++
                    }
                } catch { /* skip proposal on error */ }
            }
        } catch { /* skip DAO on error */ }
        await delay(100) // Rate limit between DAOs
    }

    writeCache(UNVOTED_CACHE_KEY, unvotedCount)
    return unvotedCount
}

/**
 * Scan saved DAOs for all proposals the user has voted on.
 * Returns a list of vote entries with DAO context.
 */
export async function scanMyVotes(address: string): Promise<MyVoteEntry[]> {
    // Check cache first
    const cached = readCache<MyVoteEntry[]>(MYVOTES_CACHE_KEY, MYVOTES_TTL)
    if (cached !== null) return cached

    if (!address) return []

    let username = ""
    try { username = (await resolveOnChainUsername(address) || "").replace("@", "") } catch { /* silent */ }

    const daos = getDAOsToScan()
    const votes: MyVoteEntry[] = []

    for (const dao of daos) {
        try {
            const proposals = await getDAOProposals(GNO_RPC_URL, dao.path)

            for (const prop of proposals.slice(0, MAX_PROPOSALS * 2)) { // scan more for history
                try {
                    const voteRecords = await getProposalVotes(GNO_RPC_URL, dao.path, prop.id)

                    // Check each vote record (one per tier)
                    let found = false
                    for (const vr of voteRecords) {
                        if (isInVoterList(vr.yesVoters, address, username)) {
                            votes.push({
                                daoName: dao.name,
                                daoSlug: dao.path.replace(/\//g, "~"),
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
                                daoSlug: dao.path.replace(/\//g, "~"),
                                proposalId: prop.id,
                                proposalTitle: prop.title,
                                vote: "NO",
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

    writeCache(MYVOTES_CACHE_KEY, votes)
    return votes
}
