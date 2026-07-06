/**
 * PostCard — one feed post, shared by the home timeline, thread view, and
 * profile timeline. Renders author (→ profile), body (escaped plain text —
 * zero XSS over the realm's raw body), block/edited meta, a reply count that
 * opens the thread, and a flag action.
 *
 * Navigation is passed in (onOpenThread / onOpenProfile) so the card stays
 * presentational and the pages own routing. In a thread's own root/reply
 * context the card is not clickable-into-itself (clickable=false).
 *
 * @module components/feed/PostCard
 */

import { useCallback, useState } from "react"
import { Flag, ChatCircle } from "@phosphor-icons/react"
import { submitFeedMsg, buildFlagPostMsg } from "../../lib/feed"
import type { UiPost } from "../../lib/feedTypes"
import { relativeTime } from "../../lib/relativeTime"

/** Short display form of a bech32 address, e.g. g1abcd…wxyz. */
function shortAddr(a: string): string {
    return a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a
}

export function PostCard({
    post,
    connected,
    selfAddress,
    onRefetch,
    onOpenThread,
    onOpenProfile,
    clickable = true,
}: {
    post: UiPost
    connected: boolean
    selfAddress: string | undefined
    onRefetch: () => void
    /** Open this post's thread. Omit / clickable=false to disable (e.g. the thread root). */
    onOpenThread?: (id: bigint) => void
    /** Open an author's profile timeline. */
    onOpenProfile?: (address: string) => void
    clickable?: boolean
}) {
    const [flagging, setFlagging] = useState(false)
    const [flagged, setFlagged] = useState(false)
    const isOwn = selfAddress === post.author
    const canOpen = clickable && !post.optimistic && !!onOpenThread

    const flag = useCallback(async () => {
        if (!connected || !selfAddress || post.optimistic) return
        setFlagging(true)
        try {
            await submitFeedMsg(buildFlagPostMsg(selfAddress, post.id), "flag post")
            setFlagged(true)
            onRefetch()
        } catch {
            // swallow — a rejected/failed flag simply leaves the post unflagged
        } finally {
            setFlagging(false)
        }
    }, [connected, selfAddress, post.id, post.optimistic, onRefetch])

    const openThread = () => canOpen && onOpenThread!(post.id)

    return (
        <article className={"feed-post" + (post.optimistic ? " feed-post--pending" : "")}>
            <div className="feed-post__head">
                <button
                    type="button"
                    className="feed-post__author"
                    onClick={() => onOpenProfile?.(post.author)}
                    disabled={!onOpenProfile || post.optimistic}
                    title={onOpenProfile ? "View profile" : post.author}
                    data-testid="feed-post-author"
                >
                    {shortAddr(post.author)}
                </button>
                <span
                    className="feed-post__meta"
                    title={post.optimistic ? undefined : `block ${post.blockH.toString()}`}
                >
                    {post.optimistic
                        ? "posting…"
                        : relativeTime(post.blockTs, Date.now()) || `block ${post.blockH.toString()}`}
                    {post.editedAt > 0n && !post.optimistic && " · edited"}
                </span>
            </div>

            {/* Body opens the thread when clickable; a keyboard-reachable button
                keeps it accessible without nesting interactive controls badly. */}
            {canOpen ? (
                <button type="button" className="feed-post__body feed-post__body--link" onClick={openThread}>
                    {post.body}
                </button>
            ) : (
                <div className="feed-post__body">{post.body}</div>
            )}

            <div className="feed-post__actions">
                <button
                    type="button"
                    className="feed-post__stat feed-post__stat--btn"
                    onClick={openThread}
                    disabled={!canOpen}
                    title={canOpen ? "View thread" : undefined}
                    data-testid="feed-replies-btn"
                >
                    <ChatCircle size={15} /> {post.replyCount}
                </button>
                {connected && !isOwn && !post.optimistic && (
                    <button
                        type="button"
                        className="feed-post__flag"
                        disabled={flagging || flagged}
                        onClick={flag}
                        title={flagged ? "Flagged" : "Flag this post"}
                        data-testid="feed-flag-btn"
                    >
                        <Flag size={15} weight={flagged ? "fill" : "regular"} />
                        {flagged ? "Flagged" : "Flag"}
                    </button>
                )}
            </div>
        </article>
    )
}
