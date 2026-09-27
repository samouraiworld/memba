import { useNow } from "../../../hooks/home/useNow"
import { relativeActivityTime } from "../../../lib/activity"
import { useLiveActivity } from "./liveState"
import "./live.css"

/** A quiet desktop entry point. The window shares this query's cache and poll. */
export function LiveTicker({ onOpen }: { onOpen: () => void }) {
    const { activity, chain } = useLiveActivity()
    const { items, loading, error, available, updatedAt } = activity
    const chainStalled = chain.degraded
    const now = useNow(30_000)
    const checkedAge = updatedAt ? relativeActivityTime(new Date(updatedAt).toISOString(), now) : ""
    const transactionAge = items[0] ? relativeActivityTime(items[0].time, now) : ""

    const state = !available ? "unavailable" : loading ? "loading" : error ? "error" : chainStalled ? "paused" : "ready"
    const headline = !available ? "Activity unavailable on this network"
        : loading ? "Loading recent activity…"
        : error ? "Activity could not be refreshed"
        : chainStalled ? "Chain appears stalled · activity paused"
        : items.length === 0 ? "No transactions in the recent sample"
        : items[0].title
    const ageLabel = state !== "ready" ? "" : transactionAge
        ? transactionAge === "just now" ? "Last transaction just now" : `Last transaction ${transactionAge} ago`
        : checkedAge ? checkedAge === "just now" ? "Indexer checked just now" : `Indexer checked ${checkedAge} ago` : ""

    return (
        <button type="button" className="os-live-ticker os-glass" data-state={state} onClick={onOpen} aria-label={`Open Live activity. ${headline}${ageLabel ? `. ${ageLabel}` : ""}`}>
            <span className="os-live-ticker-mark" aria-hidden="true" />
            <span className="os-live-ticker-text">
                <strong>Live</strong>
                <span>{headline}</span>
            </span>
            {ageLabel && <span className="os-live-ticker-age" aria-hidden="true">{ageLabel}</span>}
        </button>
    )
}
