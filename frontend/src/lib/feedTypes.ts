/**
 * feedTypes — shared feed UI types + the optimistic-post factory, used by the
 * home timeline, thread view, and profile timeline so they build/reconcile
 * optimistic posts identically. Data-only module (no JSX) per react-refresh.
 *
 * @module lib/feedTypes
 */
import type { FeedPost } from "./feedApi"

/** A feed post plus an `optimistic` flag: a locally-created row shown before
 *  the indexer has caught up. Its `id` is synthetic-negative until reconciled. */
export type UiPost = FeedPost & { optimistic?: boolean }

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

/** Two posts are "the same" for optimistic reconciliation when the indexer
 *  reports one by the same author with the same body. */
export function sameContent(a: UiPost, b: FeedPost): boolean {
    return a.author === b.author && a.body === b.body
}
