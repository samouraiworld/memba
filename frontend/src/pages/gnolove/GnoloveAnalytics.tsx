/**
 * GnoloveAnalytics — Grafana-inspired ecosystem insights dashboard.
 *
 * Stat cards with sparklines, time-series area chart, distribution/team/repo
 * bar charts, and on-chain governance metrics.
 *
 * @module pages/gnolove/GnoloveAnalytics
 */

import { useMemo, useCallback, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
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
    useGnoloveYearReport,
    useGnoloveTopics,
    useGnoloveTeams,
    useGnoloveCohorts,
    useGnoloveTeamCollab,
} from "../../hooks/gnolove"
import { TEAMS, TEAM_CSS_COLORS, TimeFilter, TIME_FILTER_LABELS, isTimeFilter } from "../../lib/gnoloveConstants"
import { PageMeta } from "../../components/gnolove/PageMeta"
import {
    computeTeamData, computeContributionTiers, computeVoteData, computeStats,
    computeCycleTimeHistogram, computeTopicHeatmap, topicHeatmapMax,
    computeRepoHealth, computeCohortGrid, computeCollabMatrix, computeSparklines,
} from "../../lib/gnoloveAnalytics"
import { useChartTokens } from "../../hooks/useChartTokens"

export default function GnoloveAnalytics() {
    const ct = useChartTokens()
    const tooltipStyle = useMemo(() => ({
        background: ct.bg,
        border: `1px solid ${ct.tooltipBorder}`,
        borderRadius: 6,
        fontSize: 11,
        fontFamily: "var(--gl-font-mono)",
    }), [ct.bg, ct.tooltipBorder])
    const gridStyle = useMemo(() => ({ stroke: ct.grid }), [ct.grid])
    const axisTick = useMemo(() => ({ fill: ct.axisFg, fontSize: 10, fontFamily: "var(--gl-font-mono)" }), [ct.axisFg])

    const [searchParams, setSearchParams] = useSearchParams()
    const rawTime = searchParams.get("time")
    const period: TimeFilter = rawTime && isTimeFilter(rawTime) ? rawTime : TimeFilter.ALL_TIME
    const setPeriod = useCallback((next: TimeFilter) => {
        const params = new URLSearchParams(searchParams)
        if (next === TimeFilter.ALL_TIME) {
            params.delete("time")
        } else {
            params.set("time", next)
        }
        setSearchParams(params, { replace: false })
    }, [searchParams, setSearchParams])

    const { data: contributors, isLoading, isError: contributorsError, refetch } = useGnoloveContributors(period)
    const { data: yearReport } = useGnoloveYearReport()
    const { rules: topicRules, labels: topicLabels } = useGnoloveTopics()
    const { teams: rosterTeams } = useGnoloveTeams()
    const { data: cohortsData } = useGnoloveCohorts()
    const collabPeriod = period === TimeFilter.ALL_TIME ? "" : period
    const { data: teamCollabData } = useGnoloveTeamCollab(collabPeriod)

    const [nowMs] = useState(() => Date.now())
    const { data: proposals } = useGnoloveProposals()
    const { data: govdaoMembers } = useGnoloveGovdaoMembers()
    const { data: packages } = useGnolovePackages()
    const { data: namespaces } = useGnoloveNamespaces()
    const { data: repoActivity } = useGnoloveRepoActivity()
    const { data: monthlyActivity } = useGnoloveMonthlyActivity()

    const teamData = useMemo(() => computeTeamData(contributors, TEAMS, TEAM_CSS_COLORS), [contributors])
    const contributionTiers = useMemo(() => computeContributionTiers(contributors), [contributors])
    const voteData = useMemo(() => computeVoteData(proposals), [proposals])

    const navigate = useNavigate()
    const handleVoteBarClick = useCallback((data: { proposalId?: string }) => {
        if (data?.proposalId) {
            navigate(`/dao/gno.land/r/gov/dao/proposal/${data.proposalId}`)
        }
    }, [navigate])

    const stats = useMemo(() => computeStats(contributors, proposals, govdaoMembers, packages, namespaces), [contributors, proposals, govdaoMembers, packages, namespaces])
    const cycleTimeHistogram = useMemo(() => computeCycleTimeHistogram(yearReport?.merged, period, nowMs), [yearReport, period, nowMs])
    const topicHeatmap = useMemo(() => computeTopicHeatmap(yearReport?.merged, topicRules, nowMs), [yearReport, topicRules, nowMs])
    const heatmapMax = useMemo(() => topicHeatmapMax(topicHeatmap), [topicHeatmap])
    const repoHealth = useMemo(() => computeRepoHealth(yearReport, nowMs), [yearReport, nowMs])
    const cohortGrid = useMemo(() => computeCohortGrid(cohortsData), [cohortsData])
    const collabMatrix = useMemo(() => computeCollabMatrix(teamCollabData), [teamCollabData])

    const teamMeta = useMemo(() => {
        const m = new Map<string, { name: string; color: string }>()
        for (const t of rosterTeams) {
            m.set(t.slug, { name: t.name, color: TEAM_CSS_COLORS[t.color] })
        }
        return m
    }, [rosterTeams])

    const sparklines = useMemo(() => computeSparklines(monthlyActivity), [monthlyActivity])

    return (
        <div className="gl-page">
            <PageMeta title="Ecosystem Insights | Gnolove · Memba" description="Time-series analytics for the Gno ecosystem (PRs, commits, proposals, governance)." />
            <div className="gl-header">
                <h1 className="gl-title">Ecosystem Insights</h1>
                <div className="gl-tabs" role="tablist" aria-label="Time period">
                    {Object.entries(TIME_FILTER_LABELS).map(([value, label]) => {
                        const active = period === value
                        return (
                            <button
                                key={value}
                                type="button"
                                role="tab"
                                className={`gl-tab ${active ? "gl-tab--active" : ""}`}
                                aria-selected={active}
                                aria-current={active ? "page" : undefined}
                                onClick={() => setPeriod(value as TimeFilter)}
                            >
                                {label}
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* ── Error Banner ────────────────────────────────── */}
            {contributorsError && !isLoading && (
                <div className="gl-error-banner">
                    <span>⚠️ Failed to load analytics data — the Gnolove backend may be unavailable.</span>
                    <button className="gl-error-retry" onClick={() => refetch()}>Retry</button>
                </div>
            )}

            {/* ── Stat Cards with Sparklines ──────────────────── */}
            {stats && (
                <div className="gl-dash-stats">
                    <DashStatCard label="Contributors" value={stats.totalContributors} icon="👥" />
                    <DashStatCard label="Pull Requests" value={stats.totalPrs} icon="🔀" sparkline={sparklines.merged} color={ct.primary} />
                    <DashStatCard label="Commits" value={stats.totalCommits} icon="📝" />
                    <DashStatCard label="Issues" value={stats.totalIssues} icon="🐛" />
                    <DashStatCard label="Reviews" value={stats.totalReviews} icon="👁️" sparkline={sparklines.open} color={ct.reviewed} />
                    <DashStatCard label="GovDAO" value={stats.govdaoMembers} icon="🏛️" />
                </div>
            )}

            {/* ── PR Cycle Time histogram (plan §2, panel 1/5) ─ */}
            {yearReport && (
                <div className="gl-panel">
                    <div className="gl-panel-header">
                        <h2 className="gl-panel-title">PR Cycle Time</h2>
                        <span className="gl-panel-subtitle">Days from open → merged for {period === TimeFilter.ALL_TIME ? "the last year" : TIME_FILTER_LABELS[period].toLowerCase()}</span>
                    </div>
                    <div className="gl-chart-container" role="img" aria-label="Bar chart showing PR cycle time distribution in days">
                        <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={cycleTimeHistogram} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
                                <CartesianGrid {...gridStyle} />
                                <XAxis dataKey="label" tick={axisTick} />
                                <YAxis tick={axisTick} />
                                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--color-text)" }} />
                                <Bar dataKey="count" name="Merged PRs" fill={ct.reviewed} radius={[3, 3, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* ── Topic Activity Heatmap (plan §2, panel 2/5) ── */}
            {topicHeatmap.rows.length > 0 && (
                <div className="gl-panel">
                    <div className="gl-panel-header">
                        <h2 className="gl-panel-title">Topic activity</h2>
                        <span className="gl-panel-subtitle">Merged-PR signal per topic over the last 12 months (taxonomy from /topics)</span>
                    </div>
                    <div className="gl-topic-heatmap" role="table" aria-label="Topic activity heatmap">
                        <div className="gl-topic-heatmap-row gl-topic-heatmap-head" role="row">
                            <span className="gl-topic-heatmap-label" role="columnheader">Topic</span>
                            {topicHeatmap.months.map(m => (
                                <span key={m} className="gl-topic-heatmap-month" role="columnheader" aria-label={m}>{m.slice(5)}</span>
                            ))}
                            <span className="gl-topic-heatmap-total" role="columnheader">Σ</span>
                        </div>
                        {topicHeatmap.rows.map(row => (
                            <div key={row.topic} className="gl-topic-heatmap-row" role="row">
                                <span className="gl-topic-heatmap-label" role="rowheader">
                                    {topicLabels[row.topic] ?? row.topic}
                                </span>
                                {row.counts.map((c, i) => {
                                    const ratio = heatmapMax > 0 ? c / heatmapMax : 0
                                    const level = c === 0 ? 0
                                        : ratio < 0.15 ? 1
                                        : ratio < 0.4 ? 2
                                        : ratio < 0.7 ? 3 : 4
                                    return (
                                        <span
                                            key={i}
                                            className={`gl-topic-heatmap-cell gl-topic-heatmap-cell-l${level}`}
                                            role="cell"
                                            title={`${row.topic} · ${topicHeatmap.months[i]}: ${c} PRs`}
                                        >
                                            {c > 0 ? c : ""}
                                        </span>
                                    )
                                })}
                                <span className="gl-topic-heatmap-total" role="cell">{row.total}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Repo Health Matrix (plan §2, panel 3/5) ────── */}
            {repoHealth.length > 0 && (
                <div className="gl-panel">
                    <div className="gl-panel-header">
                        <h2 className="gl-panel-title">Repo health</h2>
                        <span className="gl-panel-subtitle">PRs/wk · median cycle · open backlog · last activity (last year, top 15 by merged-PR rate)</span>
                    </div>
                    <table className="gl-repo-health" role="table" aria-label="Repo health matrix">
                        <thead>
                            <tr>
                                <th scope="col">Repo</th>
                                <th scope="col">PRs / week</th>
                                <th scope="col">Median cycle</th>
                                <th scope="col">Open backlog</th>
                                <th scope="col">Last activity</th>
                            </tr>
                        </thead>
                        <tbody>
                            {repoHealth.map(r => {
                                // Traffic-light thresholds tuned for Gno repos: warm (≥1/wk),
                                // tepid (1/mo – 1/wk), cold (< 1/mo). Cycle: good <7d, fair <21d,
                                // poor ≥21d. Backlog: good <5, fair <15, poor ≥15. Last activity:
                                // good <30d, fair <90d, poor ≥90d (or never).
                                const rateLevel = r.prsPerWeek >= 1 ? "good" : r.prsPerWeek >= 0.25 ? "fair" : "poor"
                                const cycleLevel = r.medianCycleDays < 7 ? "good" : r.medianCycleDays < 21 ? "fair" : "poor"
                                const backlogLevel = r.openBacklog < 5 ? "good" : r.openBacklog < 15 ? "fair" : "poor"
                                const lastLevel = r.lastActivityDays < 30 ? "good" : r.lastActivityDays < 90 ? "fair" : "poor"
                                return (
                                    <tr key={r.repo}>
                                        <th scope="row">
                                            <a href={`https://github.com/${r.repo}`} target="_blank" rel="noopener noreferrer">{r.repo}</a>
                                        </th>
                                        <td className={`gl-repo-health-cell gl-repo-health-${rateLevel}`}>{r.prsPerWeek.toFixed(2)}</td>
                                        <td className={`gl-repo-health-cell gl-repo-health-${cycleLevel}`}>{r.medianCycleDays.toFixed(1)}d</td>
                                        <td className={`gl-repo-health-cell gl-repo-health-${backlogLevel}`}>{r.openBacklog}</td>
                                        <td className={`gl-repo-health-cell gl-repo-health-${lastLevel}`}>
                                            {Number.isFinite(r.lastActivityDays) ? `${Math.round(r.lastActivityDays)}d` : "—"}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ── Cohort retention grid (plan §2, panel 4/5) ──── */}
            {cohortGrid.rows.length > 0 && (
                <div className="gl-panel">
                    <div className="gl-panel-header">
                        <h2 className="gl-panel-title">Contributor cohort retention</h2>
                        <span className="gl-panel-subtitle">
                            Rows = month of each contributor's first PR. Cell = % of the cohort
                            with at least one PR in the Nth month after they joined.
                        </span>
                    </div>
                    <div className="gl-cohort-grid" role="table" aria-label="Cohort retention grid">
                        <div className="gl-cohort-grid-row gl-cohort-grid-head" role="row">
                            <span className="gl-cohort-grid-label" role="columnheader">Cohort</span>
                            <span className="gl-cohort-grid-size" role="columnheader">N</span>
                            {Array.from({ length: cohortGrid.maxOffset + 1 }).map((_, i) => (
                                <span key={i} className="gl-cohort-grid-offset" role="columnheader">
                                    M{i}
                                </span>
                            ))}
                        </div>
                        {cohortGrid.rows.map(row => (
                            <div key={row.month} className="gl-cohort-grid-row" role="row">
                                <span className="gl-cohort-grid-label" role="rowheader">{row.month}</span>
                                <span className="gl-cohort-grid-size" role="cell">{row.size}</span>
                                {Array.from({ length: cohortGrid.maxOffset + 1 }).map((_, i) => {
                                    const v = row.retention[i]
                                    if (v === undefined) {
                                        return <span key={i} className="gl-cohort-grid-cell gl-cohort-grid-cell-empty" role="cell" />
                                    }
                                    const level = v === 0 ? 0
                                        : v < 0.15 ? 1
                                        : v < 0.4 ? 2
                                        : v < 0.7 ? 3 : 4
                                    return (
                                        <span
                                            key={i}
                                            className={`gl-cohort-grid-cell gl-topic-heatmap-cell-l${level}`}
                                            role="cell"
                                            title={`${row.month}: ${Math.round(v * 100)}% active at M${i}`}
                                        >
                                            {Math.round(v * 100)}
                                        </span>
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Cross-team collab matrix (plan §2, panel 5/5) ─ */}
            {collabMatrix.teamsList.length > 0 && (
                <div className="gl-panel">
                    <div className="gl-panel-header">
                        <h2 className="gl-panel-title">Cross-team collaboration</h2>
                        <span className="gl-panel-subtitle">
                            Rows = author's team. Columns = reviewer's team. Cell = MERGED-PR
                            review count (self-reviews + dependabot excluded).
                            {teamCollabData?.period ? ` Period: ${teamCollabData.period}.` : " All time."}
                        </span>
                    </div>
                    <div className="gl-collab-matrix" role="table" aria-label="Cross-team collaboration matrix">
                        <div className="gl-collab-matrix-row gl-collab-matrix-head" role="row">
                            <span className="gl-collab-matrix-corner" role="columnheader" aria-label="author down × reviewer right">
                                ↓ author / reviewer →
                            </span>
                            {collabMatrix.teamsList.map(slug => (
                                <span
                                    key={slug}
                                    className="gl-collab-matrix-col"
                                    role="columnheader"
                                    style={{ borderTopColor: teamMeta.get(slug)?.color ?? "transparent" }}
                                    title={teamMeta.get(slug)?.name ?? slug}
                                >
                                    {teamMeta.get(slug)?.name ?? slug}
                                </span>
                            ))}
                        </div>
                        {collabMatrix.teamsList.map(authorSlug => (
                            <div key={authorSlug} className="gl-collab-matrix-row" role="row">
                                <span
                                    className="gl-collab-matrix-row-label"
                                    role="rowheader"
                                    style={{ borderLeftColor: teamMeta.get(authorSlug)?.color ?? "transparent" }}
                                >
                                    {teamMeta.get(authorSlug)?.name ?? authorSlug}
                                </span>
                                {collabMatrix.teamsList.map(reviewerSlug => {
                                    const v = collabMatrix.get(authorSlug, reviewerSlug)
                                    const ratio = collabMatrix.max > 0 ? v / collabMatrix.max : 0
                                    const level = v === 0 ? 0
                                        : ratio < 0.15 ? 1
                                        : ratio < 0.4 ? 2
                                        : ratio < 0.7 ? 3 : 4
                                    const diag = authorSlug === reviewerSlug
                                    return (
                                        <span
                                            key={reviewerSlug}
                                            className={`gl-collab-matrix-cell gl-topic-heatmap-cell-l${level}${diag ? " gl-collab-matrix-diag" : ""}`}
                                            role="cell"
                                            title={`${teamMeta.get(authorSlug)?.name ?? authorSlug} → ${teamMeta.get(reviewerSlug)?.name ?? reviewerSlug}: ${v} reviews`}
                                        >
                                            {v > 0 ? v : ""}
                                        </span>
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                    {(Object.keys(teamCollabData?.outsiderReviewsByAuthorTeam ?? {}).length > 0 ||
                      Object.keys(teamCollabData?.outsiderReviewsByReviewerTeam ?? {}).length > 0) && (
                        <p className="gl-panel-footnote">
                            Reviews involving contributors with no team membership aren't shown here
                            (∑ author-side: {Object.values(teamCollabData?.outsiderReviewsByAuthorTeam ?? {}).reduce((a, b) => a + b, 0)},
                            reviewer-side: {Object.values(teamCollabData?.outsiderReviewsByReviewerTeam ?? {}).reduce((a, b) => a + b, 0)}).
                        </p>
                    )}
                </div>
            )}

            {/* ── Monthly Activity Trend (centerpiece) ────────── */}
            {monthlyActivity && monthlyActivity.length > 0 && (
                <div className="gl-panel">
                    <div className="gl-panel-header">
                        <h2 className="gl-panel-title">PR Activity Trend</h2>
                        <span className="gl-panel-subtitle">Merged, reviewed, and open PRs per month</span>
                    </div>
                    <div className="gl-chart-container" role="img" aria-label="Area chart showing monthly PR activity trend: merged, reviewed, and open">
                        <ResponsiveContainer width="100%" height={280}>
                            <AreaChart data={monthlyActivity} margin={{ left: 10, right: 10, top: 10, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="gradMerged" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={ct.primary} stopOpacity={0.3} />
                                        <stop offset="100%" stopColor={ct.primary} stopOpacity={0.02} />
                                    </linearGradient>
                                    <linearGradient id="gradReviewed" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={ct.reviewed} stopOpacity={0.25} />
                                        <stop offset="100%" stopColor={ct.reviewed} stopOpacity={0.02} />
                                    </linearGradient>
                                    <linearGradient id="gradOpen" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={ct.open} stopOpacity={0.2} />
                                        <stop offset="100%" stopColor={ct.open} stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid {...gridStyle} />
                                <XAxis dataKey="month" tick={axisTick} tickFormatter={m => m.slice(5)} />
                                <YAxis tick={axisTick} />
                                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--color-text)" }} />
                                <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontFamily: "var(--gl-font-mono)" }} />
                                <Area type="monotone" dataKey="merged" name="Merged" stroke={ct.primary} strokeWidth={2} fill="url(#gradMerged)" />
                                <Area type="monotone" dataKey="inReview" name="In Review" stroke={ct.reviewed} strokeWidth={1.5} fill="url(#gradReviewed)" />
                                <Area type="monotone" dataKey="open" name="Open" stroke={ct.open} strokeWidth={1.5} fill="url(#gradOpen)" />
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
                                <div className="gl-chart-container" role="img" aria-label="Bar chart showing contributor distribution by merged PR count">
                                    <ResponsiveContainer width="100%" height={260}>
                                        <BarChart data={contributionTiers} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
                                            <CartesianGrid {...gridStyle} />
                                            <XAxis dataKey="label" tick={axisTick} />
                                            <YAxis tick={axisTick} />
                                            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--color-text)" }} />
                                            <Bar dataKey="count" name="Contributors" fill={ct.primary} radius={[3, 3, 0, 0]} />
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
                                <div className="gl-chart-container" role="img" aria-label="Horizontal bar chart showing most active repositories by merged PRs">
                                    <ResponsiveContainer width="100%" height={260}>
                                        <BarChart data={repoActivity.slice(0, 8)} layout="vertical" margin={{ left: 100, right: 10, top: 10, bottom: 0 }}>
                                            <CartesianGrid {...gridStyle} />
                                            <XAxis type="number" tick={axisTick} />
                                            <YAxis type="category" dataKey="name" tick={{ ...axisTick, fontSize: 9 }} width={90} />
                                            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--color-text)" }} />
                                            <Bar dataKey="prs" name="Merged PRs" fill={ct.open} radius={[0, 3, 3, 0]} />
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
                            <div className="gl-chart-container" role="img" aria-label="Horizontal bar chart showing team breakdown by PRs, commits, issues, and reviews">
                                <ResponsiveContainer width="100%" height={Math.max(280, teamData.length * 45)}>
                                    <BarChart data={teamData} layout="vertical" margin={{ left: 120, right: 20, top: 10, bottom: 10 }}>
                                        <CartesianGrid {...gridStyle} />
                                        <XAxis type="number" tick={axisTick} />
                                        <YAxis type="category" dataKey="name" tick={{ ...axisTick, fontSize: 11 }} width={110} />
                                        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--color-text)" }} />
                                        <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontFamily: "var(--gl-font-mono)" }} />
                                        <Bar dataKey="prs" name="PRs" fill={ct.open} radius={[0, 2, 2, 0]} />
                                        <Bar dataKey="commits" name="Commits" fill={ct.commits} radius={[0, 2, 2, 0]} />
                                        <Bar dataKey="issues" name="Issues" fill={ct.issues} radius={[0, 2, 2, 0]} />
                                        <Bar dataKey="reviews" name="Reviews" fill={ct.reviewed} radius={[0, 2, 2, 0]} />
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
                                    <span className="gl-panel-subtitle">Click a proposal to view details & vote</span>
                                </div>
                                <div className="gl-chart-container">
                                    <ResponsiveContainer width="100%" height={260}>
                                        <BarChart
                                            data={voteData.slice(0, 10)}
                                            layout="vertical"
                                            margin={{ left: 90, right: 10, top: 10, bottom: 0 }}
                                            onClick={(state) => {
                                                if (state?.activePayload?.[0]?.payload) {
                                                    handleVoteBarClick(state.activePayload[0].payload)
                                                }
                                            }}
                                            style={{ cursor: "pointer" }}
                                        >
                                            <CartesianGrid {...gridStyle} />
                                            <XAxis type="number" tick={axisTick} />
                                            <YAxis type="category" dataKey="name" tick={{ ...axisTick, fontSize: 9 }} width={80} />
                                            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--color-text)" }} />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: 10, fontFamily: "var(--gl-font-mono)" }} />
                                            <Bar dataKey="yes" name="Yes" stackId="votes" fill={ct.commits} />
                                            <Bar dataKey="no" name="No" stackId="votes" fill={ct.danger} />
                                            <Bar dataKey="abstain" name="Abstain" stackId="votes" fill={ct.neutral} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

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
                <span className="gl-dash-card-icon" aria-hidden="true">{icon}</span>
                <span className="gl-dash-card-label">{label}</span>
            </div>
            <div className="gl-dash-card-value">{value.toLocaleString()}</div>
            {sparkline && sparkline.length > 2 && (
                <Sparkline data={sparkline} color={color ?? "var(--gl-color-chart-series-primary, var(--color-brand))"} />
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

