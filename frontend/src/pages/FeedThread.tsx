/**
 * FeedThread — a single post and its replies (/feed/post/:id).
 *
 * Reads the thread from the indexed backend (GetFeedThread): the root post
 * (which may be a tombstone if the author deleted it) + its live replies,
 * oldest-first. A connected wallet can reply (FeedComposer with replyTo=id);
 * the reply is inserted optimistically and reconciled against the indexer.
 *
 * @module pages/FeedThread
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft } from "@phosphor-icons/react"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { useAdena } from "../hooks/useAdena"
import { EmptyState } from "../components/ui/EmptyState"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"
import { FeedComposer } from "../components/feed/FeedComposer"
import { PostCard } from "../components/feed/PostCard"
import { useActorUsernames } from "../hooks/home/useActorUsernames"
import { fetchFeedThread } from "../lib/feedApi"
import { sameContent, type UiPost } from "../lib/feedTypes"
import { FEED_POLL_MS, RECONCILE_MS } from "../lib/feedConstants"
import "./feed.css"

/** Parse the :id route param to a bigint post id, or null if malformed. */
function parsePostId(raw: string | undefined): bigint | null {
    if (!raw || !/^\d+$/.test(raw)) return null
    try {
        const v = BigInt(raw)
        return v > 0n ? v : null
    } catch {
        return null
    }
}

export default function FeedThread() {
    const { id } = useParams<{ id: string }>()
    const postId = parsePostId(id)
    const { address, connected, connect } = useAdena()
    const nav = useNetworkNav()

    const query = useQuery({
        queryKey: ["feed", "thread", postId?.toString() ?? ""],
        queryFn: () => fetchFeedThread(postId as bigint, 0n, 50),
        enabled: postId !== null,
        refetchInterval: FEED_POLL_MS,
        staleTime: 5_000,
        retry: false,
    })

    const [optimistic, setOptimistic] = useState<UiPost[]>([])
    const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    // This component is reused across /feed/post/:id values (React Router keeps
    // it mounted and only changes the param), so reset the optimistic replies
    // when the thread id changes — otherwise thread A's pending replies would
    // leak into thread B. State reset happens in render (adjust-on-prop-change,
    // no cascading effect); the reconcile timer is cleared in the id-keyed
    // effect below (refs can't be touched during render).
    const idKey = postId?.toString() ?? ""
    const [prevIdKey, setPrevIdKey] = useState(idKey)
    if (idKey !== prevIdKey) {
        setPrevIdKey(idKey)
        setOptimistic([])
    }

    // Clear any pending reconcile poke when the thread id changes or on unmount.
    useEffect(() => () => { if (reconcileTimer.current) clearTimeout(reconcileTimer.current) }, [idKey])

    const serverReplies = query.data?.replies ?? []
    const replies: UiPost[] = [
        ...serverReplies,
        ...optimistic.filter(o => !serverReplies.some(s => sameContent(o, s))),
    ]

    const onReplied = useCallback((post: UiPost) => {
        setOptimistic(prev =>
            prev.some(o => o.author === post.author && o.body === post.body) ? prev : [...prev, post],
        )
        if (reconcileTimer.current) clearTimeout(reconcileTimer.current)
        const poke = async (n: number) => {
            const res = await query.refetch()
            const server = res.data?.replies ?? []
            setOptimistic(prev => prev.filter(o => !server.some(s => sameContent(o, s))))
            if (n > 0) reconcileTimer.current = setTimeout(() => void poke(n - 1), RECONCILE_MS)
        }
        reconcileTimer.current = setTimeout(() => void poke(3), RECONCILE_MS)
    }, [query])

    const names = useActorUsernames([
        ...(query.data?.root ? [query.data.root.author] : []),
        ...serverReplies.map(r => r.author),
    ])

    const back = (
        <button type="button" className="feed-back" onClick={() => nav("/feed")} data-testid="feed-thread-back">
            <ArrowLeft size={16} /> Back to feed
        </button>
    )

    if (postId === null) {
        return (
            <div className="feed-page" data-testid="feed-thread">
                {back}
                <EmptyState icon="ti-alert-circle" title="Invalid post" body="That post link isn't valid." />
            </div>
        )
    }

    const root = query.data?.root ?? null

    return (
        <div className="feed-page" data-testid="feed-thread">
            {back}

            {query.isLoading && !root ? (
                <ConnectingLoader minHeight="30vh" />
            ) : !root ? (
                <EmptyState icon="ti-message-off" title="Post not found" body="This post may not have indexed yet, or it was removed." />
            ) : (
                <>
                    <PostCard
                        post={root as UiPost}
                        connected={connected}
                        selfAddress={address}
                        onRefetch={() => void query.refetch()}
                        onConnect={connect}
                        onOpenProfile={(addr) => nav(`/feed/user/${addr}`)}
                        displayName={names.get((root as UiPost).author)}
                        clickable={false}
                    />

                    <div className="feed-thread__reply">
                        <FeedComposer
                            connected={connected}
                            address={address}
                            onConnect={connect}
                            onPosted={onReplied}
                            replyTo={postId}
                            placeholder="Write a reply…"
                            submitLabel="Reply"
                        />
                    </div>

                    <div className="feed-thread__replies" data-testid="feed-thread-replies">
                        {replies.length === 0 ? (
                            <p className="feed-thread__empty">No replies yet.</p>
                        ) : (
                            replies.map(r => (
                                <PostCard
                                    key={r.optimistic ? `opt-${r.id}` : r.id.toString()}
                                    post={r}
                                    connected={connected}
                                    selfAddress={address}
                                    onRefetch={() => void query.refetch()}
                                    onConnect={connect}
                                    onOpenThread={(tid) => nav(`/feed/post/${tid.toString()}`)}
                                    onOpenProfile={(addr) => nav(`/feed/user/${addr}`)}
                                    displayName={names.get(r.author)}
                                />
                            ))
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
