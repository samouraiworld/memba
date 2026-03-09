/**
 * LeaderboardView — Sortable member ranking table.
 *
 * Displays DAO member stats (packages, proposals, votes, score)
 * with clickable column headers for sorting.
 *
 * MVP: All time only (no timeframe filter).
 *
 * @module plugins/leaderboard/LeaderboardView
 */

import { useState, useEffect, useCallback } from "react"
import type { PluginProps } from "../types"
import { getLeaderboardData, sortEntries } from "./queries"
import type { LeaderboardEntry, SortField, SortDir } from "./queries"

export default function LeaderboardView({ realmPath }: PluginProps) {
    const [entries, setEntries] = useState<LeaderboardEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [sortField, setSortField] = useState<SortField>("score")
    const [sortDir, setSortDir] = useState<SortDir>("desc")

    const loadData = useCallback(async () => {
        setLoading(true)
        try {
            // We'll use a placeholder — in production this queries the DAO members endpoint
            const data = await getLeaderboardData([])
            setEntries(data)
        } catch {
            // Silently fail — empty leaderboard
        } finally {
            setLoading(false)
        }
    }, [])

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
        color: "#00d4aa",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "JetBrains Mono, monospace",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        userSelect: "none",
    }

    const tdStyle: React.CSSProperties = {
        padding: "10px 12px",
        fontSize: 12,
        color: "#ccc",
        fontFamily: "JetBrains Mono, monospace",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
    }

    if (loading) {
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0" }}>
                {[1, 2, 3].map(i => (
                    <div key={i} className="k-shimmer" style={{ height: 40, borderRadius: 8, background: "#111" }} />
                ))}
            </div>
        )
    }

    return (
        <div id="leaderboard" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>🏆</span>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>
                    Leaderboard
                </h3>
                <span style={{
                    fontSize: 9, padding: "2px 8px", borderRadius: 4,
                    background: "rgba(0,212,170,0.08)", color: "#00d4aa",
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    All Time
                </span>
            </div>

            <div style={{ fontSize: 11, color: "#555", fontFamily: "JetBrains Mono, monospace" }}>
                Realm: <code style={{ color: "#666" }}>{realmPath}</code>
            </div>

            {sorted.length === 0 ? (
                <div style={{
                    padding: 24, textAlign: "center", fontSize: 12,
                    color: "#666", fontFamily: "JetBrains Mono, monospace",
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
                                    <td style={{ ...tdStyle, color: "#555" }}>{i + 1}</td>
                                    <td style={{ ...tdStyle, color: "#f0f0f0", fontWeight: 600 }}>
                                        {entry.username}
                                    </td>
                                    <td style={tdStyle}>{entry.packages}</td>
                                    <td style={tdStyle}>{entry.proposals}</td>
                                    <td style={tdStyle}>{entry.votes}</td>
                                    <td style={{ ...tdStyle, color: "#00d4aa", fontWeight: 600 }}>{entry.score}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
