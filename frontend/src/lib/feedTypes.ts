/**
 * feedTypes — shared feed UI types + the optimistic-post factory, used by the
 * home timeline, thread view, and profile timeline so they build/reconcile
 * optimistic posts identically. Data-only module (no JSX) per react-refresh.
 *
 * @module lib/feedTypes
 */
import type { FeedPost } from "./feedApi"

/** A feed post plus optimistic bookkeeping: a locally-created row shown before
 *  the indexer has caught up. Its `id` is synthetic-negative until reconciled.
 *  `sinceId` is the newest server id loaded WHEN this row was created — a server
 *  row only reconciles it if it is strictly newer than that, so posting a
 *  duplicate of one of your own OLDER posts doesn't make the new row vanish.
 *  `optimisticAt` is a wall-clock stamp for the stuck-row TTL. */
export type UiPost = FeedPost & { optimistic?: boolean; sinceId?: bigint; optimisticAt?: number }

/** How long an optimistic row that never reconciles (e.g. the realm normalized
 *  the body so it never matches) stays before it's dropped from the view. */
export const OPTIMISTIC_TTL_MS = 30_000

/**
 * makeOptimisticPost builds the synthetic row shown immediately after a
 * broadcast, before the indexer surfaces the real one. `replyTo` is 0 for a
 * top-level post, or the parent id for a reply. The negative `id` (derived from
 * a caller-supplied monotonic value, since Date.now() varies) is never a real
 * post id, so it can't collide with indexed rows.
 */
export function makeOptimisticPost(author: string, body: string, replyTo: bigint, nonce: number): UiPost {
    return {
        id: BigInt(-Math.abs(nonce) - 1),
        author,
        body,
        replyTo,
        blockH: 0n,
        blockTs: 0n,
        editedAt: 0n,
        flagCount: 0,
        hidden: false,
        deleted: false,
        replyCount: 0,
        optimistic: true,
    } as UiPost
}

/** Two posts have the same author + body — the content signal for reconciliation. */
export function sameContent(a: UiPost, b: FeedPost): boolean {
    return a.author === b.author && a.body === b.body
}

/**
 * Whether an indexed server post `s` reconciles (replaces) the optimistic post
 * `o`. Requires same author + body AND that `s` is strictly newer than the
 * feed's newest id at the moment `o` was created (`o.sinceId`). Without the
 * newer-than check, posting a duplicate of one of your own already-loaded posts
 * would instantly match that OLD row and the fresh optimistic row would vanish.
 */
export function reconciles(o: UiPost, s: FeedPost): boolean {
    return sameContent(o, s) && s.id > (o.sinceId ?? -1n)
}

/** Whether an optimistic row is old enough to drop even though it never
 *  reconciled (its server row never appeared — e.g. body normalization). */
export function isStaleOptimistic(o: UiPost, now: number): boolean {
    return o.optimisticAt != null && now - o.optimisticAt > OPTIMISTIC_TTL_MS
}
