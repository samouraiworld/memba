/**
 * GnoloveAnalytics — Grafana-inspired ecosystem insights dashboard.
 *
 * Stat cards with sparklines, time-series area chart, distribution/team/repo
 * bar charts, and on-chain governance metrics.
 *
 * @module pages/gnolove/GnoloveAnalytics
 */

import { useMemo } from "react"
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
    ResponsiveContainer, Legend, CartesianGrid,
} from "recharts"
import {
    useGnoloveContributors,
    useGnoloveProposals,
    useGnoloveGovdaoMembers,
    useGnolovePackages,
    useGnoloveNamespaces,
    useGnoloveRepoActivity,
    useGnoloveMonthlyActivity,
} from "../../hooks/gnolove"
import { TEAMS, TEAM_CSS_COLORS, TimeFilter } from "../../lib/gnoloveConstants"

const TOOLTIP_STYLE = {
    background: "#12121e",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 6,
    fontSize: 11,
    fontFamily: "JetBrains Mono, monospace",
}

const GRID_STYLE = { stroke: "rgba(255,255,255,0.04)" }
const AXIS_TICK = { fill: "#666", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }

export default function GnoloveAnalytics() {
    const { data: contributors, isLoading } = useGnoloveContributors(TimeFilter.ALL_TIME)
    const { data: proposals } = useGnoloveProposals()
    const { data: govdaoMembers } = useGnoloveGovdaoMembers()
    const { data: packages } = useGnolovePackages()
    const { data: namespaces } = useGnoloveNamespaces()
    const { data: repoActivity } = useGnoloveRepoActivity()
    const { data: monthlyActivity } = useGnoloveMonthlyActivity()

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

    // ── Contribution distribution tiers ──────────────────────
    const contributionTiers = useMemo(() => {
        if (!contributors?.users) return []
        const tiers = [
            { label: "1 PR", min: 1, max: 1, count: 0 },
            { label: "2-5", min: 2, max: 5, count: 0 },
            { label: "6-10", min: 6, max: 10, count: 0 },
            { label: "11-25", min: 11, max: 25, count: 0 },
            { label: "26-50", min: 26, max: 50, count: 0 },
            { label: "50+", min: 51, max: Infinity, count: 0 },
        ]
        for (const user of contributors.users) {
            const prs = user.TotalPrs ?? 0
            if (prs === 0) continue
            const tier = tiers.find(t => prs >= t.min && prs <= t.max)
            if (tier) tier.count++
        }
        return tiers
    }, [contributors])

    // ── Proposal vote aggregation ────────────────────────────
    const voteData = useMemo(() => {
        if (!proposals?.length) return []
        return proposals
            .filter(p => p.votes.length > 0)
            .slice(0, 20)
            .map(p => {
                const yes = p.votes.filter(v => v.vote === "YES").length
                const no = p.votes.filter(v => v.vote === "NO").length
                const abstain = p.votes.filter(v => v.vote === "ABSTAIN").length
                const label = p.title || `#${p.id.slice(0, 6)}`
                return { name: label.length > 20 ? label.slice(0, 20) + "..." : label, yes, no, abstain }
            })
            .reverse()
    }, [proposals])

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

    // ── Sparkline data from monthly activity ─────────────────
    const sparklineMerged = useMemo(() => {
        if (!monthlyActivity?.length) return []
        return monthlyActivity.map(m => m.merged)
    }, [monthlyActivity])

    const sparklineOpen = useMemo(() => {
        if (!monthlyActivity?.length) return []
        return monthlyActivity.map(m => m.open + m.inReview)
    }, [monthlyActivity])

    return (
        <div className="gl-page">
            <div className="gl-header">
                <h1 className="gl-title">📈 Ecosystem Insights</h1>
            </div>

            {/* ── Stat Cards with Sparklines ──────────────────── */}
            {stats && (
                <div className="gl-dash-stats">
                    <DashStatCard label="Contributors" value={stats.totalContributors} icon="👥" />
                    <DashStatCard label="Pull Requests" value={stats.totalPrs} icon="🔀" sparkline={sparklineMerged} color="#00d4aa" />
                    <DashStatCard label="Commits" value={stats.totalCommits} icon="📝" />
                    <DashStatCard label="Issues" value={stats.totalIssues} icon="🐛" />
                    <DashStatCard label="Reviews" value={stats.totalReviews} icon="👁️" sparkline={sparklineOpen} color="#a855f7" />
                    <DashStatCard label="GovDAO" value={stats.govdaoMembers} icon="🏛️" />
                </div>
            )}

            {/* ── Monthly Activity Trend (centerpiece) ────────── */}
            {monthlyActivity && monthlyActivity.length > 0 && (
                <div className="gl-panel">
                    <div className="gl-panel-header">
                        <h2 className="gl-panel-title">PR Activity Trend</h2>
                        <span className="gl-panel-subtitle">Merged, reviewed, and open PRs per month</span>
                    </div>
                    <div className="gl-chart-container">
                        <ResponsiveContainer width="100%" height={280}>
                            <AreaChart data={monthlyActivity} margin={{ left: 10, right: 10, top: 10, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="gradMerged" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#00d4aa" stopOpacity={0.3} />
                                        <stop offset="100%" stopColor="#00d4aa" stopOpacity={0.02} />
                                    </linearGradient>
                                    <linearGradient id="gradReviewed" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#a855f7" stopOpacity={0.25} />
                                        <stop offset="100%" stopColor="#a855f7" stopOpacity={0.02} />
                                    </linearGradient>
                                    <linearGradient id="gradOpen" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#4a9eff" stopOpacity={0.2} />
                                        <stop offset="100%" stopColor="#4a9eff" stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid {...GRID_STYLE} />
                                <XAxis dataKey="month" tick={AXIS_TICK} tickFormatter={m => m.slice(5)} />
                                <YAxis tick={AXIS_TICK} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#f0f0f0" }} />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                                <Area type="monotone" dataKey="merged" name="Merged" stroke="#00d4aa" strokeWidth={2} fill="url(#gradMerged)" />
                                <Area type="monotone" dataKey="inReview" name="In Review" stroke="#a855f7" strokeWidth={1.5} fill="url(#gradReviewed)" />
                                <Area type="monotone" dataKey="open" name="Open" stroke="#4a9eff" strokeWidth={1.5} fill="url(#gradOpen)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {isLoading ? (
                <div className="gl-loading">
                    <div className="gl-skeleton" style={{ height: 300 }} />
                </div>
            ) : (
                <>
                    {/* ── Two-column chart row ────────────────── */}
                    <div className="gl-panel-grid">
                        {/* Contribution Distribution */}
                        {contributionTiers.length > 0 && (
                            <div className="gl-panel">
                                <div className="gl-panel-header">
                                    <h2 className="gl-panel-title">Contributor Distribution</h2>
                                    <span className="gl-panel-subtitle">By merged PR count</span>
                                </div>
                                <div className="gl-chart-container">
                                    <ResponsiveContainer width="100%" height={260}>
                                        <BarChart data={contributionTiers} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
                                            <CartesianGrid {...GRID_STYLE} />
                                            <XAxis dataKey="label" tick={AXIS_TICK} />
                                            <YAxis tick={AXIS_TICK} />
                                            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#f0f0f0" }} />
                                            <Bar dataKey="count" name="Contributors" fill="#00d4aa" radius={[3, 3, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {/* Most Active Repositories */}
                        {repoActivity && repoActivity.length > 0 && (
                            <div className="gl-panel">
                                <div className="gl-panel-header">
                                    <h2 className="gl-panel-title">Most Active Repos</h2>
                                    <span className="gl-panel-subtitle">Merged PRs (past year)</span>
                                </div>
                                <div className="gl-chart-container">
                                    <ResponsiveContainer width="100%" height={260}>
                                        <BarChart data={repoActivity.slice(0, 8)} layout="vertical" margin={{ left: 100, right: 10, top: 10, bottom: 0 }}>
                                            <CartesianGrid {...GRID_STYLE} />
                                            <XAxis type="number" tick={AXIS_TICK} />
                                            <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} width={90} />
                                            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#f0f0f0" }} />
                                            <Bar dataKey="prs" name="Merged PRs" fill="#4a9eff" radius={[0, 3, 3, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Team Contribution Breakdown ─────────── */}
                    {teamData.length > 0 && (
                        <div className="gl-panel">
                            <div className="gl-panel-header">
                                <h2 className="gl-panel-title">Team Breakdown</h2>
                                <span className="gl-panel-subtitle">PRs, commits, issues, and reviews by team</span>
                            </div>
                            <div className="gl-chart-container">
                                <ResponsiveContainer width="100%" height={Math.max(280, teamData.length * 45)}>
                                    <BarChart data={teamData} layout="vertical" margin={{ left: 120, right: 20, top: 10, bottom: 10 }}>
                                        <CartesianGrid {...GRID_STYLE} />
                                        <XAxis type="number" tick={AXIS_TICK} />
                                        <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fill: "#ccc", fontSize: 11 }} width={110} />
                                        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#f0f0f0" }} />
                                        <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                                        <Bar dataKey="prs" name="PRs" fill="#4a9eff" radius={[0, 2, 2, 0]} />
                                        <Bar dataKey="commits" name="Commits" fill="#22c55e" radius={[0, 2, 2, 0]} />
                                        <Bar dataKey="issues" name="Issues" fill="#ffc107" radius={[0, 2, 2, 0]} />
                                        <Bar dataKey="reviews" name="Reviews" fill="#a855f7" radius={[0, 2, 2, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* ── Two-column bottom row ───────────────── */}
                    <div className="gl-panel-grid">
                        {/* Proposal Vote Distribution */}
                        {voteData.length > 0 && (
                            <div className="gl-panel">
                                <div className="gl-panel-header">
                                    <h2 className="gl-panel-title">Governance Votes</h2>
                                    <span className="gl-panel-subtitle">Proposal vote distribution</span>
                                </div>
                                <div className="gl-chart-container">
                                    <ResponsiveContainer width="100%" height={260}>
                                        <BarChart data={voteData.slice(0, 10)} layout="vertical" margin={{ left: 90, right: 10, top: 10, bottom: 0 }}>
                                            <CartesianGrid {...GRID_STYLE} />
                                            <XAxis type="number" tick={AXIS_TICK} />
                                            <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} width={80} />
                                            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#f0f0f0" }} />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace" }} />
                                            <Bar dataKey="yes" name="Yes" stackId="votes" fill="#22c55e" />
                                            <Bar dataKey="no" name="No" stackId="votes" fill="#ef4444" />
                                            <Bar dataKey="abstain" name="Abstain" stackId="votes" fill="#777" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {/* On-Chain Overview */}
                        <div className="gl-panel">
                            <div className="gl-panel-header">
                                <h2 className="gl-panel-title">On-Chain Metrics</h2>
                                <span className="gl-panel-subtitle">Gno ecosystem on-chain data</span>
                            </div>
                            <div className="gl-onchain-grid">
                                <OnchainMetric label="Proposals" value={proposals?.length ?? 0} icon="🗳️" />
                                <OnchainMetric label="GovDAO Members" value={govdaoMembers?.length ?? 0} icon="🏛️" />
                                <OnchainMetric label="Packages" value={packages?.length ?? 0} icon="📦" />
                                <OnchainMetric label="Namespaces" value={namespaces?.length ?? 0} icon="🏷️" />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}

// ── Sub-components ───────────────────────────────────────────

function DashStatCard({ label, value, icon, sparkline, color }: {
    label: string; value: number; icon: string; sparkline?: number[]; color?: string
}) {
    return (
        <div className="gl-dash-card">
            <div className="gl-dash-card-top">
                <span className="gl-dash-card-icon">{icon}</span>
                <span className="gl-dash-card-label">{label}</span>
            </div>
            <div className="gl-dash-card-value">{value.toLocaleString()}</div>
            {sparkline && sparkline.length > 2 && (
                <Sparkline data={sparkline} color={color ?? "#00d4aa"} />
            )}
        </div>
    )
}

function Sparkline({ data, color, width = 80, height = 24 }: {
    data: number[]; color: string; width?: number; height?: number
}) {
    const max = Math.max(...data, 1)
    const min = Math.min(...data, 0)
    const range = max - min || 1
    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width
        const y = height - ((v - min) / range) * height
        return `${x},${y}`
    }).join(" ")
    const areaPoints = `0,${height} ${points} ${width},${height}`

    return (
        <svg width={width} height={height} className="gl-sparkline" viewBox={`0 0 ${width} ${height}`}>
            <polygon points={areaPoints} fill={color} opacity={0.12} />
            <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    )
}

function OnchainMetric({ label, value, icon }: { label: string; value: number; icon: string }) {
    return (
        <div className="gl-onchain-metric">
            <span className="gl-onchain-metric-icon">{icon}</span>
            <div>
                <div className="gl-onchain-metric-value">{value.toLocaleString()}</div>
                <div className="gl-onchain-metric-label">{label}</div>
            </div>
        </div>
    )
}
