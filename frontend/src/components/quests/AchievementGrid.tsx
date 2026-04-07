/**
 * AchievementGrid — Badge gallery for user profiles.
 *
 * Shows earned quest badges and rank badges in a grid.
 * Displays mint status (minted vs pending).
 * Links to the quest hub for uncompleted quests.
 */

import { useMemo } from "react"
import { Link } from "react-router-dom"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { loadQuestProgress } from "../../lib/quests"
import { ALL_QUESTS, calculateRank, RANK_TIERS } from "../../lib/gnobuilders"
import { RankBadge } from "./RankBadge"

interface AchievementGridProps {
    address: string
    /** If true, show the "View All Quests" link */
    showLink?: boolean
}

export function AchievementGrid({ address, showLink = true }: AchievementGridProps) {
    const nk = useNetworkKey()
    const state = useMemo(() => loadQuestProgress(), [])
    const completedIds = useMemo(() => new Set(state.completed.map(c => c.questId)), [state])
    const rank = calculateRank(state.totalXP)

    // Get completed quest details
    const completedQuests = useMemo(() =>
        ALL_QUESTS.filter(q => completedIds.has(q.id)),
    [completedIds])

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
                    <span className="k-achievements-count">{completedQuests.length} badges</span>
                </div>
            </div>

            {completedQuests.length > 0 && (
                <div className="k-achievements-grid">
                    {completedQuests.slice(0, 12).map(quest => (
                        <div
                            key={quest.id}
                            className="k-achievements-badge"
                            title={`${quest.title} (+${quest.xp} XP)`}
                        >
                            <span className="k-achievements-badge-icon">{quest.icon}</span>
                            <span className="k-achievements-badge-name">{quest.title}</span>
                        </div>
                    ))}
                    {completedQuests.length > 12 && (
                        <div className="k-achievements-more">
                            +{completedQuests.length - 12} more
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
