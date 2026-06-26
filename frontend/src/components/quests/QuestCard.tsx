/**
 * QuestCard — Individual quest display card for the Quest Hub grid.
 *
 * Shows quest icon, title, XP, difficulty badge, category tag,
 * and completion status (completed / available / locked).
 */

import { Link } from "react-router-dom"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { getQuestById, type GnoQuest } from "../../lib/gnobuilders"

interface QuestCardProps {
    quest: GnoQuest
    completed: boolean
    available: boolean
}

const DIFFICULTY_COLORS: Record<string, string> = {
    beginner: "var(--color-k-success-text)",
    intermediate: "var(--color-k-info-text)",
    advanced: "var(--color-k-warning-text)",
    expert: "var(--color-k-danger-text)",
}

export function QuestCard({ quest, completed, available }: QuestCardProps) {
    const nk = useNetworkKey()
    const statusClass = completed ? "completed" : available ? "available" : "locked"
    const diffColor = DIFFICULTY_COLORS[quest.difficulty] || "var(--color-k-muted)"

    return (
        <Link to={`/${nk}/quests/${quest.id}`} className={`k-quest-card k-quest-card--${statusClass}`} data-testid={`quest-${quest.id}`}>
            <div className="k-quest-card-header">
                <span className="k-quest-card-icon">{quest.icon}</span>
                <span className="k-quest-card-xp">+{quest.xp} XP</span>
            </div>
            <h3 className="k-quest-card-title">{quest.title}</h3>
            <p className="k-quest-card-desc">{quest.description}</p>
            <div className="k-quest-card-meta">
                <span
                    className="k-quest-card-difficulty"
                    style={{ color: diffColor, borderColor: diffColor }}
                >
                    {quest.difficulty}
                </span>
                <span className="k-quest-card-category">{quest.category}</span>
                {quest.verification === "on_chain" && (
                    <span className="k-quest-card-tag" title="Verified on-chain">on-chain</span>
                )}
            </div>
            <div className="k-quest-card-footer">
                {completed ? (
                    <span className="k-quest-card-status k-quest-card-status--done">Completed</span>
                ) : available ? (
                    <span className="k-quest-card-status k-quest-card-status--available">Available</span>
                ) : (
                    <span className="k-quest-card-status k-quest-card-status--locked">
                        🔒 {quest.prerequisite ? `Requires: ${getQuestById(quest.prerequisite)?.title ?? quest.prerequisite}` : "Locked"}
                    </span>
                )}
            </div>
        </Link>
    )
}
