/**
 * Leaderboard — Global GnoBuilders ranking page.
 *
 * Shows top users by XP with rank badges, quest counts,
 * and the current user's position highlighted.
 *
 * Route: /:network/leaderboard
 */

import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { useAdena } from "../hooks/useAdena"
import { useNetworkKey } from "../hooks/useNetworkNav"
import { api } from "../lib/api"
import { create } from "@bufbuild/protobuf"
import { GetLeaderboardRequestSchema } from "../gen/memba/v1/memba_pb"
import type { LeaderboardEntry } from "../gen/memba/v1/memba_pb"
import { RankBadge } from "../components/quests/RankBadge"
import { RANK_TIERS } from "../lib/gnobuilders"
import { trackPageVisit } from "../lib/quests"
import "./leaderboard.css"

export default function Leaderboard() {
    const { address } = useAdena()
    const nk = useNetworkKey()
    const PAGE_SIZE = 50
    const [entries, setEntries] = useState<LeaderboardEntry[]>([])
    const [totalCount, setTotalCount] = useState(0)
    const [page, setPage] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)

    useEffect(() => {
        document.title = "Leaderboard — Memba"
        trackPageVisit("leaderboard")
    }, [])

    useEffect(() => {
        let cancelled = false
        queueMicrotask(() => { if (!cancelled) setLoading(true) })
        api.getLeaderboard(create(GetLeaderboardRequestSchema, {
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
        }))
            .then(resp => {
                if (!cancelled) {
                    setEntries(resp.entries || [])
                    setTotalCount(resp.totalCount)
                }
            })
            .catch(() => { if (!cancelled) setError(true) })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [page])

    const totalPages = Math.ceil(totalCount / PAGE_SIZE)

    const truncate = (addr: string) =>
        addr.length > 16 ? `${addr.slice(0, 10)}...${addr.slice(-4)}` : addr

    return (
        <div className="k-leaderboard">
            <div className="k-leaderboard-header">
                <h1>Leaderboard</h1>
                <p>Top GnoBuilders ranked by XP</p>
                <Link to={`/${nk}/quests`} className="k-leaderboard-quests-link">
                    View Quests
                </Link>
            </div>

            {loading ? (
                <div className="k-leaderboard-loading">Loading leaderboard...</div>
            ) : error ? (
                <div className="k-leaderboard-error">
                    Unable to load leaderboard. The backend may be unavailable.
                </div>
            ) : entries.length === 0 ? (
                <div className="k-leaderboard-empty">
                    No quest completions yet. Be the first to complete a quest!
                </div>
            ) : (
                <div className="k-leaderboard-table-wrap">
                    <table className="k-leaderboard-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Player</th>
                                <th>Rank</th>
                                <th>XP</th>
                                <th>Quests</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map((entry, i) => {
                                const isMe = address === entry.address
                                const rankTier = RANK_TIERS[entry.rankTier] || RANK_TIERS[0]
                                return (
                                    <tr
                                        key={entry.address}
                                        className={isMe ? "k-leaderboard-row--me" : ""}
                                    >
                                        <td className="k-leaderboard-rank">
                                            {(() => {
                                                const pos = page * PAGE_SIZE + i
                                                if (pos === 0) return "🥇"
                                                if (pos === 1) return "🥈"
                                                if (pos === 2) return "🥉"
                                                return `#${pos + 1}`
                                            })()}
                                        </td>
                                        <td>
                                            <Link to={`/${nk}/profile/${entry.address}`} className="k-leaderboard-addr">
                                                {entry.username || truncate(entry.address)}
                                            </Link>
                                            {isMe && <span className="k-leaderboard-you">(you)</span>}
                                        </td>
                                        <td>
                                            <RankBadge
                                                tier={entry.rankTier}
                                                name={entry.rankName}
                                                color={rankTier.color}
                                                size="sm"
                                            />
                                        </td>
                                        <td className="k-leaderboard-xp">{entry.totalXp}</td>
                                        <td>{entry.questsCompleted}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                    <div className="k-leaderboard-footer">
                        <span className="k-leaderboard-count">{totalCount} players total</span>
                        {totalPages > 1 && (
                            <div className="k-leaderboard-pagination">
                                <button
                                    className="k-leaderboard-page-btn"
                                    disabled={page === 0}
                                    onClick={() => setPage(p => p - 1)}
                                >
                                    Previous
                                </button>
                                <span className="k-leaderboard-page-info">
                                    Page {page + 1} of {totalPages}
                                </span>
                                <button
                                    className="k-leaderboard-page-btn"
                                    disabled={page >= totalPages - 1}
                                    onClick={() => setPage(p => p + 1)}
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
