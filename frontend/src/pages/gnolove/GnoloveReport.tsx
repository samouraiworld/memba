/**
 * GnoloveReport — PR status report with team/repo filters and export.
 *
 * Period navigation (weekly/monthly/yearly/all-time) with PR status tabs.
 * Ported from gnolove report-client-page.tsx — MVP approach per F4.
 *
 * @module pages/gnolove/GnoloveReport
 */

import { useState, useMemo } from "react"
import {
    startOfWeek, endOfWeek, addWeeks,
    startOfMonth, endOfMonth, addMonths,
    startOfYear, endOfYear, addYears,
    format, isFuture,
} from "date-fns"
import { useGnoloveReport, useGnoloveRepositories } from "../../hooks/gnolove"
import { REPORT_TAB_LABELS, TEAMS } from "../../lib/gnoloveConstants"
import type { ReportTab } from "../../lib/gnoloveConstants"
import type { TPullRequest } from "../../lib/gnoloveSchemas"
import { exportToCSV, exportToMarkdown, exportToPDF } from "../../lib/gnoloveExport"
import { extractRepoFromUrl } from "../../lib/gnoloveApi"

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
    const [period, setPeriod] = useState<ReportPeriod>("weekly")
    const [offset, setOffset] = useState(0)
    const [activeTab, setActiveTab] = useState<ReportTab>("merged")
    const [selectedTeam, setSelectedTeam] = useState("all")
    const [selectedRepo, setSelectedRepo] = useState("all")

    const { data: repos } = useGnoloveRepositories()

    const { start, end } = useMemo(() => computeRange(period, offset), [period, offset])

    const { data: report, isLoading, isError: reportError, refetch } = useGnoloveReport(start, end)

    const prs: TPullRequest[] = useMemo(() => {
        if (!report) return []
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
        if (!report) return {} as Record<ReportTab, number>
        return {
            merged: report.merged?.length ?? 0,
            in_progress: report.in_progress?.length ?? 0,
            waiting_for_review: report.waiting_for_review?.length ?? 0,
            reviewed: report.reviewed?.length ?? 0,
            blocked: report.blocked?.length ?? 0,
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
        setOffset(0)
    }

    return (
        <div className="gl-page">
            <div className="gl-header">
                <h1 className="gl-title">📋 PR Report</h1>
                <div className="gl-report-actions">
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

            {/* PR List */}
            <div className="gl-section">
                {isLoading ? (
                    <div className="gl-loading">
                        <div className="gl-skeleton" /><div className="gl-skeleton" /><div className="gl-skeleton" />
                    </div>
                ) : filteredPrs.length === 0 ? (
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
        </div>
    )
}

function PRStateBadge({ state, mergedAt, tab }: { state: string; mergedAt: string | null; tab: ReportTab }) {
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
