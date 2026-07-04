/**
 * ValidatorReviewStars — per-row review stars for the validators table.
 *
 * Lazy: each rendered row fetches its subject reviews once, through a small
 * concurrency limiter (a 50-row page must not fire 50 parallel qevals at the
 * public RPC), with a module-level cache so pagination/sort churn never
 * refetches.
 *
 * Subject = the validator's canonical review identity (its operator address once
 * a valoper is registered), with the signing address merged as an alias. The
 * page resolves these via resolveReviewSubjects and passes them in, so the ★
 * count matches the profile page exactly. See validatorReviewsData for why.
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
export function ValidatorReviewStars({ subject, aliases }: { subject: string; aliases?: string[] }) {
    const [summary, setSummary] = useState<SubjectSummary | null>(peekSummary(subject))
    // aliases is a fresh array each render — depend on a stable joined key.
    const aliasKey = (aliases ?? []).join(",")

    useEffect(() => {
        if (!subject || peekSummary(subject) !== null) {
            setSummary(subject ? peekSummary(subject) : null)
            return
        }
        let cancelled = false
        getValidatorReviewSummary(subject, aliases ?? [])
            .then(s => { if (!cancelled) setSummary(s) })
            .catch(() => { if (!cancelled) setSummary({ count: 0, average: 0, sum: 0 }) })
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subject, aliasKey])

    if (!subject || summary === null) {
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
export function ValidatorReviewPreview({ subject, aliases }: { subject: string; aliases?: string[] }) {
    const [reviews, setReviews] = useState<OnChainReview[] | null>(peekReviews(subject)?.slice(0, 3) ?? null)
    const aliasKey = (aliases ?? []).join(",")

    useEffect(() => {
        if (!subject || peekReviews(subject) !== null) return
        let cancelled = false
        getValidatorTopReviews(subject, aliases ?? [])
            .then(r => { if (!cancelled) setReviews(r) })
            .catch(() => { if (!cancelled) setReviews([]) })
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subject, aliasKey])

    const visible = (reviews ?? []).filter(r => !r.deleted).slice(0, 3)
    if (!subject || visible.length === 0) return null

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
