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

import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../../hooks/useAuth"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { isQuestAvailableOnNetwork } from "../../lib/questNetwork"
import {
    CANDIDATURE_XP_THRESHOLD,
    resolveCandidatureEligibility,
} from "../../lib/quests"
import "./candidatureunlock.css"

interface CandidatureUnlockProps {
    /** If true, user has an existing pending candidature. */
    hasPendingCandidature?: boolean
}

export function CandidatureUnlock({ hasPendingCandidature }: CandidatureUnlockProps) {
    const networkKey = useNetworkKey()
    const auth = useAuth()
    return <CandidatureUnlockSession key={`${auth.address}:${networkKey}`} address={auth.address} networkKey={networkKey} hasPendingCandidature={hasPendingCandidature} />
}

function CandidatureUnlockSession({ address, networkKey, hasPendingCandidature }: { address: string; networkKey: string; hasPendingCandidature?: boolean }) {
    const [verifiedXP, setVerifiedXP] = useState<number | null>(null)
    const [eligible, setEligible] = useState(false)
    const onNetwork = isQuestAvailableOnNetwork("submit-candidature", networkKey)
    const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(address && onNetwork ? "loading" : "unavailable")
    const [retryCount, setRetryCount] = useState(0)
    useEffect(() => {
        let cancelled = false
        let requestId = 0
        const refresh = () => {
            if (!address || !onNetwork || document.visibilityState === "hidden") return
            const request = ++requestId
            setStatus("loading")
            setEligible(false)
            setVerifiedXP(null)
            resolveCandidatureEligibility(address).then(result => {
                if (cancelled || request !== requestId) return
                setVerifiedXP(result.verifiedXP)
                setEligible(result.eligible && result.verifiedXP !== null)
                setStatus(result.verifiedXP === null ? "unavailable" : "ready")
            }).catch(() => {
                if (cancelled || request !== requestId) return
                setVerifiedXP(null)
                setEligible(false)
                setStatus("unavailable")
            })
        }
        refresh()
        window.addEventListener("quest-completed", refresh)
        window.addEventListener("focus", refresh)
        return () => {
            cancelled = true
            window.removeEventListener("quest-completed", refresh)
            window.removeEventListener("focus", refresh)
        }
    }, [address, onNetwork, retryCount])
    const percent = Math.round(((verifiedXP ?? 0) / CANDIDATURE_XP_THRESHOLD) * 100)

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
    if (eligible && onNetwork) {
        return (
            <div
                className="candidature-unlock candidature-unlock--unlocked"
                data-testid="candidature-unlock-ready"
            >
                <div className="candidature-unlock__icon">🎯</div>
                <div className="candidature-unlock__body">
                    <h4 className="candidature-unlock__title">You're eligible for Memba DAO!</h4>
                    <p className="candidature-unlock__desc">
                        You've earned {verifiedXP} verified XP from quests. Apply to become a member.
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
                    {onNetwork ? "Earn verified quest XP to unlock membership!" : "Candidature is not available on this network yet."}
                </p>
                <div className="candidature-unlock__progress">
                    <div className="candidature-unlock__bar">
                        <div
                            className="candidature-unlock__bar-fill"
                            style={{ width: `${Math.min(percent, 100)}%` }}
                        />
                    </div>
                    <span className="candidature-unlock__xp" aria-live="polite">
                        {!onNetwork ? "Candidature unavailable on this network" : !address ? "Connect a wallet to check verified XP" : status === "loading" ? "Checking verified XP…" : status === "unavailable" ? "Verified XP unavailable" : `${verifiedXP}/${CANDIDATURE_XP_THRESHOLD} verified XP (${Math.min(percent, 100)}%)`}
                    </span>
                </div>
            </div>
            {address && onNetwork && status === "unavailable" ? (
                <button type="button" className="candidature-unlock__btn candidature-unlock__btn--secondary" onClick={() => setRetryCount(count => count + 1)}>
                    Retry verified XP
                </button>
            ) : (
                <span className="candidature-unlock__btn candidature-unlock__btn--disabled">
                    Claim Candidature
                </span>
            )}
        </div>
    )
}
