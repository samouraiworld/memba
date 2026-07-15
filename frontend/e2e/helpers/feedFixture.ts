import type { Page, Route } from '@playwright/test'

/**
 * Deterministic feed fixture + backend-Connect stub for the flag-ON feed live
 * spec (e2e/feed-live.spec.ts). The feed reads its data from the memba-backend
 * ConnectRPC endpoints (`/memba.v1.MultisigService/*`), NOT from the gno chain,
 * so `abortOnchainReads` alone can't seed it — this helper FULFILLS those RPCs
 * with a canned 25-post world and aborts every other remote/on-chain egress
 * (while never touching the local vite bundles).
 *
 * The world:
 *  - 25 live top-level posts (ids 1..25), one carrying a gno.land unfurl link.
 *  - a TOMBSTONE thread root (id 900, hidden, body retained) — proves a
 *    moderated root never leaks its body into the thread view.
 *  - a busy thread (root 500) with 51 replies — proves the thread view holds a
 *    large reply set (the "show more" affordance itself awaits B.2).
 *
 * JSON wire notes: uint64 fields (id/blockTs/cursor/…) are strings, uint32
 * (flag/reply counts) are numbers — matching the live backend verified by curl.
 */

const A = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'
const B = 'g1lp8g5p78u9dg6ww4c5e5hdeuw8q9ga056f0adv'
const C = 'g17uthmft50mycnx9ry0eecyl9mad34q8ruhphhx'
const AUTHORS = [A, B, C]

export const FEED_AUTHORS = { A, B, C }
export const TOMBSTONE_ID = 900
export const TOMBSTONE_BODY = 'TOMBSTONE-BODY-MUST-NOT-LEAK'
export const BUSY_THREAD_ID = 500
export const BUSY_REPLY_COUNT = 51

interface Post {
    id: string
    author: string
    body: string
    replyTo: string
    blockH: string
    blockTs: string
    editedAt: string
    flagCount: number
    hidden: boolean
    deleted: boolean
    replyCount: number
}

function mkPost(id: number, author: string, body: string, over: Partial<Post> = {}): Post {
    return {
        id: String(id),
        author,
        body,
        replyTo: '0',
        blockH: String(670000 + id),
        blockTs: String(1783300000 + id * 3600),
        editedAt: '0',
        flagCount: 0,
        hidden: false,
        deleted: false,
        replyCount: 0,
        ...over,
    }
}

// 25 live top-level posts, newest = highest id. Post #7 carries an unfurl link.
const LIVE_POSTS: Post[] = Array.from({ length: 25 }, (_, i) => {
    const id = i + 1
    const author = AUTHORS[i % 3]
    const body =
        id === 7
            ? 'Check the new realm https://gno.land/r/memba/feed_v1 — on-chain unfurl demo.'
            : `Post number ${id} on the Memba feed — gno-native, on-chain, no custodian.`
    return mkPost(id, author, body, { replyCount: id === BUSY_THREAD_ID ? 0 : 0 })
})

const BUSY_ROOT = mkPost(BUSY_THREAD_ID, A, 'A very active thread about gno-native governance.', {
    replyCount: BUSY_REPLY_COUNT,
})
const BUSY_REPLIES: Post[] = Array.from({ length: BUSY_REPLY_COUNT }, (_, i) =>
    mkPost(5000 + i, AUTHORS[i % 3], `Reply ${i + 1} in the busy thread.`, { replyTo: String(BUSY_THREAD_ID) }),
)

const TOMBSTONE_ROOT = mkPost(TOMBSTONE_ID, A, TOMBSTONE_BODY, { hidden: true, replyCount: 1 })
const TOMBSTONE_REPLY = mkPost(9001, B, 'A reply that keeps its context under a removed root.', {
    replyTo: String(TOMBSTONE_ID),
})

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

// Localhost origins (the dev server's own bundles) must never be aborted.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

/**
 * Install the feed fixture on the page. Fulfills the five feed RPCs from the
 * world above; aborts any other backend/RPC/indexer egress; leaves the local
 * vite bundles alone. Register in a beforeEach BEFORE the first navigation.
 */
export async function stubFeedBackend(page: Page): Promise<void> {
    await page.route('**/*', (route) => {
        const url = route.request().url()
        const method = url.split('/').pop() ?? ''

        if (url.includes('/memba.v1.MultisigService/')) {
            let req: Record<string, unknown> = {}
            try {
                req = JSON.parse(route.request().postData() ?? '{}')
            } catch {
                /* empty body */
            }
            switch (method) {
                case 'GetFeedTimeline': {
                    const cursor = Number(req.cursor ?? 0)
                    const limit = Number(req.limit ?? 20) || 20
                    const page0 = LIVE_POSTS.filter((p) => cursor === 0 || Number(p.id) < cursor).sort(
                        (a, b) => Number(b.id) - Number(a.id),
                    )
                    const posts = page0.slice(0, limit)
                    const nextCursor = posts.length === limit && posts.length < page0.length ? posts[posts.length - 1].id : '0'
                    return json(route, { posts, nextCursor, indexerLastBlock: '844633' })
                }
                case 'GetUserFeed': {
                    const author = String(req.author ?? '')
                    const cursor = Number(req.cursor ?? 0)
                    const limit = Number(req.limit ?? 20) || 20
                    const mine = LIVE_POSTS.filter((p) => p.author === author && (cursor === 0 || Number(p.id) < cursor)).sort(
                        (a, b) => Number(b.id) - Number(a.id),
                    )
                    const posts = mine.slice(0, limit)
                    const nextCursor = posts.length === limit && posts.length < mine.length ? posts[posts.length - 1].id : '0'
                    return json(route, { posts, nextCursor })
                }
                case 'GetFeedThread': {
                    const postId = Number(req.postId ?? 0)
                    const cursor = Number(req.cursor ?? 0)
                    const limit = Number(req.limit ?? 50) || 50
                    if (postId === TOMBSTONE_ID) {
                        return json(route, { root: TOMBSTONE_ROOT, replies: [TOMBSTONE_REPLY], nextCursor: '0' })
                    }
                    if (postId === BUSY_THREAD_ID) {
                        const after = BUSY_REPLIES.filter((r) => Number(r.id) > cursor).sort((a, b) => Number(a.id) - Number(b.id))
                        const replies = after.slice(0, limit)
                        const nextCursor = replies.length === limit && replies.length < after.length ? replies[replies.length - 1].id : '0'
                        return json(route, { root: BUSY_ROOT, replies, nextCursor })
                    }
                    const root = LIVE_POSTS.find((p) => p.id === String(postId))
                    if (root) return json(route, { root, replies: [], nextCursor: '0' })
                    return json(route, { code: 'not_found' }, 404)
                }
                case 'GetFeedStats':
                    return json(route, { livePosts: '25', totalReplies: '52', totalAuthors: '3', mostReplied: [BUSY_ROOT] })
                case 'GetReplyNotifications':
                    return json(route, { replies: [], unreadCount: 0, latestId: '0' })
                default:
                    // Any other MultisigService call (username resolution, home
                    // snapshot for the ecosystem tab, …) → abort; the feedApi
                    // wrappers treat that as "nothing to show".
                    return route.abort()
            }
        }

        // Non-backend: never abort a localhost bundle; abort everything remote.
        let host = ''
        try {
            host = new URL(url).hostname
        } catch {
            /* non-URL */
        }
        if (LOCAL_HOSTS.has(host)) return route.continue()
        return route.abort()
    })
}
