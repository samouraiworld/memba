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
 * - buildPostReviewMsg, and ReviewAction with reviewActionMsg — the realm's calls, each with its deposit cap
 * - assertReviewActionApplies — the action checked, and its target read again, before it is signed
 * - submitReview / submitReviewAction — broadcast from the classic page at the measured gas and a fresh fee
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

// ── Actions on a review or a reply ───────────────────────────

/** What a wallet can do to a review or a reply, besides posting a review. `was` is the text an edit replaces. */
export type ReviewAction =
    | { kind: "react"; target: number; on: "review" | "reply"; reaction: "like" | "dislike" }
    | { kind: "flag"; target: number; on: "review" | "reply" }
    | { kind: "reply"; review: number; body: string }
    | { kind: "editReview"; review: number; rating: number; body: string; was: string }
    | { kind: "deleteReview"; review: number }
    | { kind: "editReply"; reply: number; body: string; was: string }
    | { kind: "deleteReply"; reply: number }

/** A reply's limit in UTF-8 bytes — MUST stay equal to the reviews realm's MaxCommentLen. */
export const REPLY_BODY_MAX_BYTES = 1000

/**
 * Upper bound on the bytes an action stores, from simulations against
 * gno.land/r/samcrew/memba_reviews_v2 on gnoland-1 (2026-09-30, heights 452,915 to 452,935):
 *
 *   first like or dislike on a target     2,145 B  (changing it +3 B; undoing it frees 1,069 B)
 *   flag                                  2,077 B
 *   reply                                 3,659 to 3,666 B plus its text
 *   edit of a review or a reply           the growth of its text, plus 10 to 24 B
 *   delete                                a reply +20 B; a review frees 1,055 to 2,102 B
 *
 * Each used 4.86M to 7.58M gas in a transaction of its own, under half of REVIEW_GAS_WANTED.
 * The realm does not say whether this wallet already reacted, so a reaction is sized as a first one.
 */
export function reviewActionStorageBytes(action: ReviewAction): number {
    switch (action.kind) {
        case "react": return 2_200
        case "flag": return 2_150
        case "reply": return 3_700 + utf8Bytes(action.body)
        case "editReview":
        case "editReply": return Math.max(0, utf8Bytes(action.body) - utf8Bytes(action.was)) + 64
        case "deleteReview":
        case "deleteReply": return 64
    }
}

/** The call for an action, with a storage-deposit cap of twice its estimate (the chain would otherwise accept up to 100 GNOT). */
export function reviewActionMsg(caller: string, action: ReviewAction): AminoMsg {
    const call = (func: string, ...args: (string | number)[]) => buildReviewMsgCall(func, args.map(String), caller)
    const msg = action.kind === "react" ? call("React", action.target, action.reaction)
        : action.kind === "flag" ? call("Flag", action.target)
        // The realm's function is PostComment: `Comment` is its struct.
        : action.kind === "reply" ? call("PostComment", action.review, action.body)
        : action.kind === "editReview" ? call("EditReview", action.review, action.rating, action.body)
        : action.kind === "deleteReview" ? call("DeleteReview", action.review)
        : action.kind === "editReply" ? call("EditComment", action.reply, action.body)
        : call("DeleteComment", action.reply)
    return { ...msg, value: { ...msg.value, max_deposit: `${depositCapUgnot(reviewActionStorageBytes(action))}ugnot` } }
}

/** Whether an action acts on a review or on a reply. */
export function reviewActionOn(action: ReviewAction): "review" | "reply" {
    return "on" in action ? action.on : action.kind === "editReply" || action.kind === "deleteReply" ? "reply" : "review"
}

/** The id of the review or reply an action acts on. */
export function reviewActionTarget(action: ReviewAction): number {
    return "target" in action ? action.target : "reply" in action ? action.reply : action.review
}

/** A review or a reply as the realm holds it now, hidden and deleted ones included. */
export interface ReviewTargetState {
    exists: boolean
    isReview: boolean
    author: string
    /** SHA-256 of the body, hex. */
    bodyHash: string
    hidden: boolean
    deleted: boolean
}

/** Parses GetModerationState's struct as vm/qeval prints it; throws on any other shape. */
export function parseTargetState(raw: string): ReviewTargetState {
    const body = raw.match(/^\(struct\{([\s\S]*)\} \S+\.ModerationState\)$/)?.[1]
    // Each field prints as `(value type)`; a string is Go-quoted, and an empty one prints as nothing.
    const fields = body ? [...body.matchAll(/\((?:"((?:[^"\\]|\\.)*)"|([^\s()"]*)) [.\w]+\)/g)].map((m) => m[1] ?? m[2]) : []
    if (fields.length !== 12) throw new Error("The reviews realm did not describe this review.")
    const [id, isReview, , , author, , bodyHash, , , hidden, deleted] = fields
    return { exists: id !== "0", isReview: isReview === "true", author, bodyHash, hidden: hidden === "true", deleted: deleted === "true" }
}

export async function fetchTargetState(id: number): Promise<ReviewTargetState> {
    const raw = await queryEval(GNO_RPC_URL, REVIEWS_PKG_PATH, `GetModerationState(${id})`, true)
    if (!raw) throw new Error("The reviews realm could not be read.")
    return parseTargetState(raw.trim())
}

async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * Reads the target again and throws when the action would fail on chain (a failed
 * transaction still costs its fee) or would no longer act on the text that was shown.
 * The realm cannot say whether this wallet already flagged it: a second flag fails there.
 */
export async function assertReviewActionApplies(caller: string, action: ReviewAction): Promise<void> {
    // What the realm refuses by itself, after the fee is charged.
    if (action.kind === "editReview" && (!Number.isInteger(action.rating) || action.rating < 1 || action.rating > 5)) throw new Error("Select a rating from 1 to 5.")
    if (action.kind === "editReview" && reviewBodyBytes(action.body) > REVIEW_BODY_MAX_BYTES) throw new Error(`Review text must be ${REVIEW_BODY_MAX_BYTES.toLocaleString("en-US")} bytes or fewer.`)
    if ((action.kind === "reply" || action.kind === "editReply") && (action.body.trim() === "" || utf8Bytes(action.body) > REPLY_BODY_MAX_BYTES)) throw new Error(`A reply must be 1 to ${REPLY_BODY_MAX_BYTES.toLocaleString("en-US")} bytes.`)
    const state = await fetchTargetState(reviewActionTarget(action))
    const what = action.kind === "reply" ? "review" : reviewActionOn(action)
    if (!state.exists || state.hidden || state.deleted || state.isReview !== (what === "review")) throw new Error(`This ${what} is no longer available. Refresh the reviews.`)
    const own = state.author === caller
    if (action.kind === "react" && own) throw new Error(`You cannot react to your own ${what}.`)
    const changes = action.kind === "editReview" || action.kind === "deleteReview" || action.kind === "editReply" || action.kind === "deleteReply"
    if (changes && !own) throw new Error(`Only its author can change this ${what}.`)
    if ((action.kind === "editReview" || action.kind === "editReply") && state.bodyHash !== await sha256Hex(action.was)) throw new Error(`Your ${what} changed since it was shown. Refresh the reviews and edit it again.`)
}

// ── Broadcast from the classic page ──────────────────────────

/**
 * Sign + broadcast one reviews call via Adena at the measured gas limit and the network fee
 * read from the chain now, once: a retry could act twice. Throws before the wallet opens when
 * the fee cannot be read, Adena is unavailable or the RPC is untrusted.
 */
async function submitReviewsCall(msg: AminoMsg, memo: string, recheck?: () => Promise<void>): Promise<string> {
    let gasFee: number
    try { gasFee = await freshFeeForGasWanted(REVIEW_GAS_WANTED) }
    catch { throw new Error("The network fee could not be read. Nothing was sent; try again in a moment.") }
    // The confirmation shows this exact fee. When it closes, what may have changed while it was open is
    // checked again before the wallet: the target of an action, then the fee.
    const { hash } = await doContractBroadcast([msg], memo, {
        gasWanted: REVIEW_GAS_WANTED, gasFee,
        beforeSign: async () => {
            await recheck?.()
            await assertFeeStillCovers(gasFee, () => freshFeeForGasWanted(REVIEW_GAS_WANTED), "Try again to see the new fee.")
        },
    })
    return hash
}

/** Throws before anything is sent when the review is one the realm would refuse after charging the fee. */
export async function submitReview(caller: string, subject: string, rating: number, body: string): Promise<string> {
    if (!isReviewsValid()) throw new Error("Reviews are not available on this network.")
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Select a rating from 1 to 5.")
    if (reviewBodyBytes(body) > REVIEW_BODY_MAX_BYTES) throw new Error(`Review text must be ${REVIEW_BODY_MAX_BYTES.toLocaleString("en-US")} bytes or fewer.`)
    return submitReviewsCall(buildPostReviewMsg(caller, subject, rating, body), "post review")
}

/**
 * The target is read before the confirmation opens and again after it closes, so a call that
 * would fail (a review hidden meanwhile, say) never reaches the wallet.
 */
export async function submitReviewAction(caller: string, action: ReviewAction): Promise<string> {
    if (!isReviewsValid()) throw new Error("Reviews are not available on this network.")
    await assertReviewActionApplies(caller, action)
    return submitReviewsCall(reviewActionMsg(caller, action), `${action.kind} on a ${reviewActionOn(action)}`,
        () => assertReviewActionApplies(caller, action))
}
