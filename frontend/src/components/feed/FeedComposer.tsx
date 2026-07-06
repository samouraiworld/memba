/**
 * FeedComposer — the post/reply input, shared by the home timeline (replyTo=0)
 * and the thread view (replyTo=parent id). Broadcasts CreatePost to the realm
 * via the ordinary Adena flow and hands the parent a synthetic optimistic row
 * so the UI updates before the indexer catches up.
 *
 * @module components/feed/FeedComposer
 */

import { useCallback, useRef, useState } from "react"
import { PaperPlaneTilt } from "@phosphor-icons/react"
import { buildCreatePostMsg, submitFeedMsg } from "../../lib/feed"
import { makeOptimisticPost, type UiPost } from "../../lib/feedTypes"
import { MAX_FEED_BODY } from "../../lib/feedConstants"

export function FeedComposer({
    connected,
    address,
    onConnect,
    onPosted,
    replyTo = 0n,
    placeholder = "Share something with the community…",
    submitLabel = "Post",
}: {
    connected: boolean
    address: string | undefined
    onConnect: () => void
    onPosted: (post: UiPost) => void
    /** 0 for a top-level post; the parent id for a reply. */
    replyTo?: bigint
    placeholder?: string
    submitLabel?: string
}) {
    const [body, setBody] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // Monotonic nonce for optimistic ids (Date.now() is unavailable in some
    // environments and can collide on rapid posts).
    const nonce = useRef(0)

    const trimmed = body.trim()
    const overLimit = trimmed.length > MAX_FEED_BODY

    const submit = useCallback(async () => {
        if (!connected || !address) {
            onConnect()
            return
        }
        if (!trimmed || overLimit) return
        setSubmitting(true)
        setError(null)
        try {
            const replyToNum = Number(replyTo)
            await submitFeedMsg(
                buildCreatePostMsg(address, trimmed, replyToNum),
                replyTo === 0n ? "feed post" : "feed reply",
            )
            onPosted(makeOptimisticPost(address, trimmed, replyTo, nonce.current++))
            setBody("")
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (/reject|cancel|denied/i.test(msg)) {
                // A user rejection in the wallet is not worth shouting about.
            } else if (/too fast|characters|deleted|hidden|paused|reply/i.test(msg)) {
                // Surface the realm's actionable panic (e.g. "posting too fast").
                setError(msg.replace(/^.*?panic:\s*/i, "").trim() || "Could not post.")
            } else {
                setError("Could not post. Please try again.")
            }
        } finally {
            setSubmitting(false)
        }
    }, [connected, address, trimmed, overLimit, onConnect, onPosted, replyTo])

    if (!connected) {
        return (
            <div className="feed-composer feed-composer--cta">
                <p>Connect your wallet to post to the feed.</p>
                <button type="button" className="feed-btn feed-btn--primary" onClick={onConnect}>
                    Connect wallet
                </button>
            </div>
        )
    }

    return (
        <div className="feed-composer">
            <textarea
                className="feed-composer__input"
                placeholder={placeholder}
                value={body}
                maxLength={MAX_FEED_BODY + 100 /* allow paste, then show over-limit */}
                rows={replyTo === 0n ? 3 : 2}
                onChange={(e) => setBody(e.target.value)}
                data-testid="feed-composer-input"
            />
            <div className="feed-composer__row">
                <span className={"feed-composer__count" + (overLimit ? " over" : "")}>
                    {trimmed.length}/{MAX_FEED_BODY}
                </span>
                <button
                    type="button"
                    className="feed-btn feed-btn--primary"
                    disabled={submitting || !trimmed || overLimit}
                    onClick={submit}
                    data-testid="feed-post-btn"
                >
                    <PaperPlaneTilt size={16} weight="fill" />
                    {submitting ? "Posting…" : submitLabel}
                </button>
            </div>
            {error && <p className="feed-composer__error">{error}</p>}
        </div>
    )
}
