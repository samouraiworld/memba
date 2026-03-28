/**
 * GnoloveContributorProfile — Full contributor profile with two-column layout.
 *
 * Sidebar: avatar, name, team badge, bio, links, on-chain info.
 * Main: stat cards, contribution heatmap, monthly trend, top repos, recent activity.
 *
 * @module pages/gnolove/GnoloveContributorProfile
 */

import { useMemo, useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import {
    AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
    BarChart, Bar,
} from "recharts"
import { useGnoloveContributor } from "../../hooks/gnolove"
import { TEAMS, TEAM_CSS_COLORS } from "../../lib/gnoloveConstants"


// ── Contribution Heatmap (SVG) ──────────────────────────────

const CELL_SIZE = 12
const CELL_GAP = 2
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""]

function ContributionHeatmap({ data }: { data: Array<{ date: string; count: number }> }) {
    const { cells, weeks, maxCount, monthLabels } = useMemo(() => {
        const now = new Date()
        const startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
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
            const dayIdx = (currentDate.getDay() + 6) % 7
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
    }, [data])

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
            <svg
                width={svgWidth}
                height={svgHeight}
                className="gl-heatmap-svg"
                role="img"
                aria-label="Contribution heatmap showing activity over the last year"
            >
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
                {DAY_LABELS.map((label, i) =>
                    label ? (
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
                    ) : null,
                )}
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
                        <title>
                            {cell.date}: {cell.count} contribution{cell.count !== 1 ? "s" : ""}
                        </title>
                    </rect>
                ))}
            </svg>
            <div className="gl-heatmap-legend">
                <span className="gl-heatmap-legend-label">Less</span>
                {[0, 1, 2, 3, 4].map((i) => (
                    <span
                        key={i}
                        className="gl-heatmap-legend-cell"
                        style={{
                            background:
                                i === 0
                                    ? "rgba(255,255,255,0.03)"
                                    : i === 1
                                      ? "rgba(0,212,170,0.15)"
                                      : i === 2
                                        ? "rgba(0,212,170,0.35)"
                                        : i === 3
                                          ? "rgba(0,212,170,0.6)"
                                          : "#00d4aa",
                        }}
                    />
                ))}
                <span className="gl-heatmap-legend-label">More</span>
            </div>
        </div>
    )
}

// ── Helpers ─────────────────────────────────────────────────

function formatDate(dateStr: string): string {
    const d = new Date(dateStr)
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function truncateWallet(wallet: string): string {
    if (wallet.length <= 16) return wallet
    return `${wallet.slice(0, 8)}...${wallet.slice(-6)}`
}

function isValidHttpUrl(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://")
}

function findTeam(login: string) {
    for (const team of TEAMS) {
        if (team.members.includes(login)) return team
    }
    return null
}

// ── Recharts Tooltip ────────────────────────────────────────

const CHART_TOOLTIP_STYLE = {
    background: "#1a1a2e",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    fontSize: 12,
}

// ── Main Component ──────────────────────────────────────────

export default function GnoloveContributorProfile() {
    const { login } = useParams<{ login: string }>()
    const { data: contributor, isLoading } = useGnoloveContributor(login ?? "")
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        if (contributor?.name) {
            document.title = `${contributor.name} (@${contributor.login}) | Gnolove`
        } else if (login) {
            document.title = `@${login} | Gnolove`
        }
    }, [contributor, login])

    const team = useMemo(() => (login ? findTeam(login) : null), [login])

    // Merge monthly data for the area chart
    const monthlyData = useMemo(() => {
        if (!contributor) return []
        const map = new Map<string, { period: string; commits: number; prs: number; issues: number }>()

        for (const entry of contributor.commitsPerMonth) {
            const existing = map.get(entry.period) ?? { period: entry.period, commits: 0, prs: 0, issues: 0 }
            existing.commits = entry.count
            map.set(entry.period, existing)
        }
        for (const entry of contributor.pullRequestsPerMonth) {
            const existing = map.get(entry.period) ?? { period: entry.period, commits: 0, prs: 0, issues: 0 }
            existing.prs = entry.count
            map.set(entry.period, existing)
        }
        for (const entry of contributor.issuesPerMonth) {
            const existing = map.get(entry.period) ?? { period: entry.period, commits: 0, prs: 0, issues: 0 }
            existing.issues = entry.count
            map.set(entry.period, existing)
        }

        return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period))
    }, [contributor])

    // Heatmap data
    const heatmapData = useMemo(() => {
        if (!contributor?.contributionsPerDay) return []
        return contributor.contributionsPerDay.map((d) => ({ date: d.period, count: d.count }))
    }, [contributor])

    // Recent activity (merged + sorted)
    const recentActivity = useMemo(() => {
        if (!contributor) return []
        const items = [
            ...contributor.recentPullRequests.map((pr) => ({ ...pr, kind: "pull_request" as const })),
            ...contributor.recentIssues.map((issue) => ({ ...issue, kind: "issue" as const })),
        ]
        items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        return items
    }, [contributor])

    // Copy URL handler
    const handleCopyUrl = () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }

    // ── Loading state ───────────────────────────────────────
    if (isLoading) {
        return (
            <div className="gl-page">
                <Link to="/gnolove" className="gl-profile-back">
                    &larr; Back to Contributors Overview
                </Link>
                <div className="gl-profile-layout">
                    <div className="gl-profile-sidebar">
                        <div className="gl-skeleton" style={{ width: 96, height: 96, borderRadius: "50%" }} />
                        <div className="gl-skeleton" style={{ height: 24, width: 160, marginTop: 12 }} />
                        <div className="gl-skeleton" style={{ height: 16, width: 120, marginTop: 8 }} />
                        <div className="gl-skeleton" style={{ height: 60, width: "100%", marginTop: 16 }} />
                    </div>
                    <div className="gl-profile-main">
                        <div className="gl-stats-grid">
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="gl-skeleton" style={{ height: 80 }} />
                            ))}
                        </div>
                        <div className="gl-skeleton" style={{ height: 180, marginTop: 24 }} />
                        <div className="gl-skeleton" style={{ height: 250, marginTop: 24 }} />
                    </div>
                </div>
            </div>
        )
    }

    // ── Not found state ─────────────────────────────────────
    if (!contributor) {
        return (
            <div className="gl-page">
                <Link to="/gnolove" className="gl-profile-back">
                    &larr; Back to Contributors Overview
                </Link>
                <div className="gl-empty" style={{ marginTop: 48 }}>
                    <h2>Contributor not found</h2>
                    <p>
                        No contributor with the login <strong>@{login}</strong> was found.
                    </p>
                    <Link to="/gnolove" style={{ color: "#00d4aa", marginTop: 12, display: "inline-block" }}>
                        Return to Contributors Overview
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="gl-page">
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Link to="/gnolove" className="gl-profile-back">
                    &larr; Back to Contributors Overview
                </Link>
                <button className="gl-profile-copy-btn" onClick={handleCopyUrl}>
                    {copied ? "Copied!" : "Copy URL"}
                </button>
            </div>

            <div className="gl-profile-layout">
                {/* ── Sidebar ────────────────────────────────── */}
                <aside className="gl-profile-sidebar">
                    <img
                        src={contributor.avatarUrl}
                        alt={`${contributor.name}'s avatar`}
                        className="gl-profile-avatar"
                        width={96}
                        height={96}
                    />
                    <h1 className="gl-profile-name">{contributor.name}</h1>
                    <span className="gl-profile-login">@{contributor.login}</span>

                    {team && (
                        <span
                            className="gl-profile-badge"
                            style={{
                                background: TEAM_CSS_COLORS[team.color],
                                color: "#000",
                                padding: "2px 10px",
                                borderRadius: 12,
                                fontSize: 12,
                                fontWeight: 600,
                                marginTop: 8,
                                display: "inline-block",
                            }}
                        >
                            {team.name}
                        </span>
                    )}

                    {contributor.bio && <p className="gl-profile-bio">{contributor.bio}</p>}

                    <div className="gl-profile-meta">
                        {contributor.location && (
                            <div>
                                <strong>Location:</strong> {contributor.location}
                            </div>
                        )}
                        {contributor.joinDate && (
                            <div>
                                <strong>Joined:</strong> {formatDate(contributor.joinDate)}
                            </div>
                        )}
                    </div>

                    <div className="gl-profile-links">
                        <a href={contributor.url} target="_blank" rel="noopener noreferrer">
                            GitHub
                        </a>
                        {contributor.twitterUsername && (
                            <a
                                href={`https://twitter.com/${contributor.twitterUsername}`}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Twitter
                            </a>
                        )}
                        {contributor.websiteUrl && isValidHttpUrl(contributor.websiteUrl) && (
                            <a href={contributor.websiteUrl} target="_blank" rel="noopener noreferrer">
                                Website
                            </a>
                        )}
                    </div>

                    {contributor.wallet && (
                        <div className="gl-profile-onchain">
                            <div className="gl-profile-onchain-label">On-Chain</div>
                            <div className="gl-profile-onchain-wallet" title={contributor.wallet}>
                                {truncateWallet(contributor.wallet)}
                            </div>
                            {contributor.gnoBalance && (
                                <div className="gl-profile-onchain-balance">
                                    {contributor.gnoBalance} GNOT
                                </div>
                            )}
                        </div>
                    )}
                </aside>

                {/* ── Main Content ───────────────────────────── */}
                <div className="gl-profile-main">
                    {/* Stat Cards */}
                    <div className="gl-stats-grid">
                        <StatCard label="Total Commits" value={contributor.totalCommits} />
                        <StatCard label="Total PRs" value={contributor.totalPullRequests} />
                        <StatCard label="Total Issues" value={contributor.totalIssues} />
                        <StatCard label="Total Stars" value={contributor.totalStars} />
                    </div>

                    {/* Contribution Heatmap */}
                    {heatmapData.length > 0 && (
                        <div className="gl-section">
                            <h2 className="gl-section-title">Contribution Activity</h2>
                            <ContributionHeatmap data={heatmapData} />
                        </div>
                    )}

                    {/* Monthly Activity Trend */}
                    {monthlyData.length > 0 && (
                        <div className="gl-section">
                            <h2 className="gl-section-title">Monthly Activity Trend</h2>
                            <div className="gl-chart-container">
                                <ResponsiveContainer width="100%" height={280}>
                                    <AreaChart data={monthlyData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                                        <defs>
                                            <linearGradient id="gradCommits" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#4a9eff" stopOpacity={0.4} />
                                                <stop offset="100%" stopColor="#4a9eff" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="gradPrs" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                                                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="gradIssues" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#ffc107" stopOpacity={0.4} />
                                                <stop offset="100%" stopColor="#ffc107" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <XAxis
                                            dataKey="period"
                                            tick={{ fill: "#888", fontSize: 11 }}
                                            tickFormatter={(v: string) => {
                                                const [y, m] = v.split("-")
                                                return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m, 10) - 1]} ${y.slice(2)}`
                                            }}
                                        />
                                        <YAxis tick={{ fill: "#888", fontSize: 11 }} />
                                        <Tooltip
                                            contentStyle={CHART_TOOLTIP_STYLE}
                                            labelStyle={{ color: "#f0f0f0" }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="commits"
                                            name="Commits"
                                            stroke="#4a9eff"
                                            fill="url(#gradCommits)"
                                            strokeWidth={2}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="prs"
                                            name="PRs"
                                            stroke="#22c55e"
                                            fill="url(#gradPrs)"
                                            strokeWidth={2}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="issues"
                                            name="Issues"
                                            stroke="#ffc107"
                                            fill="url(#gradIssues)"
                                            strokeWidth={2}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* Top Contributed Repos */}
                    {contributor.topContributedRepositories.length > 0 && (
                        <div className="gl-section">
                            <h2 className="gl-section-title">Top Contributed Repositories</h2>
                            <div className="gl-chart-container">
                                <ResponsiveContainer width="100%" height={Math.max(200, contributor.topContributedRepositories.length * 40)}>
                                    <BarChart
                                        data={contributor.topContributedRepositories}
                                        layout="vertical"
                                        margin={{ left: 140, right: 20, top: 10, bottom: 10 }}
                                    >
                                        <XAxis type="number" tick={{ fill: "#888", fontSize: 11 }} />
                                        <YAxis
                                            type="category"
                                            dataKey="id"
                                            tick={{ fill: "#f0f0f0", fontSize: 11 }}
                                            width={130}
                                        />
                                        <Tooltip
                                            contentStyle={CHART_TOOLTIP_STYLE}
                                            labelStyle={{ color: "#f0f0f0" }}
                                        />
                                        <Bar
                                            dataKey="contributions"
                                            name="Contributions"
                                            fill="#00d4aa"
                                            radius={[0, 4, 4, 0]}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* Recent Activity */}
                    {recentActivity.length > 0 && (
                        <div className="gl-section">
                            <h2 className="gl-section-title">Recent Activity</h2>
                            <div className="gl-activity-list">
                                {recentActivity.map((item, i) => (
                                    <a
                                        key={i}
                                        href={item.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="gl-activity-row"
                                    >
                                        <span className="gl-activity-icon">
                                            {item.kind === "pull_request" ? "\uD83D\uDD00" : "\uD83D\uDC1B"}
                                        </span>
                                        <span className="gl-activity-title">{item.title}</span>
                                        <span className="gl-activity-repo">{item.repository}</span>
                                        <span className="gl-activity-date">{formatDate(item.createdAt)}</span>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Top Repositories */}
                    {contributor.topRepositories.length > 0 && (
                        <div className="gl-section">
                            <h2 className="gl-section-title">Top Repositories</h2>
                            <div className="gl-repo-grid-profile">
                                {contributor.topRepositories.map((repo) => (
                                    <a
                                        key={repo.nameWithOwner}
                                        href={repo.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="gl-repo-card-profile"
                                    >
                                        <div className="gl-repo-card-name">{repo.nameWithOwner}</div>
                                        {repo.description && (
                                            <div className="gl-repo-card-desc">
                                                {repo.description.length > 120
                                                    ? `${repo.description.slice(0, 120)}...`
                                                    : repo.description}
                                            </div>
                                        )}
                                        <div className="gl-repo-card-footer">
                                            {repo.primaryLanguage && (
                                                <span className="gl-repo-card-lang">{repo.primaryLanguage}</span>
                                            )}
                                            <span className="gl-repo-card-stars">
                                                {repo.stargazerCount.toLocaleString()} stars
                                            </span>
                                        </div>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// ── Sub-components ──────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: number }) {
    return (
        <div className="gl-stat-card">
            <div className="gl-stat-value">{value.toLocaleString()}</div>
            <div className="gl-stat-label">{label}</div>
        </div>
    )
}
