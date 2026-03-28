/**
 * GnoloveAnalytics — Ecosystem insights with contribution heatmap and team scores.
 *
 * Uses Recharts for bar charts and a custom SVG heatmap calendar.
 *
 * @module pages/gnolove/GnoloveAnalytics
 */

import { useState, useMemo } from "react"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts"
import {
    useGnoloveContributors,
    useGnoloveProposals,
    useGnoloveGovdaoMembers,
    useGnolovePackages,
    useGnoloveNamespaces,
    useGnoloveHeatmapData,
} from "../../hooks/gnolove"
import { TEAMS, TEAM_CSS_COLORS, TimeFilter } from "../../lib/gnoloveConstants"

type HeatmapRange = "3m" | "6m" | "1y"

export default function GnoloveAnalytics() {
    const { data: contributors, isLoading } = useGnoloveContributors(TimeFilter.ALL_TIME)
    const { data: proposals } = useGnoloveProposals()
    const { data: govdaoMembers } = useGnoloveGovdaoMembers()
    const { data: packages } = useGnolovePackages()
    const { data: namespaces } = useGnoloveNamespaces()

    const [heatmapRange, setHeatmapRange] = useState<HeatmapRange>("6m")

    // Top 20 contributors by score for heatmap data
    const topLogins = useMemo(() => {
        if (!contributors?.users) return []
        return [...contributors.users]
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, 20)
            .map(u => u.login)
    }, [contributors])

    const { data: heatmapData, isLoading: heatmapLoading } = useGnoloveHeatmapData(topLogins)

    // ── Team contribution breakdown ──────────────────────────
    const teamData = useMemo(() => {
        if (!contributors?.users) return []
        return TEAMS.map(team => {
            const members = contributors.users.filter(u => team.members.includes(u.login))
            return {
                name: team.name,
                score: members.reduce((s, m) => s + (m.score ?? 0), 0),
                prs: members.reduce((s, m) => s + (m.TotalPrs ?? 0), 0),
                commits: members.reduce((s, m) => s + (m.TotalCommits ?? 0), 0),
                issues: members.reduce((s, m) => s + (m.TotalIssues ?? 0), 0),
                reviews: members.reduce((s, m) => s + (m.TotalReviewedPullRequests ?? 0), 0),
                color: TEAM_CSS_COLORS[team.color],
            }
        }).filter(t => t.score > 0).sort((a, b) => b.score - a.score)
    }, [contributors])

    // ── Summary stats ────────────────────────────────────────
    const stats = useMemo(() => {
        if (!contributors?.users) return null
        const users = contributors.users
        return {
            totalContributors: users.length,
            totalPrs: users.reduce((s, u) => s + (u.TotalPrs ?? 0), 0),
            totalCommits: users.reduce((s, u) => s + (u.TotalCommits ?? 0), 0),
            totalIssues: users.reduce((s, u) => s + (u.TotalIssues ?? 0), 0),
            totalReviews: users.reduce((s, u) => s + (u.TotalReviewedPullRequests ?? 0), 0),
            totalProposals: proposals?.length ?? 0,
            govdaoMembers: govdaoMembers?.length ?? 0,
            totalPackages: packages?.length ?? 0,
            totalNamespaces: namespaces?.length ?? 0,
        }
    }, [contributors, proposals, govdaoMembers, packages, namespaces])

    return (
        <div className="gl-page">
            <div className="gl-header">
                <h1 className="gl-title">📈 Analytics</h1>
            </div>

            {/* Summary Stats */}
            {stats && (
                <div className="gl-stats-grid">
                    <StatCard label="Contributors" value={stats.totalContributors} icon="👥" />
                    <StatCard label="Pull Requests" value={stats.totalPrs} icon="🔀" />
                    <StatCard label="Commits" value={stats.totalCommits} icon="📝" />
                    <StatCard label="Issues" value={stats.totalIssues} icon="🐛" />
                    <StatCard label="Reviews" value={stats.totalReviews} icon="👁️" />
                    <StatCard label="Proposals" value={stats.totalProposals} icon="🗳️" />
                    <StatCard label="GovDAO Members" value={stats.govdaoMembers} icon="🏛️" />
                    <StatCard label="Packages" value={stats.totalPackages} icon="📦" />
                    <StatCard label="Namespaces" value={stats.totalNamespaces} icon="🏷️" />
                </div>
            )}

            {/* Contribution Heatmap */}
            <div className="gl-section">
                <div className="gl-section-header">
                    <h2 className="gl-section-title">🗓️ Top Contributors Activity</h2>
                    <div className="gl-heatmap-range">
                        {(["3m", "6m", "1y"] as HeatmapRange[]).map(r => (
                            <button
                                key={r}
                                className={`gl-filter-btn gl-filter-btn--sm ${heatmapRange === r ? "gl-filter-btn--active" : ""}`}
                                onClick={() => setHeatmapRange(r)}
                            >
                                {r === "3m" ? "3 months" : r === "6m" ? "6 months" : "1 year"}
                            </button>
                        ))}
                    </div>
                </div>
                {heatmapLoading || isLoading ? (
                    <div className="gl-loading">
                        <div className="gl-skeleton" style={{ height: 140 }} />
                    </div>
                ) : heatmapData && heatmapData.length > 0 ? (
                    <ContributionHeatmap data={heatmapData} range={heatmapRange} />
                ) : (
                    <div className="gl-empty">No contribution data available for heatmap.</div>
                )}
            </div>

            {isLoading ? (
                <div className="gl-loading">
                    <div className="gl-skeleton" style={{ height: 300 }} />
                </div>
            ) : (
                <>
                    {/* Team Score Bar Chart */}
                    {teamData.length > 0 && (
                        <div className="gl-section">
                            <h2 className="gl-section-title">🏆 Team Contribution Scores</h2>
                            <div className="gl-chart-container">
                                <ResponsiveContainer width="100%" height={350}>
                                    <BarChart data={teamData} layout="vertical" margin={{ left: 120, right: 20, top: 10, bottom: 10 }}>
                                        <XAxis type="number" tick={{ fill: "#888", fontSize: 11 }} />
                                        <YAxis type="category" dataKey="name" tick={{ fill: "#f0f0f0", fontSize: 12 }} width={110} />
                                        <Tooltip
                                            contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                                            labelStyle={{ color: "#f0f0f0" }}
                                        />
                                        <Bar dataKey="score" name="Score" radius={[0, 4, 4, 0]}>
                                            {teamData.map((entry, i) => (
                                                <Cell key={i} fill={entry.color} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

// ── Sub-components ───────────────────────────────────────────

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
    return (
        <div className="gl-stat-card">
            <div className="gl-stat-icon">{icon}</div>
            <div className="gl-stat-value">{value.toLocaleString()}</div>
            <div className="gl-stat-label">{label}</div>
        </div>
    )
}

const CELL_SIZE = 12
const CELL_GAP = 2
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""]

function ContributionHeatmap({ data, range }: {
    data: Array<{ date: string; count: number }>
    range: HeatmapRange
}) {
    const { cells, weeks, maxCount, monthLabels } = useMemo(() => {
        const now = new Date()
        const months = range === "3m" ? 3 : range === "6m" ? 6 : 12
        const startDate = new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
        // Align to start of week (Monday)
        const dayOfWeek = startDate.getDay()
        startDate.setDate(startDate.getDate() - ((dayOfWeek + 6) % 7))

        const dayMap = new Map<string, number>()
        for (const { date, count } of data) {
            dayMap.set(date, count)
        }

        const cells: Array<{ x: number; y: number; date: string; count: number }> = []
        const monthLabels: Array<{ x: number; label: string }> = []
        let maxCount = 0
        const currentDate = new Date(startDate)
        let week = 0
        let lastMonth = -1

        while (currentDate <= now) {
            const dayIdx = (currentDate.getDay() + 6) % 7 // Monday = 0
            const dateStr = currentDate.toISOString().split("T")[0]
            const count = dayMap.get(dateStr) ?? 0
            if (count > maxCount) maxCount = count

            cells.push({ x: week, y: dayIdx, date: dateStr, count })

            if (currentDate.getMonth() !== lastMonth) {
                monthLabels.push({ x: week, label: currentDate.toLocaleString("en", { month: "short" }) })
                lastMonth = currentDate.getMonth()
            }

            currentDate.setDate(currentDate.getDate() + 1)
            if ((currentDate.getDay() + 6) % 7 === 0) week++
        }

        return { cells, weeks: week + 1, maxCount, monthLabels }
    }, [data, range])

    const leftPad = 30
    const topPad = 18
    const svgWidth = leftPad + weeks * (CELL_SIZE + CELL_GAP) + 4
    const svgHeight = topPad + 7 * (CELL_SIZE + CELL_GAP) + 4

    function cellColor(count: number): string {
        if (count === 0 || maxCount === 0) return "rgba(255, 255, 255, 0.03)"
        const intensity = count / maxCount
        if (intensity < 0.25) return "rgba(0, 212, 170, 0.15)"
        if (intensity < 0.5) return "rgba(0, 212, 170, 0.35)"
        if (intensity < 0.75) return "rgba(0, 212, 170, 0.6)"
        return "#00d4aa"
    }

    return (
        <div className="gl-heatmap-wrap">
            <svg width={svgWidth} height={svgHeight} className="gl-heatmap-svg"
                 role="img" aria-label={`Contribution heatmap showing top contributor activity over the last ${range === "3m" ? "3 months" : range === "6m" ? "6 months" : "year"}`}>
                {/* Month labels */}
                {monthLabels.map((m, i) => (
                    <text
                        key={i}
                        x={leftPad + m.x * (CELL_SIZE + CELL_GAP)}
                        y={12}
                        fill="#666"
                        fontSize={9}
                        fontFamily="JetBrains Mono, monospace"
                    >
                        {m.label}
                    </text>
                ))}
                {/* Day labels */}
                {DAY_LABELS.map((label, i) => (
                    label && (
                        <text
                            key={i}
                            x={0}
                            y={topPad + i * (CELL_SIZE + CELL_GAP) + CELL_SIZE - 2}
                            fill="#555"
                            fontSize={8}
                            fontFamily="JetBrains Mono, monospace"
                        >
                            {label}
                        </text>
                    )
                ))}
                {/* Cells */}
                {cells.map((cell, i) => (
                    <rect
                        key={i}
                        x={leftPad + cell.x * (CELL_SIZE + CELL_GAP)}
                        y={topPad + cell.y * (CELL_SIZE + CELL_GAP)}
                        width={CELL_SIZE}
                        height={CELL_SIZE}
                        rx={2}
                        fill={cellColor(cell.count)}
                        className="gl-heatmap-cell"
                    >
                        <title>{cell.date}: {cell.count} contribution{cell.count !== 1 ? "s" : ""}</title>
                    </rect>
                ))}
            </svg>
            <div className="gl-heatmap-legend">
                <span className="gl-heatmap-legend-label">Less</span>
                {[0, 0.15, 0.35, 0.6, 1].map((_, i) => (
                    <span
                        key={i}
                        className="gl-heatmap-legend-cell"
                        style={{
                            background: i === 0 ? "rgba(255,255,255,0.03)" :
                                i === 1 ? "rgba(0,212,170,0.15)" :
                                i === 2 ? "rgba(0,212,170,0.35)" :
                                i === 3 ? "rgba(0,212,170,0.6)" : "#00d4aa"
                        }}
                    />
                ))}
                <span className="gl-heatmap-legend-label">More</span>
            </div>
        </div>
    )
}
