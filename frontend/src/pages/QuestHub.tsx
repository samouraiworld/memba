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
import { useAdena } from "../hooks/useAdena"
import { loadQuestProgress, trackPageVisit, fetchUserQuests, type UserQuestState } from "../lib/quests"
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
import { AttestationPanel } from "../components/quests/AttestationPanel"
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

    const adena = useAdena()
    const [questState, setQuestState] = useState(() => loadQuestProgress())
    const [backendState, setBackendState] = useState<UserQuestState | null>(null)
    const [backendLoading, setBackendLoading] = useState(false)

    useEffect(() => {
        document.title = "GnoBuilders — Memba"
        trackPageVisit("quests")

        // Refresh the local (optimistic) state on any completion.
        const onQuestComplete = () => setQuestState(loadQuestProgress())
        window.addEventListener("quest-completed", onQuestComplete)
        return () => window.removeEventListener("quest-completed", onQuestComplete)
    }, [])

    // Backend XP/rank is authoritative — it's what the leaderboard shows. Fetch
    // it for the connected user and prefer it for display (P1-1); localStorage
    // stays an offline + optimistic overlay. Re-fetch after a completion so the
    // post-sync number lands without a reload.
    useEffect(() => {
        const addr = adena.address
        if (!addr) return
        let cancelled = false
        const load = () => {
            setBackendLoading(true)
            // fetchUserQuests resolves (never throws) — null on unreachable backend.
            fetchUserQuests(addr).then(s => {
                if (cancelled) return
                if (s) setBackendState(s)
                setBackendLoading(false)
            })
        }
        load()
        window.addEventListener("quest-completed", load)
        return () => { cancelled = true; window.removeEventListener("quest-completed", load) }
    }, [adena.address])

    // Only trust the fetched backend state while a wallet is connected (it falls
    // back to localStorage when disconnected, without clearing state in-effect).
    const effectiveBackend = adena.address ? backendState : null

    // Prefer backend XP (authoritative); fall back to localStorage when offline.
    const displayXP = effectiveBackend ? effectiveBackend.totalXP : questState.totalXP
    const rank = calculateRank(displayXP)
    const toNext = xpToNextRank(displayXP)

    // Completed set = union of backend + local, so a just-completed quest shows
    // done immediately (optimistic) even before its backend sync lands.
    const completedIds = useMemo(() => {
        const ids = new Set(questState.completed.map(c => c.questId))
        if (effectiveBackend) for (const c of effectiveBackend.completed) ids.add(c.questId)
        return ids
    }, [questState, effectiveBackend])

    // "Syncing" when localStorage holds a completion the backend hasn't recorded
    // yet — a set difference, not a count compare (Q-10). A count compare is wrong
    // when the two sides hold the same number of *different* quests (e.g. one earned
    // on another device), so it could both false-positive and false-negative.
    const syncing = useMemo(() => {
        if (!effectiveBackend) return false
        const backendIds = new Set(effectiveBackend.completed.map(c => c.questId))
        return questState.completed.some(c => !backendIds.has(c.questId))
    }, [effectiveBackend, questState])

    // First authoritative fetch in flight (wallet connected, no backend state yet):
    // signal "confirming" rather than letting the XP silently jump local→server (Q-11).
    const confirmingXP = adena.address != null && backendLoading && backendState == null

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

    // Q-24: when a filter/search narrows the grid to nothing, offer a one-click reset.
    const filtersActive = category !== "all" || difficulty !== "all" || status !== "all" || search.trim() !== ""
    const clearFilters = () => { setCategory("all"); setDifficulty("all"); setStatus("all"); setSearch("") }

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
                        <span
                            className={`k-questhub-xp-value${confirmingXP ? " k-questhub-xp-value--confirming" : ""}`}
                            aria-busy={confirmingXP}
                            title={confirmingXP ? "Confirming your XP with the server…" : undefined}
                        >{displayXP} XP</span>
                        {toNext > 0 && (
                            <span className="k-questhub-xp-next">{toNext} XP to {calculateRank(displayXP + toNext).name}</span>
                        )}
                        {syncing && <span className="k-questhub-syncing" title="Saving your latest progress to the server">syncing…</span>}
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

            {/* On-chain attestation (Q-05) — renders only when the backend issues
                vouchers (i.e. attestation is enabled) and the user is connected. */}
            {adena.address && <AttestationPanel address={adena.address} />}

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
                        <p>{search ? "No quests match your search." : "No quests match these filters."}</p>
                        {filtersActive && (
                            <button type="button" className="k-questhub-clear-filters" onClick={clearFilters}>
                                Clear filters
                            </button>
                        )}
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
                    <summary>Coming soon ({comingSoon.length})</summary>
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
