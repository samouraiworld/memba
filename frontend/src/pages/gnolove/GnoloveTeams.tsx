/**
 * GnoloveTeams — Dedicated teams page with full member lists and metrics.
 *
 * @module pages/gnolove/GnoloveTeams
 */

import { useMemo } from "react"
import { Link } from "react-router-dom"
import { useGnoloveContributors } from "../../hooks/gnolove"
import { TimeFilter, TEAMS, TEAM_CSS_COLORS } from "../../lib/gnoloveConstants"

export default function GnoloveTeams() {
    const { data: contributors, isLoading } = useGnoloveContributors(TimeFilter.ALL_TIME)

    const teamsWithMembers = useMemo(() => {
        if (!contributors?.users) return []
        return TEAMS.map(team => {
            const members = contributors.users
                .filter(u => team.members.includes(u.login))
                .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            const totalScore = members.reduce((s, m) => s + (m.score ?? 0), 0)
            const totalPrs = members.reduce((s, m) => s + (m.TotalPrs ?? 0), 0)
            const totalCommits = members.reduce((s, m) => s + (m.TotalCommits ?? 0), 0)
            const totalIssues = members.reduce((s, m) => s + (m.TotalIssues ?? 0), 0)
            const totalReviews = members.reduce((s, m) => s + (m.TotalReviewedPullRequests ?? 0), 0)
            return { ...team, members: members, totalScore, totalPrs, totalCommits, totalIssues, totalReviews }
        }).filter(t => t.members.length > 0).sort((a, b) => b.totalScore - a.totalScore)
    }, [contributors])

    return (
        <div className="gl-page">
            <Link to="/gnolove" className="gl-profile-back">← Back to Contributors Overview</Link>
            <div className="gl-header">
                <h1 className="gl-title">🏆 Teams</h1>
            </div>

            {isLoading ? (
                <div className="gl-loading">
                    <div className="gl-skeleton" /><div className="gl-skeleton" /><div className="gl-skeleton" />
                </div>
            ) : (
                <div className="gl-teams-list">
                    {teamsWithMembers.map((team, i) => (
                        <div
                            key={team.name}
                            className="gl-teams-panel"
                            style={{ borderLeftColor: TEAM_CSS_COLORS[team.color] }}
                        >
                            <div className="gl-teams-panel-header">
                                <div className="gl-teams-panel-title">
                                    <span className="gl-teams-panel-rank">#{i + 1}</span>
                                    <Link
                                        to={`/gnolove/teams/${encodeURIComponent(team.name)}`}
                                        style={{ color: TEAM_CSS_COLORS[team.color], margin: 0, fontSize: 16, fontWeight: 600, textDecoration: "none" }}
                                    >
                                        {team.name}
                                    </Link>
                                </div>
                                <div className="gl-teams-panel-stats">
                                    <span>⭐ {team.totalScore}</span>
                                    <span>🔀 {team.totalPrs} PRs</span>
                                    <span>📝 {team.totalCommits} commits</span>
                                    <span>🐛 {team.totalIssues} issues</span>
                                    <span>👁️ {team.totalReviews} reviews</span>
                                </div>
                            </div>

                            <div className="gl-teams-members">
                                {team.members.map(user => (
                                    <Link
                                        key={user.id}
                                        to={`/gnolove/contributor/${user.login}`}
                                        className="gl-teams-member"
                                    >
                                        <img src={user.avatarUrl} alt="" className="gl-teams-member-avatar" loading="lazy" />
                                        <div className="gl-teams-member-info">
                                            <span className="gl-teams-member-name">{user.name || user.login}</span>
                                            <span className="gl-teams-member-login">@{user.login}</span>
                                        </div>
                                        <div className="gl-teams-member-stats">
                                            <span className="gl-teams-member-score">{user.score ?? 0} pts</span>
                                            <span className="gl-teams-member-detail">{user.TotalPrs ?? 0} PRs · {user.TotalCommits ?? 0} commits</span>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
