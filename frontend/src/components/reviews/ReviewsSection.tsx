/**
 * ReviewsSection — loads and renders reviews for a subject address.
 *
 * Props:
 *   subject: string  — the on-chain address being reviewed (e.g. a validator)
 *
 * Responsibilities:
 * - On mount: fetchSummary + fetchReviews → attachUsernames → render list
 * - Header: average (sum/count).toFixed(1) + count, honest empty state
 * - Write form: StarRating input + optional body, gated behind wallet connect
 * - Permanence notice near the form
 * - Loading + error states
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useAdena } from "../../hooks/useAdena"
import {
  type OnChainReview,
  type SubjectSummary,
  fetchReviews,
  fetchSummary,
  attachUsernames,
  buildPostReviewMsg,
  submitMsg,
} from "../../lib/reviews"
import { StarRating } from "./StarRating"
import { ReviewCard } from "./ReviewCard"
import "./reviews.css"

interface ReviewsSectionProps {
  subject: string
}

export function ReviewsSection({ subject }: ReviewsSectionProps) {
  const { address, connected, connect } = useAdena()

  const [reviews, setReviews] = useState<OnChainReview[]>([])
  const [summary, setSummary] = useState<SubjectSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [rating, setRating] = useState(0)
  const [body, setBody] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pendingPost, setPendingPost] = useState(false)
  const [connecting, setConnecting] = useState(false)
  // Synchronous re-entry guard: `disabled` is a render-cycle flag and can't stop a
  // fast double-click from firing two posts before React re-renders.
  const submittingRef = useRef(false)

  // Monotonic request id: a newer load() supersedes a slower in-flight one, so a stale
  // resolve (e.g. attachUsernames for a previous subject) can't overwrite the current view.
  const reqIdRef = useRef(0)

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    setLoadError(null)
    try {
      const [sum, raw] = await Promise.all([
        fetchSummary(subject),
        fetchReviews(subject),
      ])
      const withNames = await attachUsernames(raw)
      if (reqId !== reqIdRef.current) return // superseded by a newer load
      setSummary(sum)
      setReviews(withNames)
    } catch (err) {
      if (reqId !== reqIdRef.current) return
      setLoadError(err instanceof Error ? err.message : "Failed to load reviews.")
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [subject])

  useEffect(() => {
    // Clear the previous subject's reviews immediately so they don't flash under the
    // new subject's loading state.
    setReviews([])
    setSummary(null)
    load()
  }, [load])

  const postReview = useCallback(async (caller: string) => {
    if (submittingRef.current) return // synchronous guard against a double-fire
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      const msg = buildPostReviewMsg(caller, subject, rating, body.trim())
      await submitMsg(msg, "post review")
      setRating(0)
      setBody("")
      await load()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to post review. Please try again.")
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [subject, rating, body, load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (rating === 0 || connecting || submitting) return
    // Logged-out: the form is fully usable; "Post review" triggers the wallet. Once the
    // connection lands, the pending-post effect below fires the actual submit (one click).
    if (connected && address) { void postReview(address); return }
    setSubmitError(null)
    setConnecting(true)
    setPendingPost(true)
    const ok = await connect()
    setConnecting(false)
    if (!ok) {
      setPendingPost(false)
      setSubmitError("Connect your wallet to post your review.")
    }
  }

  // Fire a queued post once the wallet connection (address) becomes available.
  useEffect(() => {
    if (pendingPost && connected && address) {
      setPendingPost(false)
      void postReview(address)
    }
  }, [pendingPost, connected, address, postReview])

  const average = summary && summary.count > 0
    ? (summary.sum / summary.count).toFixed(1)
    : null

  return (
    <section className="reviews-section" aria-label="Reviews">
      {/* Header */}
      <div className="reviews-section__header">
        <h2 className="reviews-section__title">Reviews</h2>
        {summary && summary.count > 0 && average && (
          <div className="reviews-section__summary">
            <StarRating value={Math.round(summary.sum / summary.count)} size="sm" />
            <span className="reviews-section__average">{average}</span>
            <span className="reviews-section__count">
              ({summary.count} review{summary.count !== 1 ? "s" : ""})
            </span>
          </div>
        )}
      </div>

      {/* Write form — always usable; the wallet is only triggered on "Post review". */}
      <form className="reviews-section__form" onSubmit={handleSubmit} noValidate>
        <div>
          <span className="reviews-section__form-label" id="review-rating-label">Your rating</span>
          <StarRating value={rating} onChange={setRating} ariaLabelledBy="review-rating-label" />
        </div>
        <div>
          <label className="reviews-section__form-label" htmlFor="review-body">
            Review (optional)
          </label>
          <textarea
            id="review-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share your experience… (Markdown supported)"
            rows={4}
          />
        </div>
        <p className="reviews-section__permanence">
          Reviews are permanent on-chain; moderators can hide but not erase.
        </p>
        {submitError && (
          <p className="reviews-section__error" role="alert">{submitError}</p>
        )}
        <button
          type="submit"
          className="reviews-btn-primary"
          disabled={submitting || connecting || rating === 0}
        >
          {submitting ? "Posting…" : connecting ? "Connecting…" : !connected ? "Connect & post review" : "Post review"}
        </button>
      </form>

      {/* List */}
      <div className="reviews-section__list" aria-live="polite" aria-busy={loading}>
        {loading && (
          <div className="reviews-section__skeletons" data-testid="reviews-skeletons" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="review-card review-card--skeleton" />)}
          </div>
        )}

        {!loading && loadError && (
          <p className="reviews-section__error" role="alert">{loadError}</p>
        )}

        {!loading && !loadError && reviews.length === 0 && (
          <p className="reviews-section__empty">No reviews yet. Be the first!</p>
        )}

        {!loading && !loadError && reviews.length > 0 &&
          reviews.filter((r) => !r.deleted).map((r) => (
            <ReviewCard key={r.id} review={r} onRefetch={load} />
          ))}
      </div>
    </section>
  )
}
