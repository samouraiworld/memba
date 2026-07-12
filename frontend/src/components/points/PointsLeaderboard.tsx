/**
 * PointsLeaderboard — the reputation leaderboard as a ranked list (semantic <ol>): rank, address,
 * tier, points, highest first. Presentational — it takes already-fetched rows + pagination callbacks
 * (the container owns the queries). The connected member's row is highlighted when highlightAddr is set.
 *
 * @module components/points/PointsLeaderboard
 */

import { CaretLeft, CaretRight } from "@phosphor-icons/react"
import { TierBadge } from "./TierBadge"
import { truncateAddr } from "../../lib/format"
import type { LeaderRow } from "../../lib/points"
import "./points.css"

interface Props {
    rows: LeaderRow[]
    loading?: boolean
    /** 0-based page index (for the pager label + prev/next state). */
    page?: number
    /** Whether a next page likely exists (a full page came back). */
    hasMore?: boolean
    onPageChange?: (page: number) => void
    /** Highlight this address's row (the connected member). */
    highlightAddr?: string
}

export function PointsLeaderboard({
    rows,
    loading = false,
    page = 0,
    hasMore = false,
    onPageChange,
    highlightAddr,
}: Props) {
    if (loading) {
        return (
            <div className="points-leaderboard__state" data-testid="leaderboard-loading">
                Loading leaderboard…
            </div>
        )
    }
    if (rows.length === 0) {
        return (
            <div className="points-leaderboard__state" data-testid="leaderboard-empty">
                No ranked members yet.
            </div>
        )
    }
    const showPager = !!onPageChange && (page > 0 || hasMore)
    return (
        <div className="points-leaderboard" data-testid="points-leaderboard">
            <ol className="points-leaderboard__list">
                {rows.map((r) => (
                    <li
                        key={r.addr}
                        className={`points-leaderboard__row${highlightAddr === r.addr ? " is-me" : ""}`}
                    >
                        <span className="points-leaderboard__rank">#{r.rank.toLocaleString()}</span>
                        <span className="points-leaderboard__addr" title={r.addr}>
                            {truncateAddr(r.addr)}
                        </span>
                        <TierBadge tier={r.tier} />
                        <span className="points-leaderboard__points">{r.points.toLocaleString()} MP</span>
                    </li>
                ))}
            </ol>
            {showPager && (
                <div className="points-leaderboard__pager">
                    <button
                        type="button"
                        className="points-leaderboard__pagebtn"
                        onClick={() => onPageChange(page - 1)}
                        disabled={page === 0}
                        aria-label="Previous page"
                    >
                        <CaretLeft size={14} weight="bold" /> Prev
                    </button>
                    <span className="points-leaderboard__page">Page {page + 1}</span>
                    <button
                        type="button"
                        className="points-leaderboard__pagebtn"
                        onClick={() => onPageChange(page + 1)}
                        disabled={!hasMore}
                        aria-label="Next page"
                    >
                        Next <CaretRight size={14} weight="bold" />
                    </button>
                </div>
            )}
        </div>
    )
}
