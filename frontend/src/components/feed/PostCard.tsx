/**
 * PostCard — one feed post, shared by the home timeline, thread view, and
 * profile timeline. Renders a deterministic identity tile + name (→ profile),
 * body (escaped plain text — zero XSS over the realm's raw body), a relative
 * timestamp (block height in the tooltip), a reply count that opens the thread,
 * a flag action, and — for the author's own post — a manage menu (edit / delete).
 *
 * A11y: the whole card is opened via a single overlay button (aria-label "Open
 * thread") that sits UNDER the real controls (author / reply / flag / manage,
 * which are z-indexed above it). The body is plain text — never a button labeled
 * with the whole paragraph. In a thread's own root/reply context the card is not
 * clickable-into-itself (clickable=false).
 *
 * @module components/feed/PostCard
 */

import { memo, useCallback, useMemo, useRef, useState } from "react"
import { Flag, ChatCircle, DotsThreeVertical, PencilSimple, Trash, LinkSimple, Check } from "@phosphor-icons/react"
import { submitFeedMsg, buildFlagPostMsg, buildEditPostMsg, buildDeletePostMsg } from "../../lib/feed"
import { feedPostPermalink } from "../../lib/feedPermalink"
import type { UiPost } from "../../lib/feedTypes"
import { relativeTime } from "../../lib/relativeTime"
import { useNow } from "../../hooks/home/useNow"
import { useDismissable } from "../../hooks/useDismissable"
import { FeedAvatar } from "./FeedAvatar"
import { FeedShareCard } from "./FeedShareCard"
import { PostUnfurls } from "./PostUnfurls"
import { ReactionBar } from "./ReactionBar"
import { renderPostBody } from "../../lib/markdownLite"

/** Short display form of a bech32 address, e.g. g1abcd…wxyz. */
function shortAddr(a: string): string {
    return a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a
}

/** Turn a realm flag panic into an actionable line (or "" to stay silent). */
function flagErrorMessage(msg: string): string {
    if (/reject|cancel|denied/i.test(msg)) return "" // wallet rejection — not an error
    if (/already flagged|budget|blocks ago|paused|deleted|hidden/i.test(msg)) {
        return msg.replace(/^.*?panic:\s*/i, "").trim() || "Could not flag this post."
    }
    return "Could not flag this post. Please try again."
}

/** A realm write panic → an actionable line ("" = silent wallet rejection). */
function writeErrorMessage(msg: string, fallback: string): string {
    if (/reject|cancel|denied/i.test(msg)) return ""
    return msg.replace(/^.*?panic:\s*/i, "").trim() || fallback
}

/**
 * Clipboard fallback for insecure contexts / older Safari where
 * navigator.clipboard is unavailable. Returns whether the copy succeeded.
 */
function legacyCopy(text: string): boolean {
    if (typeof document === "undefined") return false
    try {
        const ta = document.createElement("textarea")
        ta.value = text
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        const ok = document.execCommand("copy")
        document.body.removeChild(ta)
        return ok
    } catch {
        return false
    }
}

/**
 * RelativeTime — isolates the ticking clock to a leaf so a live "3m / 2h"
 * timestamp updating every 15s re-renders only this text node, not the whole
 * PostCard (body markdown, unfurl cards, reaction bar). Falls back to the block
 * label when no relative time applies.
 */
const RelativeTime = memo(function RelativeTime({ blockTs, fallback }: { blockTs: bigint; fallback: string }) {
    const now = useNow()
    return <>{relativeTime(blockTs, now) || fallback}</>
})

function PostCardInner({
    post,
    connected,
    selfAddress,
    onRefetch,
    onOpenThread,
    onOpenProfile,
    onConnect,
    displayName,
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
    /** Opens the wallet — a disconnected visitor can see the flag, and clicking it connects. */
    onConnect?: () => void | Promise<boolean>
    /** Resolved @handle for the author, when available (else the short address). */
    displayName?: string
    clickable?: boolean
}) {
    const [flagging, setFlagging] = useState(false)
    // C.1: seeded from the durable feed_flags projection (viewerHasFlagged),
    // not just local component state — previously this forgot across every
    // reload/remount, and a returning viewer could tap Flag again only to have
    // the realm panic "already flagged" with no prior indication.
    //
    // PostCard is keyed by post id (not wallet address), so switching accounts
    // while a card stays mounted delivers a fresh `post.viewerHasFlagged` via
    // props without remounting — resync `flagged` to it whenever it changes
    // (adjust-state-during-render, not an effect) so a card never keeps
    // showing a DIFFERENT wallet's flagged state after an account switch.
    const [flagged, setFlagged] = useState(post.viewerHasFlagged)
    const [syncedViewerFlag, setSyncedViewerFlag] = useState(post.viewerHasFlagged)
    if (post.viewerHasFlagged !== syncedViewerFlag) {
        setSyncedViewerFlag(post.viewerHasFlagged)
        setFlagged(post.viewerHasFlagged)
    }
    const [flagBump, setFlagBump] = useState(0)
    const [flagError, setFlagError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    const copyLink = () => {
        const url = feedPostPermalink(post.id)
        const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500) }
        try {
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(url).then(done).catch(() => legacyCopy(url) && done())
            } else if (legacyCopy(url)) {
                done()
            }
        } catch { /* clipboard unavailable — silently no-op */ }
    }

    // Author manage state (edit / delete), with optimistic local overrides that
    // hold until the indexer-backed refetch reflects the real edit/delete.
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const closeMenu = useCallback(() => setMenuOpen(false), [])
    useDismissable(menuRef, menuOpen, closeMenu)
    const [editing, setEditing] = useState(false)
    const [editBody, setEditBody] = useState(post.body)
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const [busy, setBusy] = useState(false)
    const [actionError, setActionError] = useState<string | null>(null)
    const [localBody, setLocalBody] = useState<string | null>(null)
    const [localDeleted, setLocalDeleted] = useState(false)

    const isOwn = selfAddress === post.author
    const canManage = isOwn && !post.optimistic

    const flag = useCallback(async () => {
        if (post.optimistic || flagging || flagged) return
        if (!connected || !selfAddress) {
            void onConnect?.() // connect on the action; user confirms the flag once connected
            return
        }
        setFlagging(true)
        setFlagError(null)
        setFlagged(true)
        setFlagBump(1)
        try {
            await submitFeedMsg(buildFlagPostMsg(selfAddress, post.id), "flag post")
            onRefetch()
        } catch (e) {
            setFlagged(false)
            setFlagBump(0)
            const line = flagErrorMessage(e instanceof Error ? e.message : String(e))
            if (line) setFlagError(line)
        } finally {
            setFlagging(false)
        }
    }, [connected, selfAddress, post.id, post.optimistic, flagging, flagged, onRefetch, onConnect])

    const saveEdit = useCallback(async () => {
        const body = editBody.trim()
        if (!body || !selfAddress || busy) return
        setBusy(true)
        setActionError(null)
        try {
            await submitFeedMsg(buildEditPostMsg(selfAddress, post.id, body), "edit post")
            setLocalBody(body) // optimistic; reconciled by the refetch
            setEditing(false)
            onRefetch()
        } catch (e) {
            const line = writeErrorMessage(e instanceof Error ? e.message : String(e), "Could not save the edit.")
            if (line) setActionError(line)
        } finally {
            setBusy(false)
        }
    }, [editBody, selfAddress, post.id, busy, onRefetch])

    const doDelete = useCallback(async () => {
        if (!selfAddress || busy) return
        setBusy(true)
        setActionError(null)
        try {
            await submitFeedMsg(buildDeletePostMsg(selfAddress, post.id), "delete post")
            setLocalDeleted(true) // optimistic tombstone; reconciled by the refetch
            onRefetch()
        } catch (e) {
            setConfirmingDelete(false)
            const line = writeErrorMessage(e instanceof Error ? e.message : String(e), "Could not delete the post.")
            if (line) setActionError(line)
        } finally {
            setBusy(false)
        }
    }, [selfAddress, post.id, busy, onRefetch])

    const canOpen = clickable && !post.optimistic && !!onOpenThread
    const showOverlay = canOpen && !editing && !confirmingDelete
    const openThread = () => canOpen && onOpenThread!(post.id)
    const name = displayName || shortAddr(post.author)
    const displayBody = localBody ?? post.body
    // Escape + URL-sanitize once per body change, not on every render — the feed
    // re-renders on poll/scroll and this regex chain was re-running each time.
    const bodyHtml = useMemo(() => renderPostBody(displayBody), [displayBody])

    // Client-side moderation suppression + optimistic self-delete. GetFeedThread
    // returns a thread root in ANY state — a flag-hidden or deleted root reaches
    // this card with its body still populated (hidden posts retain their body
    // on-chain as the audit trail). Never render that body; show a tombstone,
    // mirroring the realm's own renderPost suppression.
    if (post.deleted || post.hidden || localDeleted) {
        return (
            <article className="feed-post feed-post--tombstone" data-testid="feed-post-tombstone">
                <p className="feed-post__tombstone">
                    {post.hidden && !post.deleted && !localDeleted
                        ? "This post is hidden pending moderation."
                        : "This post was deleted by its author."}
                </p>
            </article>
        )
    }

    return (
        <article className={"feed-post" + (post.optimistic ? " feed-post--pending" : "") + (menuOpen ? " feed-post--cv-off" : "")}>
            {showOverlay && (
                <button
                    type="button"
                    className="feed-post__overlay"
                    aria-label="Open thread"
                    onClick={openThread}
                    data-testid="feed-post-open"
                />
            )}

            <div className="feed-post__head">
                <button
                    type="button"
                    className="feed-post__identity"
                    onClick={() => onOpenProfile?.(post.author)}
                    disabled={!onOpenProfile || post.optimistic}
                    title={onOpenProfile ? "View profile" : post.author}
                    data-testid="feed-post-author"
                >
                    <FeedAvatar address={post.author} />
                    <span className="feed-post__names">
                        <span className="feed-post__name">{name}</span>
                        {displayName && <span className="feed-post__handle">{shortAddr(post.author)}</span>}
                    </span>
                </button>
                <div className="feed-post__headright">
                    <span className="feed-post__meta" title={post.optimistic ? undefined : `block ${post.blockH.toString()}`}>
                        {post.optimistic
                            ? "posting…"
                            : <RelativeTime blockTs={post.blockTs} fallback={`block ${post.blockH.toString()}`} />}
                        {(post.editedAt > 0n || localBody !== null) && !post.optimistic && " · edited"}
                    </span>
                    {canManage && (
                        <div className="feed-post__menu-wrap" ref={menuRef}>
                            <button
                                type="button"
                                className="feed-post__menu"
                                aria-label="Manage post"
                                aria-haspopup="menu"
                                aria-expanded={menuOpen}
                                onClick={() => setMenuOpen(o => !o)}
                                data-testid="feed-post-menu"
                            >
                                <DotsThreeVertical size={16} weight="bold" />
                            </button>
                            {menuOpen && (
                                <div className="feed-post__menu-list" role="menu">
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { setMenuOpen(false); setEditBody(displayBody); setEditing(true); setActionError(null) }}
                                        data-testid="feed-post-edit"
                                    >
                                        <PencilSimple size={14} /> Edit
                                    </button>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { setMenuOpen(false); setConfirmingDelete(true); setActionError(null) }}
                                        data-testid="feed-post-delete"
                                    >
                                        <Trash size={14} /> Delete
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {editing ? (
                <div className="feed-post__edit">
                    <textarea
                        className="feed-post__edit-input"
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={3}
                        aria-label="Edit your post"
                        data-testid="feed-edit-input"
                    />
                    <div className="feed-post__edit-row">
                        <button type="button" className="feed-btn feed-btn--primary" disabled={busy || !editBody.trim()} onClick={saveEdit} data-testid="feed-edit-save">
                            {busy ? "Saving…" : "Save"}
                        </button>
                        <button type="button" className="feed-btn" onClick={() => { setEditing(false); setActionError(null) }} data-testid="feed-edit-cancel">
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <div
                    className="feed-post__body"
                    // Inline-only, XSS-safe markdown (escapes + URL-sanitizes; see
                    // renderPostBody). Only reached for LIVE posts — the tombstone
                    // branch above returns first, so a hidden/deleted body is never rendered.
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                    data-testid="feed-post-body"
                />
            )}

            {!editing && <PostUnfurls body={displayBody} />}

            {!editing && !post.deleted && (
                <ReactionBar
                    postId={post.id}
                    connected={connected}
                    selfAddress={selfAddress}
                    onConnect={onConnect ?? (() => {})}
                />
            )}

            <div className="feed-post__actions">
                <button
                    type="button"
                    className="feed-post__stat feed-post__stat--btn"
                    onClick={openThread}
                    disabled={!canOpen}
                    aria-label={`${post.replyCount} replies — open thread`}
                    title={canOpen ? "View thread" : undefined}
                    data-testid="feed-replies-btn"
                >
                    <ChatCircle size={15} /> {post.replyCount}
                </button>
                {!post.optimistic && (
                    <button
                        type="button"
                        className="feed-post__stat feed-post__stat--btn feed-post__copy"
                        onClick={copyLink}
                        aria-label="Copy link to this post"
                        title={copied ? "Copied" : "Copy link"}
                        data-testid="feed-copy-link-btn"
                    >
                        {copied ? <Check size={15} weight="bold" /> : <LinkSimple size={15} />}
                        {copied ? "Copied" : "Copy link"}
                    </button>
                )}
                {!post.optimistic && <FeedShareCard post={post} />}
                {!isOwn && !post.optimistic && (
                    <button
                        type="button"
                        className="feed-post__flag"
                        disabled={flagging || flagged}
                        onClick={flag}
                        aria-label={flagged ? "Flagged" : "Flag this post"}
                        title={flagged ? "Flagged" : "Flag this post"}
                        data-testid="feed-flag-btn"
                    >
                        <Flag size={15} weight={flagged ? "fill" : "regular"} />
                        {flagged ? "Flagged" : "Flag"}
                        {flagBump > 0 && <span className="feed-post__flagcount"> · {post.flagCount + flagBump}</span>}
                    </button>
                )}
            </div>

            {confirmingDelete && (
                <div className="feed-post__confirm" role="alertdialog" aria-label="Confirm delete" data-testid="feed-delete-confirm">
                    <p className="feed-post__confirm-text">
                        Delete this post? It's removed from Memba, but the original text is public and permanent on-chain.
                    </p>
                    <div className="feed-post__confirm-row">
                        <button type="button" className="feed-post__confirm-danger" disabled={busy} onClick={doDelete} data-testid="feed-delete-yes">
                            {busy ? "Deleting…" : "Delete"}
                        </button>
                        <button type="button" className="feed-btn" onClick={() => setConfirmingDelete(false)} data-testid="feed-delete-no">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {(flagError || actionError) && (
                <p className="feed-post__flagerror" role="alert" aria-live="polite" data-testid={flagError ? "feed-flag-error" : "feed-action-error"}>
                    {flagError || actionError}
                </p>
            )}
        </article>
    )
}

/**
 * Memoized so a timeline poll/append or a sibling card's state change doesn't
 * re-render every card. Combined with the isolated RelativeTime clock and the
 * memoized body/unfurl parsing, an idle feed no longer churns the main thread.
 */
export const PostCard = memo(PostCardInner)
