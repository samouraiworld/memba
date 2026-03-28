/**
 * GnoloveHome — Contributors overview, team cards, issues, and freshly merged PRs.
 *
 * @module pages/gnolove/GnoloveHome
 */

import { useState, useMemo, useRef, useEffect } from "react"
import { Link } from "react-router-dom"

// Guard API-supplied hex colors against malformed values (layout corruption, not XSS)
const safeHex = (c: string) => /^[0-9a-fA-F]{3,8}$/.test(c) ? c : "888"
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
import { deriveExcludeLogins, filterAndSortContributors } from "../../lib/gnoloveFilters"
import type { SortKey } from "../../lib/gnoloveFilters"

export default function GnoloveHome() {
    const [timeFilter, setTimeFilter] = useState<TimeFilter>(TimeFilter.ALL_TIME)
    const [excludedTeams, setExcludedTeams] = useState<Set<string>>(new Set())
    const [sortBy, setSortBy] = useState<SortKey>("score")
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
    const [selectedRepos, setSelectedRepos] = useState<string[]>([])
    const [repoFilterOpen, setRepoFilterOpen] = useState(false)
    const [teamsExpanded, setTeamsExpanded] = useState(false)
    const [activityExpanded, setActivityExpanded] = useState(false)

    const repoFilterRef = useRef<HTMLDivElement>(null)

    // Derive logins to exclude from the set of excluded teams
    const excludeLogins = useMemo(() => deriveExcludeLogins(excludedTeams), [excludedTeams])

    const { data: contributors, isLoading, isFetching } = useGnoloveContributors(
        timeFilter, excludeLogins, selectedRepos.length > 0 ? selectedRepos : undefined
    )
    const { data: issues } = useGnoloveIssues()
    const { data: freshlyMerged } = useGnoloveFreshlyMerged()
    const { data: repos } = useGnoloveRepositories()
    const { data: milestone } = useGnoloveMilestone()
    const { data: scoreFactors } = useGnoloveScoreFactors()

    // Close repo filter on click outside
    useEffect(() => {
        if (!repoFilterOpen) return
        function handleClickOutside(e: MouseEvent) {
            if (repoFilterRef.current && !repoFilterRef.current.contains(e.target as Node)) {
                setRepoFilterOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [repoFilterOpen])

    const sorted = useMemo(() => {
        if (!contributors?.users) return []
        return filterAndSortContributors(contributors.users, excludedTeams, sortBy, sortDir)
    }, [contributors, sortBy, sortDir, excludedTeams])

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

    const toggleTeamExclusion = (teamName: string) => {
        setExcludedTeams(prev => {
            const next = new Set(prev)
            if (next.has(teamName)) next.delete(teamName)
            else next.add(teamName)
            return next
        })
    }

    const activityCount = (freshlyMerged?.length ?? 0) + (issues?.length ?? 0)

    return (
        <div className="gl-page">
            <div className="gl-header">
                <h1 className="gl-title">💚 Contributors Overview</h1>
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

            {/* Activity Feed — Collapsible, retracted by default */}
            {activityCount > 0 && (
                <div className="gl-section">
                    <button
                        className="gl-section-toggle"
                        onClick={() => setActivityExpanded(e => !e)}
                        aria-expanded={activityExpanded}
                    >
                        <h2 className="gl-section-title" style={{ margin: 0 }}>🔀 Activity Feed</h2>
                        <span className="gl-section-summary">
                            {freshlyMerged?.length ?? 0} merged, {issues?.length ?? 0} help wanted
                        </span>
                        <span className="gl-chevron" data-expanded={activityExpanded}>▸</span>
                    </button>
                    {activityExpanded && (
                        <div className="gl-activity-feed" style={{ marginTop: 12 }}>
                            {freshlyMerged && freshlyMerged.length > 0 && (
                                <div className="gl-activity-column">
                                    <h3 className="gl-activity-title">🔀 Freshly Merged</h3>
                                    <div className="gl-activity-list">
                                        {freshlyMerged.slice(0, 5).map(pr => (
                                            <a key={pr.id} href={pr.url} target="_blank" rel="noopener noreferrer"
                                               className="gl-activity-item">
                                                <span className="gl-activity-item-title">{pr.title}</span>
                                                <span className="gl-activity-item-meta">
                                                    #{pr.number} by {pr.authorLogin ?? "unknown"}
                                                </span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {issues && issues.length > 0 && (
                                <div className="gl-activity-column">
                                    <h3 className="gl-activity-title">🆘 Help Wanted</h3>
                                    <div className="gl-activity-list">
                                        {issues.slice(0, 5).map(issue => (
                                            <a key={issue.id} href={issue.url} target="_blank" rel="noopener noreferrer"
                                               className="gl-activity-item">
                                                <span className="gl-activity-item-title">{issue.title}</span>
                                                <div className="gl-activity-item-labels">
                                                    {issue.labels.slice(0, 2).map(l => (
                                                        <span key={l.id} className="gl-label gl-label--sm"
                                                              style={{ background: `#${safeHex(l.color)}22`, color: `#${safeHex(l.color)}` }}>
                                                            {l.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
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
                <div className="gl-filter-group">
                    {TEAMS.map(team => {
                        const excluded = excludedTeams.has(team.name)
                        return (
                            <button
                                key={team.name}
                                className={`gl-filter-btn ${excluded ? "" : "gl-filter-btn--active"}`}
                                onClick={() => toggleTeamExclusion(team.name)}
                                aria-pressed={!excluded}
                                title={excluded ? `Show ${team.name}` : `Exclude ${team.name}`}
                                style={{ opacity: excluded ? 0.4 : 1 }}
                            >
                                {team.name}
                            </button>
                        )
                    })}
                </div>
                {repos && repos.length > 0 && (
                    <div ref={repoFilterRef} className="gl-repo-filter">
                        <button
                            className={`gl-filter-btn ${selectedRepos.length > 0 ? "gl-filter-btn--active" : ""}`}
                            onClick={() => setRepoFilterOpen(o => !o)}
                            aria-expanded={repoFilterOpen}
                        >
                            📦 {selectedRepos.length === 0 ? "All Repos" : `${selectedRepos.length} repo${selectedRepos.length > 1 ? "s" : ""}`}
                        </button>
                        {repoFilterOpen && (
                            <div
                                className="gl-repo-filter-dropdown"
                                role="group"
                                aria-label="Repository filter"
                                onKeyDown={e => {
                                    if (e.key === "Escape") {
                                        setRepoFilterOpen(false)
                                    }
                                }}
                            >
                                <div className="gl-repo-filter-actions">
                                    <button className="gl-filter-btn gl-filter-btn--sm" onClick={() => {
                                        setSelectedRepos(repos!.map(r => `${r.owner}/${r.name}`))
                                    }}>
                                        Select All
                                    </button>
                                    <button className="gl-filter-btn gl-filter-btn--sm" onClick={() => setSelectedRepos([])}>
                                        Clear
                                    </button>
                                </div>
                                {repos.map(repo => {
                                    const key = `${repo.owner}/${repo.name}`
                                    const checked = selectedRepos.includes(key)
                                    return (
                                        <label key={repo.id} className="gl-repo-filter-item">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => {
                                                    setSelectedRepos(prev =>
                                                        checked ? prev.filter(r => r !== key) : [...prev, key]
                                                    )
                                                }}
                                            />
                                            <span>{key}</span>
                                        </label>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )}
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

            {/* Best Performing Teams — Collapsible, links to /gnolove/teams */}
            {teamStats.length > 0 && (
                <div className="gl-section">
                    <button
                        className="gl-section-toggle"
                        onClick={() => setTeamsExpanded(e => !e)}
                        aria-expanded={teamsExpanded}
                    >
                        <h2 className="gl-section-title" style={{ margin: 0 }}>🏆 Best Performing Teams</h2>
                        <span className="gl-section-summary">
                            {teamStats.length} teams — Top: {teamStats[0]?.name} ({teamStats[0]?.totalScore} pts)
                            {" · "}<Link to="/gnolove/teams" className="gl-section-summary-link" onClick={e => e.stopPropagation()}>View all</Link>
                        </span>
                        <span className="gl-chevron" data-expanded={teamsExpanded}>▸</span>
                    </button>
                    {teamsExpanded && (
                        <div className="gl-team-grid gl-team-grid--expanded">
                            {teamStats.map((team, i) => (
                                <Link
                                    key={team.name}
                                    to="/gnolove/teams"
                                    className="gl-team-card"
                                    style={{ borderColor: TEAM_CSS_COLORS[team.color], textDecoration: "none" }}
                                >
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
                                </Link>
                            ))}
                        </div>
                    )}
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
                        <Link to={`/gnolove/contributor/${user.login}`} className="gl-contributor-name">
                            {user.name || user.login}
                        </Link>
                        <a
                            href={user.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="gl-github-link"
                            title={`${user.login} on GitHub`}
                        >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                            </svg>
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
