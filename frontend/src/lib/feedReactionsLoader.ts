/**
 * feedReactionsLoader.ts — coalesces per-post reaction reads into batched
 * GetPostReactions calls.
 *
 * Every ReactionBar needs its own post's counts, but asking once per post
 * spent one request each from the backend's shared per-IP ConnectRPC budget
 * (60/min), so a single feed page could starve every other call. The RPC
 * already takes a list of post ids: loads made within a few ms of each other
 * are queued per viewer, deduplicated, and sent as one request (split into
 * chunks at the server's cap), and each caller gets back its own post's list.
 *
 * Unlike fetchPostReactions this REJECTS on failure — every post in a failed
 * chunk rejects — so the caller can show its own error state and retry.
 * Caching and refetching stay with the caller (react-query, per post); the
 * loader only merges requests that are in flight together.
 *
 * @module lib/feedReactionsLoader
 */
import { api } from "./api"
import type { EmojiCount } from "./feedApi"

/** Mirrors maxReactionPosts in backend/internal/service/feed_reactions_rpc.go —
 *  the server silently drops ids past it, so never send more in one call. */
export const REACTIONS_BATCH_MAX = 100

/** How long to wait for more loads before sending the batch. */
const BATCH_WINDOW_MS = 10

export type ReactionsFetcher = (req: { postIds: bigint[]; viewer: string }) => Promise<{
    posts?: { postId: bigint; reactions?: { emoji: string; count: bigint; viewerReacted: boolean }[] }[]
}>

interface Waiter {
    resolve: (v: EmojiCount[]) => void
    reject: (e: unknown) => void
}

interface Batch {
    // Keyed by the id's string form so repeat loads of one post share a slot.
    waiters: Map<string, { id: bigint; list: Waiter[] }>
}

export function createReactionsLoader(
    fetcher: ReactionsFetcher,
    opts: { maxBatch?: number; windowMs?: number } = {},
): (postId: bigint, viewer?: string) => Promise<EmojiCount[]> {
    const maxBatch = Math.max(1, opts.maxBatch ?? REACTIONS_BATCH_MAX)
    const windowMs = opts.windowMs ?? BATCH_WINDOW_MS
    // One open batch per viewer: viewerReacted is computed for the request's
    // viewer, so wallets (and anonymous reads) must never share a request.
    const open = new Map<string, Batch>()

    const runChunk = async (viewer: string, entries: { id: bigint; list: Waiter[] }[]) => {
        try {
            const res = await fetcher({ postIds: entries.map(e => e.id), viewer })
            const byId = new Map<bigint, EmojiCount[]>()
            for (const p of res.posts ?? []) {
                byId.set(
                    p.postId,
                    (p.reactions ?? []).map(e => ({ emoji: e.emoji, count: Number(e.count), viewerReacted: e.viewerReacted })),
                )
            }
            for (const e of entries) {
                const counts = byId.get(e.id) ?? []
                for (const w of e.list) w.resolve(counts)
            }
        } catch (err) {
            for (const e of entries) for (const w of e.list) w.reject(err)
        }
    }

    const flush = (viewer: string) => {
        const batch = open.get(viewer)
        if (!batch) return
        open.delete(viewer)
        const entries = [...batch.waiters.values()]
        for (let i = 0; i < entries.length; i += maxBatch) {
            void runChunk(viewer, entries.slice(i, i + maxBatch))
        }
    }

    return (postId, viewer = "") =>
        new Promise<EmojiCount[]>((resolve, reject) => {
            let batch = open.get(viewer)
            if (!batch) {
                batch = { waiters: new Map() }
                open.set(viewer, batch)
                setTimeout(() => flush(viewer), windowMs)
            }
            const key = postId.toString()
            const slot = batch.waiters.get(key)
            if (slot) slot.list.push({ resolve, reject })
            else batch.waiters.set(key, { id: postId, list: [{ resolve, reject }] })
        })
}

/** App-wide loader over the real ConnectRPC client. */
export const loadPostReactions = createReactionsLoader(req => api.getPostReactions(req))
