/**
 * ValidatorReviewStars — W5.3: per-row review stars for the validators table.
 *
 * Lazy: each rendered row fetches its subject summary once, through a small
 * concurrency limiter (a 50-row page must not fire 50 parallel qevals at the
 * public RPC — the same courtesy the e2e suite extends to it), with a
 * module-level cache so pagination/sort churn never refetches.
 *
 * Subject = the row's bech32 signing address (`gnoAddr`). Profile-level alias
 * merging (operator vs signing address) stays a ValidatorProfile concern —
 * the table shows the realm's aggregate for the address it displays.
 */
import { useEffect, useState } from "react"
import { fetchSummary, fetchReviews } from "../../lib/reviews"
import type { SubjectSummary, OnChainReview } from "../../lib/reviews"

// ── Module caches (page-lifetime) ────────────────────────────

const summaryCache = new Map<string, SubjectSummary>()
const reviewsCache = new Map<string, OnChainReview[]>()

/** Test hook: reset module state between tests. */
export function __resetValidatorReviewCaches(): void {
    summaryCache.clear()
    reviewsCache.clear()
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
    const s = await withLimit(() => fetchSummary(addr))
    summaryCache.set(addr, s)
    return s
}

/** Fetch (or serve cached) the most recent reviews for the hover card. */
export async function getValidatorTopReviews(addr: string, limit = 3): Promise<OnChainReview[]> {
    const cached = reviewsCache.get(addr)
    if (cached) return cached.slice(0, limit)
    const list = await withLimit(() => fetchReviews(addr, 0, limit))
    reviewsCache.set(addr, list)
    return list.slice(0, limit)
}

// ── Components ───────────────────────────────────────────────

/** ★★★☆☆-style compact rating, or a muted dash when unreviewed. */
export function ValidatorReviewStars({ addr }: { addr: string }) {
    const [summary, setSummary] = useState<SubjectSummary | null>(summaryCache.get(addr) ?? null)

    useEffect(() => {
        if (!addr || summaryCache.has(addr)) {
            setSummary(addr ? summaryCache.get(addr)! : null)
            return
        }
        let cancelled = false
        getValidatorReviewSummary(addr)
            .then(s => { if (!cancelled) setSummary(s) })
            .catch(() => { if (!cancelled) setSummary({ count: 0, average: 0, sum: 0 }) })
        return () => { cancelled = true }
    }, [addr])

    if (!addr || summary === null) {
        return <span className="val-stars val-stars--pending" aria-hidden="true">·</span>
    }
    if (summary.count === 0) {
        return <span className="val-stars val-stars--none" title="No reviews yet">—</span>
    }

    const avg = summary.average
    const full = Math.min(5, Math.max(0, Math.round(avg)))
    return (
        <span
            className="val-stars"
            data-testid="validator-stars"
            title={`${avg.toFixed(1)} / 5 · ${summary.count} review${summary.count !== 1 ? "s" : ""}`}
            aria-label={`Rated ${avg.toFixed(1)} out of 5 from ${summary.count} reviews`}
        >
            <span className="val-stars__icons" aria-hidden="true">
                {"★".repeat(full)}{"☆".repeat(5 - full)}
            </span>
            <span className="val-stars__count">({summary.count})</span>
        </span>
    )
}

/** Recent review lines for the row hover card (mounts on hover ⇒ lazy). */
export function ValidatorReviewPreview({ addr }: { addr: string }) {
    const [reviews, setReviews] = useState<OnChainReview[] | null>(reviewsCache.get(addr)?.slice(0, 3) ?? null)

    useEffect(() => {
        if (!addr || reviewsCache.has(addr)) return
        let cancelled = false
        getValidatorTopReviews(addr)
            .then(r => { if (!cancelled) setReviews(r) })
            .catch(() => { if (!cancelled) setReviews([]) })
        return () => { cancelled = true }
    }, [addr])

    const visible = (reviews ?? []).filter(r => !r.deleted).slice(0, 3)
    if (!addr || visible.length === 0) return null

    return (
        <div className="vhc-reviews">
            {visible.map(r => {
                const rating = Math.min(5, Math.max(0, Math.round(r.rating)))
                return (
                    <div key={`${r.author}-${r.id}`} className="vhc-review">
                        <span className="vhc-review__stars" aria-hidden="true">
                            {"★".repeat(rating)}{"☆".repeat(5 - rating)}
                        </span>
                        {r.body && <span className="vhc-review__body">{r.body}</span>}
                    </div>
                )
            })}
        </div>
    )
}
