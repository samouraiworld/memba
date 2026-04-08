/**
 * badges.ts — Badge data layer for GnoBuilders NFT badges.
 *
 * Handles badge queries (on-chain via ABCI + cached in localStorage),
 * badge metadata parsing, and mint queue management.
 *
 * Badge NFTs are minted on-chain via the gnobuilders_badges realm.
 * When the chain is unavailable, mints are queued in the backend
 * (badge_mints table) and processed when the chain stabilizes.
 */

import { queryEval, sanitize } from "./dao/shared"
import { getQuestById, calculateRank, RANK_TIERS } from "./gnobuilders"

// ── Constants ───────────────────────────────────────────────

export const BADGE_REALM_PATH = "gno.land/r/samcrew/gnobuilders_badges"

// ── Types ───────────────────────────────────────────────────

export interface BadgeInfo {
    tokenId: string
    questId: string
    owner: string
    tokenUri: string
    soulbound: boolean
    mintedAt: number
    /** Derived from quest definition */
    questTitle?: string
    questIcon?: string
    questCategory?: string
}

export interface BadgeSummary {
    totalBadges: number
    questBadges: number
    rankBadges: number
    badges: BadgeInfo[]
}

// ── Queries ─────────────────────────────────────────────────

/**
 * Fetch all badges owned by an address from the on-chain realm.
 * Falls back to cached data if chain is unavailable.
 */
export async function fetchUserBadges(
    rpcUrl: string,
    address: string,
): Promise<BadgeSummary> {
    const cacheKey = `memba_badges_${address}`

    try {
        // Query on-chain: GetUserBadgeDetails returns all badge data in one call
        // Format: each line is tokenID|owner|questID|tokenURI|soulbound|mintedAt
        const result = await queryEval(rpcUrl, BADGE_REALM_PATH, `GetUserBadgeDetails("${sanitize(address)}")`)
        if (!result || result.trim() === "") {
            return { totalBadges: 0, questBadges: 0, rankBadges: 0, badges: [] }
        }

        const badges: BadgeInfo[] = []
        for (const line of result.split("\n").filter(Boolean)) {
            const badge = parseBadgeLine(line)
            if (badge) badges.push(badge)
        }

        const summary: BadgeSummary = {
            totalBadges: badges.length,
            questBadges: badges.filter(b => !b.soulbound).length,
            rankBadges: badges.filter(b => b.soulbound).length,
            badges,
        }

        // Cache for offline access
        try {
            localStorage.setItem(cacheKey, JSON.stringify(summary))
        } catch { /* quota */ }

        return summary
    } catch {
        // Fallback to cache
        try {
            const cached = localStorage.getItem(cacheKey)
            if (cached) return JSON.parse(cached) as BadgeSummary
        } catch { /* */ }
        return { totalBadges: 0, questBadges: 0, rankBadges: 0, badges: [] }
    }
}

/**
 * Parse a single badge line from GetBadge/GetUserBadgeDetails.
 * Format: tokenID|owner|questID|tokenURI|soulbound|mintedAt
 */
function parseBadgeLine(line: string): BadgeInfo | null {
    const parts = line.split("|")
    if (parts.length < 6) return null

    const questId = parts[2]
    const quest = getQuestById(questId)

    return {
        tokenId: parts[0],
        owner: parts[1],
        questId,
        tokenUri: parts[3],
        soulbound: parts[4] === "true",
        mintedAt: parseInt(parts[5], 10) || 0,
        questTitle: quest?.title,
        questIcon: quest?.icon,
        questCategory: quest?.category,
    }
}

// ── Badge Display Helpers ───────────────────────────────────

/**
 * Get a display-friendly rank badge description.
 */
export function getRankBadgeLabel(tier: number): string {
    const rank = RANK_TIERS[tier]
    return rank ? rank.name : "Unknown Rank"
}

/**
 * Check if a quest badge exists for a given quest ID (from local quest state).
 * This does NOT query on-chain — it checks if the quest is completed locally.
 * The actual NFT may or may not be minted yet.
 */
export function hasBadgeForQuest(questId: string, completedIds: Set<string>): boolean {
    return completedIds.has(questId)
}

/**
 * Build the list of "mintable" badges — quests completed but no NFT yet.
 * Compares local completion state against on-chain badge ownership.
 */
export function getMintableBadges(
    completedIds: Set<string>,
    ownedBadges: BadgeInfo[],
): string[] {
    const ownedQuestIds = new Set(ownedBadges.map(b => b.questId))
    return Array.from(completedIds).filter(id => !ownedQuestIds.has(id))
}

/**
 * Build the list of "mintable" rank badges based on current XP vs owned rank badges.
 */
export function getMintableRankBadges(
    totalXP: number,
    ownedBadges: BadgeInfo[],
): number[] {
    const currentRank = calculateRank(totalXP)
    const ownedRankTiers = new Set(
        ownedBadges
            .filter(b => b.questId.startsWith("rank:"))
            .map(b => parseInt(b.questId.split(":")[1], 10))
    )

    const mintable: number[] = []
    for (let tier = 1; tier <= currentRank.tier; tier++) {
        if (!ownedRankTiers.has(tier)) {
            mintable.push(tier)
        }
    }
    return mintable
}
