/** A bounded view of public Feed posts tagged as community applications. */
import { fetchFeedTimeline, type FeedPost } from "./feedApi"

export const JOIN_TAG = "#join"
export const JOIN_TEMPLATE = "#join I'd like to join the Memba DAO community.\n\nWho I am: \nWhat I'd like to help with: \nWhere to see my work: "
export const JOIN_SCAN_PAGES = 3
export const JOIN_PAGE_SIZE = 100

export function isJoinPost(body: string): boolean {
    return /(?:^|\s)#join(?![\w-])/i.test(body)
}

export interface JoinScan { posts: FeedPost[]; scanned: number; complete: boolean }

export async function fetchJoinCandidates(): Promise<JoinScan> {
    const byAuthor = new Map<string, FeedPost>()
    let cursor = 0n
    let scanned = 0
    for (let pageIndex = 0; pageIndex < JOIN_SCAN_PAGES; pageIndex++) {
        const page = await fetchFeedTimeline(cursor, JOIN_PAGE_SIZE)
        scanned += page.posts.length
        for (const post of page.posts) {
            if (!post.hidden && !post.deleted && isJoinPost(post.body) && !byAuthor.has(post.author)) {
                byAuthor.set(post.author, post)
            }
        }
        if (page.nextCursor <= 0n || (cursor > 0n && page.nextCursor >= cursor)) {
            return { posts: [...byAuthor.values()], scanned, complete: page.nextCursor <= 0n }
        }
        cursor = page.nextCursor
    }
    return { posts: [...byAuthor.values()], scanned, complete: false }
}
