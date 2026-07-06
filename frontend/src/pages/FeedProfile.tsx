/**
 * FeedProfile — one author's feed posts (/feed/user/:address).
 *
 * Reads the author timeline from the indexed backend (GetUserFeed) — their
 * top-level posts and replies, newest-first. Read-only; posts link to their
 * thread. No composer (you post from the home feed or a thread).
 *
 * @module pages/FeedProfile
 */

import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft } from "@phosphor-icons/react"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { useAdena } from "../hooks/useAdena"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { EmptyState } from "../components/ui/EmptyState"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"
import { PostCard } from "../components/feed/PostCard"
import { useActorUsernames } from "../hooks/home/useActorUsernames"
import { fetchUserFeed } from "../lib/feedApi"
import type { UiPost } from "../lib/feedTypes"
import "./feed.css"

// A bech32 gno address: g1 + base32-ish chars. Loose validation is enough — a
// bad address simply returns no posts from the indexer.
const ADDR_RE = /^g1[0-9a-z]{6,}$/

export default function FeedProfile() {
    const { address: profileAddr } = useParams<{ address: string }>()
    const { address: selfAddress, connected } = useAdena()
    const nav = useNetworkNav()

    const valid = !!profileAddr && ADDR_RE.test(profileAddr)

    const query = useQuery({
        queryKey: ["feed", "user", profileAddr ?? ""],
        queryFn: () => fetchUserFeed(profileAddr as string, 0n, 20),
        enabled: valid,
        refetchInterval: 30_000,
        staleTime: 10_000,
        retry: false,
    })

    const posts = (query.data?.posts ?? []) as UiPost[]
    const isSelf = selfAddress === profileAddr
    const names = useActorUsernames(valid && profileAddr ? [profileAddr] : [])

    const back = (
        <button type="button" className="feed-back" onClick={() => nav("/feed")} data-testid="feed-profile-back">
            <ArrowLeft size={16} /> Back to feed
        </button>
    )

    if (!valid) {
        return (
            <div className="feed-page" data-testid="feed-profile">
                {back}
                <EmptyState icon="ti-alert-circle" title="Invalid address" body="That profile link isn't a valid address." />
            </div>
        )
    }

    return (
        <div className="feed-page" data-testid="feed-profile">
            {back}

            <header className="feed-profile__head">
                <h1 className="feed-title">{isSelf ? "Your posts" : "Posts by"}</h1>
                <CopyableAddress address={profileAddr as string} fontSize={13} />
            </header>

            {query.isLoading && posts.length === 0 ? (
                <ConnectingLoader minHeight="30vh" />
            ) : posts.length === 0 ? (
                <EmptyState
                    icon="ti-message-circle"
                    title="No posts yet"
                    body={isSelf ? "Posts you make will appear here." : "This account hasn't posted to the feed."}
                />
            ) : (
                <div className="feed-list" data-testid="feed-profile-list">
                    {posts.map(post => (
                        <PostCard
                            key={post.id.toString()}
                            post={post}
                            connected={connected}
                            selfAddress={selfAddress}
                            onRefetch={() => void query.refetch()}
                            onOpenThread={(id) => nav(`/feed/post/${id.toString()}`)}
                            onOpenProfile={(addr) => nav(`/feed/user/${addr}`)}
                            displayName={names.get(post.author)}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
