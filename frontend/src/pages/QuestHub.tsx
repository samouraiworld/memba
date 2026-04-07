/**
 * QuestHub — GnoBuilders quest catalog page.
 *
 * Full-page quest browser with category tabs, difficulty filters,
 * search, and progress tracking. Entry point for the gamified
 * onboarding experience.
 *
 * Route: /:network/quests
 */

import { useState, useMemo, useEffect } from "react"
import { Link } from "react-router-dom"
import { useAdena } from "../hooks/useAdena"
import { useNetworkKey } from "../hooks/useNetworkNav"
import { loadQuestProgress } from "../lib/quests"
import {
    ALL_QUESTS,
    QUEST_COUNTS,
    getVisibleQuests,
    isQuestAvailable,
    calculateRank,
    xpToNextRank,
    type QuestCategory,
    type QuestDifficulty,
    type GnoQuest,
} from "../lib/gnobuilders"
import { trackPageVisit } from "../lib/quests"
import { RankBadge } from "../components/quests/RankBadge"
import { QuestCard } from "../components/quests/QuestCard"
import "./questhub.css"

type FilterCategory = QuestCategory | "all"
type FilterDifficulty = QuestDifficulty | "all"
type FilterStatus = "all" | "available" | "completed" | "locked"

export default function QuestHub() {
    const { address } = useAdena()
    const nk = useNetworkKey()
    const [category, setCategory] = useState<FilterCategory>("all")
    const [difficulty, setDifficulty] = useState<FilterDifficulty>("all")
    const [status, setStatus] = useState<FilterStatus>("all")
    const [search, setSearch] = useState("")

    useEffect(() => {
        document.title = "GnoBuilders — Memba"
        trackPageVisit("quests")
    }, [])

    const questState = useMemo(() => loadQuestProgress(), [])
    const completedIds = useMemo(() => new Set(questState.completed.map(c => c.questId)), [questState])
    const rank = calculateRank(questState.totalXP)
    const toNext = xpToNextRank(questState.totalXP)

    const visibleQuests = useMemo(() => getVisibleQuests(completedIds), [completedIds])

    const filtered = useMemo(() => {
        let result = visibleQuests

        if (category !== "all") {
            result = result.filter(q => q.category === category)
        }
        if (difficulty !== "all") {
            result = result.filter(q => q.difficulty === difficulty)
        }
        if (status === "completed") {
            result = result.filter(q => completedIds.has(q.id))
        } else if (status === "available") {
            result = result.filter(q => isQuestAvailable(q.id, completedIds))
        } else if (status === "locked") {
            result = result.filter(q => !completedIds.has(q.id) && !isQuestAvailable(q.id, completedIds))
        }
        if (search.trim()) {
            const term = search.toLowerCase()
            result = result.filter(q =>
                q.title.toLowerCase().includes(term) ||
                q.description.toLowerCase().includes(term) ||
                q.id.includes(term)
            )
        }

        return result
    }, [visibleQuests, category, difficulty, status, search, completedIds])

    const completedCount = questState.completed.length
    const totalVisible = visibleQuests.length

    return (
        <div className="k-questhub">
            {/* Hero Section */}
            <div className="k-questhub-hero">
                <div className="k-questhub-hero-content">
                    <h1>GnoBuilders</h1>
                    <p className="k-questhub-subtitle">The Gno Developer Game</p>
                    <p className="k-questhub-desc">
                        Complete quests to earn XP, unlock ranks, and claim your place in the Gno ecosystem.
                    </p>
                </div>
                <div className="k-questhub-hero-stats">
                    <RankBadge tier={rank.tier} name={rank.name} color={rank.color} />
                    <div className="k-questhub-xp-info">
                        <span className="k-questhub-xp-value">{questState.totalXP} XP</span>
                        {toNext > 0 && (
                            <span className="k-questhub-xp-next">{toNext} XP to {calculateRank(questState.totalXP + toNext).name}</span>
                        )}
                    </div>
                    <div className="k-questhub-progress-bar">
                        <div
                            className="k-questhub-progress-fill"
                            style={{ width: `${totalVisible > 0 ? Math.min(100, (completedCount / totalVisible) * 100) : 0}%` }}
                        />
                    </div>
                    <span className="k-questhub-progress-label">{completedCount} / {totalVisible} quests</span>
                </div>
            </div>

            {/* Category Tabs */}
            <div className="k-questhub-tabs">
                {([
                    ["all", `All (${totalVisible})`],
                    ["developer", `Developers (${QUEST_COUNTS.developer})`],
                    ["everyone", `Everyone (${QUEST_COUNTS.everyone})`],
                    ["champion", `Champion (${QUEST_COUNTS.champion})`],
                ] as [FilterCategory, string][]).map(([key, label]) => (
                    <button
                        key={key}
                        className={`k-questhub-tab${category === key ? " active" : ""}`}
                        onClick={() => setCategory(key)}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Filters */}
            <div className="k-questhub-filters">
                <input
                    type="text"
                    className="k-questhub-search"
                    placeholder="Search quests..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                <select
                    className="k-questhub-select"
                    value={difficulty}
                    onChange={e => setDifficulty(e.target.value as FilterDifficulty)}
                >
                    <option value="all">All difficulties</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                    <option value="expert">Expert</option>
                </select>
                <select
                    className="k-questhub-select"
                    value={status}
                    onChange={e => setStatus(e.target.value as FilterStatus)}
                >
                    <option value="all">All statuses</option>
                    <option value="available">Available</option>
                    <option value="completed">Completed</option>
                    <option value="locked">Locked</option>
                </select>
            </div>

            {/* Quest Grid */}
            <div className="k-questhub-grid">
                {filtered.length === 0 ? (
                    <div className="k-questhub-empty">
                        {search ? "No quests match your search." : "No quests in this category."}
                    </div>
                ) : (
                    filtered.map(quest => (
                        <QuestCard
                            key={quest.id}
                            quest={quest}
                            completed={completedIds.has(quest.id)}
                            available={isQuestAvailable(quest.id, completedIds)}
                        />
                    ))
                )}
            </div>

            {/* Leaderboard Link */}
            <div className="k-questhub-footer">
                <Link to={`/${nk}/leaderboard`} className="k-questhub-leaderboard-link">
                    View Leaderboard
                </Link>
            </div>
        </div>
    )
}
