/**
 * LeaderboardView — Global Gno contributor ranking table.
 *
 * v2.10: Fetches DAO members via getDAOMembers(), queries gnolove
 * for stats per address. Falls back gracefully when gnolove API
 * returns SSR HTML or is unreachable.
 *
 * Rank badges: 🥇 🥈 🥉 for top 3.
 *
 * @module plugins/leaderboard/LeaderboardView
 */

import { useState, useEffect, useCallback } from "react"
import type { PluginProps } from "../types"
import { getDAOMembers } from "../../lib/dao"
import { GNO_RPC_URL } from "../../lib/config"
import { getLeaderboardData, sortEntries } from "./queries"
import type { LeaderboardEntry, SortField, SortDir } from "./queries"

const RANK_BADGES: Record<number, string> = { 0: "🥇", 1: "🥈", 2: "🥉" }

export default function LeaderboardView({ realmPath }: PluginProps) {
    const [entries, setEntries] = useState<LeaderboardEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [sortField, setSortField] = useState<SortField>("score")
    const [sortDir, setSortDir] = useState<SortDir>("desc")

    const loadData = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            // v2.10: Fetch actual DAO members for the leaderboard
            const members = await getDAOMembers(GNO_RPC_URL, realmPath)
            if (members.length === 0) {
                setEntries([])
                return
            }

            const memberInput = members.map(m => ({
                address: m.address,
                username: m.username || m.address.slice(0, 10) + "...",
            }))

            const data = await getLeaderboardData(memberInput)
            setEntries(data)
        } catch {
            setError("Could not load leaderboard data")
        } finally {
            setLoading(false)
        }
    }, [realmPath])

    useEffect(() => { loadData() }, [loadData])

    const handleSort = (field: SortField) => {
        if (field === sortField) {
            setSortDir(d => d === "asc" ? "desc" : "asc")
        } else {
            setSortField(field)
            setSortDir("desc")
        }
    }

    const sorted = sortEntries(entries, sortField, sortDir)
    const arrow = (field: SortField) => sortField === field ? (sortDir === "desc" ? " ↓" : " ↑") : ""

    // ── Styles ────────────────────────────────────────────────

    const thStyle: React.CSSProperties = {
        padding: "8px 12px",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--color-primary)",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "JetBrains Mono, monospace",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        userSelect: "none",
    }

    const tdStyle: React.CSSProperties = {
        padding: "10px 12px",
        fontSize: 12,
        color: "var(--color-text-secondary)",
        fontFamily: "JetBrains Mono, monospace",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
    }

    if (loading) {
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0" }}>
                {[1, 2, 3].map(i => (
                    <div key={i} className="k-shimmer" style={{ height: 40, borderRadius: 8, background: "var(--color-border)" }} />
                ))}
            </div>
        )
    }

    return (
        <div id="leaderboard" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>🏆</span>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)", margin: 0 }}>
                    Leaderboard
                </h3>
                <span style={{
                    fontSize: 9, padding: "2px 8px", borderRadius: 4,
                    background: "rgba(0,212,170,0.08)", color: "var(--color-primary)",
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    All Time
                </span>
                <a
                    href="/gnolove"
                    style={{
                        marginLeft: "auto", fontSize: 10, color: "var(--color-text-muted)",
                        textDecoration: "none", fontFamily: "JetBrains Mono, monospace",
                        transition: "color 0.15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = "#00d4aa"}
                    onMouseLeave={e => e.currentTarget.style.color = "#555"}
                >
                    Full analytics →
                </a>
            </div>

            <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "JetBrains Mono, monospace" }}>
                Realm: <code style={{ color: "var(--color-text-secondary)" }}>{realmPath}</code>
            </div>

            {error && (
                <div style={{
                    padding: "10px 14px", borderRadius: 8,
                    background: "rgba(255,59,48,0.03)", border: "1px solid rgba(255,59,48,0.1)",
                    fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace",
                }}>
                    ⚠ {error}
                </div>
            )}

            {sorted.length === 0 ? (
                <div style={{
                    padding: 24, textAlign: "center", fontSize: 12,
                    color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace",
                    borderRadius: 10, background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                }}>
                    No leaderboard data yet. Members will appear as they contribute.
                </div>
            ) : (
                <div style={{ overflowX: "auto", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr>
                                <th style={{ ...thStyle, width: 40 }}>#</th>
                                <th style={thStyle}>Member</th>
                                <th style={thStyle} onClick={() => handleSort("packages")}>Packages{arrow("packages")}</th>
                                <th style={thStyle} onClick={() => handleSort("proposals")}>Proposals{arrow("proposals")}</th>
                                <th style={thStyle} onClick={() => handleSort("votes")}>Votes{arrow("votes")}</th>
                                <th style={thStyle} onClick={() => handleSort("score")}>Score{arrow("score")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((entry, i) => (
                                <tr key={entry.address}>
                                    <td style={{ ...tdStyle, color: "var(--color-text-muted)", fontSize: 14 }}>
                                        {RANK_BADGES[i] || i + 1}
                                    </td>
                                    <td style={{ ...tdStyle, color: "var(--color-text)", fontWeight: 600 }}>
                                        {entry.username}
                                    </td>
                                    <td style={tdStyle}>{entry.packages}</td>
                                    <td style={tdStyle}>{entry.proposals}</td>
                                    <td style={tdStyle}>{entry.votes}</td>
                                    <td style={{ ...tdStyle, color: "var(--color-primary)", fontWeight: 600 }}>{entry.score}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
