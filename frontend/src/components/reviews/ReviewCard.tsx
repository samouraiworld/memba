/**
 * ReviewCard — renders a single on-chain review with actions.
 *
 * Controls:
 * - Like / Dislike (all users, authenticated)
 * - Reply (flat, one level — shows existing comments + reply form)
 * - Flag (all users, authenticated)
 * - Edit / Delete (author only)
 *
 * Hiding is not done here: the moderator acts by a transaction of its own.
 * ModerationPolicy states what the product knows of its rules.
 */

import { useState, useCallback } from "react"
import { sanitizeMarkdownHtml } from "../../lib/sanitizeMarkdownHtml"
import { renderMarkdown } from "../../lib/markdownLite"
import { useBlockTime } from "../../hooks/useBlockTime"
import {
  type OnChainReview,
  type OnChainComment,
  type ReviewAction,
  fetchComments,
  REPLY_BODY_MAX_BYTES,
  REVIEW_BODY_MAX_BYTES,
} from "../../lib/reviews"
import { StarRating } from "./StarRating"

/**
 * Carries out an action for the viewer: the classic page signs it in the wallet, Memba OS
 * reviews it in its signing sheet first. Resolves false when nothing was sent (a review
 * that was cancelled), and throws with the message to show.
 */
export type ReviewAct = (action: ReviewAction) => Promise<boolean>

const bytes = (text: string) => new TextEncoder().encode(text).length

function truncateAddr(addr: string): string {
  if (addr.length <= 16) return addr
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}

/**
 * ReviewDate — render an on-chain block height as a real date.
 *
 * The reviews realm stores createdAt/editedAt as a BLOCK HEIGHT, not a Unix timestamp,
 * so we resolve the block's wall-clock time via useBlockTime. While resolving we show a
 * neutral "·"; if resolution fails we fall back to "block #N". The block height is always
 * available as a title tooltip for provenance.
 */
function ReviewDate({ height, className }: { height: number; className?: string }) {
  const { ms, loading } = useBlockTime(height)
  if (!height) return null
  const title = `block #${height}`
  if (loading) return <span className={className} title={title} aria-hidden="true">·</span>
  if (ms == null) return <span className={className} title={title}>block #{height}</span>
  const text = new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
  return <span className={className} title={title}>{text}</span>
}

// ── CommentRow ────────────────────────────────────────────────────────

interface CommentRowProps {
  comment: OnChainComment
  viewer: string | null
  act: ReviewAct
  onRefetch: () => void
}

function CommentRow({ comment, viewer, act, onRefetch }: CommentRowProps) {
  const [editMode, setEditMode] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (comment.deleted) {
    return <p className="review-comment--deleted">[deleted]</p>
  }

  const authorLabel = truncateAddr(comment.author)
  const isAuthor = viewer === comment.author
  const editTooLong = bytes(editBody.trim()) > REPLY_BODY_MAX_BYTES

  // Busy controls stay focusable (aria-disabled): a disabled one drops the focus a signing sheet hands back.
  async function handleAction(action: ReviewAction) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (!await act(action)) return
      setEditMode(false)
      onRefetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="review-comment">
      <div className="review-comment__author-row">
        <span className="review-comment__author">{authorLabel}</span>
        {comment.username && (
          <span className="review-card__username-badge">{comment.username}</span>
        )}
        <ReviewDate height={comment.createdAt} className="review-comment__date" />
        {comment.editedAt > 0 && (
          <span className="review-comment__edited">(edited)</span>
        )}
      </div>

      {editMode ? (
        <div className="review-card__edit-form">
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={3}
          />
          <div className="review-card__edit-btns">
            <button
              className="reviews-btn-primary"
              aria-disabled={busy}
              disabled={!editBody.trim() || editTooLong}
              onClick={() => handleAction({ kind: "editReply", reply: comment.id, body: editBody.trim(), was: comment.body })}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button className="reviews-btn-secondary" onClick={() => setEditMode(false)}>
              Cancel
            </button>
          </div>
          {editTooLong && <p className="review-card__error" role="alert">A reply is limited to {REPLY_BODY_MAX_BYTES.toLocaleString("en-US")} bytes.</p>}
          {error && <p className="review-card__error" role="alert">{error}</p>}
        </div>
      ) : (
        <div
          className="review-comment__body"
          dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(renderMarkdown(comment.body || "")) }}
        />
      )}

      {!editMode && (
        <div className="review-comment__actions">
          {isAuthor && (
            <>
              <button
                className="review-card__action-btn"
                aria-disabled={busy}
                onClick={() => { if (!busy) { setEditBody(comment.body); setEditMode(true) } }}
              >
                Edit
              </button>
              <button
                className="review-card__action-btn review-card__action-btn--danger"
                aria-disabled={busy}
                onClick={() => handleAction({ kind: "deleteReply", reply: comment.id })}
              >
                Delete
              </button>
            </>
          )}
          {error && <p className="review-card__error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}

// ── ReviewCard ────────────────────────────────────────────────────────

interface ReviewCardProps {
  review: OnChainReview
  onRefetch: () => void
  /** The connected wallet's address, or null for a visitor. */
  viewer: string | null
  act: ReviewAct
  /** Word labels instead of emoji on the actions (Memba OS). */
  plain?: boolean
}

export function ReviewCard({ review, onRefetch, viewer, act, plain = false }: ReviewCardProps) {
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState<OnChainComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyBody, setReplyBody] = useState("")
  const [editMode, setEditMode] = useState(false)
  const [editRating, setEditRating] = useState(review.rating)
  const [editBody, setEditBody] = useState(review.body)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isAuthor = viewer === review.author
  const replyTooLong = bytes(replyBody.trim()) > REPLY_BODY_MAX_BYTES
  const editTooLong = bytes(editBody.trim()) > REVIEW_BODY_MAX_BYTES
  const authorLabel = truncateAddr(review.author)
  // Optimistic, not-yet-confirmed review (temp id < 0): show a "Posting…" chip and hide the
  // on-chain actions (they'd target an invalid id until the chain reflects the write).
  const pending = review.id < 0

  const loadComments = useCallback(async () => {
    setCommentsLoading(true)
    try {
      const items = await fetchComments(review.id, 0, 50)
      setComments(items)
    } catch {
      // non-critical — show empty if comments fail to load
    } finally {
      setCommentsLoading(false)
    }
  }, [review.id])

  async function toggleComments() {
    const next = !showComments
    setShowComments(next)
    if (next && comments.length === 0) {
      await loadComments()
    }
  }

  async function handleAction(action: ReviewAction, afterSuccess?: () => void) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (!await act(action)) return
      afterSuccess?.()
      onRefetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function handleReply() {
    if (!replyBody.trim() || replyTooLong) return
    await handleAction(
      { kind: "reply", review: review.id, body: replyBody.trim() },
      () => { setReplyBody(""); setReplyOpen(false); loadComments() },
    )
  }

  async function handleEdit() {
    await handleAction(
      { kind: "editReview", review: review.id, rating: editRating, body: editBody.trim(), was: review.body },
      () => setEditMode(false),
    )
  }

  return (
    <div className="review-card">
      {/* Header */}
      <div className="review-card__header">
        <div>
          <div className="review-card__author-row">
            <span className="review-card__author">{authorLabel}</span>
            {review.username && (
              <span className="review-card__username-badge">{review.username}</span>
            )}
            <span
              className={`review-card__rep-chip${review.reputation > 0 ? " review-card__rep-chip--positive" : review.reputation < 0 ? " review-card__rep-chip--negative" : ""}`}
            >
              rep {review.reputation > 0 ? `+${review.reputation}` : review.reputation}
            </span>
          </div>
          <StarRating value={review.rating} size="sm" />
        </div>
        <div style={{ textAlign: "right" }}>
          {pending ? (
            <span className="review-card__pending" data-testid="review-pending">Posting…</span>
          ) : (
            <>
              <ReviewDate height={review.createdAt} className="review-card__date" />
              {review.editedAt > 0 && (
                <span className="review-card__edited"> (edited)</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Body */}
      {editMode ? (
        <div className="review-card__edit-form">
          <div>
            <span className="reviews-section__form-label">Rating</span>
            <StarRating value={editRating} onChange={setEditRating} />
          </div>
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={4}
            placeholder="Update your review…"
          />
          <div className="review-card__edit-btns">
            <button
              className="reviews-btn-primary"
              aria-disabled={busy}
              disabled={editRating === 0 || editTooLong}
              onClick={handleEdit}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button className="reviews-btn-secondary" onClick={() => setEditMode(false)}>
              Cancel
            </button>
          </div>
          {editTooLong && <p className="review-card__error" role="alert">A review is limited to {REVIEW_BODY_MAX_BYTES.toLocaleString("en-US")} bytes.</p>}
          {error && <p className="review-card__error" role="alert">{error}</p>}
        </div>
      ) : (
        <div
          className="review-card__body"
          dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(renderMarkdown(review.body || "")) }}
        />
      )}

      {/* Actions — hidden while the optimistic review is still pending confirmation. */}
      {!editMode && !pending && (
        <div className="review-card__actions">
          {/* Like */}
          <button
            className="review-card__action-btn review-card__action-btn--like"
            aria-disabled={busy}
            disabled={isAuthor}
            onClick={() => handleAction({ kind: "react", target: review.id, on: "review", reaction: "like" })}
            aria-label={`Like — ${review.likes}`}
          >
            {plain ? "Like" : <span aria-hidden="true">👍</span>} {review.likes}
          </button>

          {/* Dislike */}
          <button
            className="review-card__action-btn review-card__action-btn--dislike"
            aria-disabled={busy}
            disabled={isAuthor}
            onClick={() => handleAction({ kind: "react", target: review.id, on: "review", reaction: "dislike" })}
            aria-label={`Dislike — ${review.dislikes}`}
          >
            {plain ? "Dislike" : <span aria-hidden="true">👎</span>} {review.dislikes}
          </button>

          {/* Reply toggle */}
          <button
            className="review-card__action-btn"
            onClick={toggleComments}
            aria-expanded={showComments}
            aria-label="Reply"
          >
            {!plain && <span aria-hidden="true">💬</span>} Reply
          </button>

          {/* Flag — a visitor sees it too: pressing it asks for the wallet. */}
          {!isAuthor && (
            <button
              className="review-card__action-btn review-card__action-btn--flag"
              aria-disabled={busy}
              onClick={() => handleAction({ kind: "flag", target: review.id, on: "review" })}
              aria-label="Flag for moderation"
            >
              {!plain && <span aria-hidden="true">🚩</span>} Flag
            </button>
          )}

          {/* Author controls */}
          {isAuthor && (
            <>
              <button
                className="review-card__action-btn review-card__action-btn--spacer"
                aria-disabled={busy}
                onClick={() => { if (!busy) { setEditRating(review.rating); setEditBody(review.body); setEditMode(true) } }}
              >
                Edit
              </button>
              <button
                className="review-card__action-btn review-card__action-btn--danger"
                aria-disabled={busy}
                onClick={() => handleAction({ kind: "deleteReview", review: review.id })}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {error && !editMode && <p className="review-card__error" role="alert">{error}</p>}

      {/* Comments section */}
      {showComments && (
        <div className="review-card__comments">
          {commentsLoading && (
            <p className="reviews-section__loading">Loading comments…</p>
          )}
          {!commentsLoading && comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              viewer={viewer}
              act={act}
              onRefetch={loadComments}
            />
          ))}
          {!commentsLoading && comments.length === 0 && <p className="reviews-section__empty">No replies yet.</p>}

          {/* Reply form — open to a visitor too: posting asks for the wallet. */}
          {replyOpen ? (
            <div className="review-card__reply-form">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Write a reply…"
                rows={3}
              />
              {replyTooLong && <p className="review-card__error" role="alert">A reply is limited to {REPLY_BODY_MAX_BYTES.toLocaleString("en-US")} bytes.</p>}
              <div className="review-card__reply-btns">
                <button
                  className="reviews-btn-primary"
                  aria-disabled={busy}
                  disabled={!replyBody.trim() || replyTooLong}
                  onClick={handleReply}
                >
                  {busy ? "Posting…" : "Post reply"}
                </button>
                <button
                  className="reviews-btn-secondary"
                  onClick={() => { setReplyOpen(false); setReplyBody("") }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="reviews-btn-secondary"
              onClick={() => setReplyOpen(true)}
            >
              + Add reply
            </button>
          )}
        </div>
      )}
    </div>
  )
}
