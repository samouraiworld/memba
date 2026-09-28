import { useId, useState, type FormEvent } from "react"
import { StarRating } from "../../../components/reviews/StarRating"
import { MEMBA_DAO } from "../../../lib/config"
import type { OsSession } from "../../shell/useOsSession"
import { useSigner } from "../../sign/signerContext"
import { storeReviewRequest } from "./reviewRequest"

export function NativeReviewComposer({ session, subject, appName, onSubmitted }: {
    session: OsSession
    subject: string
    appName: string
    onSubmitted: () => void
}) {
    const signer = useSigner()
    const formId = useId()
    const ratingId = useId()
    const bodyId = useId()
    const [rating, setRating] = useState(0)
    const [body, setBody] = useState("")
    const [message, setMessage] = useState<string | null>(null)
    const [unknown, setUnknown] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const bodyBytes = new TextEncoder().encode(body.trim()).length

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (rating < 1 || bodyBytes > 2000 || unknown) return
        if (session.status !== "member") { session.openConnect(); return }
        try {
            const request = storeReviewRequest({
                subject, appName, caller: session.address, rating, body,
                realmPath: MEMBA_DAO.appReviewsPath,
                networkKey: session.network.key, chainId: session.network.chainId,
                onSettled: (outcome) => {
                    if (outcome === "submitted" || outcome === "confirmed") {
                        setRating(0)
                        setBody("")
                        setExpanded(false)
                        setMessage("Review submitted to the network. It may take a moment to appear below.")
                        onSubmitted()
                    } else if (outcome === "unknown") {
                        setUnknown(true)
                        setMessage("The outcome is unknown. Check your transaction before trying again.")
                    }
                },
            })
            setMessage(null)
            signer.sign(request)
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not prepare this review.")
        }
    }

    return <div className="os-store-review-widget">
        <div className="os-store-review-prompt"><span>Have something to share about this app?</span><button type="button" className="os-btn" aria-expanded={expanded} aria-controls={expanded ? formId : undefined} onClick={() => { if (!expanded && !unknown) setMessage(null); setExpanded(value => !value) }}>{expanded ? "Close editor" : "Write a review"}</button></div>
        {message && !expanded && <p className="os-store-review-message" role="status">{message}</p>}
        {expanded && <form id={formId} className="os-store-review-composer" onSubmit={submit} noValidate>
        <h2>Write a review</h2>
        <p>Share a rating for this onchain app. Posting again updates your visible review.</p>
        <span id={ratingId} className="os-store-review-label">Your rating</span>
        <StarRating value={rating} onChange={setRating} ariaLabelledBy={ratingId} />
        <label className="os-store-review-label" htmlFor={bodyId}>Your review <span>(optional)</span></label>
        <textarea id={bodyId} value={body} onChange={event => setBody(event.target.value)} maxLength={2000} rows={3} placeholder="What should others know?" />
        <small>{bodyBytes} / 2,000 bytes</small>
        {bodyBytes > 2000 && <p className="os-store-review-error" role="alert">Review text is too long in UTF-8 bytes.</p>}
        {message && <p className={unknown ? "os-store-review-error" : "os-store-review-message"} role="status">{message}</p>}
        <div className="os-store-review-actions">
            <button type="submit" className="os-btn" disabled={rating === 0 || bodyBytes > 2000 || unknown || session.status === "resuming"}>{session.status === "member" ? "Review in Memba OS" : "Connect to review"}</button>
            {unknown && <button type="button" className="os-btn os-quiet" onClick={() => { setUnknown(false); setMessage(null) }}>I checked my transaction</button>}
        </div>
        <p className="os-store-review-disclosure">Reviews are public chain transactions. Removing a review from public view does not erase its chain history. A signature proves wallet authorship, not app use.</p>
        </form>}
    </div>
}
