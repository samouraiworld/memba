/**
 * useFeedReplyBadge — the unread reply-notification count for the connected
 * wallet, surfaced as a badge on the Feed nav item so the retention loop fires
 * even when the user isn't on /feed.
 *
 * Shares the SAME react-query key as the on-page {@link FeedNotifications}
 * (`["feed","notifications",address,lastSeen]`, limit 20), so mounting both runs
 * ONE poll app-wide. Re-reads last-seen on the cross-component "seen" event (and
 * cross-tab `storage`) so the badge clears the instant the banner is marked
 * seen. Returns 0 when the feed is disabled or no wallet is connected.
 *
 * @module hooks/useFeedReplyBadge
 */
import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchReplyNotifications } from "../lib/feedApi"
import { getLastSeenReply, FEED_LASTSEEN_EVENT } from "../lib/feedLastSeen"
import { isFeedEnabled } from "../lib/config"
import { FEED_POLL_MS } from "../lib/feedConstants"

export function useFeedReplyBadge(address: string | null): number {
    const enabled = isFeedEnabled() && !!address
    const [lastSeen, setLastSeen] = useState<bigint>(() => (address ? getLastSeenReply(address) : 0n))

    useEffect(() => {
        if (!address) return
        const resync = () => setLastSeen(getLastSeenReply(address))
        resync() // pick up the current value on (re)connect
        window.addEventListener(FEED_LASTSEEN_EVENT, resync)
        window.addEventListener("storage", resync)
        return () => {
            window.removeEventListener(FEED_LASTSEEN_EVENT, resync)
            window.removeEventListener("storage", resync)
        }
    }, [address])

    const query = useQuery({
        queryKey: ["feed", "notifications", address, lastSeen.toString()],
        queryFn: () => fetchReplyNotifications(address as string, lastSeen, 20),
        enabled,
        refetchInterval: FEED_POLL_MS,
        staleTime: 5_000,
        retry: false,
    })

    return enabled ? (query.data?.unreadCount ?? 0) : 0
}
