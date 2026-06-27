/**
 * QuestAdmin — review queue for self-report quest claims.
 *
 * Lists pending claims with their proof; approve/reject calls ReviewQuestClaim
 * (on approval the backend records the completion + queues the badge). Gated
 * client-side to the admin address for UX; the backend enforces its
 * adminAddresses allowlist regardless.
 *
 * Route: /:network/quest-admin
 */

import { useState, useEffect, useCallback } from "react"
import { Link } from "react-router-dom"
import { useAdena } from "../hooks/useAdena"
import { useAuth } from "../hooks/useAuth"
import { useNetworkKey } from "../hooks/useNetworkNav"
import { ZOOMA_ADDRESS } from "../lib/membaDAO"
import { listPendingClaims, reviewQuestClaim } from "../lib/questClaims"
import { getQuestById } from "../lib/gnobuilders"
import type { QuestClaim } from "../gen/memba/v1/memba_pb"
import "./questhub.css"

/** Only render a proof URL as a link when it's a real http(s) URL (no javascript:). */
function safeHttpUrl(url: string): string | null {
    return /^https?:\/\//i.test(url) ? url : null
}

/** Format a backend timestamp for display, falling back to the raw string if unparseable (Q-13). */
function formatClaimDate(raw: string): string {
    const t = Date.parse(raw)
    return Number.isNaN(t) ? raw : new Date(t).toLocaleString()
}

export default function QuestAdmin() {
    const { address } = useAdena()
    const auth = useAuth()
    const nk = useNetworkKey()
    const isAdmin = !!address && address === ZOOMA_ADDRESS

    const [claims, setClaims] = useState<QuestClaim[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [busyId, setBusyId] = useState<bigint | null>(null)

    const load = useCallback(async () => {
        if (!auth.token || !isAdmin) return
        setLoading(true)
        setError("")
        try {
            setClaims(await listPendingClaims(auth.token))
        } catch {
            setError("Failed to load claims.")
        } finally {
            setLoading(false)
        }
    }, [auth.token, isAdmin])

    useEffect(() => {
        document.title = "Quest Admin — Memba"
        load()
    }, [load])

    const review = async (claim: QuestClaim, approved: boolean) => {
        if (!auth.token) return
        setBusyId(claim.id)
        setError("")
        try {
            await reviewQuestClaim(auth.token, claim.id, approved)
            setClaims(prev => prev.filter(c => c.id !== claim.id))
        } catch {
            setError("Review failed — please try again.")
        } finally {
            setBusyId(null)
        }
    }

    if (!isAdmin) {
        return (
            <div className="k-questhub">
                <h1>Quest Admin</h1>
                <p>This page is restricted to quest reviewers.</p>
                <Link to={`/${nk}/quests`} className="k-questhub-leaderboard-link">Back to Quests</Link>
            </div>
        )
    }

    return (
        <div className="k-questhub">
            <div className="k-questhub-hero">
                <div className="k-questhub-hero-content">
                    <h1>Quest Admin</h1>
                    <p className="k-questhub-subtitle">Self-report claim review</p>
                </div>
            </div>

            {loading && <p className="k-questdetail-hint">Loading…</p>}
            {error && (
                <div className="k-questdetail-result k-questdetail-result--error"><span>{error}</span></div>
            )}
            {!loading && claims.length === 0 && (
                <div className="k-questhub-empty">No pending claims. 🎉</div>
            )}

            <div className="k-questadmin-list" role="list" aria-label="Pending quest claims">
                {claims.map(claim => {
                    const quest = getQuestById(claim.questId)
                    const url = safeHttpUrl(claim.proofUrl)
                    return (
                        <div key={String(claim.id)} className="k-questadmin-claim" role="listitem">
                            <div className="k-questadmin-claim-head">
                                <span className="k-questadmin-claim-quest">{quest?.icon} {quest?.title ?? claim.questId}</span>
                                <span className="k-quest-card-xp">+{quest?.xp ?? 0} XP</span>
                            </div>
                            <div className="k-questadmin-claim-meta">
                                <span title={claim.address}>{claim.address.slice(0, 12)}…</span>
                                <span title={claim.createdAt}>{formatClaimDate(claim.createdAt)}</span>
                            </div>
                            {url
                                ? <a className="k-questadmin-claim-url" href={url} target="_blank" rel="noopener noreferrer">{claim.proofUrl}</a>
                                : claim.proofUrl && <span className="k-questadmin-claim-url">{claim.proofUrl}</span>}
                            {claim.proofText && <p className="k-questadmin-claim-text">{claim.proofText}</p>}
                            <div className="k-questadmin-claim-actions">
                                <button className="k-questdetail-verify-btn" disabled={busyId === claim.id} onClick={() => review(claim, true)}>
                                    Approve
                                </button>
                                <button className="k-questadmin-reject" disabled={busyId === claim.id} onClick={() => review(claim, false)}>
                                    Reject
                                </button>
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="k-questhub-footer">
                <Link to={`/${nk}/quests`} className="k-questhub-leaderboard-link">Back to Quests</Link>
            </div>
        </div>
    )
}
