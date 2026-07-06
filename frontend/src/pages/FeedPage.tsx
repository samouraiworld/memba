/**
 * FeedPage — the social feed home timeline (W7.2).
 *
 * Reads the home timeline from the indexed backend projection (feedApi) and
 * lets a connected wallet post + flag via the memba_feed_v1 realm. New posts
 * are inserted optimistically and reconciled against the indexer. Posts link to
 * their thread (/feed/post/:id) and authors to their profile (/feed/user/:addr).
 *
 * History is infinitely scrolled (cursor-paginated `useInfiniteQuery`). A
 * SEPARATE lightweight page-0 poll drives the "N new posts" pill, so background
 * polling never refetches deep pages (the useInfiniteQuery thundering-herd trap).
 *
 * @module pages/FeedPage
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { ArrowUp } from "@phosphor-icons/react"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { useAdena } from "../hooks/useAdena"
import { EmptyState } from "../components/ui/EmptyState"
import { FeedComposer } from "../components/feed/FeedComposer"
import { PostCard } from "../components/feed/PostCard"
import { FeedNotifications } from "../components/feed/FeedNotifications"
import { useActorUsernames } from "../hooks/home/useActorUsernames"
import { fetchFeedTimeline } from "../lib/feedApi"
import { countNewer } from "../lib/feedPaging"
import { sameContent, type UiPost } from "../lib/feedTypes"
import { FEED_POLL_MS, RECONCILE_MS } from "../lib/feedConstants"
import "./feed.css"

export default function FeedPage() {
    const { address, connected, connect } = useAdena()
    const nav = useNetworkNav()

    const timeline = useInfiniteQuery({
        queryKey: ["feed", "timeline"],
        queryFn: ({ pageParam }) => fetchFeedTimeline(pageParam, 20),
        initialPageParam: 0n,
        getNextPageParam: (last) => (last.nextCursor && last.nextCursor > 0n ? last.nextCursor : undefined),
        staleTime: 5_000,
        retry: false,
    })

    // Freshness poll — page 0 only. Never refetches the loaded deep pages.
    const head = useQuery({
        queryKey: ["feed", "head"],
        queryFn: () => fetchFeedTimeline(0n, 20),
        refetchInterval: FEED_POLL_MS,
        staleTime: 5_000,
        retry: false,
    })

    const serverPosts = useMemo(
        () => timeline.data?.pages.flatMap(p => p.posts) ?? [],
        [timeline.data],
    )
    const newestLoadedId = serverPosts[0]?.id ?? 0n
    const newCount = countNewer(newestLoadedId, head.data?.posts ?? [])

    const [optimistic, setOptimistic] = useState<UiPost[]>([])
    const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => () => { if (reconcileTimer.current) clearTimeout(reconcileTimer.current) }, [])

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
            const res = await timeline.refetch()
            const server = res.data?.pages.flatMap(p => p.posts) ?? []
            setOptimistic(prev => prev.filter(o => !server.some(s => sameContent(o, s))))
            if (n > 0) reconcileTimer.current = setTimeout(() => void poke(n - 1), RECONCILE_MS)
        }
        reconcileTimer.current = setTimeout(() => void poke(3), RECONCILE_MS)
    }, [timeline])

    // Pull the newest posts into view (refetches loaded pages on explicit action).
    const showNewest = useCallback(() => {
        void timeline.refetch()
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
    }, [timeline])

    return (
        <div className="feed-page" data-testid="feed-page">
            <header className="feed-header">
                <h1 className="feed-title">Feed</h1>
                <p className="feed-subtitle">A global, on-chain timeline for the Memba community.</p>
            </header>

            {connected && address && (
                <FeedNotifications address={address} onOpenThread={(pid) => nav(`/feed/post/${pid.toString()}`)} />
            )}

            <FeedComposer connected={connected} address={address} onConnect={connect} onPosted={onPosted} />

            {newCount > 0 && (
                <button type="button" className="feed-newpill" onClick={showNewest} data-testid="feed-new-pill">
                    <ArrowUp size={14} weight="bold" />
                    {newCount >= 20 ? "20+ new posts" : `${newCount} new post${newCount === 1 ? "" : "s"}`}
                </button>
            )}

            <FeedList
                posts={posts}
                loading={timeline.isLoading}
                connected={connected}
                selfAddress={address}
                onRefetch={() => void timeline.refetch()}
                onConnect={connect}
                onOpenThread={(id) => nav(`/feed/post/${id.toString()}`)}
                onOpenProfile={(addr) => nav(`/feed/user/${addr}`)}
            />

            {timeline.hasNextPage && (
                <button
                    type="button"
                    className="feed-loadmore"
                    onClick={() => void timeline.fetchNextPage()}
                    disabled={timeline.isFetchingNextPage}
                    data-testid="feed-load-more"
                >
                    {timeline.isFetchingNextPage ? "Loading…" : "Load older posts"}
                </button>
            )}
        </div>
    )
}

function FeedList({
    posts,
    loading,
    connected,
    selfAddress,
    onRefetch,
    onConnect,
    onOpenThread,
    onOpenProfile,
}: {
    posts: UiPost[]
    loading: boolean
    connected: boolean
    selfAddress: string | undefined
    onRefetch: () => void
    onConnect: () => void | Promise<boolean>
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
                    onConnect={onConnect}
                    onOpenThread={onOpenThread}
                    onOpenProfile={onOpenProfile}
                    displayName={names.get(post.author)}
                />
            ))}
        </div>
    )
}
