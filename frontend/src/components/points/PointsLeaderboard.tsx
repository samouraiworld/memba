/**
 * PointsLeaderboard — the reputation leaderboard as a ranked list (semantic <ol>): rank, address,
 * tier, points, highest first. Presentational — it takes already-fetched rows + pagination callbacks
 * (the container owns the queries). The connected member's row is highlighted when highlightAddr is set.
 * A real load failure (`error`) renders a distinct message, so it is never confused with "empty".
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
    /** A real RPC/ABCI failure (distinct from a legitimately empty board). */
    error?: boolean
    /** 0-based page index (for the pager label + prev/next state). */
    page?: number
    /** Whether a next page exists (the container fetches PAGE_SIZE+1 to know this truthfully). */
    hasMore?: boolean
    onPageChange?: (page: number) => void
    /** Highlight this address's row (the connected member). */
    highlightAddr?: string
}

export function PointsLeaderboard({
    rows,
    loading = false,
    error = false,
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
    if (error) {
        return (
            <div className="points-leaderboard__state" data-testid="leaderboard-error">
                Couldn’t load the leaderboard. Try again shortly.
            </div>
        )
    }
    // Keep the pager whenever paging is possible — including on an empty non-first page, so a user who
    // lands past the end (e.g. after a revoke shrank the board) always has a way back.
    const showPager = !!onPageChange && (page > 0 || hasMore)
    return (
        <div className="points-leaderboard" data-testid="points-leaderboard">
            {rows.length === 0 ? (
                <div className="points-leaderboard__state" data-testid="leaderboard-empty">
                    {page > 0 ? "No more members here." : "No ranked members yet."}
                </div>
            ) : (
                <ol className="points-leaderboard__list" role="list">
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
            )}
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
                    <span className="points-leaderboard__page" aria-live="polite">
                        Page {page + 1}
                    </span>
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
