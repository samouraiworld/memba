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
    const [entries, setEntries] = useState<LeaderboardEntry[]>([])
    const [totalCount, setTotalCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)

    useEffect(() => {
        document.title = "Leaderboard — Memba"
        trackPageVisit("leaderboard")

        async function fetchLeaderboard() {
            try {
                const resp = await api.getLeaderboard(create(GetLeaderboardRequestSchema, {
                    limit: 50,
                    offset: 0,
                }))
                setEntries(resp.entries || [])
                setTotalCount(resp.totalCount)
            } catch {
                setError(true)
            } finally {
                setLoading(false)
            }
        }

        fetchLeaderboard()
    }, [])

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
                                            {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
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
                    <div className="k-leaderboard-count">{totalCount} players total</div>
                </div>
            )}
        </div>
    )
}
