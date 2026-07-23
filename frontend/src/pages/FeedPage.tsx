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
import { FeedTrending } from "../components/feed/FeedTrending"
import { FeedEcosystem } from "../components/feed/FeedEcosystem"
import { useActorUsernames } from "../hooks/home/useActorUsernames"
import { useNow } from "../hooks/home/useNow"
import { fetchFeedTimeline, fetchFeedStats } from "../lib/feedApi"
import { countNewer } from "../lib/feedPaging"
import { reconciles, isStaleOptimistic, type UiPost } from "../lib/feedTypes"
import { FEED_POLL_MS, RECONCILE_MS } from "../lib/feedConstants"
import "./feed.css"

export default function FeedPage() {
    const { address, connected, connect } = useAdena()
    const nav = useNetworkNav()

    // address in the query key: switching wallets must refetch, not keep
    // serving the previous wallet's viewerHasFlagged state from cache.
    const timeline = useInfiniteQuery({
        queryKey: ["feed", "timeline", address ?? ""],
        queryFn: ({ pageParam }) => fetchFeedTimeline(pageParam, 20, address),
        initialPageParam: 0n,
        getNextPageParam: (last) => (last.nextCursor && last.nextCursor > 0n ? last.nextCursor : undefined),
        staleTime: 5_000,
        retry: false,
    })

    // Freshness poll — page 0 only. Never refetches the loaded deep pages.
    const head = useQuery({
        queryKey: ["feed", "head", address ?? ""],
        queryFn: () => fetchFeedTimeline(0n, 20, address),
        refetchInterval: FEED_POLL_MS,
        staleTime: 5_000,
        retry: false,
    })

    // Feed-wide live counters for the header strip.
    const stats = useQuery({
        queryKey: ["feed", "stats"],
        queryFn: fetchFeedStats,
        staleTime: 30_000,
        retry: false,
    })

    const serverPosts = useMemo(
        () => timeline.data?.pages.flatMap(p => p.posts) ?? [],
        [timeline.data],
    )
    const newestLoadedId = serverPosts[0]?.id ?? 0n
    const newCount = countNewer(newestLoadedId, head.data?.posts ?? [])

    // Posts vs Ecosystem view. Default "posts" (the least-surprising landing —
    // "Feed" means posts) with the ecosystem activity spine one tap away. The
    // plan's D18 "ecosystem-first while volume is low" is intentionally left as
    // an owner toggle rather than a silent default flip.
    const [tab, setTab] = useState<"posts" | "ecosystem">("posts")

    const [optimistic, setOptimistic] = useState<UiPost[]>([])
    const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => () => { if (reconcileTimer.current) clearTimeout(reconcileTimer.current) }, [])

    // Ticks so a stuck optimistic row crosses its TTL and drops without a manual
    // refresh (state-based, not Date.now()-in-render).
    const now = useNow(15_000)
    const posts: UiPost[] = [
        ...optimistic.filter(o => !isStaleOptimistic(o, now) && !serverPosts.some(s => reconciles(o, s))),
        ...serverPosts,
    ]

    const onPosted = useCallback((post: UiPost) => {
        // Stamp the baseline (newest id known now) + a wall-clock time so the row
        // reconciles only against a genuinely newer server row, and clears via TTL
        // if its server row never appears. Dedup on the synthetic id (unique per
        // nonce) so a legitimate second identical post is NOT swallowed.
        const stamped: UiPost = { ...post, sinceId: newestLoadedId, optimisticAt: Date.now() }
        setOptimistic(prev => (prev.some(o => o.id === stamped.id) ? prev : [stamped, ...prev]))
        if (reconcileTimer.current) clearTimeout(reconcileTimer.current)
        const poke = async (n: number) => {
            const res = await timeline.refetch()
            const server = res.data?.pages.flatMap(p => p.posts) ?? []
            const t = Date.now()
            setOptimistic(prev => prev.filter(o => !isStaleOptimistic(o, t) && !server.some(s => reconciles(o, s))))
            if (n > 0) reconcileTimer.current = setTimeout(() => void poke(n - 1), RECONCILE_MS)
        }
        reconcileTimer.current = setTimeout(() => void poke(3), RECONCILE_MS)
    }, [timeline, newestLoadedId])

    // Pull the newest posts into view (refetches loaded pages on explicit action).
    const showNewest = useCallback(() => {
        void timeline.refetch()
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
    }, [timeline])

    // Stable callbacks so the memoized PostCards don't re-render on every
    // FeedPage render (poll/optimistic updates) just because the handlers were
    // freshly allocated inline.
    const onRefetch = useCallback(() => void timeline.refetch(), [timeline])
    const openThread = useCallback((id: bigint) => nav(`/feed/post/${id.toString()}`), [nav])
    const openProfile = useCallback((addr: string) => nav(`/feed/user/${addr}`), [nav])

    return (
        <div className="feed-page" data-testid="feed-page">
            <header className="feed-header">
                <h1 className="feed-title">Feed</h1>
                <p className="feed-subtitle">A global, on-chain timeline for the Memba community.</p>
            </header>

            <div className="feed-page__notifs">
                {connected && address && (
                    <FeedNotifications address={address} onOpenThread={openThread} />
                )}
            </div>

            <div className="feed-page__compose">
                <FeedComposer connected={connected} address={address} onConnect={connect} onPosted={onPosted} />
            </div>

            {/* Right rail (≥1024px) / stacked context strip (mobile): live counters +
                the "Most replied" discovery list, promoted out of the header/timeline. */}
            <aside className="feed-rail" data-testid="feed-rail" aria-label="Feed activity">
                {stats.data && stats.data.livePosts > 0n && (
                    <p className="feed-stats" data-testid="feed-stats">
                        <span><b>{stats.data.livePosts.toString()}</b> posts</span>
                        <span><b>{stats.data.totalReplies.toString()}</b> replies</span>
                        <span><b>{stats.data.totalAuthors.toString()}</b> authors</span>
                    </p>
                )}
                <FeedTrending posts={stats.data?.mostReplied ?? []} onOpenThread={openThread} />
            </aside>

            <div className="feed-main">
                <div className="feed-tabs" role="tablist" aria-label="Feed view">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "posts"}
                        className={`feed-tab${tab === "posts" ? " feed-tab--active" : ""}`}
                        onClick={() => setTab("posts")}
                        data-testid="feed-tab-posts"
                    >
                        Posts
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "ecosystem"}
                        className={`feed-tab${tab === "ecosystem" ? " feed-tab--active" : ""}`}
                        onClick={() => setTab("ecosystem")}
                        data-testid="feed-tab-ecosystem"
                    >
                        Ecosystem
                    </button>
                </div>

                {tab === "ecosystem" ? (
                    <FeedEcosystem />
                ) : (
                    <>
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
                            onRefetch={onRefetch}
                            onConnect={connect}
                            onOpenThread={openThread}
                            onOpenProfile={openProfile}
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
                    </>
                )}
            </div>
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
