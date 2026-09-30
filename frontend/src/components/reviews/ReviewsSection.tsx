/**
 * ReviewsSection — loads and renders reviews for a subject address.
 *
 * Props:
 *   subject: string         — the canonical address being reviewed (post target)
 *   aliasSubjects?: string[] — additional addresses to MERGE reads from (e.g. a valoper's
 *                              signing address, so reviews posted before it registered an
 *                              operator address still show). New reviews always post to
 *                              `subject` (the stable canonical identity).
 *   realmPath?: string       — which on-chain reviews realm to read/write. Defaults (undefined)
 *                              to the validator/profile web-of-trust realm; the App Store detail
 *                              page passes the reputation-isolated app-reviews realm path. Threaded
 *                              down to every ReviewCard so its actions hit the same realm.
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
  fetchSummary,
  attachUsernames,
  buildPostReviewMsg,
  submitMsg,
  mergeReviewsByAuthor,
  summaryFromReviews,
  makeOptimisticReview,
  upsertReviewByAuthor,
  type SubjectSummary,
} from "../../lib/reviews"
import { StarRating } from "./StarRating"
import { ReviewCard } from "./ReviewCard"
import { ReviewsModeration } from "./ModerationPolicy"
import "./reviews.css"

interface ReviewsSectionProps {
  subject: string
  aliasSubjects?: string[]
  realmPath?: string
  /**
   * Smallest number of reviews before the header shows a star average. Below it, the header
   * shows a neutral "New · N" chip instead — so a 1–2 review sample can't read as a confident
   * score. Defaults to 0 (never suppress), preserving the validator/profile display; the App
   * Store passes MIN_RATED_COUNT so the section matches its hero AppReviewStars.
   */
  minRatedCount?: number
  /** The dedicated App Store realm pages visible items after moderation. */
  paginate?: boolean
  /** Use the realm's all-review summary instead of the loaded page's subtotal. */
  useOnchainSummary?: boolean
  /** Hide classic wallet controls when a native surface handles its own writes. */
  readOnly?: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const REVIEW_PAGE_SIZE = 20

export function ReviewsSection({ subject, aliasSubjects, realmPath, minRatedCount = 0, paginate = false, useOnchainSummary = false, readOnly = false }: ReviewsSectionProps) {
  const { address, connected, connect } = useAdena()

  const [reviews, setReviews] = useState<OnChainReview[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chainSummary, setChainSummary] = useState<SubjectSummary | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const loadedPagesRef = useRef(1)

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
  // Unmount guard for the post-review reconcile loop: without it the loop keeps
  // sleeping+fetching for up to ~6s after the user navigates away (and leaks
  // fetches into whatever test runs next).
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Stable key so the effect/callbacks don't churn on array identity. The canonical subject
  // is first; aliases follow (deduped, self-excluded).
  const subjectsKey = useMemo(() => {
    const all = [subject, ...(aliasSubjects ?? [])].filter((s, i, a) => !!s && a.indexOf(s) === i)
    return all.join(",")
  }, [subject, aliasSubjects])

  const fetchMerged = useCallback(async () => {
    const subs = subjectsKey.split(",").filter(Boolean)
    if (paginate && subs.length === 1) {
      const pages = await Promise.all(Array.from({ length: loadedPagesRef.current }, (_, index) =>
        fetchReviews(subject, index * REVIEW_PAGE_SIZE, REVIEW_PAGE_SIZE, realmPath)))
      return { items: mergeReviewsByAuthor(pages, subject), more: pages.at(-1)?.length === REVIEW_PAGE_SIZE }
    }
    const lists = await Promise.all(subs.map((s) => fetchReviews(s, 0, REVIEW_PAGE_SIZE, realmPath)))
    return { items: mergeReviewsByAuthor(lists, subject), more: false }
  }, [subjectsKey, subject, realmPath, paginate])

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    setLoadError(null)
    try {
      const { items, more } = await fetchMerged()
      const [withNames, total] = await Promise.all([
        attachUsernames(items),
        useOnchainSummary ? fetchSummary(subject, realmPath).catch(() => null) : Promise.resolve(null),
      ])
      if (reqId !== reqIdRef.current) return // superseded by a newer load
      setHasMore(more)
      setChainSummary(total)
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
    } catch {
      if (reqId !== reqIdRef.current) return
      setLoadError("Reviews could not be loaded. Check your connection and try again.")
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [fetchMerged, realmPath, subject, useOnchainSummary])

  useEffect(() => {
    // Clear the previous subject's reviews immediately so they don't flash under the new
    // subject's loading state. Deliberate sync setState: this component runs a
    // hand-rolled optimistic pipeline (optimisticRef upserts, request-id
    // superseding, bounded chain-reconcile polling) that a query cache can't
    // express without redesigning the reconcile semantics — waived, not ported.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate clear-before-load in the optimistic pipeline
    setReviews([])
    setChainSummary(null)
    setHasMore(false)
    setLoadingMore(false)
    setLoadMoreError(null)
    loadedPagesRef.current = 1
    optimisticRef.current = null
    load()
  }, [load])

  const loadMore = useCallback(async () => {
    if (!paginate || !hasMore || loadingMore) return
    const reqId = reqIdRef.current
    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const page = await fetchReviews(subject, loadedPagesRef.current * REVIEW_PAGE_SIZE, REVIEW_PAGE_SIZE, realmPath)
      const withNames = await attachUsernames(page)
      if (reqId !== reqIdRef.current) return
      loadedPagesRef.current++
      setReviews((previous) => mergeReviewsByAuthor([previous, withNames], subject))
      setHasMore(page.length === REVIEW_PAGE_SIZE)
    } catch {
      if (reqId === reqIdRef.current) setLoadMoreError("Could not load more reviews. Please try again.")
    } finally {
      if (reqId === reqIdRef.current) setLoadingMore(false)
    }
  }, [paginate, hasMore, loadingMore, subject, realmPath])

  // Poll a few times after a post so the optimistic entry is swapped for the real one once
  // the chain reflects the write (bounded; load() clears optimisticRef when confirmed).
  const reconcileToChain = useCallback(async () => {
    for (let i = 0; i < 4 && optimisticRef.current && aliveRef.current; i++) {
      await sleep(1500)
      if (!aliveRef.current) return
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
      await submitMsg(buildPostReviewMsg(caller, subject, chosen, trimmed, realmPath), "post review")
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
  }, [subject, rating, body, reconcileToChain, realmPath])

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
  // This is a state machine synchronizing with an external system (the wallet):
  // the effect consumes the pending flag exactly once when the connection
  // lands. The sync setState IS the consume step — waived.
  useEffect(() => {
    if (pendingPost && connected && address) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- consume-once of the queued-post flag when the wallet connects
      setPendingPost(false)
      void postReview(address)
    }
  }, [pendingPost, connected, address, postReview])

  const visible = reviews.filter((r) => !r.deleted)
  const summary = useOnchainSummary && chainSummary ? chainSummary : summaryFromReviews(visible)
  const completeSummary = !useOnchainSummary || chainSummary !== null
  // Enough of a sample to show a star average? Below minRatedCount we show the count only.
  const rated = summary.count >= minRatedCount

  return (
    <section className="reviews-section" aria-label="Reviews">
      {/* Header */}
      <div className="reviews-section__header">
        <h2 className="reviews-section__title">Reviews</h2>
        {summary.count > 0 && (
          <div className="reviews-section__summary">
            {!completeSummary ? (
              <span className="reviews-section__count">{visible.length} shown</span>
            ) : rated ? (
              <>
                <StarRating value={Math.round(summary.average)} size="sm" />
                <span className="reviews-section__average">{summary.average.toFixed(1)}</span>
                <span className="reviews-section__count">
                  ({summary.count} review{summary.count !== 1 ? "s" : ""})
                </span>
              </>
            ) : (
              <>
                <span className="appreviewstars__new-chip">New</span>
                <span className="reviews-section__count">
                  · {summary.count} review{summary.count !== 1 ? "s" : ""}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Write form — always usable; the wallet is only triggered on "Post review". */}
      {!readOnly && <form className="reviews-section__form" onSubmit={handleSubmit} noValidate>
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
          Reviews are public chain transactions. You can remove a review from public view, but its chain history remains.
          {useOnchainSummary && " A wallet signature proves authorship, not that someone used the app."}
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
      </form>}

      {/* List — show stale content while revalidating (so a post's optimistic entry and
          the background reconcile loads don't flash skeletons over the list). */}
      <div className="reviews-section__list" aria-live="polite" aria-busy={loading || loadingMore}>
        {loading && visible.length === 0 && !loadError && (
          <div className="reviews-section__skeletons" data-testid="reviews-skeletons" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="review-card review-card--skeleton" />)}
          </div>
        )}

        {!loading && loadError && <div className="reviews-section__retry"><p className="reviews-section__error" role="alert">{loadError}</p><button type="button" className="reviews-btn-secondary" onClick={() => void load()}>Retry reviews</button></div>}

        {!loading && !loadError && visible.length === 0 && (
          <p className="reviews-section__empty">No reviews yet. Be the first!</p>
        )}

        {visible.length > 0 &&
          visible.map((r) => (
            <ReviewCard key={`${r.subject}:${r.id}`} review={r} onRefetch={load} realmPath={realmPath} readOnly={readOnly} />
          ))}
        {loadMoreError && <p className="reviews-section__error" role="alert">{loadMoreError}</p>}
        {paginate && hasMore && !loading && <button type="button" className="reviews-btn-secondary reviews-section__load-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more reviews"}</button>}
      </div>
      <ReviewsModeration realmPath={realmPath} />
    </section>
  )
}
