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
import { Link, useSearchParams } from "react-router-dom"
import { useNetworkKey } from "../hooks/useNetworkNav"
import { useTabListKeyboard } from "../hooks/useTabListKeyboard"
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
import { questHubStatus } from "../lib/questNetwork"
import { useWindowActive } from "../os/page/WindowActivity"
import { RankBadge } from "../components/quests/RankBadge"
import { AttestationPanel } from "../components/quests/AttestationPanel"
import { QuestCard } from "../components/quests/QuestCard"
import "./questhub.css"

type FilterCategory = QuestCategory | "all"

// Category tabs in display order — shared by the tablist markup and the
// keyboard hook so "next tab" can never disagree with what is rendered.
const CATEGORY_TAB_KEYS: readonly FilterCategory[] = ["all", "developer", "everyone", "champion"]
type FilterDifficulty = QuestDifficulty | "all"
type FilterStatus = "all" | "available" | "completed" | "locked"
const EMPTY_PROGRESS: UserQuestState = { completed: [], totalXP: 0 }
// Keep historical local completions visible, but these quests are retired by
// the backend and can never finish syncing if they were not recorded there.
const RETIRED_LOCAL_QUEST_IDS = new Set(["gnodaokit-extension", "submit-feedback"])

function filterValue<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
    return value && options.includes(value as T) ? value as T : fallback
}

export default function QuestHub() {
    const nk = useNetworkKey()
    const [searchParams, setSearchParams] = useSearchParams()
    const category = filterValue(searchParams.get("category"), CATEGORY_TAB_KEYS, "all")
    const difficulty: FilterDifficulty = filterValue(searchParams.get("difficulty"), ["all", "beginner", "intermediate", "advanced", "expert"] as const, "all")
    const status: FilterStatus = filterValue(searchParams.get("status"), ["all", "available", "completed", "locked"] as const, "all")
    const search = searchParams.get("q") ?? ""
    const updateFilter = (key: "category" | "difficulty" | "status" | "q", value: string) => {
        setSearchParams(previous => {
            const next = new URLSearchParams(previous)
            if (!value || value === "all") next.delete(key)
            else next.set(key, value)
            return next
        }, { replace: true })
    }
    const setCategory = (value: FilterCategory) => updateFilter("category", value)

    // APG tabs keyboard contract (roving tabindex, arrows, Home/End) — the
    // shared hook Directory extracted; these tabs had no keyboard support.
    const { tabProps } = useTabListKeyboard<FilterCategory>({
        keys: CATEGORY_TAB_KEYS,
        active: category,
        onSelect: setCategory,
        idFor: (k) => `quest-tab-${k}`,
    })
    const adena = useAdena()
    const windowActive = useWindowActive()
    const [localProgress, setLocalProgress] = useState(() => ({ address: adena.address, state: loadQuestProgress(adena.address || null) }))
    const questState = localProgress.address === adena.address ? localProgress.state : EMPTY_PROGRESS
    const [backendProgress, setBackendProgress] = useState<{ address: string; state: UserQuestState } | null>(null)
    const [backendLoading, setBackendLoading] = useState(false)
    const [backendUnavailableFor, setBackendUnavailableFor] = useState<string | null>(null)
    const [backendRetry, setBackendRetry] = useState(0)

    useEffect(() => {
        document.title = "GnoBuilders — Memba"
        trackPageVisit("quests")
    }, [])

    useEffect(() => {
        // Refresh the local (optimistic) state on any completion.
        const onQuestComplete = () => setLocalProgress({ address: adena.address, state: loadQuestProgress(adena.address || null) })
        window.addEventListener("quest-completed", onQuestComplete)
        return () => window.removeEventListener("quest-completed", onQuestComplete)
    }, [adena.address])

    useEffect(() => {
        // Layout updates the wallet-scoped quest storage in its own effect.
        // A microtask reads after that update, while the render above shows no
        // progress from the previous wallet during the handoff.
        let cancelled = false
        queueMicrotask(() => {
            if (!cancelled) setLocalProgress({ address: adena.address, state: loadQuestProgress(adena.address || null) })
        })
        return () => { cancelled = true }
    }, [adena.address])

    // Backend XP/rank is authoritative — it's what the leaderboard shows. Fetch
    // it for the connected user and prefer it for display (P1-1); localStorage
    // stays an offline + optimistic overlay. Re-fetch after a completion so the
    // post-sync number lands without a reload.
    useEffect(() => {
        const addr = adena.address
        if (!addr || !windowActive) return
        let cancelled = false
        let requestId = 0
        const load = () => {
            const currentRequest = ++requestId
            setBackendLoading(true)
            setBackendUnavailableFor(null)
            // fetchUserQuests resolves (never throws) — null on unreachable backend.
            fetchUserQuests(addr).then(s => {
                if (cancelled || currentRequest !== requestId) return
                setBackendProgress(s ? { address: addr, state: s } : null)
                setBackendUnavailableFor(s ? null : addr)
                setBackendLoading(false)
            }).catch(() => {
                if (cancelled || currentRequest !== requestId) return
                setBackendProgress(null)
                setBackendUnavailableFor(addr)
                setBackendLoading(false)
            })
        }
        load()
        window.addEventListener("quest-completed", load)
        return () => { cancelled = true; requestId++; window.removeEventListener("quest-completed", load) }
    }, [adena.address, windowActive, backendRetry])

    // Only trust the fetched backend state while a wallet is connected (it falls
    // back to localStorage when disconnected, without clearing state in-effect).
    const effectiveBackend = adena.address && backendProgress?.address === adena.address ? backendProgress.state : null

    // Prefer backend XP (authoritative); label localStorage fallback when offline.
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
        return questState.completed.some(c => !RETIRED_LOCAL_QUEST_IDS.has(c.questId) && !backendIds.has(c.questId))
    }, [effectiveBackend, questState])

    // First authoritative fetch in flight (wallet connected, no backend state yet):
    // signal "confirming" rather than letting the XP silently jump local→server (Q-11).
    const confirmingXP = !!adena.address && backendLoading

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
        if (status !== "all") {
            result = result.filter(q => questHubStatus(q.id, completedIds, nk) === status)
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
    }, [liveQuests, category, difficulty, status, search, completedIds, nk])

    const completedCount = useMemo(
        () => liveQuests.filter(q => completedIds.has(q.id)).length,
        [liveQuests, completedIds],
    )
    const totalLive = liveQuests.length

    // Q-24: when a filter/search narrows the grid to nothing, offer a one-click reset.
    const filtersActive = category !== "all" || difficulty !== "all" || status !== "all" || search.trim() !== ""
    const clearFilters = () => setSearchParams(previous => {
        const next = new URLSearchParams(previous)
        for (const key of ["category", "difficulty", "status", "q"]) next.delete(key)
        return next
    }, { replace: true })
    const returnQuery = new URLSearchParams()
    if (category !== "all") returnQuery.set("category", category)
    if (difficulty !== "all") returnQuery.set("difficulty", difficulty)
    if (status !== "all") returnQuery.set("status", status)
    if (search) returnQuery.set("q", search)

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
                        {adena.address && backendUnavailableFor === adena.address && !backendLoading && (
                            <span className="k-questhub-xp-unavailable" role="status">
                                Server XP unavailable; showing saved local progress.{' '}
                                <button type="button" className="k-questhub-xp-retry" onClick={() => setBackendRetry(count => count + 1)}>Retry server XP</button>
                            </span>
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
                        {...tabProps(key)}
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
                    id="quest-search"
                    name="quest-search"
                    className="k-questhub-search"
                    placeholder="Search quests..."
                    value={search}
                    onChange={e => updateFilter("q", e.target.value)}
                    aria-label="Search quests"
                />
                <select
                    id="quest-difficulty"
                    name="quest-difficulty"
                    className="k-questhub-select"
                    value={difficulty}
                    onChange={e => updateFilter("difficulty", e.target.value)}
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
                    onChange={e => updateFilter("status", e.target.value)}
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
                            returnQuery={returnQuery.toString()}
                        />
                    ))
                )}
            </div>

            {/* Season 2 — Coming soon (curated-out quests, shown dimmed, non-clickable) */}
            {comingSoon.length > 0 && (
                <details className="k-questhub-comingsoon">
                    <summary>Coming soon ({comingSoon.length})</summary>
                    <p className="k-questhub-comingsoon-note">
                        These quests aren&apos;t live yet — their verification or rewards are still being wired up.
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
