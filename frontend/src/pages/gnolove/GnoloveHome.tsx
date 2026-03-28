/**
 * GnoloveHome — Contributor scoreboard, team cards, issues, and freshly merged PRs.
 *
 * Ported from gnolove scoreboard-page.tsx → vanilla CSS + React Query.
 * YouTube carousel removed, masonic → CSS Grid, Radix → vanilla.
 *
 * @module pages/gnolove/GnoloveHome
 */

import { useState, useMemo } from "react"
import {
    useGnoloveContributors,
    useGnoloveIssues,
    useGnoloveFreshlyMerged,
    useGnoloveRepositories,
    useGnoloveMilestone,
    useGnoloveScoreFactors,
} from "../../hooks/gnolove"
import { TimeFilter, TIME_FILTER_LABELS, TEAMS, TEAM_CSS_COLORS } from "../../lib/gnoloveConstants"
import type { Team } from "../../lib/gnoloveConstants"
import type { TEnhancedUserWithStats } from "../../lib/gnoloveSchemas"

type SortKey = "score" | "TotalCommits" | "TotalPrs" | "TotalIssues" | "TotalReviewedPullRequests"

export default function GnoloveHome() {
    const [timeFilter, setTimeFilter] = useState<TimeFilter>(TimeFilter.ALL_TIME)
    const [excludeCore, setExcludeCore] = useState(false)
    const [sortBy, setSortBy] = useState<SortKey>("score")
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

    const { data: contributors, isLoading, isFetching } = useGnoloveContributors(timeFilter, excludeCore)
    const { data: issues } = useGnoloveIssues()
    const { data: freshlyMerged } = useGnoloveFreshlyMerged()
    const { data: repos } = useGnoloveRepositories()
    const { data: milestone } = useGnoloveMilestone()
    const { data: scoreFactors } = useGnoloveScoreFactors()

    const sorted = useMemo(() => {
        if (!contributors?.users) return []
        return [...contributors.users].sort((a, b) => {
            const diff = (b[sortBy] ?? 0) - (a[sortBy] ?? 0)
            return sortDir === "desc" ? diff : -diff
        })
    }, [contributors, sortBy, sortDir])

    const handleSort = (key: SortKey) => {
        if (sortBy === key) setSortDir(d => (d === "desc" ? "asc" : "desc"))
        else { setSortBy(key); setSortDir("desc") }
    }

    const teamStats = useMemo(() => {
        if (!contributors?.users) return []
        return TEAMS.map(team => {
            const members = contributors.users.filter(u => team.members.includes(u.login))
            const totalScore = members.reduce((s, m) => s + (m.score ?? 0), 0)
            const totalPrs = members.reduce((s, m) => s + (m.TotalPrs ?? 0), 0)
            const totalCommits = members.reduce((s, m) => s + (m.TotalCommits ?? 0), 0)
            return { ...team, memberCount: members.length, totalScore, totalPrs, totalCommits }
        }).filter(t => t.memberCount > 0).sort((a, b) => b.totalScore - a.totalScore)
    }, [contributors])

    // Precompute login → team lookup (O(1) per row instead of O(n*m))
    const loginToTeam = useMemo(() => {
        const map = new Map<string, Team>()
        for (const team of TEAMS) {
            for (const login of team.members) {
                map.set(login, team)
            }
        }
        return map
    }, [])

    const milestoneProgress = useMemo(() => {
        if (!milestone) return null
        const total = milestone.issues.length
        const closed = milestone.issues.filter(i => i.state === "CLOSED" || i.state === "closed").length
        return { total, closed, pct: total > 0 ? Math.round((closed / total) * 100) : 0, title: milestone.title }
    }, [milestone])

    return (
        <div className="gl-page">
            <div className="gl-header">
                <h1 className="gl-title">💚 Gnolove Scoreboard</h1>
                {contributors?.lastSyncedAt && (
                    <span className="gl-sync-time">
                        Last sync: {new Date(contributors.lastSyncedAt).toLocaleString()}
                    </span>
                )}
            </div>

            {/* Milestone Progress */}
            {milestoneProgress && (
                <div className="gl-milestone">
                    <div className="gl-milestone-header">
                        <span className="gl-milestone-title">🎯 {milestoneProgress.title}</span>
                        <span className="gl-milestone-count">
                            {milestoneProgress.closed}/{milestoneProgress.total} ({milestoneProgress.pct}%)
                        </span>
                    </div>
                    <div className="gl-milestone-bar">
                        <div className="gl-milestone-fill" style={{ width: `${milestoneProgress.pct}%` }} />
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="gl-filters">
                <div className="gl-filter-group">
                    {Object.entries(TIME_FILTER_LABELS).map(([value, label]) => (
                        <button
                            key={value}
                            className={`gl-filter-btn ${timeFilter === value ? "gl-filter-btn--active" : ""}`}
                            onClick={() => setTimeFilter(value as TimeFilter)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <label className="gl-checkbox">
                    <input type="checkbox" checked={excludeCore} onChange={e => setExcludeCore(e.target.checked)} />
                    Exclude Core Team
                </label>
            </div>

            {/* Score Factors */}
            {scoreFactors && (
                <div className="gl-score-factors">
                    <span className="gl-score-label">Score weights:</span>
                    <span className="gl-score-badge">PR ×{scoreFactors.prFactor}</span>
                    <span className="gl-score-badge">Issue ×{scoreFactors.issueFactor}</span>
                    <span className="gl-score-badge">Commit ×{scoreFactors.commitFactor}</span>
                    <span className="gl-score-badge">Review ×{scoreFactors.reviewedPrFactor}</span>
                </div>
            )}

            {/* Team Cards (CSS Grid — no masonic) */}
            {teamStats.length > 0 && (
                <div className="gl-section">
                    <h2 className="gl-section-title">🏆 Best Performing Teams</h2>
                    <div className="gl-team-grid">
                        {teamStats.map((team, i) => (
                            <div key={team.name} className="gl-team-card" style={{ borderColor: TEAM_CSS_COLORS[team.color] }}>
                                <div className="gl-team-rank">#{i + 1}</div>
                                <div className="gl-team-name" style={{ color: TEAM_CSS_COLORS[team.color] }}>
                                    {team.name}
                                </div>
                                <div className="gl-team-stats">
                                    <span>⭐ {team.totalScore}</span>
                                    <span>🔀 {team.totalPrs} PRs</span>
                                    <span>📝 {team.totalCommits} commits</span>
                                    <span>👥 {team.memberCount} members</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Leaderboard Table */}
            <div className="gl-section">
                <h2 className="gl-section-title">📊 Contributor Leaderboard</h2>
                {isLoading ? (
                    <div className="gl-loading">
                        <div className="gl-skeleton" /><div className="gl-skeleton" /><div className="gl-skeleton" />
                    </div>
                ) : sorted.length === 0 ? (
                    <div className="gl-empty">No contributors found for this time range.</div>
                ) : (
                    <div className="gl-table-wrap" style={{ opacity: isFetching ? 0.6 : 1, transition: 'opacity 0.2s' }}>
                        <table className="gl-table">
                            <caption className="gl-sr-only">Contributor leaderboard ranked by {sortBy === 'score' ? 'total score' : sortBy}</caption>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Contributor</th>
                                    <SortHeader label="Score" field="score" current={sortBy} dir={sortDir} onClick={handleSort} />
                                    <SortHeader label="Commits" field="TotalCommits" current={sortBy} dir={sortDir} onClick={handleSort} />
                                    <SortHeader label="PRs" field="TotalPrs" current={sortBy} dir={sortDir} onClick={handleSort} />
                                    <SortHeader label="Issues" field="TotalIssues" current={sortBy} dir={sortDir} onClick={handleSort} />
                                    <SortHeader label="Reviews" field="TotalReviewedPullRequests" current={sortBy} dir={sortDir} onClick={handleSort} />
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((user, i) => (
                                    <ContributorRow key={user.id} user={user} rank={i + 1} loginToTeam={loginToTeam} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Help Wanted Issues */}
            {issues && issues.length > 0 && (
                <div className="gl-section">
                    <h2 className="gl-section-title">🆘 Help Wanted Issues</h2>
                    <div className="gl-issue-list">
                        {issues.slice(0, 10).map(issue => (
                            <a key={issue.id} href={issue.url} target="_blank" rel="noopener noreferrer" className="gl-issue-row">
                                <span className="gl-issue-title">{issue.title}</span>
                                <div className="gl-issue-labels">
                                    {issue.labels.map(l => (
                                        <span key={l.id} className="gl-label" style={{ background: `#${l.color}22`, color: `#${l.color}` }}>
                                            {l.name}
                                        </span>
                                    ))}
                                </div>
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* Freshly Merged PRs */}
            {freshlyMerged && freshlyMerged.length > 0 && (
                <div className="gl-section">
                    <h2 className="gl-section-title">🔀 Freshly Merged</h2>
                    <div className="gl-pr-list">
                        {freshlyMerged.slice(0, 8).map(pr => (
                            <a key={pr.id} href={pr.url} target="_blank" rel="noopener noreferrer" className="gl-pr-row">
                                {pr.authorAvatarUrl && (
                                    <img src={pr.authorAvatarUrl} alt="" className="gl-pr-avatar" loading="lazy" />
                                )}
                                <div className="gl-pr-info">
                                    <span className="gl-pr-title">{pr.title}</span>
                                    <span className="gl-pr-meta">#{pr.number} by {pr.authorLogin ?? "unknown"}</span>
                                </div>
                                <span className="gl-pr-state gl-pr-state--merged">Merged</span>
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* Repositories */}
            {repos && repos.length > 0 && (
                <div className="gl-section">
                    <h2 className="gl-section-title">📦 Tracked Repositories ({repos.length})</h2>
                    <div className="gl-repo-grid">
                        {repos.map(repo => (
                            <a
                                key={repo.id}
                                href={`https://github.com/${repo.owner}/${repo.name}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="gl-repo-card"
                            >
                                <span className="gl-repo-name">{repo.owner}/{repo.name}</span>
                                <span className="gl-repo-branch">{repo.baseBranch}</span>
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

// ── Sub-components ───────────────────────────────────────────

function SortHeader({ label, field, current, dir, onClick }: {
    label: string; field: SortKey; current: SortKey; dir: "asc" | "desc"; onClick: (f: SortKey) => void
}) {
    const active = current === field
    return (
        <th className="gl-sortable" onClick={() => onClick(field)} role="button" tabIndex={0}
            aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : undefined}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(field) } }}>
            {label} {active ? (dir === "desc" ? "▼" : "▲") : ""}
        </th>
    )
}

function ContributorRow({ user, rank, loginToTeam }: { user: TEnhancedUserWithStats; rank: number; loginToTeam: Map<string, Team> }) {
    const rankBadge = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}`
    const team = loginToTeam.get(user.login)

    return (
        <tr className="gl-contributor-row">
            <td className="gl-rank">{rankBadge}</td>
            <td>
                <div className="gl-contributor-cell">
                    <img src={user.avatarUrl} alt="" className="gl-avatar" loading="lazy" />
                    <div>
                        <a href={user.url} target="_blank" rel="noopener noreferrer" className="gl-contributor-name">
                            {user.name || user.login}
                        </a>
                        <span className="gl-contributor-login">@{user.login}</span>
                        {team && (
                            <span className="gl-team-badge" style={{ color: TEAM_CSS_COLORS[team.color] }}>
                                {team.name}
                            </span>
                        )}
                    </div>
                </div>
            </td>
            <td className="gl-stat-cell gl-stat-highlight">{user.score}</td>
            <td className="gl-stat-cell">{user.TotalCommits}</td>
            <td className="gl-stat-cell">{user.TotalPrs}</td>
            <td className="gl-stat-cell">{user.TotalIssues}</td>
            <td className="gl-stat-cell">{user.TotalReviewedPullRequests}</td>
        </tr>
    )
}
