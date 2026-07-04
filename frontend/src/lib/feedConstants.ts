/**
 * feedConstants — data-only constants for the feed UI. Kept in a .ts module
 * (not FeedPage.tsx) so react-refresh's only-export-components rule stays happy.
 *
 * @module lib/feedConstants
 */

/** Max post body length — mirrors the realm's MaxBodyLen (memba_feed_v1). */
export const MAX_FEED_BODY = 1000

/** Background timeline refetch cadence (ms). */
export const FEED_POLL_MS = 20_000

/** Delay between reconcile refetches after an optimistic post (ms) — covers
 *  block time + indexer confirmation lag. */
export const RECONCILE_MS = 2_500
