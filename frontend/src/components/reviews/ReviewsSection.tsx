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

import { useState, useEffect, useCallback } from "react"
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

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [sum, raw] = await Promise.all([
        fetchSummary(subject),
        fetchReviews(subject),
      ])
      const withNames = await attachUsernames(raw)
      setSummary(sum)
      setReviews(withNames)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load reviews.")
    } finally {
      setLoading(false)
    }
  }, [subject])

  useEffect(() => { load() }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (rating === 0 || !connected || !address) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const msg = buildPostReviewMsg(address, subject, rating, body.trim())
      await submitMsg(msg, "post review")
      setRating(0)
      setBody("")
      await load()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to post review. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

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

      {/* Write form */}
      {connected ? (
        <form className="reviews-section__form" onSubmit={handleSubmit} noValidate>
          <div>
            <span className="reviews-section__form-label">Your rating</span>
            <StarRating value={rating} onChange={setRating} />
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
            <p className="reviews-section__error">{submitError}</p>
          )}
          <button
            type="submit"
            className="reviews-btn-primary"
            disabled={submitting || rating === 0}
          >
            {submitting ? "Posting…" : "Post review"}
          </button>
        </form>
      ) : (
        <div className="reviews-section__connect-prompt">
          <p>Connect your wallet to leave a review.</p>
          <button
            type="button"
            className="reviews-btn-connect"
            onClick={() => connect()}
          >
            Connect wallet to review
          </button>
          <p className="reviews-section__permanence" style={{ marginTop: 4 }}>
            Reviews are permanent on-chain; moderators can hide but not erase.
          </p>
        </div>
      )}

      {/* List */}
      {loading && (
        <p className="reviews-section__loading">Loading reviews…</p>
      )}

      {!loading && loadError && (
        <p className="reviews-section__error">{loadError}</p>
      )}

      {!loading && !loadError && reviews.length === 0 && (
        <p className="reviews-section__empty">No reviews yet. Be the first!</p>
      )}

      {!loading && !loadError && reviews.length > 0 && (
        <div className="reviews-section__list">
          {reviews.filter((r) => !r.deleted).map((r) => (
            <ReviewCard key={r.id} review={r} onRefetch={load} />
          ))}
        </div>
      )}
    </section>
  )
}
