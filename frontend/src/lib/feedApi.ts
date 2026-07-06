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
import { API_BASE_URL } from "./config"
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

/** Feed-wide live counters + most-replied (trending) posts for the header/rail. */
export async function fetchFeedStats(): Promise<{ livePosts: bigint; totalReplies: bigint; totalAuthors: bigint; mostReplied: FeedPost[] }> {
    try {
        const res = await api.getFeedStats({})
        return {
            livePosts: res.livePosts ?? 0n,
            totalReplies: res.totalReplies ?? 0n,
            totalAuthors: res.totalAuthors ?? 0n,
            mostReplied: res.mostReplied ?? [],
        }
    } catch {
        return { livePosts: 0n, totalReplies: 0n, totalAuthors: 0n, mostReplied: [] }
    }
}

export interface LinkPreview {
    title: string
    description: string
    siteName: string
    canonicalUrl: string
    imageToken: string
    imageWidth: number
    imageHeight: number
}

/**
 * Server-side rich preview for an external URL (OG metadata via an SSRF-guarded
 * fetch, image proxied through a signed token). Returns null on any failure or
 * when the backend has the feature disabled — the caller then renders the plain
 * link card. Never throws.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
    try {
        const res = await api.getLinkPreview({ url })
        if (!res.ok) return null
        return {
            title: res.title ?? "",
            description: res.description ?? "",
            siteName: res.siteName ?? "",
            canonicalUrl: res.canonicalUrl ?? url,
            imageToken: res.imageToken ?? "",
            imageWidth: res.imageWidth ?? 0,
            imageHeight: res.imageHeight ?? 0,
        }
    } catch {
        return null
    }
}

/** Backend image-proxy URL for a signed preview-image token (never a third-party host). */
export function linkImageUrl(token: string): string {
    return `${API_BASE_URL}/api/link-image?t=${encodeURIComponent(token)}`
}

export interface EmojiCount {
    emoji: string
    count: number
    viewerReacted: boolean
}

/**
 * Per-emoji reaction counts for a set of posts (+ which the viewer reacted
 * with), keyed by post id. Empty map on any failure — reactions are additive
 * chrome, never a hard error. Never throws.
 */
export async function fetchPostReactions(postIds: bigint[], viewer?: string): Promise<Map<bigint, EmojiCount[]>> {
    const out = new Map<bigint, EmojiCount[]>()
    if (postIds.length === 0) return out
    try {
        const res = await api.getPostReactions({ postIds, viewer: viewer ?? "" })
        for (const p of res.posts ?? []) {
            out.set(
                p.postId,
                (p.reactions ?? []).map(e => ({ emoji: e.emoji, count: Number(e.count), viewerReacted: e.viewerReacted })),
            )
        }
    } catch {
        /* empty */
    }
    return out
}
