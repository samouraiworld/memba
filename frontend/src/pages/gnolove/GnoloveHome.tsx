/**
 * GnoloveHome — Contributors overview, team cards, issues, and freshly merged PRs.
 *
 * Ported from gnolove scoreboard-page.tsx → vanilla CSS + React Query.
 * YouTube carousel removed, masonic → CSS Grid, Radix → vanilla.
 *
 * @module pages/gnolove/GnoloveHome
 */

import { useState, useMemo, useRef, useEffect } from "react"

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
import type { Team, TeamColor } from "../../lib/gnoloveConstants"
import type { TEnhancedUserWithStats } from "../../lib/gnoloveSchemas"

type SortKey = "score" | "TotalCommits" | "TotalPrs" | "TotalIssues" | "TotalReviewedPullRequests"

export default function GnoloveHome() {
    const [timeFilter, setTimeFilter] = useState<TimeFilter>(TimeFilter.ALL_TIME)
    const [excludeCore, setExcludeCore] = useState(false)
    const [sortBy, setSortBy] = useState<SortKey>("score")
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
    const [selectedRepos, setSelectedRepos] = useState<string[]>([])
    const [repoFilterOpen, setRepoFilterOpen] = useState(false)
    const [teamsExpanded, setTeamsExpanded] = useState(false)

    const repoFilterRef = useRef<HTMLDivElement>(null)

    const { data: contributors, isLoading, isFetching } = useGnoloveContributors(
        timeFilter, excludeCore, selectedRepos.length > 0 ? selectedRepos : undefined
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

            {/* Activity Feed — Compact top section */}
            <div className="gl-activity-feed">
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

            {/* Best Performing Teams — Collapsible */}
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
                        </span>
                        <span className="gl-chevron" data-expanded={teamsExpanded}>▸</span>
                    </button>
                    {teamsExpanded && (
                        <div className="gl-team-grid gl-team-grid--expanded">
                            {teamStats.map((team, i) => (
                                <TeamCard
                                    key={team.name}
                                    team={team}
                                    rank={i + 1}
                                    contributors={contributors?.users}
                                />
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

function TeamCard({ team, rank, contributors }: {
    team: { name: string; color: TeamColor; totalScore: number; totalPrs: number; totalCommits: number; memberCount: number }
    rank: number
    contributors: TEnhancedUserWithStats[] | undefined
}) {
    const [showMembers, setShowMembers] = useState(false)

    const memberDetails = useMemo(() => {
        if (!contributors) return []
        const teamDef = TEAMS.find(t => t.name === team.name)
        if (!teamDef) return []
        return teamDef.members.map(login => {
            const user = contributors.find(u => u.login === login)
            return { login, avatarUrl: user?.avatarUrl, name: user?.name, score: user?.score ?? 0 }
        }).sort((a, b) => b.score - a.score)
    }, [contributors, team.name])

    return (
        <div
            className="gl-team-card"
            style={{ borderColor: TEAM_CSS_COLORS[team.color] }}
            onMouseEnter={() => setShowMembers(true)}
            onMouseLeave={() => setShowMembers(false)}
            onClick={() => setShowMembers(s => !s)}
            tabIndex={0}
            onFocus={() => setShowMembers(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setShowMembers(false)
                }
            }}
            role="button"
            aria-expanded={showMembers}
            onKeyDown={e => {
                if (e.key === "Escape") setShowMembers(false)
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault(); setShowMembers(s => !s)
                }
            }}
        >
            <div className="gl-team-rank">#{rank}</div>
            <div className="gl-team-name" style={{ color: TEAM_CSS_COLORS[team.color] }}>
                {team.name}
            </div>
            <div className="gl-team-stats">
                <span>⭐ {team.totalScore}</span>
                <span>🔀 {team.totalPrs} PRs</span>
                <span>📝 {team.totalCommits} commits</span>
                <span>👥 {team.memberCount} members</span>
            </div>

            {showMembers && memberDetails.length > 0 && (
                <div className="gl-team-popover">
                    <div className="gl-team-popover-title">Team Members</div>
                    {memberDetails.map(m => (
                        <div key={m.login} className="gl-team-popover-member">
                            {m.avatarUrl && (
                                <img src={m.avatarUrl} alt="" className="gl-team-popover-avatar" loading="lazy" />
                            )}
                            <span className="gl-team-popover-name">{m.name || m.login}</span>
                            <span className="gl-team-popover-login">@{m.login}</span>
                            <span className="gl-team-popover-score">{m.score} pts</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
