/**
 * SelfReportForm — proof submission for self-report quests.
 *
 * Self-report quests (e.g. "get a PR merged to gnolang/gno") can't be verified
 * on-chain, so the user submits a proof URL and/or description. An admin reviews
 * it on the quest-admin page; on approval the backend records the completion.
 */

import { useState } from "react"
import { hasSubmittedClaim, submitQuestClaim } from "../../lib/questClaims"
import type { Token } from "../../gen/memba/v1/memba_pb"

interface SelfReportFormProps {
    questId: string
    address: string
    authToken: Token | null
}

export function SelfReportForm({ questId, address, authToken }: SelfReportFormProps) {
    const [proofUrl, setProofUrl] = useState("")
    const [proofText, setProofText] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(() => hasSubmittedClaim(address, questId))
    const [error, setError] = useState("")

    if (submitted) {
        return (
            <div className="k-questdetail-result k-questdetail-result--pending" role="status">
                <span>Proof submitted — pending admin review.</span>
            </div>
        )
    }

    const canSubmit = !!authToken && (proofUrl.trim() !== "" || proofText.trim() !== "")

    const handleSubmit = async () => {
        if (!authToken || !canSubmit) return
        setSubmitting(true)
        setError("")
        try {
            await submitQuestClaim(authToken, address, questId, proofUrl.trim(), proofText.trim())
            setSubmitted(true)
        } catch {
            setError("Submission failed — please try again.")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="k-questdetail-selfreport">
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
                {submitting ? "Submitting…" : "Submit proof"}
            </button>
            {!authToken && <p className="k-questdetail-hint">Connect your wallet to submit.</p>}
            {error && (
                <div className="k-questdetail-result k-questdetail-result--error">
                    <span>{error}</span>
                </div>
            )}
        </div>
    )
}
