/**
 * AchievementGrid — Badge gallery for user profiles.
 *
 * Shows earned quest badges and rank badges in a grid.
 * Uses both localStorage (offline-first) and on-chain badge data when available.
 * Links to the quest hub for uncompleted quests.
 */

import { useMemo, useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { loadQuestProgress } from "../../lib/quests"
import { ALL_QUESTS, calculateRank, getQuestById } from "../../lib/gnobuilders"
import { fetchUserBadges, type BadgeSummary } from "../../lib/badges"
import { questBadgeSvg, rankBadgeSvg, rankTierOf, svgDataUri } from "../../lib/badgeArt"
import { RankBadge } from "./RankBadge"
import { GNO_RPC_URL } from "../../lib/config"

interface AchievementGridProps {
    address: string
    /** If true, show the "View All Quests" link */
    showLink?: boolean
}

/** SVG art for a badge: a rank medallion for "rank:N", else a category shield. */
function badgeSvgFor(questId: string, icon: string): string {
    const tier = rankTierOf(questId)
    if (tier !== null) return rankBadgeSvg(tier)
    return questBadgeSvg(getQuestById(questId)?.category ?? "everyone", icon)
}

export function AchievementGrid({ address, showLink = true }: AchievementGridProps) {
    const nk = useNetworkKey()
    const state = useMemo(() => loadQuestProgress(), [])
    const completedIds = useMemo(() => new Set(state.completed.map(c => c.questId)), [state])
    const rank = calculateRank(state.totalXP)
    const [badgeSummary, setBadgeSummary] = useState<BadgeSummary | null>(null)

    // Fetch on-chain badges (non-blocking, enhances display)
    useEffect(() => {
        if (!address) return
        fetchUserBadges(GNO_RPC_URL, address)
            .then(setBadgeSummary)
            .catch(() => { /* offline-first: use localStorage data */ })
    }, [address])

    // Get completed quest details from local state
    const completedQuests = useMemo(() =>
        ALL_QUESTS.filter(q => completedIds.has(q.id)),
    [completedIds])

    // Merge: prefer on-chain badge count if available, else local
    const totalBadges = badgeSummary?.totalBadges ?? completedQuests.length
    const displayBadges = badgeSummary?.badges?.length
        ? badgeSummary.badges.slice(0, 12).map(b => ({
            svg: badgeSvgFor(b.questId, b.questIcon || "🏅"),
            title: b.questTitle || b.questId,
            soulbound: b.soulbound,
        }))
        : completedQuests.slice(0, 12).map(q => ({
            svg: questBadgeSvg(q.category, q.icon),
            title: q.title,
            soulbound: false,
        }))

    if (completedQuests.length === 0 && rank.tier === 0) {
        return null // Don't show section if no achievements
    }

    return (
        <div className="k-achievements" data-testid="achievement-grid">
            <div className="k-achievements-header">
                <h3>Achievements</h3>
                <div className="k-achievements-stats">
                    <RankBadge tier={rank.tier} name={rank.name} color={rank.color} size="sm" />
                    <span className="k-achievements-xp">{state.totalXP} XP</span>
                    <span className="k-achievements-count">{totalBadges} badges</span>
                </div>
            </div>

            {displayBadges.length > 0 && (
                <div className="k-achievements-grid">
                    {displayBadges.map((badge, i) => (
                        <div
                            key={i}
                            className={`k-achievements-badge${badge.soulbound ? " k-achievements-badge--soulbound" : ""}`}
                            title={badge.title + (badge.soulbound ? " (soulbound)" : "")}
                        >
                            <img className="k-achievements-badge-art" src={svgDataUri(badge.svg)} alt="" aria-hidden="true" />
                            <span className="k-achievements-badge-name">{badge.title}</span>
                        </div>
                    ))}
                    {totalBadges > 12 && (
                        <div className="k-achievements-more">
                            +{totalBadges - 12} more
                        </div>
                    )}
                </div>
            )}

            {showLink && (
                <Link to={`/${nk}/quests`} className="k-achievements-link">
                    View all quests
                </Link>
            )}
        </div>
    )
}
