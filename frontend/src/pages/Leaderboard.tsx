/**
 * Leaderboard — Global GnoBuilders ranking page.
 *
 * Shows top users by XP with rank badges, quest counts,
 * and the current user's position highlighted.
 *
 * Player names are the wallet's on-chain registered username (r/sys/users),
 * resolved client-side for the current page only, else a short address. The
 * backend's `username` field is the free-text profile title, which anyone can
 * set to look like someone else's @handle, so it is never shown as a name.
 *
 * Route: /:network/leaderboard
 */

import { useEffect } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useAdena } from "../hooks/useAdena"
import { useNetworkKey } from "../hooks/useNetworkNav"
import { useActorUsernames } from "../hooks/home/useActorUsernames"
import { api } from "../lib/api"
import { create } from "@bufbuild/protobuf"
import { GetLeaderboardRequestSchema } from "../gen/memba/v1/memba_pb"
import { RankBadge } from "../components/quests/RankBadge"
import { RANK_TIERS } from "../lib/gnobuilders"
import { trackPageVisit } from "../lib/quests"
import { useWindowActive } from "../os/page/WindowActivity"
import "./leaderboard.css"

const PAGE_SIZE = 50

export default function Leaderboard() {
    const { address } = useAdena()
    const nk = useNetworkKey()
    const windowActive = useWindowActive()
    const [searchParams, setSearchParams] = useSearchParams()
    const requestedPage = Number(searchParams.get("page"))
    const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 10_000
        ? requestedPage - 1 : 0
    const setPage = (nextPage: number) => setSearchParams(previous => {
        const next = new URLSearchParams(previous)
        if (nextPage <= 0) next.delete("page")
        else next.set("page", String(nextPage + 1))
        return next
    }, { replace: true })

    useEffect(() => {
        document.title = "Leaderboard — Memba"
        trackPageVisit("leaderboard")
    }, [])

    const leaderboard = useQuery({
        queryKey: ["quests", "leaderboard", page],
        enabled: windowActive,
        queryFn: ({ signal }) => api.getLeaderboard(create(GetLeaderboardRequestSchema, {
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
        }), { signal }),
        staleTime: 30_000,
        retry: false,
    })

    const entries = leaderboard.data?.entries ?? []
    const totalCount = leaderboard.data?.totalCount ?? 0
    const totalPages = Math.ceil(totalCount / PAGE_SIZE)
    // Cached per address set; a failed or unregistered lookup is simply absent.
    const usernames = useActorUsernames(windowActive ? entries.map(e => e.address) : [])

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

            {leaderboard.isPending ? (
                <div className="k-leaderboard-loading">Loading leaderboard...</div>
            ) : leaderboard.isError ? (
                <div className="k-leaderboard-error">
                    <p>Unable to load leaderboard. The backend may be unavailable.</p>
                    <button type="button" className="k-leaderboard-page-btn" onClick={() => void leaderboard.refetch()}>Try again</button>
                </div>
            ) : entries.length === 0 ? (
                <div className="k-leaderboard-empty">
                    {page > 0 ? (
                        <>
                            <p>No players on this page.</p>
                            <button type="button" className="k-leaderboard-page-btn" onClick={() => setPage(0)}>Back to first page</button>
                        </>
                    ) : "No quest completions yet. Be the first to complete a quest!"}
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
                                            <Link to={`/${nk}/profile/${entry.address}`} className="k-leaderboard-addr" title={entry.address}>
                                                {usernames.has(entry.address)
                                                    ? `@${usernames.get(entry.address)}`
                                                    : truncate(entry.address)}
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
                                    onClick={() => setPage(page - 1)}
                                >
                                    Previous
                                </button>
                                <span className="k-leaderboard-page-info">
                                    Page {page + 1} of {totalPages}
                                </span>
                                <button
                                    className="k-leaderboard-page-btn"
                                    disabled={page >= totalPages - 1}
                                    onClick={() => setPage(page + 1)}
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
