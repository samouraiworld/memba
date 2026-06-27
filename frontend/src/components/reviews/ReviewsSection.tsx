/**
 * ReviewsSection — loads and renders reviews for a subject address.
 *
 * Props:
 *   subject: string         — the canonical address being reviewed (post target)
 *   aliasSubjects?: string[] — additional addresses to MERGE reads from (e.g. a valoper's
 *                              signing address, so reviews posted before it registered an
 *                              operator address still show). New reviews always post to
 *                              `subject` (the stable canonical identity).
 *
 * Responsibilities:
 * - On mount: fetch reviews for subject + aliases → merge/dedupe by author → attach
 *   usernames → render list; summary is computed client-side from the merged set.
 * - Write form: StarRating + optional body, always visible; wallet triggered on submit.
 * - Optimistic insert on post (covers read-after-write lag), reconciled against chain.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useAdena } from "../../hooks/useAdena"
import {
  type OnChainReview,
  fetchReviews,
  attachUsernames,
  buildPostReviewMsg,
  submitMsg,
  mergeReviewsByAuthor,
  summaryFromReviews,
  makeOptimisticReview,
  upsertReviewByAuthor,
} from "../../lib/reviews"
import { StarRating } from "./StarRating"
import { ReviewCard } from "./ReviewCard"
import "./reviews.css"

interface ReviewsSectionProps {
  subject: string
  aliasSubjects?: string[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function ReviewsSection({ subject, aliasSubjects }: ReviewsSectionProps) {
  const { address, connected, connect } = useAdena()

  const [reviews, setReviews] = useState<OnChainReview[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [rating, setRating] = useState(0)
  const [body, setBody] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pendingPost, setPendingPost] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const submittingRef = useRef(false)
  const reqIdRef = useRef(0)
  // An optimistically-inserted review awaiting on-chain confirmation; load() keeps showing
  // it until the chain reflects it (read-after-write lag), then clears it.
  const optimisticRef = useRef<OnChainReview | null>(null)

  // Stable key so the effect/callbacks don't churn on array identity. The canonical subject
  // is first; aliases follow (deduped, self-excluded).
  const subjectsKey = useMemo(() => {
    const all = [subject, ...(aliasSubjects ?? [])].filter((s, i, a) => !!s && a.indexOf(s) === i)
    return all.join(",")
  }, [subject, aliasSubjects])

  const fetchMerged = useCallback(async () => {
    const subs = subjectsKey.split(",").filter(Boolean)
    const lists = await Promise.all(subs.map((s) => fetchReviews(s)))
    return mergeReviewsByAuthor(lists, subject)
  }, [subjectsKey, subject])

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    setLoadError(null)
    try {
      const merged = await fetchMerged()
      const withNames = await attachUsernames(merged)
      if (reqId !== reqIdRef.current) return // superseded by a newer load
      // If a just-posted review is still pending, keep showing it until the chain confirms.
      const opt = optimisticRef.current
      if (opt) {
        if (withNames.some((r) => r.author === opt.author && r.createdAt > 0)) {
          optimisticRef.current = null // chain caught up
          setReviews(withNames)
        } else {
          setReviews(upsertReviewByAuthor(withNames, opt))
        }
      } else {
        setReviews(withNames)
      }
    } catch (err) {
      if (reqId !== reqIdRef.current) return
      setLoadError(err instanceof Error ? err.message : "Failed to load reviews.")
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [fetchMerged])

  useEffect(() => {
    // Clear the previous subject's reviews immediately so they don't flash under the new
    // subject's loading state.
    setReviews([])
    optimisticRef.current = null
    load()
  }, [load])

  // Poll a few times after a post so the optimistic entry is swapped for the real one once
  // the chain reflects the write (bounded; load() clears optimisticRef when confirmed).
  const reconcileToChain = useCallback(async () => {
    for (let i = 0; i < 4 && optimisticRef.current; i++) {
      await sleep(1500)
      await load()
    }
  }, [load])

  const postReview = useCallback(async (caller: string) => {
    if (submittingRef.current) return // synchronous guard against a double-fire
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    const trimmed = body.trim()
    const chosen = rating
    try {
      await submitMsg(buildPostReviewMsg(caller, subject, chosen, trimmed), "post review")
      // Optimistic: show it immediately (the realm edits an author's existing review on
      // re-post, so upsert-by-author matches that), then reconcile against the chain.
      const opt = makeOptimisticReview(caller, chosen, trimmed, subject)
      optimisticRef.current = opt
      setReviews((prev) => upsertReviewByAuthor(prev, opt))
      setRating(0)
      setBody("")
      void reconcileToChain()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to post review. Please try again.")
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [subject, rating, body, reconcileToChain])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (rating === 0 || connecting || submitting) return
    // Logged-out: the form is fully usable; "Post review" triggers the wallet. Once the
    // connection lands, the pending-post effect below fires the actual submit (one click).
    if (connected && address) { void postReview(address); return }
    setSubmitError(null)
    setConnecting(true)
    setPendingPost(true)
    try {
      const ok = await connect()
      if (!ok) {
        setPendingPost(false)
        setSubmitError("Connect your wallet to post your review.")
      }
    } finally {
      // Always clear `connecting` so the button can never get stuck disabled if connect
      // resolves oddly or throws.
      setConnecting(false)
    }
  }

  // Fire a queued post once the wallet connection (address) becomes available.
  useEffect(() => {
    if (pendingPost && connected && address) {
      setPendingPost(false)
      void postReview(address)
    }
  }, [pendingPost, connected, address, postReview])

  const visible = reviews.filter((r) => !r.deleted)
  const summary = summaryFromReviews(visible)
  const average = summary.count > 0 ? summary.average.toFixed(1) : null

  return (
    <section className="reviews-section" aria-label="Reviews">
      {/* Header */}
      <div className="reviews-section__header">
        <h2 className="reviews-section__title">Reviews</h2>
        {summary.count > 0 && average && (
          <div className="reviews-section__summary">
            <StarRating value={Math.round(summary.average)} size="sm" />
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
        <div className="reviews-section__submit-row">
          <button
            type="submit"
            className="reviews-btn-primary"
            disabled={submitting || connecting || rating === 0}
          >
            {submitting ? "Posting…" : connecting ? "Connecting…" : !connected ? "Connect & post review" : "Post review"}
          </button>
          {rating === 0 && (
            <span className="reviews-section__hint" data-testid="reviews-rating-hint">
              Select a rating to post.
            </span>
          )}
        </div>
      </form>

      {/* List — show stale content while revalidating (so a post's optimistic entry and
          the background reconcile loads don't flash skeletons over the list). */}
      <div className="reviews-section__list" aria-live="polite" aria-busy={loading}>
        {loading && visible.length === 0 && !loadError && (
          <div className="reviews-section__skeletons" data-testid="reviews-skeletons" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="review-card review-card--skeleton" />)}
          </div>
        )}

        {!loading && loadError && (
          <p className="reviews-section__error" role="alert">{loadError}</p>
        )}

        {!loading && !loadError && visible.length === 0 && (
          <p className="reviews-section__empty">No reviews yet. Be the first!</p>
        )}

        {visible.length > 0 &&
          visible.map((r) => (
            <ReviewCard key={`${r.subject}:${r.id}`} review={r} onRefetch={load} />
          ))}
      </div>
    </section>
  )
}
