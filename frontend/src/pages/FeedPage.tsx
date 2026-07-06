/**
 * FeedPage — the social feed home timeline (W7.2).
 *
 * Reads the home timeline from the indexed backend projection (feedApi) and
 * lets a connected wallet post + flag via the memba_feed_v1 realm. New posts
 * are inserted optimistically and reconciled against the indexer. Posts link to
 * their thread (/feed/post/:id) and authors to their profile (/feed/user/:addr);
 * those views reuse PostCard + FeedComposer.
 *
 * @module pages/FeedPage
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { useAdena } from "../hooks/useAdena"
import { EmptyState } from "../components/ui/EmptyState"
import { FeedComposer } from "../components/feed/FeedComposer"
import { PostCard } from "../components/feed/PostCard"
import { FeedNotifications } from "../components/feed/FeedNotifications"
import { useActorUsernames } from "../hooks/home/useActorUsernames"
import { fetchFeedTimeline } from "../lib/feedApi"
import { sameContent, type UiPost } from "../lib/feedTypes"
import { FEED_POLL_MS, RECONCILE_MS } from "../lib/feedConstants"
import "./feed.css"

export default function FeedPage() {
    const { address, connected, connect } = useAdena()
    const nav = useNetworkNav()

    const query = useQuery({
        queryKey: ["feed", "timeline"],
        queryFn: () => fetchFeedTimeline(0n, 20),
        refetchInterval: FEED_POLL_MS,
        staleTime: 5_000,
        retry: false,
    })

    const [optimistic, setOptimistic] = useState<UiPost[]>([])
    const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        return () => {
            if (reconcileTimer.current) clearTimeout(reconcileTimer.current)
        }
    }, [])

    // Filter confirmed optimistic rows at render (no cascading setState); the
    // array is pruned in the reconcile callback so it can't grow across a session.
    const serverPosts = query.data?.posts ?? []
    const posts: UiPost[] = [
        ...optimistic.filter(o => !serverPosts.some(s => sameContent(o, s))),
        ...serverPosts,
    ]

    const onPosted = useCallback((post: UiPost) => {
        setOptimistic(prev =>
            prev.some(o => o.author === post.author && o.body === post.body) ? prev : [post, ...prev],
        )
        if (reconcileTimer.current) clearTimeout(reconcileTimer.current)
        const poke = async (n: number) => {
            const res = await query.refetch()
            const server = res.data?.posts ?? []
            setOptimistic(prev => prev.filter(o => !server.some(s => sameContent(o, s))))
            if (n > 0) reconcileTimer.current = setTimeout(() => void poke(n - 1), RECONCILE_MS)
        }
        reconcileTimer.current = setTimeout(() => void poke(3), RECONCILE_MS)
    }, [query])

    return (
        <div className="feed-page" data-testid="feed-page">
            <header className="feed-header">
                <h1 className="feed-title">Feed</h1>
                <p className="feed-subtitle">A global, on-chain timeline for the Memba community.</p>
            </header>

            {connected && address && (
                <FeedNotifications address={address} onOpenThread={(pid) => nav(`/feed/post/${pid.toString()}`)} />
            )}

            <FeedComposer
                connected={connected}
                address={address}
                onConnect={connect}
                onPosted={onPosted}
            />

            <FeedList
                posts={posts}
                loading={query.isLoading}
                connected={connected}
                selfAddress={address}
                onRefetch={() => void query.refetch()}
                onOpenThread={(id) => nav(`/feed/post/${id.toString()}`)}
                onOpenProfile={(addr) => nav(`/feed/user/${addr}`)}
            />
        </div>
    )
}

function FeedList({
    posts,
    loading,
    connected,
    selfAddress,
    onRefetch,
    onOpenThread,
    onOpenProfile,
}: {
    posts: UiPost[]
    loading: boolean
    connected: boolean
    selfAddress: string | undefined
    onRefetch: () => void
    onOpenThread: (id: bigint) => void
    onOpenProfile: (address: string) => void
}) {
    const names = useActorUsernames(posts.map(p => p.author))
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
                    onOpenThread={onOpenThread}
                    onOpenProfile={onOpenProfile}
                    displayName={names.get(post.author)}
                />
            ))}
        </div>
    )
}
