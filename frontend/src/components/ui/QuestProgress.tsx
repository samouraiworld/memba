/**
 * QuestProgress — Shows quest completion status and XP.
 *
 * Sprint 13: Renders on profile page and sidebar (compact mode).
 * v2.28: Supports external state for viewing other users' quests.
 */

import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import {
    QUESTS,
    CANDIDATURE_XP_THRESHOLD,
    loadQuestProgress,
    fetchUserQuests,
    canApplyForMembership,
} from "../../lib/quests"
import type { UserQuestState } from "../../lib/quests"

interface QuestProgressProps {
    compact?: boolean
    /** If set, fetch quest state from backend for this address instead of localStorage. */
    address?: string
}

export function QuestProgress({ compact, address }: QuestProgressProps) {
    const networkKey = useNetworkKey()
    const [state, setState] = useState<UserQuestState>(() =>
        address ? { completed: [], totalXP: 0 } : loadQuestProgress()
    )
    const [loading, setLoading] = useState(!!address)

    useEffect(() => {
        if (!address) return
        let cancelled = false
        fetchUserQuests(address).then(result => {
            if (!cancelled) {
                if (result) setState(result)
                setLoading(false)
            }
        })
        return () => { cancelled = true }
    }, [address])

    const completedIds = new Set(state.completed.map(c => c.questId))
    const percent = Math.round((state.completed.length / QUESTS.length) * 100)
    const eligible = address ? state.totalXP >= CANDIDATURE_XP_THRESHOLD : canApplyForMembership()

    if (loading) {
        return (
            <div className="quest-panel">
                <h3 className="quest-panel__title">Memba Quests</h3>
                <p className="quest-panel__subtitle">Loading quest progress...</p>
            </div>
        )
    }

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
                {address
                    ? "Quest progress for this user"
                    : "Complete quests to earn XP and unlock Memba DAO membership"}
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

            {eligible && !address && (
                <Link to={`/${networkKey}/candidature`} className="quest-panel__cta">
                    Apply for Memba DAO Membership →
                </Link>
            )}

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
