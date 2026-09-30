/**
 * Reviews data layer — on-chain reads + Adena write builders for the network's reviews realm.
 *
 * Exposes:
 * - OnChainReview / OnChainComment / SubjectSummary types
 * - parseReviews / parseComments — check a decoded realm answer, throwing on anything else
 * - sortByTrust   — reputation desc, recency desc
 * - fetchReviews / fetchComments / fetchSummary / fetchModerator — strict reads: a node that
 *   serves another network, an outage or an unreadable answer throws, never reads as "none"
 * - attachUsernames — joins @username to each distinct author
 * - buildPostReviewMsg / buildEditReviewMsg / buildDeleteReviewMsg /
 *   buildReactMsg / buildCommentMsg / buildFlagMsg — Adena MsgCall builders
 * - submitMsg — broadcast a single reviews MsgCall via Adena
 * - submitReview — broadcast a PostReview at its measured gas, fee and deposit cap
 */

import { GNO_RPC_URL, isReviewsValid, MEMBA_DAO } from "./config"
import { assertFeeStillCovers, doContractBroadcast, freshFeeForGasWanted, type AminoMsg } from "./grc20"
import { parseQevalJSON, queryEval } from "./dao/shared"
import { decodeGoQuoted } from "./goQuote"
import { depositCapUgnot } from "./dao/v2Budget"
import { resolveOnChainUsername } from "./profile"

// ── Constants ────────────────────────────────────────────────

export const REVIEWS_PKG_PATH = MEMBA_DAO.reviewsPath

/** A review body's limit in UTF-8 bytes — MUST stay equal to the reviews realms' MaxBodyLen. */
export const REVIEW_BODY_MAX_BYTES = 2000

/**
 * PostReview's gas limit and storage, from simulations against gno.land/r/samcrew/memba_reviews_v2
 * on gnoland-1 (2026-09-30, heights 450,000 to 452,104).
 *
 *   first review on a subject, rating only, 22-character subject     11,884 B
 *   the same for a 52-character subject                               12,156 B
 *   40-character subject, 2,000-byte body                             14,057 B
 *   200-character subject, 2,000-byte body                            15,530 B
 *   replacing a review                                                only what its body grows by
 *
 * That is about 9.2 bytes per subject character and one per body byte. A new review used 7.47M
 * to 7.55M gas and a replacement about 0.58M more (8.13M); the limit is twice that, rounded up.
 */
export const REVIEW_GAS_WANTED = 17_000_000

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length

/** A review body's size as the realm counts it. */
export function reviewBodyBytes(body: string): number {
    return utf8Bytes(body)
}

/**
 * Upper bound on the bytes a review stores when it is the first on its subject; a later review on
 * the same subject stores less. The chain locks a deposit for them; deleting the review returns
 * only a small part (1,055 to 2,102 bytes measured).
 */
export function reviewStorageBytes(subject: string, body: string): number {
    return 11_720 + 10 * utf8Bytes(subject) + utf8Bytes(body)
}

// One reviews realm per network holds validator, profile and App Store reviews: a subject is an
// address or a realm path, and an author's reputation is shared across all three.

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

const UNREADABLE = "The reviews could not be read from the network. Try again in a moment."

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0

/** A list of reviews or comments as the realm writes it. Throws on anything else: one bad entry must not read as "none". */
function parseList<T extends { id: number; author: string }>(value: unknown, extra: (item: Record<string, unknown>) => boolean): T[] {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "object" && item !== null
        && isCount(item.id) && typeof item.author === "string" && typeof item.body === "string" && extra(item))) {
        throw new Error(UNREADABLE)
    }
    return value as T[]
}

export function parseReviews(value: unknown): OnChainReview[] {
    return parseList<OnChainReview>(value, (r) => typeof r.subject === "string" && Number.isInteger(r.rating) && (r.rating as number) >= 1 && (r.rating as number) <= 5)
}

export function parseComments(value: unknown): OnChainComment[] {
    return parseList<OnChainComment>(value, (c) => isCount(c.reviewId))
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

/**
 * A reviews realm answer, from a node checked to serve this network (every failover attempt is
 * checked). Throws when no such node answers, or when the answer is not what the realm writes.
 */
async function evalRaw(expr: string): Promise<string> {
    const raw = await queryEval(GNO_RPC_URL, REVIEWS_PKG_PATH, expr, true)
    if (raw === null) throw new Error(UNREADABLE)
    return raw
}

/** A JSON answer, decoded with Go's quoting rules (a body may hold runes JSON.parse rejects). */
async function evalJSON(expr: string): Promise<unknown> {
    const value = parseQevalJSON(await evalRaw(expr))
    if (value === null) throw new Error(UNREADABLE)
    return value
}

// ── Fetchers ─────────────────────────────────────────────────

/**
 * Fetch reviews for a subject address.
 * Deleted reviews are pruned on-chain so the result only contains live reviews.
 * Returns sorted by trust (reputation desc, recency desc).
 */
export async function fetchReviews(subject: string, offset = 0, limit = 20): Promise<OnChainReview[]> {
    return sortByTrust(parseReviews(await evalJSON(`GetReviewsJSON(${JSON.stringify(subject)}, ${offset}, ${limit})`)))
}

/**
 * Fetch comments for a review ID.
 * May include deleted tombstones (`body:"", deleted:true`) — handle defensively.
 */
export async function fetchComments(reviewID: number, offset = 0, limit = 50): Promise<OnChainComment[]> {
    return parseComments(await evalJSON(`GetCommentsJSON(${reviewID}, ${offset}, ${limit})`))
}

/**
 * The realm's summary for a subject (count / average / sum of its visible reviews). Throws when
 * the reply is missing or malformed: only a well-formed zero means "no reviews". Ratings are 1 to
 * 5, so the sum lies between the count and five times it.
 */
export async function fetchSummary(subject: string): Promise<SubjectSummary> {
    const v = await evalJSON(`GetSubjectSummaryJSON(${JSON.stringify(subject)})`)
    const { count, sum } = (typeof v === "object" && v !== null ? v : {}) as { count?: unknown; sum?: unknown }
    if (!isCount(count) || !isCount(sum) || sum < count || sum > count * 5) {
        throw new Error("The reviews summary could not be read.")
    }
    // The realm's `average` is rounded to an integer. Derive the display value from
    // its exact sum and count so a 4.3 score is not presented as 4.0.
    return { count, average: count ? sum / count : 0, sum }
}

/** The Samourai team's 2-of-3 multisig on gno.land mainnet. What it moderates or lists is read from chain, never assumed from this address. */
export const TEAM_MULTISIG_ADDRESS = "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf"

/**
 * What a listing adds after its publisher's address: whose address it is, and that it
 * moderates reviews only when `moderator` (read from the reviews realm now) is that address.
 */
export function publisherNote(publisher: string, moderator: string | null | undefined): string {
    const moderates = !!moderator && moderator === publisher
    if (publisher === TEAM_MULTISIG_ADDRESS) return moderates ? " (the Samourai team multisig, which also moderates reviews)" : " (the Samourai team multisig)"
    return moderates ? " (this address also moderates reviews)" : ""
}

/** Current onchain moderation authority, for display; null when absent or malformed. */
export async function fetchModerator(): Promise<string | null> {
    const literal = /^\(("[\s\S]*") string\)$/.exec(await evalRaw("GetModerator()"))?.[1]
    let address = ""
    try { address = literal ? decodeGoQuoted(literal) : "" } catch { /* malformed: none */ }
    return /^g1[0-9a-z]{10,80}$/.test(address) ? address : null
}

/**
 * Batch fetchSummary over many subjects with a small concurrency cap — per-card
 * summaries for a grid without an unbounded qeval burst. A subject whose summary cannot
 * be read is left out (unknown, not zero) rather than failing the batch; repeats are deduplicated.
 * NOTE: the honest fix for large catalogs is a realm-side batch getter
 * (next-cycle plan Wave A.5); the cap just keeps this N+1 polite until then.
 */
export async function fetchSummaries(
    subjects: string[],
    concurrency = 4,
): Promise<Map<string, SubjectSummary>> {
    const out = new Map<string, SubjectSummary>()
    const queue = [...new Set(subjects)]
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
        for (;;) {
            const subject = queue.shift()
            if (subject === undefined) return
            try {
                out.set(subject, await fetchSummary(subject))
            } catch { /* unknown: no entry */ }
        }
    })
    await Promise.all(workers)
    return out
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
function buildReviewMsgCall(func: string, args: string[], caller: string): AminoMsg {
    return { type: "vm/MsgCall", value: { caller, send: "", pkg_path: REVIEWS_PKG_PATH, func, args } }
}

/**
 * PostReview(subject string, rating int, body string)
 * Called by a reviewer to publish a new review for `subject`, or to replace their own.
 * Carries a storage-deposit cap of twice the estimate: without one the chain accepts up to
 * its 100 GNOT default.
 */
export function buildPostReviewMsg(caller: string, subject: string, rating: number, body: string): AminoMsg {
    const msg = buildReviewMsgCall("PostReview", [subject, String(rating), body], caller)
    return { ...msg, value: { ...msg.value, max_deposit: `${depositCapUgnot(reviewStorageBytes(subject, body))}ugnot` } }
}

/**
 * EditReview(reviewID uint64, rating int, body string)
 * Allows the original author to update their review.
 */
export function buildEditReviewMsg(caller: string, reviewID: number, rating: number, body: string): AminoMsg {
    return buildReviewMsgCall("EditReview", [String(reviewID), String(rating), body], caller)
}

/**
 * DeleteReview(reviewID uint64)
 * Soft-deletes a review (author or multisig only on-chain).
 */
export function buildDeleteReviewMsg(caller: string, reviewID: number): AminoMsg {
    return buildReviewMsgCall("DeleteReview", [String(reviewID)], caller)
}

/**
 * React(targetID uint64, kind string)
 * Like or dislike a review or comment. kind = "like" | "dislike".
 */
export function buildReactMsg(caller: string, targetID: number, kind: "like" | "dislike"): AminoMsg {
    return buildReviewMsgCall("React", [String(targetID), kind], caller)
}

/**
 * PostComment(reviewID uint64, body string)
 * Post a comment on an existing review.
 * NOTE: func name is "PostComment" (not "Comment") to avoid the on-chain Comment struct clash.
 */
export function buildCommentMsg(caller: string, reviewID: number, body: string): AminoMsg {
    return buildReviewMsgCall("PostComment", [String(reviewID), body], caller)
}

/**
 * EditComment(commentID uint64, body string)
 * Allows the original commenter to update their comment.
 */
export function buildEditCommentMsg(caller: string, commentID: number, body: string): AminoMsg {
    return buildReviewMsgCall("EditComment", [String(commentID), body], caller)
}

/**
 * DeleteComment(commentID uint64)
 * Soft-deletes a comment (author or multisig only on-chain).
 */
export function buildDeleteCommentMsg(caller: string, commentID: number): AminoMsg {
    return buildReviewMsgCall("DeleteComment", [String(commentID)], caller)
}

/**
 * Flag(targetID uint64)
 * Flag a review or comment for moderation.
 */
export function buildFlagMsg(caller: string, targetID: number): AminoMsg {
    return buildReviewMsgCall("Flag", [String(targetID)], caller)
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

/**
 * Sign + broadcast a PostReview at its measured gas limit and the network fee read from the
 * chain now, once: a retry could post twice. The confirmation shows that exact fee; a fee that
 * rose while it was open stops the post before the wallet. Throws before anything is sent when
 * the review is one the realm would refuse after charging the fee, or when the fee cannot be read.
 */
export async function submitReview(caller: string, subject: string, rating: number, body: string): Promise<string> {
    if (!isReviewsValid()) throw new Error("Reviews are not available on this network.")
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Select a rating from 1 to 5.")
    if (reviewBodyBytes(body) > REVIEW_BODY_MAX_BYTES) throw new Error(`Review text must be ${REVIEW_BODY_MAX_BYTES.toLocaleString("en-US")} bytes or fewer.`)
    let gasFee: number
    try { gasFee = await freshFeeForGasWanted(REVIEW_GAS_WANTED) }
    catch { throw new Error("The network fee could not be read. Nothing was sent; try again in a moment.") }
    const { hash } = await doContractBroadcast([buildPostReviewMsg(caller, subject, rating, body)], "post review", {
        gasWanted: REVIEW_GAS_WANTED, gasFee,
        beforeSign: () => assertFeeStillCovers(gasFee, () => freshFeeForGasWanted(REVIEW_GAS_WANTED), "Post the review again to see the new fee."),
    })
    return hash
}
