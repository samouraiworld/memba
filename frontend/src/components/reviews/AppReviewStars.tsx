/**
 * AppReviewStars — compact, at-a-glance rating summary for an App Store listing.
 *
 * Pure/presentational: fed a { count, average } summary (the caller fetches it via
 * fetchSummary(subject, realmPath)). Kept dumb so it's trivial to test and reuse in a
 * card or a detail hero.
 *
 * Product-integrity rule: below MIN_RATED_COUNT reviews we do NOT show a headline star
 * average — one or two reviews must never present as a confident "5.0". We surface the
 * review count instead (honest sample size), matching the "show n= count, hide rating <3"
 * review-integrity guidance.
 */

import { StarRating } from "./StarRating"

// Smallest sample we'll show an average for. Below this, show the count without a score.
export const MIN_RATED_COUNT = 3

interface AppReviewStarsProps {
    count: number
    average: number
    className?: string
}

function reviewNoun(count: number): string {
    return `${count} review${count === 1 ? "" : "s"}`
}

export function AppReviewStars({ count, average, className }: AppReviewStarsProps) {
    const cls = `appreviewstars${className ? ` ${className}` : ""}`

    if (count <= 0) {
        return (
            <span className={`${cls} appreviewstars--empty`} data-testid="app-review-stars">
                No reviews yet
            </span>
        )
    }

    // Too few data points to average honestly — show the sample size, not a score.
    if (count < MIN_RATED_COUNT) {
        return (
            <span className={`${cls} appreviewstars--new`} data-testid="app-review-stars">
                <span className="appreviewstars__new-chip">New</span>
                <span className="appreviewstars__count">· {reviewNoun(count)}</span>
            </span>
        )
    }

    return (
        <span className={cls} data-testid="app-review-stars">
            <StarRating value={Math.round(average)} size="sm" />
            <span className="appreviewstars__average" data-testid="app-review-stars-average">
                {average.toFixed(1)}
            </span>
            <span className="appreviewstars__count">({reviewNoun(count)})</span>
        </span>
    )
}
