/**
 * QuestCard — Individual quest display card for the Quest Hub grid.
 *
 * Shows quest icon, title, XP, difficulty badge, category tag,
 * and completion status (completed / available / locked).
 */

import { Link } from "react-router-dom"
import type { GnoQuest } from "../../lib/gnobuilders"

interface QuestCardProps {
    quest: GnoQuest
    completed: boolean
    available: boolean
}

const DIFFICULTY_COLORS: Record<string, string> = {
    beginner: "#22c55e",
    intermediate: "#3b82f6",
    advanced: "#f59e0b",
    expert: "#ef4444",
}

export function QuestCard({ quest, completed, available }: QuestCardProps) {
    const statusClass = completed ? "completed" : available ? "available" : "locked"
    const diffColor = DIFFICULTY_COLORS[quest.difficulty] || "#6b7280"

    return (
        <div className={`k-quest-card k-quest-card--${statusClass}`} data-testid={`quest-${quest.id}`}>
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
                        {quest.prerequisite ? `Requires: ${quest.prerequisite}` : "Locked"}
                    </span>
                )}
            </div>
        </div>
    )
}
