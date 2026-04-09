/**
 * GnoloveReport — PR status report with team/repo filters and export.
 *
 * Two views:
 *  - Table View (default): raw PR list with filters
 *  - Report View: formatted narrative report (gno-skills style) with stats,
 *    highlights, blockers — shareable via ?view=report URL param
 *
 * Period navigation (weekly/monthly/yearly/all-time) with PR status tabs.
 * Ported from gnolove report-client-page.tsx — MVP approach per F4.
 *
 * @module pages/gnolove/GnoloveReport
 */

import { useState, useMemo, useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import {
    startOfWeek, endOfWeek, addWeeks,
    startOfMonth, endOfMonth, addMonths,
    startOfYear, endOfYear, addYears,
    format, isFuture, getISOWeek,
} from "date-fns"
import { useGnoloveReport, useGnoloveRepositories } from "../../hooks/gnolove"
import { REPORT_TAB_LABELS, TEAMS, TEAM_CSS_COLORS } from "../../lib/gnoloveConstants"
import type { ReportTab, Team } from "../../lib/gnoloveConstants"
import type { TPullRequest, TPullRequestReport } from "../../lib/gnoloveSchemas"
import { exportToCSV, exportToMarkdown, exportToPDF } from "../../lib/gnoloveExport"
import { extractRepoFromUrl } from "../../lib/gnoloveApi"

type ViewMode = "table" | "report"

type ReportPeriod = "weekly" | "monthly" | "yearly" | "all_time"

const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
    weekly: "Weekly",
    monthly: "Monthly",
    yearly: "Yearly",
    all_time: "All Time",
}

function computeRange(period: ReportPeriod, offset: number): { start: Date; end: Date } {
    const now = new Date()
    switch (period) {
        case "weekly": {
            const ref = addWeeks(now, offset)
            return { start: startOfWeek(ref, { weekStartsOn: 1 }), end: endOfWeek(ref, { weekStartsOn: 1 }) }
        }
        case "monthly": {
            const ref = addMonths(now, offset)
            return { start: startOfMonth(ref), end: endOfMonth(ref) }
        }
        case "yearly": {
            const ref = addYears(now, offset)
            return { start: startOfYear(ref), end: endOfYear(ref) }
        }
        case "all_time":
            return { start: new Date(1980, 0, 1), end: now }
    }
}

export default function GnoloveReport() {
    const [searchParams, setSearchParams] = useSearchParams()
    const [period, setPeriod] = useState<ReportPeriod>("weekly")
    const [offset, setOffset] = useState(-1) // Default to previous week (report of past work)
    const [activeTab, setActiveTab] = useState<ReportTab | "all">("all")
    const [selectedTeam, setSelectedTeam] = useState("all")
    const [selectedRepo, setSelectedRepo] = useState("all")
    const [view, setView] = useState<ViewMode>(() => searchParams.get("view") === "report" ? "report" : "table")

    const handleViewToggle = useCallback((v: ViewMode) => {
        setView(v)
        setSearchParams(prev => {
            const next = new URLSearchParams(prev)
            if (v === "report") next.set("view", "report")
            else next.delete("view")
            return next
        }, { replace: true })
    }, [setSearchParams])

    const { data: repos } = useGnoloveRepositories()

    const { start, end } = useMemo(() => computeRange(period, offset), [period, offset])

    const { data: report, isLoading, isError: reportError, refetch } = useGnoloveReport(start, end)

    const prs: TPullRequest[] = useMemo(() => {
        if (!report) return []
        if (activeTab === "all") {
            return [
                ...(report.merged ?? []),
                ...(report.in_progress ?? []),
                ...(report.waiting_for_review ?? []),
                ...(report.reviewed ?? []),
                ...(report.blocked ?? []),
            ]
        }
        return (report[activeTab] ?? [])
    }, [report, activeTab])

    const filteredPrs = useMemo(() => {
        let result = prs

        if (selectedTeam !== "all") {
            const team = TEAMS.find(t => t.name === selectedTeam)
            if (team) {
                result = result.filter(pr => pr.authorLogin && team.members.includes(pr.authorLogin))
            }
        }

        if (selectedRepo !== "all") {
            result = result.filter(pr => extractRepoFromUrl(pr.url) === selectedRepo)
        }

        return result
    }, [prs, selectedTeam, selectedRepo])

    const counts = useMemo(() => {
        if (!report) return {} as Record<ReportTab | "all", number>
        const merged = report.merged?.length ?? 0
        const inProgress = report.in_progress?.length ?? 0
        const waitingForReview = report.waiting_for_review?.length ?? 0
        const reviewed = report.reviewed?.length ?? 0
        const blocked = report.blocked?.length ?? 0
        return {
            all: merged + inProgress + waitingForReview + reviewed + blocked,
            merged,
            in_progress: inProgress,
            waiting_for_review: waitingForReview,
            reviewed,
            blocked,
        }
    }, [report])

    const canGoForward = period !== "all_time" && !isFuture(
        period === "weekly" ? addWeeks(start, 1) :
        period === "monthly" ? addMonths(start, 1) :
        addYears(start, 1)
    )

    const dateLabel = useMemo(() => {
        switch (period) {
            case "weekly":
                return `${format(start, "MMM d")} — ${format(end, "MMM d, yyyy")}`
            case "monthly":
                return format(start, "MMMM yyyy")
            case "yearly":
                return format(start, "yyyy")
            case "all_time":
                return "All Time"
        }
    }, [period, start, end])

    function handlePeriodChange(p: ReportPeriod) {
        setPeriod(p)
        setOffset(p === "weekly" ? -1 : 0) // Weekly defaults to previous week
    }

    return (
        <div className="gl-page">
            <div className="gl-header">
                <h1 className="gl-title">📋 PR Report</h1>
                <div className="gl-report-actions">
                    <div className="gl-view-toggle">
                        <button
                            className={`gl-view-btn ${view === "table" ? "gl-view-btn--active" : ""}`}
                            onClick={() => handleViewToggle("table")}
                        >
                            Table
                        </button>
                        <button
                            className={`gl-view-btn ${view === "report" ? "gl-view-btn--active" : ""}`}
                            onClick={() => handleViewToggle("report")}
                        >
                            Report
                        </button>
                    </div>
                    <button
                        className="gl-export-btn"
                        onClick={() => exportToCSV(filteredPrs, activeTab, format(start, "yyyy-MM-dd"))}
                        disabled={filteredPrs.length === 0}
                    >
                        Export CSV
                    </button>
                    <button
                        className="gl-export-btn"
                        onClick={() => exportToMarkdown(filteredPrs, activeTab, dateLabel)}
                        disabled={filteredPrs.length === 0}
                    >
                        Export MD
                    </button>
                    <button
                        className="gl-export-btn"
                        onClick={() => exportToPDF(filteredPrs, activeTab, dateLabel)}
                        disabled={filteredPrs.length === 0}
                    >
                        Export PDF
                    </button>
                </div>
            </div>

            {/* ── Error Banner ────────────────────────────────── */}
            {reportError && !isLoading && (
                <div className="gl-error-banner">
                    <span>⚠️ Failed to load report data — the Gnolove backend may be unavailable.</span>
                    <button className="gl-error-retry" onClick={() => refetch()}>Retry</button>
                </div>
            )}

            {/* Period Tabs */}
            <div className="gl-tabs">
                {(Object.entries(REPORT_PERIOD_LABELS) as [ReportPeriod, string][]).map(([key, label]) => (
                    <button
                        key={key}
                        className={`gl-tab ${period === key ? "gl-tab--active" : ""}`}
                        onClick={() => handlePeriodChange(key)}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Date Navigator */}
            {period !== "all_time" && (
                <div className="gl-week-nav">
                    <button className="gl-week-btn" onClick={() => setOffset(o => o - 1)} aria-label="Previous">← Previous</button>
                    <span className="gl-week-label">{dateLabel}</span>
                    <button
                        className="gl-week-btn"
                        onClick={() => setOffset(o => o + 1)}
                        disabled={!canGoForward}
                        aria-label="Next"
                    >
                        Next →
                    </button>
                </div>
            )}

            {/* Filters */}
            <div className="gl-report-filters">
                <select
                    className="gl-filter-select"
                    value={selectedTeam}
                    onChange={e => setSelectedTeam(e.target.value)}
                >
                    <option value="all">All Teams</option>
                    {TEAMS.map(team => (
                        <option key={team.name} value={team.name}>{team.name}</option>
                    ))}
                </select>
                <select
                    className="gl-filter-select"
                    value={selectedRepo}
                    onChange={e => setSelectedRepo(e.target.value)}
                >
                    <option value="all">All Repositories</option>
                    {repos?.map(repo => (
                        <option key={repo.id} value={`${repo.owner}/${repo.name}`}>
                            {repo.owner}/{repo.name}
                        </option>
                    ))}
                </select>
            </div>

            {/* Status Tabs */}
            <div className="gl-tabs">
                <button
                    className={`gl-tab ${activeTab === "all" ? "gl-tab--active" : ""}`}
                    onClick={() => setActiveTab("all")}
                >
                    All
                    {counts.all != null && <span className="gl-tab-count">{counts.all}</span>}
                </button>
                {(Object.entries(REPORT_TAB_LABELS) as [ReportTab, string][]).map(([key, label]) => (
                    <button
                        key={key}
                        className={`gl-tab ${activeTab === key ? "gl-tab--active" : ""}`}
                        onClick={() => setActiveTab(key)}
                    >
                        {label}
                        {counts[key] != null && (
                            <span className="gl-tab-count">{counts[key]}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Content: Table or Report view */}
            {isLoading ? (
                <div className="gl-section">
                    <div className="gl-loading">
                        <div className="gl-skeleton" /><div className="gl-skeleton" /><div className="gl-skeleton" />
                    </div>
                </div>
            ) : view === "report" ? (
                <NarrativeReportView
                    report={report}
                    dateLabel={dateLabel}
                    start={start}
                    selectedTeam={selectedTeam}
                    selectedRepo={selectedRepo}
                />
            ) : (
                <div className="gl-section">
                    {filteredPrs.length === 0 ? (
                        <div className="gl-empty">No pull requests in this category for the selected period.</div>
                    ) : (
                        <div className="gl-pr-list">
                            {filteredPrs.map(pr => (
                                <a key={pr.id} href={pr.url} target="_blank" rel="noopener noreferrer" className="gl-pr-row">
                                    {pr.authorAvatarUrl && (
                                        <img src={pr.authorAvatarUrl} alt="" className="gl-pr-avatar" loading="lazy" />
                                    )}
                                    <div className="gl-pr-info">
                                        <span className="gl-pr-title">{pr.title}</span>
                                        <span className="gl-pr-meta">
                                            #{pr.number}
                                            {pr.authorLogin && ` by @${pr.authorLogin}`}
                                            {pr.isDraft && " · Draft"}
                                            {pr.reviewDecision && ` · ${pr.reviewDecision}`}
                                        </span>
                                    </div>
                                    <PRStateBadge state={pr.state} mergedAt={pr.mergedAt} tab={activeTab} />
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Narrative Report View ─────────────────────────────────────

function NarrativeReportView({ report, dateLabel, start, selectedTeam, selectedRepo }: {
    report: TPullRequestReport | undefined
    dateLabel: string
    start: Date
    selectedTeam: string
    selectedRepo: string
}) {
    const [copied, setCopied] = useState(false)

    // Apply team/repo filters to all categories
    const filterPrs = useCallback((prs: TPullRequest[] | null | undefined): TPullRequest[] => {
        let result = prs ?? []
        if (selectedTeam !== "all") {
            const team = TEAMS.find(t => t.name === selectedTeam)
            if (team) result = result.filter(pr => pr.authorLogin && team.members.includes(pr.authorLogin))
        }
        if (selectedRepo !== "all") {
            result = result.filter(pr => extractRepoFromUrl(pr.url) === selectedRepo)
        }
        return result
    }, [selectedTeam, selectedRepo])

    const merged = useMemo(() => filterPrs(report?.merged), [report, filterPrs])
    const inProgress = useMemo(() => filterPrs(report?.in_progress), [report, filterPrs])
    const waitingForReview = useMemo(() => filterPrs(report?.waiting_for_review), [report, filterPrs])
    const reviewed = useMemo(() => filterPrs(report?.reviewed), [report, filterPrs])
    const blocked = useMemo(() => filterPrs(report?.blocked), [report, filterPrs])

    const allPrs = useMemo(() => [...merged, ...inProgress, ...waitingForReview, ...reviewed, ...blocked], [merged, inProgress, waitingForReview, reviewed, blocked])

    // Group by repository
    const byRepo = useMemo(() => {
        const map = new Map<string, TPullRequest[]>()
        for (const pr of allPrs) {
            const repo = extractRepoFromUrl(pr.url) || "unknown"
            const list = map.get(repo) || []
            list.push(pr)
            map.set(repo, list)
        }
        return map
    }, [allPrs])

    // Active contributors
    const contributors = useMemo(() => {
        const set = new Set<string>()
        for (const pr of allPrs) {
            if (pr.authorLogin) set.add(pr.authorLogin)
        }
        return Array.from(set).sort()
    }, [allPrs])

    // Top merged PRs (by title length as proxy for impact — simple heuristic)
    const topMerged = useMemo(() =>
        [...merged].sort((a, b) => b.title.length - a.title.length).slice(0, 5),
        [merged]
    )

    // Find contributor team
    const getTeamForUser = (login: string): Team | undefined =>
        TEAMS.find(t => t.members.includes(login))

    // PR status label
    const prStatus = (pr: TPullRequest): string =>
        pr.mergedAt || pr.state === "MERGED" ? "Merged" :
        blocked.includes(pr) ? "Blocked" :
        waitingForReview.includes(pr) ? "Waiting for Review" :
        reviewed.includes(pr) ? "Reviewed" :
        "In Progress"

    const weekId = `${format(start, "yyyy")}-W${String(getISOWeek(start)).padStart(2, "0")}`

    // Generate shareable markdown
    const generateReportMd = useCallback((): string => {
        const lines: string[] = [
            `# Weekly Report — ${dateLabel}`,
            "",
            `## Highlights`,
        ]
        if (topMerged.length > 0) {
            for (const pr of topMerged) {
                lines.push(`- [Merged] PR #${pr.number}: ${pr.title}${pr.authorLogin ? ` @${pr.authorLogin}` : ""}`)
            }
        } else {
            lines.push("- No merged PRs this period")
        }

        lines.push("", `## Stats`, `- PRs Merged: ${merged.length}`, `- PRs In Progress: ${inProgress.length}`, `- Waiting for Review: ${waitingForReview.length}`, `- Reviewed: ${reviewed.length}`, `- Blocked: ${blocked.length}`, `- Contributors Active: ${contributors.length}`)

        lines.push("", `## By Repository`)
        for (const [repo, prs] of byRepo) {
            lines.push(`### ${repo}`)
            for (const pr of prs) {
                lines.push(`- PR #${pr.number}: ${pr.title}${pr.authorLogin ? ` @${pr.authorLogin}` : ""} [${prStatus(pr)}]`)
            }
        }

        if (blocked.length > 0) {
            lines.push("", `## Blockers`)
            for (const pr of blocked) {
                lines.push(`- PR #${pr.number}: ${pr.title}${pr.authorLogin ? ` @${pr.authorLogin}` : ""}`)
            }
        }

        lines.push("", `---`, `_Generated by Gnolove · ${weekId}_`)
        return lines.join("\n")
    }, [dateLabel, topMerged, merged, inProgress, waitingForReview, reviewed, blocked, contributors, byRepo, weekId, prStatus])

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(generateReportMd()).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }, [generateReportMd])

    const handleDownload = useCallback(() => {
        const blob = new Blob([generateReportMd()], { type: "text/markdown" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `weekly-report-${weekId}.md`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }, [generateReportMd, weekId])

    if (allPrs.length === 0) {
        return <div className="gl-section"><div className="gl-empty">No data for this period.</div></div>
    }

    return (
        <div className="gl-report-narrative">
            {/* Copy / Download actions */}
            <div className="gl-report-narrative__actions">
                <button className="gl-export-btn" onClick={handleCopy}>
                    {copied ? "Copied!" : "Copy as Markdown"}
                </button>
                <button className="gl-export-btn" onClick={handleDownload}>
                    Download .md
                </button>
                <span className="gl-report-narrative__week-id">{weekId}</span>
            </div>

            {/* Highlights */}
            <section className="gl-report-narrative__section">
                <h2 className="gl-report-narrative__heading">Highlights</h2>
                {topMerged.length > 0 ? (
                    <ul className="gl-report-narrative__list">
                        {topMerged.map(pr => (
                            <li key={pr.id}>
                                <span className="gl-pr-state gl-pr-state--merged" style={{ marginRight: 6 }}>Merged</span>
                                <a href={pr.url} target="_blank" rel="noopener noreferrer">PR #{pr.number}</a>: {pr.title}
                                {pr.authorLogin && <span className="gl-report-narrative__author"> @{pr.authorLogin}</span>}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="gl-report-narrative__empty">No merged PRs this period.</p>
                )}
            </section>

            {/* Stats */}
            <section className="gl-report-narrative__section">
                <h2 className="gl-report-narrative__heading">Stats</h2>
                <div className="gl-report-narrative__stats">
                    <div className="gl-report-narrative__stat">
                        <span className="gl-report-narrative__stat-value">{merged.length}</span>
                        <span className="gl-report-narrative__stat-label">Merged</span>
                    </div>
                    <div className="gl-report-narrative__stat">
                        <span className="gl-report-narrative__stat-value">{inProgress.length}</span>
                        <span className="gl-report-narrative__stat-label">In Progress</span>
                    </div>
                    <div className="gl-report-narrative__stat">
                        <span className="gl-report-narrative__stat-value">{waitingForReview.length}</span>
                        <span className="gl-report-narrative__stat-label">Waiting</span>
                    </div>
                    <div className="gl-report-narrative__stat">
                        <span className="gl-report-narrative__stat-value">{reviewed.length}</span>
                        <span className="gl-report-narrative__stat-label">Reviewed</span>
                    </div>
                    {blocked.length > 0 && (
                        <div className="gl-report-narrative__stat gl-report-narrative__stat--blocked">
                            <span className="gl-report-narrative__stat-value">{blocked.length}</span>
                            <span className="gl-report-narrative__stat-label">Blocked</span>
                        </div>
                    )}
                    <div className="gl-report-narrative__stat">
                        <span className="gl-report-narrative__stat-value">{contributors.length}</span>
                        <span className="gl-report-narrative__stat-label">Contributors</span>
                    </div>
                </div>
            </section>

            {/* By Repository */}
            <section className="gl-report-narrative__section">
                <h2 className="gl-report-narrative__heading">By Repository</h2>
                {Array.from(byRepo.entries()).map(([repo, prs]) => (
                    <div key={repo} className="gl-report-narrative__repo">
                        <h3 className="gl-report-narrative__repo-name">{repo}</h3>
                        <ul className="gl-report-narrative__list">
                            {prs.map(pr => {
                                const team = pr.authorLogin ? getTeamForUser(pr.authorLogin) : undefined
                                return (
                                    <li key={pr.id}>
                                        <a href={pr.url} target="_blank" rel="noopener noreferrer">PR #{pr.number}</a>: {pr.title}
                                        {pr.authorLogin && (
                                            <span className="gl-report-narrative__author">
                                                {" "}@{pr.authorLogin}
                                                {team && <span className="gl-report-narrative__team-dot" style={{ background: TEAM_CSS_COLORS[team.color] }} title={team.name} />}
                                            </span>
                                        )}
                                        <span className={`gl-pr-state gl-pr-state--${prStatus(pr).toLowerCase().replace(/ /g, "-")}`} style={{ marginLeft: 6 }}>
                                            {prStatus(pr)}
                                        </span>
                                    </li>
                                )
                            })}
                        </ul>
                    </div>
                ))}
            </section>

            {/* Contributors */}
            <section className="gl-report-narrative__section">
                <h2 className="gl-report-narrative__heading">Active Contributors ({contributors.length})</h2>
                <div className="gl-report-narrative__contributors">
                    {contributors.map(login => {
                        const team = getTeamForUser(login)
                        const count = allPrs.filter(pr => pr.authorLogin === login).length
                        return (
                            <span key={login} className="gl-report-narrative__contributor">
                                {team && <span className="gl-report-narrative__team-dot" style={{ background: TEAM_CSS_COLORS[team.color] }} title={team.name} />}
                                @{login} <span className="gl-report-narrative__contributor-count">({count})</span>
                            </span>
                        )
                    })}
                </div>
            </section>

            {/* Blockers */}
            {blocked.length > 0 && (
                <section className="gl-report-narrative__section gl-report-narrative__section--blockers">
                    <h2 className="gl-report-narrative__heading">Blockers</h2>
                    <ul className="gl-report-narrative__list">
                        {blocked.map(pr => (
                            <li key={pr.id}>
                                <a href={pr.url} target="_blank" rel="noopener noreferrer">PR #{pr.number}</a>: {pr.title}
                                {pr.authorLogin && <span className="gl-report-narrative__author"> @{pr.authorLogin}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    )
}

function PRStateBadge({ state, mergedAt, tab }: { state: string; mergedAt: string | null; tab: ReportTab | "all" }) {
    const label =
        mergedAt ? "Merged" :
        state === "MERGED" ? "Merged" :
        state === "CLOSED" ? "Closed" :
        tab === "blocked" ? "Blocked" :
        tab === "waiting_for_review" ? "Waiting" :
        "Open"

    const cls =
        label === "Merged" ? "gl-pr-state--merged" :
        label === "Blocked" ? "gl-pr-state--blocked" :
        label === "Waiting" ? "gl-pr-state--waiting" :
        label === "Closed" ? "gl-pr-state--closed" :
        "gl-pr-state--open"

    return <span className={`gl-pr-state ${cls}`}>{label}</span>
}
