/**
 * GnoloveAnalytics — Charts and statistics for Gno ecosystem contributions.
 *
 * Uses Recharts for data visualization with Memba CSS custom properties.
 *
 * @module pages/gnolove/GnoloveAnalytics
 */

import { useMemo } from "react"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
} from "recharts"
import {
    useGnoloveContributors,
    useGnoloveProposals,
    useGnoloveGovdaoMembers,
    useGnolovePackages,
    useGnoloveNamespaces,
} from "../../hooks/gnolove"
import { TEAMS, TEAM_CSS_COLORS, TimeFilter } from "../../lib/gnoloveConstants"

export default function GnoloveAnalytics() {
    const { data: contributors, isLoading } = useGnoloveContributors(TimeFilter.ALL_TIME)
    const { data: proposals } = useGnoloveProposals()
    const { data: govdaoMembers } = useGnoloveGovdaoMembers()
    const { data: packages } = useGnolovePackages()
    const { data: namespaces } = useGnoloveNamespaces()

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

    // ── Pie data for contribution types ──────────────────────
    const pieData = useMemo(() => {
        if (!stats) return []
        return [
            { name: "PRs", value: stats.totalPrs, color: "#00d4aa" },
            { name: "Commits", value: stats.totalCommits, color: "#4a9eff" },
            { name: "Issues", value: stats.totalIssues, color: "#ffc107" },
            { name: "Reviews", value: stats.totalReviews, color: "#a855f7" },
        ].filter(d => d.value > 0)
    }, [stats])

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

                    {/* Contribution Type Pie Chart */}
                    {pieData.length > 0 && (
                        <div className="gl-section">
                            <h2 className="gl-section-title">📊 Contribution Breakdown</h2>
                            <div className="gl-chart-container">
                                <ResponsiveContainer width="100%" height={300}>
                                    <PieChart>
                                        <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                                            outerRadius={100} innerRadius={50} paddingAngle={3}
                                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                            labelLine={{ stroke: "#555" }}>
                                            {pieData.map((entry, i) => (
                                                <Cell key={i} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                                        <Legend wrapperStyle={{ fontSize: 12, color: "#888" }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* PRs by Team (Bar Chart) */}
                    {teamData.length > 0 && (
                        <div className="gl-section">
                            <h2 className="gl-section-title">🔀 PRs by Team</h2>
                            <div className="gl-chart-container">
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={teamData} margin={{ left: 20, right: 20, top: 10, bottom: 30 }}>
                                        <XAxis dataKey="name" tick={{ fill: "#888", fontSize: 10 }} angle={-30} textAnchor="end" />
                                        <YAxis tick={{ fill: "#888", fontSize: 11 }} />
                                        <Tooltip contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                                        <Bar dataKey="prs" name="PRs" fill="#00d4aa" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="commits" name="Commits" fill="#4a9eff" radius={[4, 4, 0, 0]} />
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

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
    return (
        <div className="gl-stat-card">
            <div className="gl-stat-icon">{icon}</div>
            <div className="gl-stat-value">{value.toLocaleString()}</div>
            <div className="gl-stat-label">{label}</div>
        </div>
    )
}
