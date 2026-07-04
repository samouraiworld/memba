/**
 * validatorReviewsData — data layer for the validator review stars/preview.
 *
 * Split from the component file: react-refresh/only-export-components requires
 * .tsx files to export components only. Module-level caches, the in-flight
 * dedup map, the concurrency limiter, and the subject-resolution helpers live
 * here.
 *
 * Subject resolution (the fix for "only one validator shows reviews"): reviews
 * are keyed by the reviewed subject. ValidatorProfile posts a review to the
 * validator's *operator* address once it has registered a valoper (its stable
 * identity), keeping the signing address only as a read alias. The table used
 * to query the *signing* address alone, so every validator with a registered
 * valoper (operator ≠ signing) showed zero reviews. We now resolve each row to
 * the same canonical subject the profile posts to, and merge the signing-address
 * alias so reviews posted before valoper registration still count.
 */
import { fetchReviews, mergeReviewsByAuthor, summaryFromReviews } from "../../lib/reviews"
import type { SubjectSummary, OnChainReview } from "../../lib/reviews"

// ── Module cache (page-lifetime), keyed by canonical subject ─────────
const reviewsCache = new Map<string, OnChainReview[]>()
// In-flight promise dedup: StrictMode's mount→unmount→remount runs the effect
// twice BEFORE the first fetch resolves — without this, every row fired 2×
// RPC calls in dev (the resolved-value cache alone can't catch racing mounts).
const reviewsInFlight = new Map<string, Promise<OnChainReview[]>>()

// Validators have few reviews; one page per subject is plenty and lets us count
// and dedup from the actual list (so the table's ★ count matches the profile).
const REVIEW_FETCH_LIMIT = 100

/** Test hook: reset module state between tests. */
export function __resetValidatorReviewCaches(): void {
    reviewsCache.clear()
    reviewsInFlight.clear()
}

// ── Subject resolution ───────────────────────────────────────────────

/** Signing (consensus) address → stable operator address, for every registered
 *  valoper. Reviews flip to the operator key once a valoper is registered. */
export function buildSigningToOperator(
    valopers: { signingAddress: string; operatorAddress: string }[],
): Map<string, string> {
    const m = new Map<string, string>()
    for (const vp of valopers) {
        if (vp.signingAddress && vp.operatorAddress) m.set(vp.signingAddress.toLowerCase(), vp.operatorAddress)
    }
    return m
}

/** Canonical review subject + alias subjects for a validator row. Canonical is
 *  the operator address when the signing address maps to one; the signing
 *  address is kept as an alias for reviews posted before valoper registration. */
export function resolveReviewSubjects(
    gnoAddr: string,
    signingToOperator: Map<string, string>,
): { subject: string; aliases: string[] } {
    if (!gnoAddr) return { subject: "", aliases: [] }
    const operator = signingToOperator.get(gnoAddr.toLowerCase())
    if (operator && operator !== gnoAddr) return { subject: operator, aliases: [gnoAddr] }
    return { subject: gnoAddr, aliases: [] }
}

// ── Tiny concurrency limiter ─────────────────────────────────────────
const MAX_CONCURRENT = 4
let active = 0
const queue: (() => void)[] = []

function withLimit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const run = () => {
            active++
            fn().then(resolve, reject).finally(() => {
                active--
                queue.shift()?.()
            })
        }
        if (active < MAX_CONCURRENT) run()
        else queue.push(run)
    })
}

// ── Fetchers ─────────────────────────────────────────────────────────

/** All live reviews for a validator, merged across its canonical subject + any
 *  alias subjects, deduped per author and sorted by trust. Cached by canonical. */
export async function getValidatorReviews(canonical: string, aliases: string[] = []): Promise<OnChainReview[]> {
    if (!canonical) return []
    const cached = reviewsCache.get(canonical)
    if (cached) return cached
    let p = reviewsInFlight.get(canonical)
    if (!p) {
        const subjects = [canonical, ...aliases.filter(a => a && a !== canonical)]
        p = Promise.all(subjects.map(s => withLimit(() => fetchReviews(s, 0, REVIEW_FETCH_LIMIT))))
            .then(lists => mergeReviewsByAuthor(lists, canonical))
            .finally(() => reviewsInFlight.delete(canonical))
        reviewsInFlight.set(canonical, p)
    }
    const list = await p
    reviewsCache.set(canonical, list) // success only — errors are never cached
    return list
}

/** Aggregate summary (count / average / sum) for a validator, alias-merged. */
export async function getValidatorReviewSummary(canonical: string, aliases: string[] = []): Promise<SubjectSummary> {
    return summaryFromReviews(await getValidatorReviews(canonical, aliases))
}

/** Most-recent-by-trust reviews for the hover card, alias-merged. */
export async function getValidatorTopReviews(canonical: string, aliases: string[] = [], limit = 3): Promise<OnChainReview[]> {
    return (await getValidatorReviews(canonical, aliases)).slice(0, limit)
}

// ── Synchronous cache peeks for component initial state ───────────────
export function peekSummary(canonical: string): SubjectSummary | null {
    const list = reviewsCache.get(canonical)
    return list ? summaryFromReviews(list) : null
}
export function peekReviews(canonical: string): OnChainReview[] | null {
    return reviewsCache.get(canonical) ?? null
}
