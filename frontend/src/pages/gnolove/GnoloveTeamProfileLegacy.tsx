/**
 * GnoloveTeamProfileLegacy — Pre-Phase-4 team page.
 *
 * Description + members + tracked-repo list. Kept as the auto-degrade
 * target for the new team hub: rendered when VITE_GNOLOVE_TEAM_HUB is
 * off OR when useGnoloveBackendHealth() reports the backend is down.
 * Don't add new features here — they belong in the hub.
 *
 * @module pages/gnolove/GnoloveTeamProfileLegacy
 */

import { useMemo } from "react"
import { useParams, Link } from "react-router-dom"
import { useGnoloveContributors, useGnoloveRepositories } from "../../hooks/gnolove"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { PageMeta } from "../../components/gnolove/PageMeta"
import { TimeFilter, TEAMS, TEAM_CSS_COLORS } from "../../lib/gnoloveConstants"

export default function GnoloveTeamProfileLegacy() {
    const np = useNetworkPath()
    const { teamName } = useParams<{ teamName: string }>()
    const decodedName = teamName ? decodeURIComponent(teamName) : ""
    const team = TEAMS.find(t => t.name === decodedName)
    const { data: contributors, isLoading } = useGnoloveContributors(TimeFilter.ALL_TIME)
    const { data: repositories } = useGnoloveRepositories()

    const teamMembers = useMemo(() => {
        if (!team || !contributors?.users) return []
        return contributors.users
            .filter(u => team.members.includes(u.login))
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    }, [team, contributors])

    const stats = useMemo(() => {
        if (!teamMembers.length) return null
        return {
            totalScore: teamMembers.reduce((s, m) => s + (m.score ?? 0), 0),
            totalPrs: teamMembers.reduce((s, m) => s + (m.TotalPrs ?? 0), 0),
            totalCommits: teamMembers.reduce((s, m) => s + (m.TotalCommits ?? 0), 0),
            totalIssues: teamMembers.reduce((s, m) => s + (m.TotalIssues ?? 0), 0),
            totalReviews: teamMembers.reduce((s, m) => s + (m.TotalReviewedPullRequests ?? 0), 0),
        }
    }, [teamMembers])

    if (!team) {
        return (
            <div className="gl-page">
                <Link to={np("gnolove/teams")} className="gl-profile-back">&larr; Back to Teams</Link>
                <div className="gl-empty">Team not found: {decodedName}</div>
            </div>
        )
    }

    return (
        <div className="gl-page">
            <PageMeta title={`${team.name} | Gnolove · Memba`} description={team.description ?? `Team profile for ${team.name}.`} />
            <Link to={np("gnolove/teams")} className="gl-profile-back">&larr; Back to Teams</Link>

            <div className="gl-team-profile-header" style={{ borderLeftColor: TEAM_CSS_COLORS[team.color] }}>
                <div>
                    <h1 className="gl-title" style={{ color: TEAM_CSS_COLORS[team.color], marginBottom: 4 }}>
                        {team.name}
                    </h1>
                    {team.description && (
                        <p className="gl-team-profile-desc">{team.description}</p>
                    )}
                </div>
                {stats && (
                    <div className="gl-team-profile-stats">
                        <div className="gl-team-profile-stat">
                            <span className="gl-team-profile-stat-value">{stats.totalScore}</span>
                            <span className="gl-team-profile-stat-label">Score</span>
                        </div>
                        <div className="gl-team-profile-stat">
                            <span className="gl-team-profile-stat-value">{stats.totalPrs}</span>
                            <span className="gl-team-profile-stat-label">PRs</span>
                        </div>
                        <div className="gl-team-profile-stat">
                            <span className="gl-team-profile-stat-value">{stats.totalCommits}</span>
                            <span className="gl-team-profile-stat-label">Commits</span>
                        </div>
                        <div className="gl-team-profile-stat">
                            <span className="gl-team-profile-stat-value">{stats.totalIssues}</span>
                            <span className="gl-team-profile-stat-label">Issues</span>
                        </div>
                        <div className="gl-team-profile-stat">
                            <span className="gl-team-profile-stat-value">{stats.totalReviews}</span>
                            <span className="gl-team-profile-stat-label">Reviews</span>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Team Repositories ─────────────────────────── */}
            {repositories && repositories.length > 0 && (
                <div className="gl-section">
                    <h2 className="gl-section-title">Tracked Repositories ({repositories.length})</h2>
                    <div className="gl-team-repos">
                        {repositories.map(repo => (
                            <a
                                key={repo.id}
                                href={`https://github.com/${repo.owner}/${repo.name}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="gl-team-repo"
                            >
                                <span className="gl-team-repo-name">{repo.owner}/{repo.name}</span>
                                <span className="gl-team-repo-branch">{repo.baseBranch}</span>
                            </a>
                        ))}
                    </div>
                </div>
            )}

            <div className="gl-section">
                <h2 className="gl-section-title">Members ({teamMembers.length})</h2>
                {isLoading ? (
                    <div className="gl-loading">
                        <div className="gl-skeleton" /><div className="gl-skeleton" />
                    </div>
                ) : (
                    <div className="gl-teams-members">
                        {teamMembers.map((user, i) => (
                            <Link
                                key={user.id}
                                to={np(`gnolove/contributor/${user.login}`)}
                                className="gl-teams-member"
                            >
                                <span className="gl-team-member-rank">#{i + 1}</span>
                                <img src={user.avatarUrl} alt="" className="gl-teams-member-avatar" loading="lazy" />
                                <div className="gl-teams-member-info">
                                    <span className="gl-teams-member-name">{user.name || user.login}</span>
                                    <span className="gl-teams-member-login">@{user.login}</span>
                                </div>
                                <div className="gl-teams-member-stats">
                                    <span className="gl-teams-member-score">{user.score ?? 0} pts</span>
                                    <span className="gl-teams-member-detail">
                                        {user.TotalPrs ?? 0} PRs &middot; {user.TotalCommits ?? 0} commits &middot; {user.TotalReviewedPullRequests ?? 0} reviews
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
