/**
 * feedApi.ts — typed wrappers over the social-feed ConnectRPC endpoints
 * (GetFeedTimeline / GetUserFeed / GetFeedThread). Each returns a safe empty
 * shape on any error — the backend feed indexer may be undeployed (the
 * FEED_WATCHED_REALMS env gates it off), so callers treat empty as "nothing to
 * show yet", never a hard failure.
 *
 * @module lib/feedApi
 */
import { api } from "./api"
import type { FeedPost } from "../gen/memba/v1/memba_pb"

export type { FeedPost } from "../gen/memba/v1/memba_pb"

export interface TimelinePage {
    posts: FeedPost[]
    nextCursor: bigint
    indexerLastBlock: bigint
}

/** Home timeline — newest top-level posts. cursor 0n = from the newest. */
export async function fetchFeedTimeline(cursor = 0n, limit = 20): Promise<TimelinePage> {
    try {
        const res = await api.getFeedTimeline({ cursor, limit })
        return {
            posts: res.posts ?? [],
            nextCursor: res.nextCursor ?? 0n,
            indexerLastBlock: res.indexerLastBlock ?? 0n,
        }
    } catch {
        return { posts: [], nextCursor: 0n, indexerLastBlock: 0n }
    }
}

/** One author's posts (includes their replies). */
export async function fetchUserFeed(author: string, cursor = 0n, limit = 20): Promise<{ posts: FeedPost[]; nextCursor: bigint }> {
    try {
        const res = await api.getUserFeed({ author, cursor, limit })
        return { posts: res.posts ?? [], nextCursor: res.nextCursor ?? 0n }
    } catch {
        return { posts: [], nextCursor: 0n }
    }
}

/** A post and its live replies (oldest-first). root is null when not found. */
export async function fetchFeedThread(postId: bigint, cursor = 0n, limit = 50): Promise<{ root: FeedPost | null; replies: FeedPost[]; nextCursor: bigint }> {
    try {
        const res = await api.getFeedThread({ postId, cursor, limit })
        return { root: res.root ?? null, replies: res.replies ?? [], nextCursor: res.nextCursor ?? 0n }
    } catch {
        return { root: null, replies: [], nextCursor: 0n }
    }
}

/** Replies to the caller's own posts (newest-first) + how many are unread
 *  relative to sinceId. latestId advances the last-seen cursor. */
export async function fetchReplyNotifications(
    author: string,
    sinceId = 0n,
    limit = 20,
): Promise<{ replies: FeedPost[]; unreadCount: number; latestId: bigint }> {
    try {
        const res = await api.getReplyNotifications({ author, sinceId, limit })
        return { replies: res.replies ?? [], unreadCount: res.unreadCount ?? 0, latestId: res.latestId ?? 0n }
    } catch {
        return { replies: [], unreadCount: 0, latestId: 0n }
    }
}

/** Feed-wide live counters for the header (posts / replies / authors). */
export async function fetchFeedStats(): Promise<{ livePosts: bigint; totalReplies: bigint; totalAuthors: bigint }> {
    try {
        const res = await api.getFeedStats({})
        return { livePosts: res.livePosts ?? 0n, totalReplies: res.totalReplies ?? 0n, totalAuthors: res.totalAuthors ?? 0n }
    } catch {
        return { livePosts: 0n, totalReplies: 0n, totalAuthors: 0n }
    }
}
