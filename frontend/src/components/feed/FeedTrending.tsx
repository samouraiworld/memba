/**
 * FeedTrending — a compact "Most replied" list for the home feed, from
 * GetFeedStats.mostReplied. Each row opens its thread. Renders nothing until at
 * least one post has replies (a fresh feed shows no trending noise). Names
 * resolve best-effort via useActorUsernames.
 *
 * @module components/feed/FeedTrending
 */
import { ChatCircle, TrendUp } from "@phosphor-icons/react"
import type { FeedPost } from "../../lib/feedApi"
import { useActorUsernames } from "../../hooks/home/useActorUsernames"

function shortAddr(a: string): string {
    return a.length > 12 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a
}

export function FeedTrending({ posts, onOpenThread }: { posts: FeedPost[]; onOpenThread: (id: bigint) => void }) {
    const trending = posts.filter(p => p.replyCount > 0)
    const names = useActorUsernames(trending.map(p => p.author))
    if (trending.length === 0) return null

    return (
        <section className="feed-trending" data-testid="feed-trending">
            <h2 className="feed-trending__title">
                <TrendUp size={14} weight="bold" /> Most replied
            </h2>
            <ul className="feed-trending__list">
                {trending.map(p => (
                    <li key={p.id.toString()}>
                        <button type="button" className="feed-trending__item" onClick={() => onOpenThread(p.id)}>
                            <span className="feed-trending__who">{names.get(p.author) || shortAddr(p.author)}</span>
                            <span className="feed-trending__snippet">{p.body}</span>
                            <span className="feed-trending__count">
                                <ChatCircle size={13} /> {p.replyCount}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    )
}
