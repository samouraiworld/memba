/**
 * ReviewCard — renders a single on-chain review with actions.
 *
 * Controls:
 * - Like / Dislike (all users, authenticated)
 * - Reply (flat, one level — shows existing comments + reply form)
 * - Flag (all users, authenticated)
 * - Edit / Delete (author only)
 * - Hide / Unhide (MODERATOR only)
 */

import { useState, useCallback } from "react"
import DOMPurify from "dompurify"
import { renderMarkdown } from "../../lib/markdownLite"
import { useAdena } from "../../hooks/useAdena"
import { useBlockTime } from "../../hooks/useBlockTime"
import {
  type OnChainReview,
  type OnChainComment,
  fetchComments,
  buildReactMsg,
  buildCommentMsg,
  buildEditReviewMsg,
  buildDeleteReviewMsg,
  buildEditCommentMsg,
  buildDeleteCommentMsg,
  buildFlagMsg,
  buildHideReviewMsg,
  buildHideCommentMsg,
  buildUnhideMsg,
  submitMsg,
} from "../../lib/reviews"
import { StarRating } from "./StarRating"

// Moderator multisig address — Hide/Unhide controls gated to this address only.
const MODERATOR = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"

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
  address: string
  onRefetch: () => void
  realmPath?: string
}

function CommentRow({ comment, address, onRefetch, realmPath }: CommentRowProps) {
  const [editMode, setEditMode] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (comment.deleted) {
    return <p className="review-comment--deleted">[deleted]</p>
  }

  const authorLabel = comment.username || truncateAddr(comment.author)
  const isAuthor = address === comment.author
  const isModerator = address === MODERATOR

  async function handleAction(msg: ReturnType<typeof buildEditCommentMsg>, memo: string) {
    setBusy(true)
    setError(null)
    try {
      await submitMsg(msg, memo)
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
              disabled={busy || !editBody.trim()}
              onClick={() =>
                handleAction(buildEditCommentMsg(address, comment.id, editBody.trim(), realmPath), "edit comment")
              }
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button className="reviews-btn-secondary" onClick={() => setEditMode(false)}>
              Cancel
            </button>
          </div>
          {error && <p className="review-card__error">{error}</p>}
        </div>
      ) : (
        <div
          className="review-comment__body"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(comment.body || "")) }}
        />
      )}

      {!editMode && (
        <div className="review-comment__actions">
          {isAuthor && (
            <>
              <button
                className="review-card__action-btn"
                disabled={busy}
                onClick={() => { setEditBody(comment.body); setEditMode(true) }}
              >
                Edit
              </button>
              <button
                className="review-card__action-btn review-card__action-btn--danger"
                disabled={busy}
                onClick={() =>
                  handleAction(buildDeleteCommentMsg(address, comment.id, realmPath), "delete comment")
                }
              >
                Delete
              </button>
            </>
          )}
          {isModerator && (
            <button
              className="review-card__action-btn review-card__action-btn--hide"
              disabled={busy}
              onClick={() =>
                handleAction(buildHideCommentMsg(address, comment.id, realmPath), "hide comment")
              }
            >
              Hide
            </button>
          )}
          {error && <p className="review-card__error">{error}</p>}
        </div>
      )}
    </div>
  )
}

// ── ReviewCard ────────────────────────────────────────────────────────

interface ReviewCardProps {
  review: OnChainReview
  onRefetch: () => void
  realmPath?: string
}

export function ReviewCard({ review, onRefetch, realmPath }: ReviewCardProps) {
  const { address, connected } = useAdena()

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

  const isAuthor = connected && address === review.author
  const isModerator = connected && address === MODERATOR
  const authorLabel = review.username || truncateAddr(review.author)
  // Optimistic, not-yet-confirmed review (temp id < 0): show a "Posting…" chip and hide the
  // on-chain actions (they'd target an invalid id until the chain reflects the write).
  const pending = review.id < 0

  const loadComments = useCallback(async () => {
    setCommentsLoading(true)
    try {
      const items = await fetchComments(review.id, 0, 50, realmPath)
      setComments(items)
    } catch {
      // non-critical — show empty if comments fail to load
    } finally {
      setCommentsLoading(false)
    }
  }, [review.id, realmPath])

  async function toggleComments() {
    const next = !showComments
    setShowComments(next)
    if (next && comments.length === 0) {
      await loadComments()
    }
  }

  async function handleAction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msg: any,
    memo: string,
    afterSuccess?: () => void,
  ) {
    setBusy(true)
    setError(null)
    try {
      await submitMsg(msg, memo)
      afterSuccess?.()
      onRefetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function handleReply() {
    if (!replyBody.trim()) return
    await handleAction(
      buildCommentMsg(address, review.id, replyBody.trim(), realmPath),
      "post comment",
      () => { setReplyBody(""); setReplyOpen(false); loadComments() },
    )
  }

  async function handleEdit() {
    await handleAction(
      buildEditReviewMsg(address, review.id, editRating, editBody.trim(), realmPath),
      "edit review",
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
              <span className="review-card__username-badge">✓ verified</span>
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
              disabled={busy || editRating === 0}
              onClick={handleEdit}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button className="reviews-btn-secondary" onClick={() => setEditMode(false)}>
              Cancel
            </button>
          </div>
          {error && <p className="review-card__error">{error}</p>}
        </div>
      ) : (
        <div
          className="review-card__body"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(review.body || "")) }}
        />
      )}

      {/* Actions — hidden while the optimistic review is still pending confirmation. */}
      {!editMode && !pending && (
        <div className="review-card__actions">
          {/* Like */}
          <button
            className="review-card__action-btn review-card__action-btn--like"
            disabled={busy || !connected || isAuthor}
            onClick={() => handleAction(buildReactMsg(address, review.id, "like", realmPath), "like review")}
            aria-label={`Like — ${review.likes}`}
          >
            <span aria-hidden="true">👍</span> {review.likes}
          </button>

          {/* Dislike */}
          <button
            className="review-card__action-btn review-card__action-btn--dislike"
            disabled={busy || !connected || isAuthor}
            onClick={() => handleAction(buildReactMsg(address, review.id, "dislike", realmPath), "dislike review")}
            aria-label={`Dislike — ${review.dislikes}`}
          >
            <span aria-hidden="true">👎</span> {review.dislikes}
          </button>

          {/* Reply toggle */}
          <button
            className="review-card__action-btn"
            onClick={toggleComments}
            aria-expanded={showComments}
            aria-label="Reply"
          >
            <span aria-hidden="true">💬</span> Reply
          </button>

          {/* Flag */}
          {connected && !isAuthor && (
            <button
              className="review-card__action-btn review-card__action-btn--flag"
              disabled={busy}
              onClick={() => handleAction(buildFlagMsg(address, review.id, realmPath), "flag review")}
              aria-label="Flag for moderation"
            >
              <span aria-hidden="true">🚩</span> Flag
            </button>
          )}

          {/* Author controls */}
          {isAuthor && (
            <>
              <button
                className="review-card__action-btn review-card__action-btn--spacer"
                disabled={busy}
                onClick={() => { setEditRating(review.rating); setEditBody(review.body); setEditMode(true) }}
              >
                Edit
              </button>
              <button
                className="review-card__action-btn review-card__action-btn--danger"
                disabled={busy}
                onClick={() =>
                  handleAction(buildDeleteReviewMsg(address, review.id, realmPath), "delete review")
                }
              >
                Delete
              </button>
            </>
          )}

          {/* Moderator controls */}
          {isModerator && (
            <>
              <button
                className="review-card__action-btn review-card__action-btn--hide"
                disabled={busy}
                onClick={() =>
                  handleAction(buildHideReviewMsg(address, review.id, realmPath), "hide review")
                }
              >
                Hide
              </button>
              <button
                className="review-card__action-btn review-card__action-btn--hide"
                disabled={busy}
                onClick={() =>
                  handleAction(buildUnhideMsg(address, review.id, realmPath), "unhide review")
                }
              >
                Unhide
              </button>
            </>
          )}
        </div>
      )}

      {error && !editMode && <p className="review-card__error">{error}</p>}

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
              address={address}
              onRefetch={loadComments}
              realmPath={realmPath}
            />
          ))}

          {/* Reply form */}
          {connected ? (
            replyOpen ? (
              <div className="review-card__reply-form">
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Write a reply…"
                  rows={3}
                />
                <div className="review-card__reply-btns">
                  <button
                    className="reviews-btn-primary"
                    disabled={busy || !replyBody.trim()}
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
            )
          ) : (
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-k-muted)" }}>
              Connect wallet to reply.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
