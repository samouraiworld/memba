/**
 * GnoloveAnalytics — Ecosystem insights with stat cards and contribution charts.
 *
 * Uses Recharts for bar charts.
 *
 * @module pages/gnolove/GnoloveAnalytics
 */

import { useMemo } from "react"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts"
import {
    useGnoloveContributors,
    useGnoloveProposals,
    useGnoloveGovdaoMembers,
    useGnolovePackages,
    useGnoloveNamespaces,
    useGnoloveRepoActivity,
} from "../../hooks/gnolove"
import { TEAMS, TEAM_CSS_COLORS, TimeFilter } from "../../lib/gnoloveConstants"

const TOOLTIP_STYLE = {
    background: "#1a1a2e",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    fontSize: 12,
}

export default function GnoloveAnalytics() {
    const { data: contributors, isLoading } = useGnoloveContributors(TimeFilter.ALL_TIME)
    const { data: proposals } = useGnoloveProposals()
    const { data: govdaoMembers } = useGnoloveGovdaoMembers()
    const { data: packages } = useGnolovePackages()
    const { data: namespaces } = useGnoloveNamespaces()
    const { data: repoActivity } = useGnoloveRepoActivity()

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

    // ── Top repos by merged PRs ──────────────────────────────
    const topRepos = useMemo(() => {
        if (!repoActivity) return []
        return repoActivity.slice(0, 15)
    }, [repoActivity])

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

            {isLoading ? (
                <div className="gl-loading">
                    <div className="gl-skeleton" style={{ height: 300 }} />
                </div>
            ) : (
                <>
                    {/* Chart A: Contribution Distribution */}
                    {contributionTiers.length > 0 && (
                        <div className="gl-section">
                            <h2 className="gl-section-title">📊 Contribution Distribution</h2>
                            <p className="gl-section-desc">Number of contributors grouped by total merged PRs</p>
                            <div className="gl-chart-container">
                                <ResponsiveContainer width="100%" height={350}>
                                    <BarChart data={contributionTiers} margin={{ left: 10, right: 20, top: 10, bottom: 10 }}>
                                        <XAxis dataKey="label" tick={{ fill: "#f0f0f0", fontSize: 12 }} />
                                        <YAxis tick={{ fill: "#888", fontSize: 11 }} />
                                        <Tooltip
                                            contentStyle={TOOLTIP_STYLE}
                                            labelStyle={{ color: "#f0f0f0" }}
                                        />
                                        <Bar dataKey="count" name="Contributors" fill="#00d4aa" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* Chart B: Team Contribution Breakdown */}
                    {teamData.length > 0 && (
                        <div className="gl-section">
                            <h2 className="gl-section-title">🏆 Team Contribution Breakdown</h2>
                            <p className="gl-section-desc">PRs, commits, issues, and reviews by team</p>
                            <div className="gl-chart-container">
                                <ResponsiveContainer width="100%" height={350}>
                                    <BarChart data={teamData} layout="vertical" margin={{ left: 120, right: 20, top: 10, bottom: 10 }}>
                                        <XAxis type="number" tick={{ fill: "#888", fontSize: 11 }} />
                                        <YAxis type="category" dataKey="name" tick={{ fill: "#f0f0f0", fontSize: 12 }} width={110} />
                                        <Tooltip
                                            contentStyle={TOOLTIP_STYLE}
                                            labelStyle={{ color: "#f0f0f0" }}
                                        />
                                        <Legend />
                                        <Bar dataKey="prs" name="PRs" fill="#4a9eff" radius={[0, 4, 4, 0]} />
                                        <Bar dataKey="commits" name="Commits" fill="#22c55e" radius={[0, 4, 4, 0]} />
                                        <Bar dataKey="issues" name="Issues" fill="#ffc107" radius={[0, 4, 4, 0]} />
                                        <Bar dataKey="reviews" name="Reviews" fill="#a855f7" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* Chart C: Most Active Repositories */}
                    {topRepos.length > 0 && (
                        <div className="gl-section">
                            <h2 className="gl-section-title">📂 Most Active Repositories</h2>
                            <p className="gl-section-desc">Top repositories by merged PRs in the last year</p>
                            <div className="gl-chart-container">
                                <ResponsiveContainer width="100%" height={Math.max(300, topRepos.length * 30)}>
                                    <BarChart data={topRepos} layout="vertical" margin={{ left: 120, right: 20, top: 10, bottom: 10 }}>
                                        <XAxis type="number" tick={{ fill: "#888", fontSize: 11 }} />
                                        <YAxis type="category" dataKey="name" tick={{ fill: "#f0f0f0", fontSize: 12 }} width={110} />
                                        <Tooltip
                                            contentStyle={TOOLTIP_STYLE}
                                            labelStyle={{ color: "#f0f0f0" }}
                                        />
                                        <Bar dataKey="prs" name="Merged PRs" fill="#00d4aa" radius={[0, 4, 4, 0]} />
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
