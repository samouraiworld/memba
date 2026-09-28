/** Native Feed home. Detail and moderation routes keep their existing pages. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { NativeViewProps } from "../../native/types"
import { AppShell, Empty, ErrorState, Loading, Pill } from "../../kit"
import { specForTarget } from "../../shell/windows"
import { FeedComposer } from "../../../components/feed/FeedComposer"
import { FeedNotifications } from "../../../components/feed/FeedNotifications"
import { PostCard } from "../../../components/feed/PostCard"
import { FeedEcosystem } from "../../../components/feed/FeedEcosystem"
import { FeedViewerProvider } from "../../../components/feed/FeedViewerProvider"
import { useActorUsernames } from "../../../hooks/home/useActorUsernames"
import { useNow } from "../../../hooks/home/useNow"
import { FEED_INDEXED_NETWORK, FEED_INDEXED_NETWORK_LABEL, getIndexerUrl, isFeedEnabled } from "../../../lib/config"
import { fetchFeedTimeline } from "../../../lib/feedApi"
import { FEED_POLL_MS, RECONCILE_MS } from "../../../lib/feedConstants"
import { JOIN_TEMPLATE } from "../../../lib/feedJoin"
import { countNewer } from "../../../lib/feedPaging"
import { isStaleOptimistic, reconciles, type UiPost } from "../../../lib/feedTypes"
import "../../../pages/feed.css"
import "./native.css"

const sections = [
    { id: "posts", name: "Posts", icon: "feed" },
    { id: "ecosystem", name: "Ecosystem", icon: "chart" },
    { id: "transparency", name: "Moderation", icon: "doc" },
] as const

export default function FeedWindow(props: NativeViewProps) {
    const { section, session, open, fallback } = props
    const member = session.status === "member"
    const viewer = { connected: member, address: member ? session.address : undefined, connect: async () => { session.openConnect(); return false }, queueOnConnect: false }
    if (!isFeedEnabled()) {
        return <div className="os-note" role="status"><Pill tone="neutral">Feed unavailable</Pill>{" "}The Feed is disabled in this build.</div>
    }
    if (section !== null && section !== "ecosystem" && section !== "transparency") return <FeedViewerProvider value={viewer}>{fallback}</FeedViewerProvider>
    const current = section ?? "posts"
    const go = (next: string) => open(specForTarget({ kind: "app", app: "feed", section: next === "posts" ? null : next })!)
    return <AppShell label="Feed" sections={sections} current={current} onSelect={go}>
        <div className="os-feed os-classic">
            {current === "posts" && (session.network.key === FEED_INDEXED_NETWORK
                ? <Posts {...props} />
                : <div className="os-note" role="status">The Feed is indexed on {FEED_INDEXED_NETWORK_LABEL}. Posts are unavailable on this network.</div>)}
            {current === "ecosystem" && (getIndexerUrl()
                ? <FeedEcosystem />
                : <div className="os-note" role="status">Live ecosystem activity is unavailable on this network.</div>)}
            {current === "transparency" && <FeedViewerProvider value={viewer}>{fallback}</FeedViewerProvider>}
        </div>
    </AppShell>
}

function Posts({ session, open, query }: NativeViewProps) {
    // Only a fully signed-in OS member may write. A connected but unsigned
    // wallet remains a guest here, and the OS connect flow owns promotion.
    const connected = session.status === "member"
    const address = connected ? session.address : undefined
    const connect = async () => { session.openConnect(); return false }
    const composerRef = useRef<HTMLTextAreaElement>(null)
    const joinPreset = new URLSearchParams(query).get("compose") === "join" ? JOIN_TEMPLATE : undefined
    useEffect(() => { if (joinPreset) composerRef.current?.focus() }, [joinPreset])

    const timeline = useInfiniteQuery({
        queryKey: ["feed", "timeline", address ?? ""],
        queryFn: ({ pageParam }) => fetchFeedTimeline(pageParam, 20, address),
        initialPageParam: 0n,
        getNextPageParam: (last) => last.nextCursor > 0n ? last.nextCursor : undefined,
        staleTime: 5_000,
        retry: false,
    })
    const head = useQuery({
        queryKey: ["feed", "head", address ?? ""],
        queryFn: () => fetchFeedTimeline(0n, 20, address),
        refetchInterval: FEED_POLL_MS,
        staleTime: 5_000,
        retry: false,
    })
    const serverPosts = useMemo(() => timeline.data?.pages.flatMap(page => page.posts) ?? [], [timeline.data])
    const latestId = serverPosts[0]?.id ?? 0n
    const newCount = countNewer(latestId, head.data?.posts ?? [])
    const [optimistic, setOptimistic] = useState<UiPost[]>([])
    const now = useNow(15_000)
    const names = useActorUsernames(serverPosts.map(post => post.author))
    const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => { if (reconcileTimer.current) clearTimeout(reconcileTimer.current) }, [])
    const posts: UiPost[] = [
        ...optimistic.filter(post => !isStaleOptimistic(post, now) && !serverPosts.some(server => reconciles(post, server))),
        ...serverPosts,
    ]
    const onPosted = useCallback((post: UiPost) => {
        const stamped = { ...post, sinceId: latestId, optimisticAt: Date.now() }
        setOptimistic(current => current.some(item => item.id === stamped.id) ? current : [stamped, ...current])
        if (reconcileTimer.current) clearTimeout(reconcileTimer.current)
        const poll = async (remaining: number) => {
            await timeline.refetch()
            if (remaining > 0) reconcileTimer.current = setTimeout(() => void poll(remaining - 1), RECONCILE_MS)
        }
        reconcileTimer.current = setTimeout(() => void poll(3), RECONCILE_MS)
    }, [latestId, timeline])
    const refresh = useCallback(() => { void timeline.refetch() }, [timeline])
    const openThread = useCallback((id: bigint) => open(specForTarget({ kind: "app", app: "feed", section: `post/${id}` })!), [open])
    const openProfile = useCallback((author: string) => open(specForTarget({ kind: "app", app: "profile", section: author })!), [open])

    return <div className="os-feed__stack" data-testid="os-feed-posts">
        <div>
            <h2>Community posts</h2>
            <p className="os-sub">A public on-chain conversation. Read as a guest; connect and sign in to post.</p>
        </div>
        {connected && address && <FeedNotifications address={address} onOpenThread={openThread} />}
        <FeedComposer connected={connected} address={address} onConnect={connect} queueOnConnect={false} onPosted={onPosted} initialBody={joinPreset} inputRef={composerRef} />
        {timeline.isError && posts.length > 0 && <div className="os-note os-err" role="status">New posts could not be loaded. Showing the last available posts. <button type="button" className="os-btn os-quiet" onClick={refresh}>Retry</button></div>}
        {newCount > 0 && <button type="button" className="os-btn" onClick={refresh}>{newCount >= 20 ? "20+" : newCount} new post{newCount === 1 ? "" : "s"} · Refresh</button>}
        {timeline.isLoading && posts.length === 0 && <Loading label="Loading community posts…" />}
        {timeline.isError && posts.length === 0 && <ErrorState message="The Feed could not be loaded. Your posts remain on-chain." onRetry={refresh} />}
        {timeline.isSuccess && posts.length === 0 && <Empty title="No community posts have been indexed yet." action={<button type="button" className="os-btn" onClick={() => composerRef.current?.focus()}>Write the first post</button>} />}
        {posts.length > 0 && <div className="feed-list" data-testid="os-feed-timeline">{posts.map(post => <PostCard
            key={post.optimistic ? `opt-${post.id}` : post.id.toString()}
            post={post} connected={connected} selfAddress={address}
            onConnect={connect} onRefetch={refresh}
            onOpenThread={openThread} onOpenProfile={openProfile}
            displayName={names.get(post.author)}
        />)}</div>}
        {timeline.hasNextPage && <button type="button" className="os-btn" onClick={() => void timeline.fetchNextPage()} disabled={timeline.isFetchingNextPage}>
            {timeline.isFetchingNextPage ? "Loading older posts…" : "Load older posts"}
        </button>}
        {timeline.isFetchNextPageError && <ErrorState message="Older posts could not be loaded." onRetry={() => { void timeline.fetchNextPage() }} />}
    </div>
}
