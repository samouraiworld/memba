import { MIN_RATED_COUNT } from "../../../components/reviews/AppReviewStars"
import type { SubjectSummary } from "../../../lib/reviews"

/** Below MIN_RATED_COUNT reviews an average would mislead: show "New" instead. */
export function RatingBadge({ summary }: { summary: SubjectSummary | undefined }) {
    if (!summary) return null
    if (summary.count < MIN_RATED_COUNT) return <span className="os-cin-rating os-cin-rating--new">New</span>
    const average = summary.average.toFixed(1)
    return <span className="os-cin-rating">
        <span aria-hidden="true">★ {average} · {summary.count}</span>
        <span className="os-cin-sr">Rated {average} out of 5 from {summary.count} reviews</span>
    </span>
}
