/**
 * FeedComposer — the post/reply input, shared by the home timeline (replyTo=0)
 * and the thread view (replyTo=parent id).
 *
 * Read-freely / connect-on-action: the input is ALWAYS shown, even to a
 * disconnected visitor. Clicking Post triggers the wallet connect, and the post
 * is sent automatically once connected — one action, not "connect, then post".
 *
 * @module components/feed/FeedComposer
 */

import { useCallback, useEffect, useRef, useState } from "react"
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
    /** Opens the wallet. Returns whether the connection succeeded (when known). */
    onConnect: () => void | Promise<boolean>
    onPosted: (post: UiPost) => void
    /** 0 for a top-level post; the parent id for a reply. */
    replyTo?: bigint
    placeholder?: string
    submitLabel?: string
}) {
    const [body, setBody] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // Set when a disconnected user clicked Post: the broadcast fires as soon as
    // the wallet connects (see the effect below).
    const [pending, setPending] = useState(false)
    // Monotonic nonce for optimistic ids (Date.now() is unavailable in some
    // environments and can collide on rapid posts).
    const nonce = useRef(0)

    const trimmed = body.trim()
    const overLimit = trimmed.length > MAX_FEED_BODY

    const broadcast = useCallback(async (from: string, text: string) => {
        setSubmitting(true)
        setError(null)
        try {
            await submitFeedMsg(
                buildCreatePostMsg(from, text, replyTo), // bigint threaded through — no precision loss
                replyTo === 0n ? "feed post" : "feed reply",
            )
            onPosted(makeOptimisticPost(from, text, replyTo, nonce.current++))
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
    }, [replyTo, onPosted])

    const submit = useCallback(async () => {
        if (!trimmed || overLimit) return
        if (!connected || !address) {
            // Connect on the action itself; the post fires from the effect once
            // the wallet is connected (props flow in on the next render).
            const ok = await onConnect()
            if (ok !== false) setPending(true)
            return
        }
        await broadcast(address, trimmed)
    }, [connected, address, trimmed, overLimit, onConnect, broadcast])

    // Fire the pending post the moment the wallet finishes connecting.
    useEffect(() => {
        if (pending && connected && address && trimmed && !overLimit) {
            setPending(false)
            void broadcast(address, trimmed)
        }
    }, [pending, connected, address, trimmed, overLimit, broadcast])

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
                    disabled={submitting || pending || !trimmed || overLimit}
                    onClick={submit}
                    data-testid="feed-post-btn"
                >
                    <PaperPlaneTilt size={16} weight="fill" />
                    {submitting || pending ? "Posting…" : !connected ? `Connect & ${submitLabel.toLowerCase()}` : submitLabel}
                </button>
            </div>
            {!connected && (
                <p className="feed-composer__hint">You can read the feed freely — connect only when you post.</p>
            )}
            {error && <p className="feed-composer__error">{error}</p>}
            <p className="feed-composer__note">
                Posts are public and permanent on-chain. Deleting removes a post
                from Memba, but the original text stays recorded on gno.land.
            </p>
        </div>
    )
}
