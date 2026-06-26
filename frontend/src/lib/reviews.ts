/**
 * Reviews data layer — on-chain reads for memba_reviews_v1.
 *
 * Exposes:
 * - OnChainReview / OnChainComment / SubjectSummary types
 * - unwrapQeval  — strips `("..." string)` wrapper returned by vm/qeval
 * - parseReviews / parseComments — safe JSON.parse helpers
 * - sortByTrust   — reputation desc, recency desc
 * - fetchReviews / fetchComments / fetchSummary / fetchReputation
 * - attachUsernames — joins @username to each distinct author
 * - parseReputationScalar — exposed for unit tests
 */

import { GNO_RPC_URL, MEMBA_DAO } from "./config"
import { queryEval } from "./dao/shared"
import { resolveOnChainUsername } from "./profile"

// ── Constants ────────────────────────────────────────────────

export const REVIEWS_PKG_PATH = MEMBA_DAO.reviewsPath

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

// ── Internal RPC helper ──────────────────────────────────────

async function evalJSON(expr: string): Promise<string> {
    const raw = await queryEval(GNO_RPC_URL, REVIEWS_PKG_PATH, expr)
    return raw ? unwrapQeval(raw) : ""
}

// ── Fetchers ─────────────────────────────────────────────────

/**
 * Fetch reviews for a subject address.
 * Deleted reviews are pruned on-chain so the result only contains live reviews.
 * Returns sorted by trust (reputation desc, recency desc).
 */
export async function fetchReviews(subject: string, offset = 0, limit = 20): Promise<OnChainReview[]> {
    const json = await evalJSON(`GetReviewsJSON(${JSON.stringify(subject)}, ${offset}, ${limit})`)
    return sortByTrust(parseReviews(json))
}

/**
 * Fetch comments for a review ID.
 * May include deleted tombstones (`body:"", deleted:true`) — handle defensively.
 */
export async function fetchComments(reviewID: number, offset = 0, limit = 50): Promise<OnChainComment[]> {
    const json = await evalJSON(`GetCommentsJSON(${reviewID}, ${offset}, ${limit})`)
    return parseComments(json)
}

/** Fetch aggregate summary for a subject (count / average / sum). */
export async function fetchSummary(subject: string): Promise<SubjectSummary> {
    const json = await evalJSON(`GetSubjectSummaryJSON(${JSON.stringify(subject)})`)
    try {
        const v = JSON.parse(json)
        return { count: v.count ?? 0, average: v.average ?? 0, sum: v.sum ?? 0 }
    } catch {
        return { count: 0, average: 0, sum: 0 }
    }
}

/**
 * Fetch on-chain reputation score for an address.
 * GetReputation returns a bare int64 wrapped as `(N int64)`.
 */
export async function fetchReputation(addr: string): Promise<number> {
    const raw = await queryEval(GNO_RPC_URL, REVIEWS_PKG_PATH, `GetReputation(${JSON.stringify(addr)})`)
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
