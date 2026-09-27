import { useRecentActivity } from "../../../hooks/home/useRecentActivity"
import { useNow } from "../../../hooks/home/useNow"
import { relativeActivityTime } from "../../../lib/activity"
import "./live.css"

/** A quiet desktop entry point. The window shares this query's cache and poll. */
export function LiveTicker({ networkKey, onOpen }: { networkKey: string; onOpen: () => void }) {
    const { items, loading, error, available, updatedAt } = useRecentActivity(networkKey)
    const now = useNow(30_000)
    const age = updatedAt ? relativeActivityTime(new Date(updatedAt).toISOString(), now) : ""

    const headline = !available ? "Activity unavailable on this network"
        : loading ? "Loading recent activity…"
        : error ? "Activity could not be refreshed"
        : items.length === 0 ? "No transactions in the recent sample"
        : items[0].title

    return (
        <button type="button" className="os-live-ticker os-glass" onClick={onOpen} aria-label={`Open Live activity. ${headline}`}>
            <span className="os-live-ticker-mark" aria-hidden="true" />
            <span className="os-live-ticker-text">
                <strong>Live</strong>
                <span>{headline}</span>
            </span>
            {available && !loading && !error && age && <span className="os-live-ticker-age" aria-hidden="true">{age === "just now" ? "updated now" : `updated ${age} ago`}</span>}
        </button>
    )
}
