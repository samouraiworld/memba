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
import { useQuery } from "@tanstack/react-query"
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
    // aliases is a fresh array each render — key on a stable joined form.
    const aliasKey = (aliases ?? []).join(",")

    // getValidatorReviewSummary keeps its own module-level dedupe cache (50
    // table rows share it); initialData taps it so an already-fetched subject
    // renders instantly, exactly like the old peek-first effect did.
    const summaryQuery = useQuery({
        queryKey: ["reviews", "validator-summary", subject, aliasKey],
        enabled: !!subject,
        initialData: () => peekSummary(subject) ?? undefined,
        queryFn: async () => {
            try {
                return await getValidatorReviewSummary(subject, aliases ?? [])
            } catch {
                return { count: 0, average: 0, sum: 0 }
            }
        },
    })
    const summary: SubjectSummary | null = subject ? (summaryQuery.data ?? null) : null

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
    const aliasKey = (aliases ?? []).join(",")

    // Mounts on hover ⇒ the query fires lazily by construction; peekReviews
    // seeds an already-fetched subject so the card never flickers.
    const reviewsQuery = useQuery({
        queryKey: ["reviews", "validator-top", subject, aliasKey],
        enabled: !!subject,
        initialData: () => peekReviews(subject) ?? undefined,
        queryFn: async () => {
            try {
                return await getValidatorTopReviews(subject, aliases ?? [])
            } catch {
                return [] as OnChainReview[]
            }
        },
    })

    const visible = (reviewsQuery.data ?? []).filter(r => !r.deleted).slice(0, 3)
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
