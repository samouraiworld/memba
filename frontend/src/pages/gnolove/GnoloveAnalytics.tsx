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
} from "../../hooks/gnolove"
import { computeFocusAreas } from "../../lib/gnoloveFocusAreas"
import { TEAMS, TEAM_CSS_COLORS, TimeFilter, TIME_FILTER_LABELS, isTimeFilter } from "../../lib/gnoloveConstants"
import { PageMeta } from "../../components/gnolove/PageMeta"

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
    // Plan §2: "wire the page-level period selector to URL state."
    // Validate the URL param at the boundary so a malformed link doesn't
    // crash the page; fall back to ALL_TIME (the historical default).
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

    // Snapshot "now" once at mount so useMemos that bucket by recency stay
    // stable across re-renders. react-hooks/purity flags raw Date.now() inside
    // memos, and we don't want the analytics page to tick second-by-second
    // anyway — a per-mount anchor is the right granularity here.
    const [nowMs] = useState(() => Date.now())
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
                return { name: label.length > 20 ? label.slice(0, 20) + "..." : label, yes, no, abstain, proposalId: p.id }
            })
            .reverse()
    }, [proposals])

    const navigate = useNavigate()
    const handleVoteBarClick = useCallback((data: { proposalId?: string }) => {
        if (data?.proposalId) {
            navigate(`/dao/gno.land/r/gov/dao/proposal/${data.proposalId}`)
        }
    }, [navigate])

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

    // ── Cycle time histogram (plan §2) ───────────────────────
    // Buckets merged-PR cycle time (mergedAt - createdAt) into seven
    // human-meaningful ranges. Includes ALL period buckets even when
    // empty so the chart shape stays comparable across periods.
    const cycleTimeHistogram = useMemo(() => {
        const buckets: { label: string; max: number; count: number }[] = [
            { label: "<1d",    max: 1,           count: 0 },
            { label: "1-3d",   max: 3,           count: 0 },
            { label: "3-7d",   max: 7,           count: 0 },
            { label: "1-2w",   max: 14,          count: 0 },
            { label: "2-4w",   max: 28,          count: 0 },
            { label: "1-3mo",  max: 90,          count: 0 },
            { label: ">3mo",   max: Number.POSITIVE_INFINITY, count: 0 },
        ]
        if (!yearReport?.merged) return buckets
        const cutoff = (() => {
            switch (period) {
                case TimeFilter.WEEKLY: return nowMs - 7 * 24 * 3_600_000
                case TimeFilter.MONTHLY: return nowMs - 30 * 24 * 3_600_000
                case TimeFilter.YEARLY: return nowMs - 365 * 24 * 3_600_000
                default: return 0
            }
        })()
        for (const pr of yearReport.merged) {
            if (!pr.mergedAt || !pr.createdAt) continue
            const merged = new Date(pr.mergedAt).getTime()
            if (cutoff > 0 && merged < cutoff) continue
            const created = new Date(pr.createdAt).getTime()
            const days = (merged - created) / 86_400_000
            if (days < 0) continue
            const bucket = buckets.find(b => days <= b.max)
            if (bucket) bucket.count++
        }
        return buckets
    }, [yearReport, period, nowMs])

    // ── Topic activity heatmap (plan §2) ─────────────────────
    // 16 topics × 12 trailing months. Reuses the same /topics taxonomy
    // the Team Hub uses (Phase 2c) so analytics and the hub agree on
    // what counts as "wallet" vs "governance" PR work.
    const topicHeatmap = useMemo(() => {
        if (!yearReport?.merged) return { months: [], rows: [] as { topic: string; counts: number[]; total: number }[] }
        // Roll trailing 12 months ending at the current month.
        const anchor = new Date(nowMs)
        const months: string[] = []
        const monthIndex = new Map<string, number>()
        for (let i = 11; i >= 0; i--) {
            const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
            monthIndex.set(key, months.length)
            months.push(key)
        }
        // Build per-topic monthly buckets using the classifier inside computeFocusAreas:
        // we re-derive classification per PR by running each one through a single-rule
        // call. Faster + simpler: inline a tiny classifier here using the live rules.
        const counts = new Map<string, number[]>()
        const ensure = (topic: string): number[] => {
            let row = counts.get(topic)
            if (!row) { row = new Array(months.length).fill(0); counts.set(topic, row) }
            return row
        }
        for (const pr of yearReport.merged) {
            if (!pr.mergedAt) continue
            const monthKey = pr.mergedAt.slice(0, 7)
            const m = monthIndex.get(monthKey)
            if (m === undefined) continue
            const repoMatch = pr.url.match(/github\.com\/([^/]+\/[^/]+)/)
            const repo = repoMatch ? repoMatch[1] : ""
            // computeFocusAreas takes signals, but we want per-PR classification.
            // Reuse it with a single-signal call → first pill is the topic.
            const pills = computeFocusAreas([{ repo, title: pr.title }], topicRules)
            const topic = pills[0]?.topic ?? "other"
            ensure(topic)[m]++
        }
        const rows = Array.from(counts.entries())
            .map(([topic, counts]) => ({
                topic,
                counts,
                total: counts.reduce((s, n) => s + n, 0),
            }))
            // Hide "other" if it's noise (< 5% of total signal); always sort by total desc.
            .filter(r => {
                if (r.topic !== "other") return true
                const grandTotal = Array.from(counts.values()).reduce(
                    (s, row) => s + row.reduce((a, b) => a + b, 0), 0,
                )
                return grandTotal > 0 && r.total / grandTotal > 0.05
            })
            .sort((a, b) => b.total - a.total)
        return { months, rows }
    }, [yearReport, topicRules, nowMs])

    const topicHeatmapMax = useMemo(() => {
        let max = 0
        for (const r of topicHeatmap.rows) for (const c of r.counts) if (c > max) max = c
        return max
    }, [topicHeatmap])

    // ── Repo health matrix (plan §2) ─────────────────────────
    // Rows = repos in the year report, cols = traffic-light scored
    // PRs/week, median cycle time, open backlog (in-progress + waiting +
    // blocked + reviewed), last activity. Cells use the gl-color-state
    // tokens; "good / fair / poor" is keyed off engineering-team norms.
    const repoHealth = useMemo(() => {
        if (!yearReport?.merged) return [] as { repo: string; prsPerWeek: number; medianCycleDays: number; openBacklog: number; lastActivityDays: number }[]
        type Bucket = { merged: number[]; cycleDays: number[]; lastMerged: number; openBacklog: number }
        const byRepo = new Map<string, Bucket>()
        const repoKey = (url: string) => url.match(/github\.com\/([^/]+\/[^/]+)/)?.[1] ?? ""
        for (const pr of yearReport.merged) {
            const repo = repoKey(pr.url)
            if (!repo || !pr.mergedAt) continue
            const merged = new Date(pr.mergedAt).getTime()
            const created = pr.createdAt ? new Date(pr.createdAt).getTime() : merged
            const days = (merged - created) / 86_400_000
            let row = byRepo.get(repo)
            if (!row) { row = { merged: [], cycleDays: [], lastMerged: 0, openBacklog: 0 }; byRepo.set(repo, row) }
            row.merged.push(merged)
            row.cycleDays.push(days)
            if (merged > row.lastMerged) row.lastMerged = merged
        }
        for (const bucket of ["in_progress", "waiting_for_review", "reviewed", "blocked"] as const) {
            for (const pr of yearReport[bucket] ?? []) {
                const repo = repoKey(pr.url)
                if (!repo) continue
                let row = byRepo.get(repo)
                if (!row) { row = { merged: [], cycleDays: [], lastMerged: 0, openBacklog: 0 }; byRepo.set(repo, row) }
                row.openBacklog++
            }
        }
        const oneYearAgo = nowMs - 365 * 24 * 3_600_000
        return Array.from(byRepo.entries())
            .map(([repo, b]) => {
                const weeksCovered = Math.max(1, (nowMs - oneYearAgo) / (7 * 24 * 3_600_000))
                const sortedCycles = [...b.cycleDays].sort((a, b) => a - b)
                const median = sortedCycles.length === 0
                    ? 0
                    : sortedCycles[Math.floor(sortedCycles.length / 2)]
                return {
                    repo,
                    prsPerWeek: b.merged.length / weeksCovered,
                    medianCycleDays: median,
                    openBacklog: b.openBacklog,
                    lastActivityDays: b.lastMerged === 0 ? Number.POSITIVE_INFINITY : (nowMs - b.lastMerged) / 86_400_000,
                }
            })
            .filter(r => r.prsPerWeek > 0 || r.openBacklog > 0)
            .sort((a, b) => b.prsPerWeek - a.prsPerWeek)
            .slice(0, 15)
    }, [yearReport, nowMs])

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
            <PageMeta title="Ecosystem Insights | Gnolove · Memba" description="Time-series analytics for the Gno ecosystem (PRs, commits, proposals, governance)." />
            <div className="gl-header">
                <h1 className="gl-title">📈 Ecosystem Insights</h1>
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
                    <DashStatCard label="Pull Requests" value={stats.totalPrs} icon="🔀" sparkline={sparklineMerged} color="#00d4aa" />
                    <DashStatCard label="Commits" value={stats.totalCommits} icon="📝" />
                    <DashStatCard label="Issues" value={stats.totalIssues} icon="🐛" />
                    <DashStatCard label="Reviews" value={stats.totalReviews} icon="👁️" sparkline={sparklineOpen} color="#a855f7" />
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
                    <div className="gl-chart-container">
                        <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={cycleTimeHistogram} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
                                <CartesianGrid {...GRID_STYLE} />
                                <XAxis dataKey="label" tick={AXIS_TICK} />
                                <YAxis tick={AXIS_TICK} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--color-text)" }} />
                                <Bar dataKey="count" name="Merged PRs" fill="var(--gl-color-state-merged, #a855f7)" radius={[3, 3, 0, 0]} />
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
                                    const ratio = topicHeatmapMax > 0 ? c / topicHeatmapMax : 0
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
                                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--color-text)" }} />
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
                                            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--color-text)" }} />
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
                                            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--color-text)" }} />
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
                                        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--color-text)" }} />
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
                                            <CartesianGrid {...GRID_STYLE} />
                                            <XAxis type="number" tick={AXIS_TICK} />
                                            <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} width={80} />
                                            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--color-text)" }} />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace" }} />
                                            <Bar dataKey="yes" name="Yes" stackId="votes" fill="#22c55e" />
                                            <Bar dataKey="no" name="No" stackId="votes" fill="#ef4444" />
                                            <Bar dataKey="abstain" name="Abstain" stackId="votes" fill="#777" />
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

