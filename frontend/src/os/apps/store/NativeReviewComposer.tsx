import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { StarRating } from "../../../components/reviews/StarRating"
import { MEMBA_DAO } from "../../../lib/config"
import { FALLBACK_GAS_PRICE, networkGasPrice, type GasPrice } from "../../../lib/grc20"
import { REVIEW_BODY_MAX_BYTES } from "../../../lib/reviews"
import type { OsSession } from "../../shell/useOsSession"
import { useSigner } from "../../sign/signerContext"
import { storeReviewRequest } from "./reviewRequest"

interface ReviewDraft { rating: number; body: string }

const EMPTY: ReviewDraft = { rating: 0, body: "" }
const BODY_LIMIT = REVIEW_BODY_MAX_BYTES.toLocaleString("en-US")

// Kept for the browser session and not tied to a wallet: connecting remounts every window,
// and a guest's draft must still be there afterwards.
function draftKey(chainId: string, subject: string) { return `memba_os_review_draft:${chainId}:${subject}` }
function readDraft(key: string): ReviewDraft {
    try {
        const { rating, body } = JSON.parse(sessionStorage.getItem(key) ?? "{}") as Partial<ReviewDraft>
        if (typeof rating === "number" && [0, 1, 2, 3, 4, 5].includes(rating) && typeof body === "string") return { rating, body }
    } catch { /* malformed or storage blocked: start empty */ }
    return EMPTY
}
function saveDraft(key: string, draft: ReviewDraft) {
    try {
        if (draft.rating || draft.body) sessionStorage.setItem(key, JSON.stringify(draft))
        else sessionStorage.removeItem(key)
    } catch { /* storage blocked: the draft lasts while this window stays open */ }
}

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
    const key = draftKey(session.network.chainId, subject)
    const [draft, setDraft] = useState(() => readDraft(key))
    const [expanded, setExpanded] = useState(draft.rating > 0 || draft.body !== "")
    const [notice, setNotice] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [price, setPrice] = useState<GasPrice>(FALLBACK_GAS_PRICE)
    const toggle = useRef<HTMLButtonElement>(null)
    const refocus = useRef(false)
    const bodyBytes = new TextEncoder().encode(draft.body.trim()).length
    const tooLong = bodyBytes > REVIEW_BODY_MAX_BYTES
    const edit = (next: ReviewDraft) => { setDraft(next); saveDraft(key, next) }

    useEffect(() => {
        let active = true
        networkGasPrice().then((p) => { if (active) setPrice(p) }, () => {})
        return () => { active = false }
    }, [])

    // A posted review collapses the form that held focus; hand it to the toggle, not <body>.
    useEffect(() => {
        if (refocus.current && document.activeElement === document.body) toggle.current?.focus()
        refocus.current = false
    }, [expanded])

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (draft.rating < 1 || tooLong) return
        if (session.status !== "member") { session.openConnect(); return }
        setNotice(null)
        setError(null)
        try {
            signer.sign(storeReviewRequest({
                subject, appName, caller: session.address, rating: draft.rating, body: draft.body,
                realmPath: MEMBA_DAO.appReviewsPath,
                networkKey: session.network.key, chainId: session.network.chainId, price,
                onSettled: (outcome) => {
                    if (outcome === "submitted" || outcome === "confirmed") {
                        edit(EMPTY)
                        refocus.current = true
                        setExpanded(false)
                        setNotice(`Review ${outcome === "confirmed" ? "confirmed on chain" : "submitted to the network"}. It may take a moment to appear below.`)
                        onSubmitted()
                    } else if (outcome === "unknown") {
                        setError("The outcome is unknown. Refresh the reviews below to check whether it was posted. Posting again replaces your rating and text and costs another network fee.")
                    }
                },
            }))
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not prepare this review.")
        }
    }

    return <div className="os-store-review-widget">
        <div className="os-store-review-prompt"><span>Have something to share about this app?</span><button ref={toggle} type="button" className="os-btn" aria-expanded={expanded} aria-controls={expanded ? formId : undefined} onClick={() => { setNotice(null); setError(null); setExpanded(value => !value) }}>{expanded ? "Close editor" : "Write a review"}</button></div>
        {notice && <p className="os-store-review-message" role="status">{notice}</p>}
        {expanded && <form id={formId} className="os-store-review-composer" onSubmit={submit} noValidate>
        <h2>Write a review</h2>
        <p>Share a rating for this onchain app. Posting again replaces your rating and text.</p>
        <span id={ratingId} className="os-store-review-label">Your rating</span>
        <StarRating value={draft.rating} onChange={rating => edit({ ...draft, rating })} ariaLabelledBy={ratingId} />
        <label className="os-store-review-label" htmlFor={bodyId}>Your review <span>(optional)</span></label>
        <textarea id={bodyId} value={draft.body} onChange={event => edit({ ...draft, body: event.target.value })} maxLength={REVIEW_BODY_MAX_BYTES} rows={3} placeholder="What should others know?" />
        <small>{bodyBytes} / {BODY_LIMIT} bytes</small>
        {tooLong && <p className="os-store-review-error" role="alert">Review text is too long in UTF-8 bytes.</p>}
        {error && <p className="os-store-review-error" role="alert">{error}</p>}
        <div className="os-store-review-actions">
            <button type="submit" className="os-btn" disabled={draft.rating === 0 || tooLong || session.status === "resuming"}>{session.status === "member" ? "Review in Memba OS" : "Connect to review"}</button>
            {draft.rating === 0 && <span className="os-sub">Select a rating to post.</span>}
        </div>
        <p className="os-store-review-disclosure">Reviews are public chain transactions. Removing a review from public view does not erase its chain history. A signature proves wallet authorship, not app use.</p>
        </form>}
    </div>
}
