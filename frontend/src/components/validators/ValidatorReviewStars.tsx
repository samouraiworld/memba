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
import {
    getValidatorReviewSummary,
    getValidatorTopReviews,
    peekSummary,
    peekReviews,
} from "./validatorReviewsData"
import type { SubjectSummary, OnChainReview } from "../../lib/reviews"

// ── Components ───────────────────────────────────────────────

/** ★★★☆☆-style compact rating, or a muted dash when unreviewed. */
export function ValidatorReviewStars({ addr }: { addr: string }) {
    const [summary, setSummary] = useState<SubjectSummary | null>(peekSummary(addr))

    useEffect(() => {
        if (!addr || peekSummary(addr) !== null) {
            setSummary(addr ? peekSummary(addr) : null)
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
    const [reviews, setReviews] = useState<OnChainReview[] | null>(peekReviews(addr)?.slice(0, 3) ?? null)

    useEffect(() => {
        if (!addr || peekReviews(addr) !== null) return
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
