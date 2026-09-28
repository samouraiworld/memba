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

import { useState, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Code, ConnectError } from "@connectrpc/connect"
import { Link } from "react-router-dom"
import { useAdena } from "../hooks/useAdena"
import { useAuth } from "../hooks/useAuth"
import { useNetworkKey } from "../hooks/useNetworkNav"
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
    const headingRef = useRef<HTMLHeadingElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    const [busyId, setBusyId] = useState<bigint | null>(null)

    // The backend's configurable reviewer allowlist is authoritative. A
    // hardcoded address here locked out additional permitted reviewers.
    const queryClient = useQueryClient()
    const claimsEnabled = !!auth.token && !!address && auth.token.userAddress === address
    const claimsKey = ["quests", "pending-claims", auth.token?.userAddress ?? ""]
    const claimsQuery = useQuery({
        queryKey: claimsKey,
        enabled: claimsEnabled,
        queryFn: () => listPendingClaims(auth.token!),
    })
    const claims = claimsQuery.data ?? []
    const loading = claimsEnabled ? claimsQuery.isPending : false

    // Review errors are UI state; the fetch error keeps its old fixed copy.
    const [actionError, setActionError] = useState("")
    const forbidden = claimsQuery.error instanceof ConnectError && claimsQuery.error.code === Code.PermissionDenied
    const error = actionError || (claimsQuery.isError && !forbidden ? "Failed to load claims." : "")

    useEffect(() => {
        document.title = "Quest Admin — Memba"
    }, [])

    const review = async (claim: QuestClaim, approved: boolean) => {
        if (!auth.token) return
        setBusyId(claim.id)
        setActionError("")
        try {
            await reviewQuestClaim(auth.token, claim.id, approved)
            // Remove the reviewed row immediately, then fetch the next bounded
            // batch so claim 101 becomes visible after claim 1 is processed.
            queryClient.setQueryData(claimsKey, (prev: QuestClaim[] | undefined) =>
                (prev ?? []).filter(c => c.id !== claim.id))
            const refreshed = await claimsQuery.refetch()
            if (refreshed.isError) setActionError("Review saved, but the queue could not refresh. Retry loading claims.")
            requestAnimationFrame(() => {
                (listRef.current?.querySelector<HTMLElement>(".k-questadmin-claim-actions button:not(:disabled)") ?? headingRef.current)?.focus()
            })
        } catch {
            setActionError("Review failed — please try again.")
        } finally {
            setBusyId(null)
        }
    }

    if (!claimsEnabled || forbidden) {
        return (
            <div className="k-questhub">
                <h1>Quest Admin</h1>
                <p>{forbidden ? "This page is restricted to quest reviewers." : "Connect and sign in with a reviewer wallet to see pending claims."}</p>
                <Link to={`/${nk}/quests`} className="k-questhub-leaderboard-link">Back to Quests</Link>
            </div>
        )
    }

    return (
        <div className="k-questhub">
            <div className="k-questhub-hero">
                <div className="k-questhub-hero-content">
                    <h1 ref={headingRef} tabIndex={-1}>Quest Admin</h1>
                    <p className="k-questhub-subtitle">Self-report claim review</p>
                </div>
            </div>

            {loading && <p className="k-questdetail-hint">Loading…</p>}
            {error && (
                <div className="k-questdetail-result k-questdetail-result--error" role="alert">
                    <span>{error}</span>
                    <button type="button" onClick={() => { setActionError(""); void claimsQuery.refetch() }}>Retry loading claims</button>
                </div>
            )}
            {claimsQuery.isSuccess && claims.length === 0 && !actionError && (
                <div className="k-questhub-empty">No pending claims. 🎉</div>
            )}

            <div className="k-questadmin-list" role="list" aria-label="Pending quest claims" ref={listRef}>
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
                                <button className="k-questdetail-verify-btn" aria-label={`Approve ${quest?.title ?? claim.questId} claim from ${claim.address}`} disabled={busyId === claim.id} onClick={() => review(claim, true)}>
                                    Approve
                                </button>
                                <button className="k-questadmin-reject" aria-label={`Reject ${quest?.title ?? claim.questId} claim from ${claim.address}`} disabled={busyId === claim.id} onClick={() => review(claim, false)}>
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
