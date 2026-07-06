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

export function setLastSeenReply(address: string, id: bigint): void {
    try {
        localStorage.setItem(key(address), id.toString())
    } catch {
        /* storage unavailable — the badge just won't persist "seen" */
    }
}
