/**
 * CandidatureUnlock — Quest-gated candidature CTA component.
 *
 * Three visual states:
 * 1. LOCKED (XP < threshold): Progress bar + greyed CTA
 * 2. UNLOCKED (XP ≥ threshold, no application): Glowing "Claim Candidature" CTA
 * 3. PENDING (existing application submitted): Status indicator + "View Status" link
 *
 * v3.2: Bridges the Quest Hub → CandidaturePage gap identified in Sprint 5 audit.
 *
 * @module components/quests/CandidatureUnlock
 */

import { Link } from "react-router-dom"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import {
    CANDIDATURE_XP_THRESHOLD,
    TOTAL_POSSIBLE_XP,
    loadQuestProgress,
    canApplyForMembership,
} from "../../lib/quests"
import "./candidatureunlock.css"

interface CandidatureUnlockProps {
    /** If true, user has an existing pending candidature. */
    hasPendingCandidature?: boolean
}

export function CandidatureUnlock({ hasPendingCandidature }: CandidatureUnlockProps) {
    const networkKey = useNetworkKey()
    const state = loadQuestProgress()
    const eligible = canApplyForMembership()
    const percent = Math.round((state.totalXP / CANDIDATURE_XP_THRESHOLD) * 100)

    // State 3: Pending candidature
    if (hasPendingCandidature) {
        return (
            <div
                className="candidature-unlock candidature-unlock--pending"
                data-testid="candidature-unlock-pending"
            >
                <div className="candidature-unlock__icon">⏳</div>
                <div className="candidature-unlock__body">
                    <h4 className="candidature-unlock__title">Candidature Pending</h4>
                    <p className="candidature-unlock__desc">
                        Your application is awaiting DAO member vote.
                    </p>
                </div>
                <Link
                    to={`/${networkKey}/candidature`}
                    className="candidature-unlock__btn candidature-unlock__btn--secondary"
                >
                    View Status →
                </Link>
            </div>
        )
    }

    // State 2: Unlocked (eligible)
    if (eligible) {
        return (
            <div
                className="candidature-unlock candidature-unlock--unlocked"
                data-testid="candidature-unlock-ready"
            >
                <div className="candidature-unlock__icon">🎯</div>
                <div className="candidature-unlock__body">
                    <h4 className="candidature-unlock__title">You're eligible for Memba DAO!</h4>
                    <p className="candidature-unlock__desc">
                        You've earned {state.totalXP} XP from quests. Apply to become a member.
                    </p>
                </div>
                <Link
                    to={`/${networkKey}/candidature`}
                    className="candidature-unlock__btn candidature-unlock__btn--primary"
                    data-testid="candidature-unlock-cta"
                >
                    🚀 Claim Candidature →
                </Link>
            </div>
        )
    }

    // State 1: Locked (not enough XP)
    return (
        <div
            className="candidature-unlock candidature-unlock--locked"
            data-testid="candidature-unlock-locked"
        >
            <div className="candidature-unlock__icon">🔒</div>
            <div className="candidature-unlock__body">
                <h4 className="candidature-unlock__title">Memba DAO Candidature</h4>
                <p className="candidature-unlock__desc">
                    Complete quests to unlock membership!
                </p>
                <div className="candidature-unlock__progress">
                    <div className="candidature-unlock__bar">
                        <div
                            className="candidature-unlock__bar-fill"
                            style={{ width: `${Math.min(percent, 100)}%` }}
                        />
                    </div>
                    <span className="candidature-unlock__xp">
                        {state.totalXP}/{CANDIDATURE_XP_THRESHOLD} XP ({Math.min(percent, 100)}%)
                    </span>
                </div>
            </div>
            <span className="candidature-unlock__btn candidature-unlock__btn--disabled">
                Claim Candidature
            </span>
        </div>
    )
}
