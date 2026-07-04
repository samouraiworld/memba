/**
 * FeedPage — the social feed MVP (W7.2 P1).
 *
 * Reads the home timeline from the indexed backend projection (feedApi) and
 * lets a connected wallet post + flag by broadcasting to the memba_feed_v1
 * realm (lib/feed). New posts are inserted optimistically and reconciled
 * against the indexer (block time + indexer lag mean a fresh post isn't
 * queryable for a few seconds).
 *
 * Post bodies are rendered as plain text — React escapes them, so the realm's
 * raw (un-sanitized) JSON body carries zero XSS risk here.
 *
 * @module pages/FeedPage
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Flag, PaperPlaneTilt, ChatCircle } from "@phosphor-icons/react"
import { useAdena } from "../hooks/useAdena"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { EmptyState } from "../components/ui/EmptyState"
import { fetchFeedTimeline, type FeedPost } from "../lib/feedApi"
import { buildCreatePostMsg, buildFlagPostMsg, submitFeedMsg } from "../lib/feed"
import { MAX_FEED_BODY, FEED_POLL_MS, RECONCILE_MS } from "../lib/feedConstants"
import "./feed.css"

// An optimistic post carries a synthetic negative id until the indexer catches
// up; it's replaced by the real row once the author's newest post appears.
type UiPost = FeedPost & { optimistic?: boolean }

export default function FeedPage() {
    const { address, connected, connect } = useAdena()

    const query = useQuery({
        queryKey: ["feed", "timeline"],
        queryFn: () => fetchFeedTimeline(0n, 20),
        refetchInterval: FEED_POLL_MS,
        staleTime: 5_000,
        retry: false,
    })

    // Optimistic posts the current session created, not yet in the indexer.
    const [optimistic, setOptimistic] = useState<UiPost[]>([])
    const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        return () => {
            if (reconcileTimer.current) clearTimeout(reconcileTimer.current)
        }
    }, [])

    // An optimistic post is confirmed once the indexer reports a post by the
    // same author with the same body. Filter those out at render (no effect,
    // no cascading setState); the array itself is pruned in the reconcile
    // callback below so it can't grow across a long session.
    const serverPosts = query.data?.posts ?? []
    const confirmed = (o: UiPost) => serverPosts.some(s => s.author === o.author && s.body === o.body)
    const posts: UiPost[] = [...optimistic.filter(o => !confirmed(o)), ...serverPosts]

    return (
        <div className="feed-page" data-testid="feed-page">
            <header className="feed-header">
                <h1 className="feed-title">Feed</h1>
                <p className="feed-subtitle">
                    A global, on-chain timeline for the Memba community.
                </p>
            </header>

            <Composer
                connected={connected}
                address={address}
                onConnect={connect}
                onPosted={(post) => {
                    setOptimistic(prev => [post, ...prev])
                    // Reconcile: refetch a few times while the indexer catches up,
                    // and prune confirmed optimistic rows in the timer callback
                    // (not an effect) so the array can't grow across a session.
                    if (reconcileTimer.current) clearTimeout(reconcileTimer.current)
                    const poke = async (n: number) => {
                        const res = await query.refetch()
                        const server = res.data?.posts ?? []
                        setOptimistic(prev =>
                            prev.filter(o => !server.some(s => s.author === o.author && s.body === o.body)),
                        )
                        if (n > 0) reconcileTimer.current = setTimeout(() => void poke(n - 1), RECONCILE_MS)
                    }
                    reconcileTimer.current = setTimeout(() => void poke(3), RECONCILE_MS)
                }}
            />

            <FeedList
                posts={posts}
                loading={query.isLoading}
                connected={connected}
                selfAddress={address}
                onRefetch={() => void query.refetch()}
            />
        </div>
    )
}

// ── Composer ─────────────────────────────────────────────────

function Composer({
    connected,
    address,
    onConnect,
    onPosted,
}: {
    connected: boolean
    address: string | undefined
    onConnect: () => void
    onPosted: (post: UiPost) => void
}) {
    const [body, setBody] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

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
            await submitFeedMsg(buildCreatePostMsg(address, trimmed, 0), "feed post")
            onPosted({
                // Synthetic optimistic row; negative id is never a real post id.
                id: BigInt(-Date.now()),
                author: address,
                body: trimmed,
                replyTo: 0n,
                blockH: 0n,
                editedAt: 0n,
                flagCount: 0,
                hidden: false,
                deleted: false,
                replyCount: 0,
                optimistic: true,
            } as UiPost)
            setBody("")
        } catch (e) {
            // A user rejection in the wallet is not an error worth shouting about.
            const msg = e instanceof Error ? e.message : String(e)
            if (!/reject|cancel|denied/i.test(msg)) setError("Could not post. Please try again.")
        } finally {
            setSubmitting(false)
        }
    }, [connected, address, trimmed, overLimit, onConnect, onPosted])

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
                placeholder="Share something with the community…"
                value={body}
                maxLength={MAX_FEED_BODY + 100 /* allow paste then show over-limit */}
                rows={3}
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
                    {submitting ? "Posting…" : "Post"}
                </button>
            </div>
            {error && <p className="feed-composer__error">{error}</p>}
        </div>
    )
}

// ── List ─────────────────────────────────────────────────────

function FeedList({
    posts,
    loading,
    connected,
    selfAddress,
    onRefetch,
}: {
    posts: UiPost[]
    loading: boolean
    connected: boolean
    selfAddress: string | undefined
    onRefetch: () => void
}) {
    if (loading && posts.length === 0) {
        return (
            <div className="feed-list" aria-busy="true">
                {[0, 1, 2].map(i => (
                    <div key={i} className="feed-post feed-post--skeleton" />
                ))}
            </div>
        )
    }

    if (posts.length === 0) {
        return (
            <EmptyState
                icon="ti-message-circle"
                title="No posts yet"
                body="Be the first to post to the Memba feed."
            />
        )
    }

    return (
        <div className="feed-list" data-testid="feed-timeline">
            {posts.map(post => (
                <PostCard
                    key={post.optimistic ? `opt-${post.id}` : post.id.toString()}
                    post={post}
                    connected={connected}
                    selfAddress={selfAddress}
                    onRefetch={onRefetch}
                />
            ))}
        </div>
    )
}

function PostCard({
    post,
    connected,
    selfAddress,
    onRefetch,
}: {
    post: UiPost
    connected: boolean
    selfAddress: string | undefined
    onRefetch: () => void
}) {
    const [flagging, setFlagging] = useState(false)
    const [flagged, setFlagged] = useState(false)
    const isOwn = selfAddress === post.author

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

    return (
        <article className={"feed-post" + (post.optimistic ? " feed-post--pending" : "")}>
            <div className="feed-post__head">
                <CopyableAddress address={post.author} compact fontSize={12} />
                <span className="feed-post__meta">
                    {post.optimistic ? "posting…" : `block ${post.blockH.toString()}`}
                    {post.editedAt > 0n && !post.optimistic && " · edited"}
                </span>
            </div>
            <div className="feed-post__body">{post.body}</div>
            <div className="feed-post__actions">
                <span className="feed-post__stat">
                    <ChatCircle size={15} /> {post.replyCount}
                </span>
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
