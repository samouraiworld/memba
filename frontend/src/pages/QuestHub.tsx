/**
 * QuestHub — GnoBuilders quest catalog page.
 *
 * Full-page quest browser with category tabs, difficulty filters,
 * search, and progress tracking. Entry point for the gamified
 * onboarding experience.
 *
 * test13 (Phase 0): the grid shows only the curated, completable "live"
 * quest set; everything else is listed dimmed under a "Season 2 — Coming
 * soon" curtain so the catalog never promises a quest a user can't finish.
 *
 * Route: /:network/quests
 */

import { useState, useMemo, useEffect } from "react"
import { Link } from "react-router-dom"
import { useNetworkKey } from "../hooks/useNetworkNav"
import { loadQuestProgress, trackPageVisit } from "../lib/quests"
import {
    getLiveQuests,
    getComingSoonQuests,
    isQuestAvailable,
    calculateRank,
    xpToNextRank,
    type QuestCategory,
    type QuestDifficulty,
} from "../lib/gnobuilders"
import { RankBadge } from "../components/quests/RankBadge"
import { QuestCard } from "../components/quests/QuestCard"
import "./questhub.css"

type FilterCategory = QuestCategory | "all"
type FilterDifficulty = QuestDifficulty | "all"
type FilterStatus = "all" | "available" | "completed" | "locked"

export default function QuestHub() {
    const nk = useNetworkKey()
    const [category, setCategory] = useState<FilterCategory>("all")
    const [difficulty, setDifficulty] = useState<FilterDifficulty>("all")
    const [status, setStatus] = useState<FilterStatus>("all")
    const [search, setSearch] = useState("")

    const [questState, setQuestState] = useState(() => loadQuestProgress())

    useEffect(() => {
        document.title = "GnoBuilders — Memba"
        trackPageVisit("quests")

        // Listen for quest completion events to refresh state
        const onQuestComplete = () => setQuestState(loadQuestProgress())
        window.addEventListener("quest-completed", onQuestComplete)
        return () => window.removeEventListener("quest-completed", onQuestComplete)
    }, [])

    const completedIds = useMemo(() => new Set(questState.completed.map(c => c.questId)), [questState])
    const rank = calculateRank(questState.totalXP)
    const toNext = xpToNextRank(questState.totalXP)

    // Curated, completable quests (Phase 0). Everything else is "coming soon".
    const liveQuests = useMemo(() => getLiveQuests(), [])
    const comingSoon = useMemo(() => getComingSoonQuests(), [])

    // Live counts per category — drives honest tab labels.
    const liveByCategory = useMemo(() => {
        const counts: Record<string, number> = { developer: 0, everyone: 0, champion: 0, hidden: 0 }
        for (const q of liveQuests) counts[q.category]++
        return counts
    }, [liveQuests])

    const filtered = useMemo(() => {
        let result = liveQuests

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
    }, [liveQuests, category, difficulty, status, search, completedIds])

    const completedCount = useMemo(
        () => liveQuests.filter(q => completedIds.has(q.id)).length,
        [liveQuests, completedIds],
    )
    const totalLive = liveQuests.length

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
                            style={{ width: `${totalLive > 0 ? Math.min(100, (completedCount / totalLive) * 100) : 0}%` }}
                        />
                    </div>
                    <span className="k-questhub-progress-label">{completedCount} / {totalLive} quests</span>
                    <div className="k-questhub-badges-soon" title="On-chain badges are being wired up — see the roadmap.">
                        🏅 Badges — coming soon
                    </div>
                </div>
            </div>

            {/* Category Tabs */}
            <div className="k-questhub-tabs" role="tablist" aria-label="Quest categories">
                {([
                    ["all", `All (${totalLive})`],
                    ["developer", `Developers (${liveByCategory.developer})`],
                    ["everyone", `Everyone (${liveByCategory.everyone})`],
                    ["champion", `Champion (${liveByCategory.champion})`],
                ] as [FilterCategory, string][]).map(([key, label]) => (
                    <button
                        key={key}
                        className={`k-questhub-tab${category === key ? " active" : ""}`}
                        role="tab"
                        aria-selected={category === key}
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
                    id="quest-search"
                    name="quest-search"
                    className="k-questhub-search"
                    placeholder="Search quests..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    aria-label="Search quests"
                />
                <select
                    id="quest-difficulty"
                    name="quest-difficulty"
                    className="k-questhub-select"
                    value={difficulty}
                    onChange={e => setDifficulty(e.target.value as FilterDifficulty)}
                    aria-label="Filter by difficulty"
                >
                    <option value="all">All difficulties</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                    <option value="expert">Expert</option>
                </select>
                <select
                    id="quest-status"
                    name="quest-status"
                    className="k-questhub-select"
                    value={status}
                    onChange={e => setStatus(e.target.value as FilterStatus)}
                    aria-label="Filter by status"
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

            {/* Season 2 — Coming soon (curated-out quests, shown dimmed, non-clickable) */}
            {comingSoon.length > 0 && (
                <details className="k-questhub-comingsoon">
                    <summary>Season 2 — Coming soon ({comingSoon.length})</summary>
                    <p className="k-questhub-comingsoon-note">
                        These quests aren&apos;t live on test13 yet — their verification or rewards are still being wired up.
                    </p>
                    <div className="k-questhub-comingsoon-grid">
                        {comingSoon.map(q => (
                            <div key={q.id} className="k-questhub-comingsoon-item" title={q.description}>
                                <span className="k-questhub-comingsoon-icon">{q.icon}</span>
                                <span className="k-questhub-comingsoon-title">{q.title}</span>
                                <span className="k-questhub-comingsoon-xp">+{q.xp} XP</span>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {/* Leaderboard Link */}
            <div className="k-questhub-footer">
                <Link to={`/${nk}/leaderboard`} className="k-questhub-leaderboard-link">
                    View Leaderboard
                </Link>
            </div>
        </div>
    )
}
