/**
 * Reviews data layer — on-chain reads + Adena write builders for memba_reviews_v1.
 *
 * Exposes:
 * - OnChainReview / OnChainComment / SubjectSummary types
 * - unwrapQeval  — strips `("..." string)` wrapper returned by vm/qeval
 * - parseReviews / parseComments — safe JSON.parse helpers
 * - sortByTrust   — reputation desc, recency desc
 * - fetchReviews / fetchComments / fetchSummary / fetchReputation
 * - attachUsernames — joins @username to each distinct author
 * - parseReputationScalar — exposed for unit tests
 * - buildPostReviewMsg / buildEditReviewMsg / buildDeleteReviewMsg /
 *   buildReactMsg / buildCommentMsg / buildFlagMsg — Adena MsgCall builders
 * - submitMsg — broadcast a single reviews MsgCall via Adena
 */

import { GNO_RPC_URL, MEMBA_DAO } from "./config"
import { doContractBroadcast, type AminoMsg } from "./grc20"
import { queryEval } from "./dao/shared"
import { resolveOnChainUsername } from "./profile"

// ── Constants ────────────────────────────────────────────────

export const REVIEWS_PKG_PATH = MEMBA_DAO.reviewsPath

// The reviews engine is subject-agnostic and there is more than one deployed reviews realm
// (the validator/profile web-of-trust and the reputation-isolated App Store reviews realm). All
// reads + write builders default to REVIEWS_PKG_PATH but accept an explicit `realmPath` so a caller
// (e.g. ReviewsSection with realmPath=…) can target a different realm without any other change.

// ── Types ────────────────────────────────────────────────────

export interface OnChainReview {
    id: number
    subject: string
    author: string
    rating: number
    body: string
    createdAt: number
    editedAt: number
    deleted: boolean
    likes: number
    dislikes: number
    flags: number
    reputation: number
    // joined client-side:
    username?: string
}

export interface OnChainComment {
    id: number
    reviewId: number
    author: string
    body: string
    createdAt: number
    editedAt: number
    deleted: boolean
    likes: number
    dislikes: number
    flags: number
    reputation: number
    username?: string
}

export interface SubjectSummary {
    count: number
    average: number
    sum: number
}

// ── Pure helpers ─────────────────────────────────────────────

/**
 * vm/qeval returns string-typed values wrapped as `("..." string)`.
 * Unwrap the outer layer and unescape `\"` and `\\` inside.
 * Passes bare JSON through unchanged (for numeric / array returns).
 */
export function unwrapQeval(raw: string): string {
    const m = raw.match(/^\("([\s\S]*)" string\)$/)
    const inner = m ? m[1] : raw
    return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
}

export function parseReviews(json: string): OnChainReview[] {
    try {
        const v = JSON.parse(json)
        return Array.isArray(v) ? v : []
    } catch {
        return []
    }
}

export function parseComments(json: string): OnChainComment[] {
    try {
        const v = JSON.parse(json)
        return Array.isArray(v) ? v : []
    } catch {
        return []
    }
}

/**
 * Parse the scalar int64 returned by GetReputation(addr).
 * vm/qeval wraps it as `(N int64)`, e.g. `(3 int64)`, `(-2 int64)`.
 */
export function parseReputationScalar(raw: string): number {
    const m = raw.match(/^\((-?\d+)\s/)
    return m ? Number(m[1]) : 0
}

/** Sort reviews (or comments) by reputation desc, then most-recent first. */
export function sortByTrust<T extends { reputation: number; createdAt: number }>(items: T[]): T[] {
    return [...items].sort((a, b) => b.reputation - a.reputation || b.createdAt - a.createdAt)
}

/**
 * Merge review lists fetched from several subject addresses into one, deduped by author.
 *
 * A validator's reviews can be split across addresses: when a genesis validator later
 * registers a valoper, its canonical subject flips from the signing address to the
 * operator address, stranding earlier reviews under the old key. We read BOTH and merge.
 *
 * Dedup rule (per author, since the realm allows one review per author+subject): keep the
 * review on the canonical subject if present; otherwise the most recently created.
 * Deleted reviews are dropped. Result is sorted by trust.
 */
export function mergeReviewsByAuthor(lists: OnChainReview[][], canonicalSubject: string): OnChainReview[] {
    const byAuthor = new Map<string, OnChainReview>()
    for (const list of lists) {
        for (const r of list) {
            if (r.deleted) continue
            const existing = byAuthor.get(r.author)
            if (!existing) { byAuthor.set(r.author, r); continue }
            const rCanon = r.subject === canonicalSubject
            const eCanon = existing.subject === canonicalSubject
            if (rCanon && !eCanon) byAuthor.set(r.author, r)
            else if (rCanon === eCanon && r.createdAt > existing.createdAt) byAuthor.set(r.author, r)
        }
    }
    return sortByTrust([...byAuthor.values()])
}

/** Client-side summary (count / sum / average) over a (already merged/deduped) review list. */
export function summaryFromReviews(reviews: OnChainReview[]): SubjectSummary {
    const live = reviews.filter((r) => !r.deleted)
    const sum = live.reduce((s, r) => s + r.rating, 0)
    return { count: live.length, sum, average: live.length ? sum / live.length : 0 }
}

/** A local, not-yet-confirmed review for optimistic display right after posting. id<0 and
 *  createdAt=0 mark it as pending (no real block height yet). */
export function makeOptimisticReview(author: string, rating: number, body: string, subject: string): OnChainReview {
    return {
        id: -1, subject, author, rating, body,
        createdAt: 0, editedAt: 0, deleted: false,
        likes: 0, dislikes: 0, flags: 0, reputation: 0,
    }
}

/** Insert-or-replace a review by author (the realm edits an author's existing review on
 *  re-post), keeping the list sorted by trust. */
export function upsertReviewByAuthor(list: OnChainReview[], review: OnChainReview): OnChainReview[] {
    return sortByTrust([review, ...list.filter((r) => r.author !== review.author)])
}

// ── Internal RPC helper ──────────────────────────────────────

async function evalJSON(expr: string, realmPath: string = REVIEWS_PKG_PATH): Promise<string> {
    const raw = await queryEval(GNO_RPC_URL, realmPath, expr)
    return raw ? unwrapQeval(raw) : ""
}

// ── Fetchers ─────────────────────────────────────────────────

/**
 * Fetch reviews for a subject address.
 * Deleted reviews are pruned on-chain so the result only contains live reviews.
 * Returns sorted by trust (reputation desc, recency desc).
 */
export async function fetchReviews(subject: string, offset = 0, limit = 20, realmPath: string = REVIEWS_PKG_PATH): Promise<OnChainReview[]> {
    const json = await evalJSON(`GetReviewsJSON(${JSON.stringify(subject)}, ${offset}, ${limit})`, realmPath)
    return sortByTrust(parseReviews(json))
}

/**
 * Fetch comments for a review ID.
 * May include deleted tombstones (`body:"", deleted:true`) — handle defensively.
 */
export async function fetchComments(reviewID: number, offset = 0, limit = 50, realmPath: string = REVIEWS_PKG_PATH): Promise<OnChainComment[]> {
    const json = await evalJSON(`GetCommentsJSON(${reviewID}, ${offset}, ${limit})`, realmPath)
    return parseComments(json)
}

/** Fetch aggregate summary for a subject (count / average / sum). */
export async function fetchSummary(subject: string, realmPath: string = REVIEWS_PKG_PATH): Promise<SubjectSummary> {
    const json = await evalJSON(`GetSubjectSummaryJSON(${JSON.stringify(subject)})`, realmPath)
    try {
        const v = JSON.parse(json)
        return { count: v.count ?? 0, average: v.average ?? 0, sum: v.sum ?? 0 }
    } catch {
        return { count: 0, average: 0, sum: 0 }
    }
}

/**
 * Batch fetchSummary over many subjects with a small concurrency cap — per-card
 * summaries for a grid without an unbounded qeval burst. A failed subject yields
 * the zero summary rather than failing the batch; repeats are deduplicated.
 * NOTE: the honest fix for large catalogs is a realm-side batch getter
 * (next-cycle plan Wave A.5); the cap just keeps this N+1 polite until then.
 */
export async function fetchSummaries(
    subjects: string[],
    realmPath: string = REVIEWS_PKG_PATH,
    concurrency = 4,
): Promise<Map<string, SubjectSummary>> {
    const out = new Map<string, SubjectSummary>()
    const queue = [...new Set(subjects)]
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
        for (;;) {
            const subject = queue.shift()
            if (subject === undefined) return
            try {
                out.set(subject, await fetchSummary(subject, realmPath))
            } catch {
                out.set(subject, { count: 0, average: 0, sum: 0 })
            }
        }
    })
    await Promise.all(workers)
    return out
}

/**
 * Fetch on-chain reputation score for an address.
 * GetReputation returns a bare int64 wrapped as `(N int64)`.
 */
export async function fetchReputation(addr: string, realmPath: string = REVIEWS_PKG_PATH): Promise<number> {
    const raw = await queryEval(GNO_RPC_URL, realmPath, `GetReputation(${JSON.stringify(addr)})`)
    return raw ? parseReputationScalar(raw) : 0
}

// ── Username join ────────────────────────────────────────────

/**
 * Join each distinct author to their on-chain @username (best-effort, deduped).
 * Returns a new array — does not mutate input.
 */
export async function attachUsernames<T extends { author: string; username?: string }>(items: T[]): Promise<T[]> {
    const uniq = [...new Set(items.map((i) => i.author))]
    const map = new Map<string, string>()
    await Promise.all(
        uniq.map(async (a) => {
            const u = await resolveOnChainUsername(a)
            if (u) map.set(a, u)
        }),
    )
    return items.map((i) => ({ ...i, username: map.get(i.author) || undefined }))
}

// ── Write builders ───────────────────────────────────────────

/**
 * Internal: build a vm/MsgCall AminoMsg targeting the reviews realm.
 * Not exported — use the typed build*Msg helpers below.
 */
function buildReviewMsgCall(func: string, args: string[], caller: string, realmPath: string = REVIEWS_PKG_PATH): AminoMsg {
    return { type: "vm/MsgCall", value: { caller, send: "", pkg_path: realmPath, func, args } }
}

/**
 * PostReview(subject string, rating int, body string)
 * Called by a reviewer to publish a new review for `subject`.
 */
export function buildPostReviewMsg(caller: string, subject: string, rating: number, body: string, realmPath: string = REVIEWS_PKG_PATH): AminoMsg {
    return buildReviewMsgCall("PostReview", [subject, String(rating), body], caller, realmPath)
}

/**
 * EditReview(reviewID uint64, rating int, body string)
 * Allows the original author to update their review.
 */
export function buildEditReviewMsg(caller: string, reviewID: number, rating: number, body: string, realmPath: string = REVIEWS_PKG_PATH): AminoMsg {
    return buildReviewMsgCall("EditReview", [String(reviewID), String(rating), body], caller, realmPath)
}

/**
 * DeleteReview(reviewID uint64)
 * Soft-deletes a review (author or multisig only on-chain).
 */
export function buildDeleteReviewMsg(caller: string, reviewID: number, realmPath: string = REVIEWS_PKG_PATH): AminoMsg {
    return buildReviewMsgCall("DeleteReview", [String(reviewID)], caller, realmPath)
}

/**
 * React(targetID uint64, kind string)
 * Like or dislike a review or comment. kind = "like" | "dislike".
 */
export function buildReactMsg(caller: string, targetID: number, kind: "like" | "dislike", realmPath: string = REVIEWS_PKG_PATH): AminoMsg {
    return buildReviewMsgCall("React", [String(targetID), kind], caller, realmPath)
}

/**
 * PostComment(reviewID uint64, body string)
 * Post a comment on an existing review.
 * NOTE: func name is "PostComment" (not "Comment") to avoid the on-chain Comment struct clash.
 */
export function buildCommentMsg(caller: string, reviewID: number, body: string, realmPath: string = REVIEWS_PKG_PATH): AminoMsg {
    return buildReviewMsgCall("PostComment", [String(reviewID), body], caller, realmPath)
}

/**
 * EditComment(commentID uint64, body string)
 * Allows the original commenter to update their comment.
 */
export function buildEditCommentMsg(caller: string, commentID: number, body: string, realmPath: string = REVIEWS_PKG_PATH): AminoMsg {
    return buildReviewMsgCall("EditComment", [String(commentID), body], caller, realmPath)
}

/**
 * DeleteComment(commentID uint64)
 * Soft-deletes a comment (author or multisig only on-chain).
 */
export function buildDeleteCommentMsg(caller: string, commentID: number, realmPath: string = REVIEWS_PKG_PATH): AminoMsg {
    return buildReviewMsgCall("DeleteComment", [String(commentID)], caller, realmPath)
}

/**
 * Flag(targetID uint64)
 * Flag a review or comment for moderation.
 */
export function buildFlagMsg(caller: string, targetID: number, realmPath: string = REVIEWS_PKG_PATH): AminoMsg {
    return buildReviewMsgCall("Flag", [String(targetID)], caller, realmPath)
}

/**
 * HideReview(reviewID uint64)
 * Moderator-only: hide a review from public view without erasing it.
 */
export function buildHideReviewMsg(caller: string, reviewID: number, realmPath: string = REVIEWS_PKG_PATH): AminoMsg {
    return buildReviewMsgCall("HideReview", [String(reviewID)], caller, realmPath)
}

/**
 * HideComment(commentID uint64)
 * Moderator-only: hide a comment from public view without erasing it.
 */
export function buildHideCommentMsg(caller: string, commentID: number, realmPath: string = REVIEWS_PKG_PATH): AminoMsg {
    return buildReviewMsgCall("HideComment", [String(commentID)], caller, realmPath)
}

/**
 * Unhide(targetID uint64)
 * Moderator-only: restore a hidden review or comment to public view.
 */
export function buildUnhideMsg(caller: string, targetID: number, realmPath: string = REVIEWS_PKG_PATH): AminoMsg {
    return buildReviewMsgCall("Unhide", [String(targetID)], caller, realmPath)
}

// ── Broadcast helper ─────────────────────────────────────────

/**
 * Sign + broadcast a single reviews MsgCall via Adena.
 * Returns the transaction hash on success.
 * Throws if Adena is unavailable, the RPC is untrusted, or the user cancels.
 */
export async function submitMsg(msg: AminoMsg, memo: string): Promise<string> {
    const { hash } = await doContractBroadcast([msg], memo)
    return hash
}
