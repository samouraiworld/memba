/**
 * feedConstants — constants (and the realm's body-length rule) for the feed UI. Kept in a .ts module
 * (not FeedPage.tsx) so react-refresh's only-export-components rule stays happy.
 *
 * @module lib/feedConstants
 */

/** Max post body length — mirrors the realm's MaxBodyLen (memba_feed_v1). */
export const MAX_FEED_BODY = 1000

const utf8 = new TextEncoder()

/** A post body's length as the realm measures it: Gno's `len(body)` counts
 *  UTF-8 BYTES of the (trimmed) body the client sends, not JS UTF-16 units — so
 *  "é" is 2 and "🚀" is 4. Counting `.length` let accented or emoji text pass
 *  the client check and then fail on-chain after signing. */
export function feedBodyLength(body: string): number {
    return utf8.encode(body.trim()).length
}

/** Background timeline refetch cadence (ms). */
export const FEED_POLL_MS = 20_000

/** Delay between reconcile refetches after an optimistic post (ms) — covers
 *  block time + indexer confirmation lag. */
export const RECONCILE_MS = 2_500
