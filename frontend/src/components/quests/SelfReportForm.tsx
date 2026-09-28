/**
 * SelfReportForm — proof submission for self-report quests.
 *
 * Self-report quests (e.g. "get a PR merged to gnolang/gno") can't be verified
 * on-chain, so the user submits a proof URL and/or description. An admin reviews
 * it on the quest-admin page; on approval the backend records the completion.
 *
 * The backend claim status is the source of truth: pending shows a waiting
 * banner, approved shows a done banner, and REJECTED shows the rejection and
 * re-opens the form so the user can resubmit better proof (the backend reopens
 * a rejected claim as pending). localStorage (hasSubmittedClaim) is only an
 * optimistic hint while the status loads or the backend is unreachable.
 */

import { useEffect, useRef, useState } from "react"
import { fetchQuestClaimStatuses, hasSubmittedClaim, submitQuestClaim } from "../../lib/questClaims"
import type { Token } from "../../gen/memba/v1/memba_pb"

interface SelfReportFormProps {
    questId: string
    address: string
    authToken: Token | null
}

/** What the form knows about the user's claim for this quest. */
type ClaimView = "none" | "pending" | "approved" | "rejected"

export function SelfReportForm({ questId, address, authToken }: SelfReportFormProps) {
    const [proofUrl, setProofUrl] = useState("")
    const [proofText, setProofText] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState("")
    const requestId = useRef(0)
    // Optimistic hint until the backend answers: a locally-recorded submission
    // renders as pending so the form doesn't flash open on reload.
    const [view, setView] = useState<ClaimView>(() =>
        hasSubmittedClaim(address, questId) ? "pending" : "none")

    useEffect(() => {
        let cancelled = false
        const refresh = () => {
            if (document.visibilityState === "hidden") return
            const request = ++requestId.current
            fetchQuestClaimStatuses(address).then(statuses => {
                if (cancelled || request !== requestId.current || !statuses) return // unreachable — keep the local hint
                setView(statuses.get(questId)?.status ?? "none")
            })
        }
        refresh()
        // A reviewer can approve or reject while the applicant keeps this page
        // open. Refresh on return and periodically while the page is visible.
        const timer = window.setInterval(refresh, 30_000)
        window.addEventListener("focus", refresh)
        return () => {
            cancelled = true
            window.clearInterval(timer)
            window.removeEventListener("focus", refresh)
        }
    }, [address, questId])

    if (view === "pending") {
        return (
            <div className="k-questdetail-result k-questdetail-result--pending" role="status">
                <span>Proof submitted — pending admin review.</span>
            </div>
        )
    }

    if (view === "approved") {
        return (
            <div className="k-questdetail-result k-questdetail-result--verified" role="status">
                <span>Proof approved — quest completed.</span>
            </div>
        )
    }

    const isResubmit = view === "rejected"
    const signedInAsClaimant = !!authToken && authToken.userAddress === address
    const canSubmit = signedInAsClaimant && (proofUrl.trim() !== "" || proofText.trim() !== "")

    const handleSubmit = async () => {
        if (!authToken || !canSubmit) return
        // A pre-submit status read may still be in flight. Its old "none"
        // response must not reopen the form after this submit succeeds.
        requestId.current++
        setSubmitting(true)
        setError("")
        try {
            await submitQuestClaim(authToken, address, questId, proofUrl.trim(), proofText.trim())
            setView("pending")
        } catch {
            setError("Submission failed — please try again.")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="k-questdetail-selfreport">
            {isResubmit && (
                <div className="k-questdetail-result k-questdetail-result--error" role="status">
                    <span>Your previous proof was rejected. You can submit new proof below.</span>
                </div>
            )}
            <p className="k-questdetail-hint">
                This quest is verified by proof. Add a link and/or a short description; an admin will review it.
            </p>
            <input
                type="text"
                id={`proof-url-${questId}`}
                name="proof-url"
                className="k-questhub-search"
                placeholder="Proof URL (PR, tx hash, repo…)"
                value={proofUrl}
                onChange={e => setProofUrl(e.target.value)}
                aria-label="Proof URL"
            />
            <textarea
                id={`proof-text-${questId}`}
                name="proof-text"
                className="k-questdetail-proof-text"
                placeholder="Describe what you did (optional if a URL is provided)"
                value={proofText}
                onChange={e => setProofText(e.target.value)}
                aria-label="Proof description"
                rows={3}
            />
            <button
                className="k-questdetail-verify-btn"
                onClick={handleSubmit}
                disabled={submitting || !canSubmit}
            >
                {submitting ? "Submitting…" : isResubmit ? "Resubmit proof" : "Submit proof"}
            </button>
            {!signedInAsClaimant && <p className="k-questdetail-hint">Sign in with this wallet to submit.</p>}
            {error && (
                <div className="k-questdetail-result k-questdetail-result--error">
                    <span>{error}</span>
                </div>
            )}
        </div>
    )
}
