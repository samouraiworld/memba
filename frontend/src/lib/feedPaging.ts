/**
 * feedPaging — pure helpers for the infinitely-scrolled timeline.
 *
 * @module lib/feedPaging
 */
import type { FeedPost } from "./feedApi"

/**
 * countNewer returns how many of `head` (the freshest page, newest-first) are
 * strictly newer than `newestLoadedId` — i.e. how many new posts to badge on
 * the "N new posts" pill. Ids are monotonic, so a plain `>` compare is exact.
 */
export function countNewer(newestLoadedId: bigint, head: FeedPost[]): number {
    let n = 0
    for (const p of head) {
        if (p.id > newestLoadedId) n++
    }
    return n
}
