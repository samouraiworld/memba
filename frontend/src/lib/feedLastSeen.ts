/**
 * feedLastSeen — the client's last-seen reply-notification id, per address, in
 * localStorage. Drives the "N new replies to you" unread badge: unread =
 * replies with id > last-seen. Best-effort; a missing/corrupt value reads as 0
 * (everything unread), never throws.
 *
 * @module lib/feedLastSeen
 */

const key = (address: string) => `memba.feed.lastSeenReply.${address}`

export function getLastSeenReply(address: string): bigint {
    try {
        const raw = localStorage.getItem(key(address))
        if (!raw) return 0n
        return BigInt(raw)
    } catch {
        return 0n // unset, unavailable, or corrupt
    }
}

/** Event fired when the last-seen reply id advances, so a same-tab listener
 *  (the nav reply badge) re-reads immediately instead of waiting for a poll. */
export const FEED_LASTSEEN_EVENT = "memba:feed-lastseen"

export function setLastSeenReply(address: string, id: bigint): void {
    try {
        localStorage.setItem(key(address), id.toString())
    } catch {
        /* storage unavailable — the badge just won't persist "seen" */
    }
    try {
        window.dispatchEvent(new CustomEvent(FEED_LASTSEEN_EVENT, { detail: { address } }))
    } catch {
        /* no window (SSR/test) — same-tab listeners simply won't fire */
    }
}
