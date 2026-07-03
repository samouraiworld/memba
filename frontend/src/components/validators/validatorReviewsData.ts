/**
 * validatorReviewsData — W5.3 data layer for the validator review stars.
 *
 * Split from the component file: react-refresh/only-export-components
 * requires .tsx files to export components only. Module-level caches,
 * the in-flight dedup maps, and the 4-wide concurrency limiter live here.
 */
import { fetchSummary, fetchReviews } from "../../lib/reviews"
import type { SubjectSummary, OnChainReview } from "../../lib/reviews"

// ── Module caches (page-lifetime) ────────────────────────────

const summaryCache = new Map<string, SubjectSummary>()
const reviewsCache = new Map<string, OnChainReview[]>()
// In-flight promise dedup: StrictMode's mount→unmount→remount runs the effect
// twice BEFORE the first fetch resolves — without this, every row fired 2×
// RPC calls in dev (the resolved-value cache alone can't catch racing mounts).
const summaryInFlight = new Map<string, Promise<SubjectSummary>>()
const reviewsInFlight = new Map<string, Promise<OnChainReview[]>>()

/** Test hook: reset module state between tests. */
export function __resetValidatorReviewCaches(): void {
    summaryCache.clear()
    reviewsCache.clear()
    summaryInFlight.clear()
    reviewsInFlight.clear()
}

// ── Tiny concurrency limiter ─────────────────────────────────

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

/** Fetch (or serve cached) summary for an address, limiter-scheduled. */
export async function getValidatorReviewSummary(addr: string): Promise<SubjectSummary> {
    const cached = summaryCache.get(addr)
    if (cached) return cached
    let p = summaryInFlight.get(addr)
    if (!p) {
        p = withLimit(() => fetchSummary(addr)).finally(() => summaryInFlight.delete(addr))
        summaryInFlight.set(addr, p)
    }
    const s = await p
    summaryCache.set(addr, s) // success only — errors are never cached
    return s
}

/** Fetch (or serve cached) the most recent reviews for the hover card. */
export async function getValidatorTopReviews(addr: string, limit = 3): Promise<OnChainReview[]> {
    const cached = reviewsCache.get(addr)
    if (cached) return cached.slice(0, limit)
    let p = reviewsInFlight.get(addr)
    if (!p) {
        p = withLimit(() => fetchReviews(addr, 0, limit)).finally(() => reviewsInFlight.delete(addr))
        reviewsInFlight.set(addr, p)
    }
    const list = await p
    reviewsCache.set(addr, list) // success only — errors are never cached
    return list.slice(0, limit)
}


/** Synchronous cache peeks for component initial state. */
export function peekSummary(addr: string): SubjectSummary | null {
    return summaryCache.get(addr) ?? null
}
export function peekReviews(addr: string): OnChainReview[] | null {
    return reviewsCache.get(addr) ?? null
}
