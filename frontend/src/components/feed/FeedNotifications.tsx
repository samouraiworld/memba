/**
 * FeedNotifications — the "someone replied to you" surface, shown on the home
 * feed for a connected wallet. Reads replies to the caller's own posts
 * (GetReplyNotifications) and badges how many are new since the client's
 * last-seen id (localStorage). Expanding the banner lists the recent replies,
 * each opening its thread; "Mark seen" advances the cursor so the badge clears.
 *
 * This is the feed's retention loop: it gives a reason to come back.
 *
 * @module components/feed/FeedNotifications
 */
import { useCallback, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BellSimple, CaretDown, CaretUp } from "@phosphor-icons/react"
import { fetchReplyNotifications } from "../../lib/feedApi"
import { getLastSeenReply, setLastSeenReply } from "../../lib/feedLastSeen"
import { useActorUsernames } from "../../hooks/home/useActorUsernames"
import { relativeTime } from "../../lib/relativeTime"
import { FeedAvatar } from "./FeedAvatar"
import { FEED_POLL_MS } from "../../lib/feedConstants"

export function FeedNotifications({
    address,
    onOpenThread,
}: {
    address: string
    onOpenThread: (parentId: bigint) => void
}) {
    // Snapshot the last-seen id per address; markSeen advances it locally so the
    // unread query re-runs against the new cursor.
    const [lastSeen, setLastSeen] = useState<bigint>(() => getLastSeenReply(address))
    const [open, setOpen] = useState(false)

    const query = useQuery({
        queryKey: ["feed", "notifications", address, lastSeen.toString()],
        queryFn: () => fetchReplyNotifications(address, lastSeen, 20),
        enabled: !!address,
        refetchInterval: FEED_POLL_MS,
        staleTime: 5_000,
        retry: false,
    })

    const replies = query.data?.replies ?? []
    const unread = query.data?.unreadCount ?? 0
    const latestId = query.data?.latestId ?? 0n
    const names = useActorUsernames(replies.map(r => r.author))

    const markSeen = useCallback(() => {
        if (latestId > 0n) {
            setLastSeenReply(address, latestId)
            setLastSeen(latestId)
        }
    }, [address, latestId])

    // Nothing to show until there is at least one unread reply.
    if (unread === 0) return null

    return (
        <section className="feed-notifs" data-testid="feed-notifications">
            <div className="feed-notifs__bar">
                <button
                    type="button"
                    className="feed-notifs__toggle"
                    onClick={() => setOpen(o => !o)}
                    aria-expanded={open}
                    data-testid="feed-notifs-toggle"
                >
                    <BellSimple size={16} weight="fill" />
                    <span className="feed-notifs__count">{unread}</span>
                    {unread === 1 ? "new reply to you" : "new replies to you"}
                    {open ? <CaretUp size={14} /> : <CaretDown size={14} />}
                </button>
                <button type="button" className="feed-notifs__seen" onClick={markSeen} data-testid="feed-notifs-seen">
                    Mark seen
                </button>
            </div>

            {open && (
                <ul className="feed-notifs__list" data-testid="feed-notifs-list">
                    {replies.map(r => {
                        const name = names.get(r.author) || `${r.author.slice(0, 8)}…${r.author.slice(-4)}`
                        return (
                            <li key={r.id.toString()}>
                                <button
                                    type="button"
                                    className="feed-notifs__item"
                                    onClick={() => onOpenThread(r.replyTo)}
                                >
                                    <FeedAvatar address={r.author} size={28} />
                                    <span className="feed-notifs__text">
                                        <span className="feed-notifs__who">
                                            <b>{name}</b> replied
                                            <span className="feed-notifs__when"> · {relativeTime(r.blockTs, Date.now()) || `block ${r.blockH.toString()}`}</span>
                                        </span>
                                        <span className="feed-notifs__snippet">{r.body}</span>
                                    </span>
                                </button>
                            </li>
                        )
                    })}
                </ul>
            )}
        </section>
    )
}
