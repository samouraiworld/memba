/**
 * QuestProgress — Shows quest completion status and XP.
 *
 * Sprint 13: Renders on profile page and sidebar (compact mode).
 */

import { useState } from "react"
import {
    QUESTS,
    CANDIDATURE_XP_THRESHOLD,
    loadQuestProgress,
    canApplyForMembership,
} from "../../lib/quests"

interface QuestProgressProps {
    compact?: boolean
}

export function QuestProgress({ compact }: QuestProgressProps) {
    const [state] = useState(() => loadQuestProgress())
    const completedIds = new Set(state.completed.map(c => c.questId))
    const percent = Math.round((state.completed.length / QUESTS.length) * 100)
    const eligible = canApplyForMembership()

    if (compact) {
        return (
            <div className="quest-compact">
                <div className="quest-compact__bar">
                    <div className="quest-compact__fill" style={{ width: `${percent}%` }} />
                </div>
                <span className="quest-compact__label">{state.totalXP} XP</span>
            </div>
        )
    }

    return (
        <div className="quest-panel">
            <h3 className="quest-panel__title">Memba Quests</h3>
            <p className="quest-panel__subtitle">
                Complete quests to earn XP and unlock Memba DAO membership
            </p>

            <div className="quest-panel__progress">
                <div className="quest-panel__bar">
                    <div className="quest-panel__fill" style={{ width: `${percent}%` }} />
                </div>
                <span className="quest-panel__xp">
                    {state.totalXP} / {CANDIDATURE_XP_THRESHOLD} XP
                    {eligible && " — Eligible!"}
                </span>
            </div>

            <div className="quest-panel__list">
                {QUESTS.map(q => (
                    <div key={q.id} className={`quest-item ${completedIds.has(q.id) ? "quest-item--done" : ""}`}>
                        <span className="quest-item__icon">{completedIds.has(q.id) ? "✅" : q.icon}</span>
                        <div className="quest-item__info">
                            <span className="quest-item__title">{q.title}</span>
                            <span className="quest-item__desc">{q.description}</span>
                        </div>
                        <span className="quest-item__xp">{q.xp} XP</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
