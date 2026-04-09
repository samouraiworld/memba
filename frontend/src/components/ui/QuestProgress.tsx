/**
 * QuestProgress — Gamified quest completion widget.
 *
 * v2.29: Redesigned with collapsible "Quest Hub" pattern:
 * - Retracted by default: compact summary bar with SVG radial ring
 * - Expanded on click: 2-column card grid with animations
 * - Uses <details>/<summary> for native keyboard + screen reader support
 * - CSS grid-template-rows transition for smooth expand/collapse
 */

import { useState, useEffect, useRef } from "react"
import { CaretDown } from "@phosphor-icons/react"
import { CandidatureUnlock } from "../quests/CandidatureUnlock"
import {
    QUESTS,
    CANDIDATURE_XP_THRESHOLD,
    loadQuestProgress,
    fetchUserQuests,
    canApplyForMembership,
} from "../../lib/quests"
import { ALL_QUESTS } from "../../lib/gnobuilders"
import type { UserQuestState } from "../../lib/quests"
import "./questprogress.css"

interface QuestProgressProps {
    compact?: boolean
    /** If set, fetch quest state from backend for this address instead of localStorage. */
    address?: string
}

// ── SVG Radial Progress Ring ─────────────────────────────────────────
function RadialRing({ percent, size = 32 }: { percent: number; size?: number }) {
    const radius = 15
    const circumference = 2 * Math.PI * radius
    const offset = circumference - (percent / 100) * circumference

    return (
        <svg
            className="quest-ring"
            viewBox="0 0 36 36"
            style={{ width: size, height: size }}
            aria-hidden="true"
        >
            <circle
                className="quest-ring__bg"
                cx="18" cy="18" r={radius}
                fill="none"
                strokeWidth="3"
            />
            <circle
                className="quest-ring__fill"
                cx="18" cy="18" r={radius}
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform="rotate(-90 18 18)"
            />
            <text
                x="18" y="18"
                className="quest-ring__text"
                textAnchor="middle"
                dominantBaseline="central"
            >
                {percent}%
            </text>
        </svg>
    )
}

// ── Animated XP Counter ──────────────────────────────────────────────
function AnimatedXP({ target }: { target: number }) {
    const [current, setCurrent] = useState(0)
    const rafRef = useRef<number>(0)

    useEffect(() => {
        if (target === 0) return
        const duration = 600 // ms
        const start = performance.now()
        const animate = (now: number) => {
            const elapsed = now - start
            const progress = Math.min(elapsed / duration, 1)
            // ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3)
            setCurrent(Math.round(eased * target))
            if (progress < 1) {
                rafRef.current = requestAnimationFrame(animate)
            }
        }
        rafRef.current = requestAnimationFrame(animate)
        return () => cancelAnimationFrame(rafRef.current)
    }, [target])

    return <span className="quest-hub__xp-value">{current}</span>
}

// ── Main Component ───────────────────────────────────────────────────
export function QuestProgress({ compact, address }: QuestProgressProps) {
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
    const completedCount = state.completed.length
    const totalQuests = ALL_QUESTS.length > 0 ? ALL_QUESTS.length : QUESTS.length // v2 authoritative, v1 fallback
    const percent = Math.min(100, Math.round((completedCount / totalQuests) * 100))
    const eligible = address ? state.totalXP >= CANDIDATURE_XP_THRESHOLD : canApplyForMembership()

    if (loading) {
        return (
            <div className="quest-hub quest-hub--loading">
                <div className="quest-hub__summary">
                    <RadialRing percent={0} />
                    <span className="quest-hub__label">Loading quest progress...</span>
                </div>
            </div>
        )
    }

    // Compact mode for sidebar or other tight spaces
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
        <details className="quest-hub" data-testid="quest-hub">
            {/* ── Collapsed: Summary Bar (always visible) ──────── */}
            <summary className="quest-hub__summary" data-testid="quest-hub-toggle">
                <RadialRing percent={percent} />
                <div className="quest-hub__info">
                    <span className="quest-hub__count">
                        {completedCount} / {totalQuests} Quests
                    </span>
                    <span className="quest-hub__separator">·</span>
                    <span className={`quest-hub__xp${eligible ? " quest-hub__xp--eligible" : ""}`}>
                        {state.totalXP} XP
                    </span>
                    {eligible && !address && (
                        <span className="quest-hub__eligible-badge">✦ Eligible</span>
                    )}
                </div>
                <CaretDown size={16} className="quest-hub__chevron" aria-hidden="true" />
                {/* Progress accent bar */}
                <div className="quest-hub__accent" aria-hidden="true">
                    <div className="quest-hub__accent-fill" style={{ width: `${percent}%` }} />
                </div>
            </summary>

            {/* ── Expanded: Full Quest Grid ─────────────────────── */}
            <div className="quest-hub__content">
                {/* Hero progress section */}
                <div className="quest-hub__hero">
                    <RadialRing percent={percent} size={64} />
                    <div className="quest-hub__hero-info">
                        <div className="quest-hub__hero-xp">
                            <AnimatedXP target={state.totalXP} />
                            <span className="quest-hub__hero-xp-label">
                                / {CANDIDATURE_XP_THRESHOLD} XP
                            </span>
                        </div>
                        <p className="quest-hub__hero-desc">
                            {address
                                ? "Quest progress for this user"
                                : "Complete quests to earn XP and unlock Memba DAO membership"}
                        </p>
                    </div>
                </div>

                {/* v3.2: Enhanced Candidature CTA — 3-state component */}
                {!address && (
                    <CandidatureUnlock />
                )}

                {/* Quest card grid */}
                <div className="quest-hub__grid">
                    {ALL_QUESTS.map(q => {
                        const done = completedIds.has(q.id)
                        return (
                            <div
                                key={q.id}
                                className={`quest-card${done ? " quest-card--done" : ""}`}
                                data-testid={`quest-card-${q.id}`}
                            >
                                <span className="quest-card__icon" aria-hidden="true">
                                    {done ? "✅" : q.icon}
                                </span>
                                <div className="quest-card__body">
                                    <span className="quest-card__title">{q.title}</span>
                                    <span className="quest-card__desc">{q.description}</span>
                                </div>
                                <span className="quest-card__xp">{q.xp} XP</span>
                            </div>
                        )
                    })}
                </div>
            </div>
        </details>
    )
}
