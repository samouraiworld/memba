/**
 * Leaderboard Queries — Aggregate member stats from gnolove + DAO data.
 *
 * Sources:
 * - gnolove API: package count, GitHub contributions
 * - DAO proposals: authored, voted
 *
 * @module plugins/leaderboard/queries
 */

import { GNOLOVE_API_URL } from "../../lib/config"

// ── Types ─────────────────────────────────────────────────────

export interface LeaderboardEntry {
    address: string
    username: string
    packages: number
    proposals: number
    votes: number
    score: number
}

export type SortField = keyof Pick<LeaderboardEntry, "packages" | "proposals" | "votes" | "score">
export type SortDir = "asc" | "desc"

// ── Data Fetching ─────────────────────────────────────────────

/**
 * Fetch leaderboard data for a list of member addresses.
 * Queries gnolove API for package/contribution data.
 */
export async function getLeaderboardData(members: { address: string; username: string }[]): Promise<LeaderboardEntry[]> {
    const entries = await Promise.all(
        members.map(async (m) => {
            const gnoloveData = await fetchGnoloveStats(m.address)
            return {
                address: m.address,
                username: m.username || m.address.slice(0, 10) + "...",
                packages: gnoloveData.packages,
                proposals: gnoloveData.proposals,
                votes: gnoloveData.votes,
                score: calculateScore(gnoloveData),
            }
        }),
    )
    return entries.sort((a, b) => b.score - a.score)
}

// ── gnolove API ───────────────────────────────────────────────

interface GnoloveStats {
    packages: number
    proposals: number
    votes: number
    contributions: number
}

async function fetchGnoloveStats(address: string): Promise<GnoloveStats> {
    try {
        const res = await fetch(`${GNOLOVE_API_URL}/onchain/packages/${address}`)
        if (!res.ok) return { packages: 0, proposals: 0, votes: 0, contributions: 0 }
        const data = await res.json()
        return {
            packages: data.total || data.count || 0,
            proposals: data.proposals || 0,
            votes: data.votes || 0,
            contributions: data.contributions || 0,
        }
    } catch {
        return { packages: 0, proposals: 0, votes: 0, contributions: 0 }
    }
}

// ── Scoring ───────────────────────────────────────────────────

/**
 * Calculate a composite score from gnolove stats.
 * Weights: packages (10), proposals (5), votes (2), contributions (1).
 */
export function calculateScore(stats: { packages: number; proposals: number; votes: number; contributions?: number }): number {
    return (stats.packages * 10) + (stats.proposals * 5) + (stats.votes * 2) + ((stats.contributions || 0) * 1)
}

// ── Sorting ───────────────────────────────────────────────────

/**
 * Sort leaderboard entries by field and direction.
 * Returns a new array (does not mutate input).
 * @param entries — leaderboard entries to sort
 * @param field — field to sort by (packages, proposals, votes, score)
 * @param dir — sort direction (asc or desc)
 */
export function sortEntries(entries: LeaderboardEntry[], field: SortField, dir: SortDir): LeaderboardEntry[] {
    return [...entries].sort((a, b) => dir === "asc" ? a[field] - b[field] : b[field] - a[field])
}
