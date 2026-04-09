/**
 * GnoloveReport — PR status report with team/repo filters and export.
 *
 * Two views:
 *  - Report View (default): formatted narrative report (gno-skills style) with
 *    categorized sections, emoji indicators, stats — shareable via copy as MD
 *  - Table View: raw PR list with filters (accessible via ?view=table)
 *
 * Key behaviors:
 *  - Default view is "report" (gno-skills format)
 *  - Repos ordered by priority: gnolang/gno > samouraiworld/* > others
 *  - Multi-select repository filter with checkboxes
 *  - Merged PRs displayed above other statuses
 *  - Weekly scope shows ONLY current week activity
 *  - Merged badge uses purple (not red)
 *
 * Period navigation (weekly/monthly/yearly/all-time) with PR status tabs.
 *
 * @module pages/gnolove/GnoloveReport
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import {
    startOfWeek, endOfWeek, addWeeks,
    startOfMonth, endOfMonth, addMonths,
    startOfYear, endOfYear, addYears,
    format, isFuture, getISOWeek, isWithinInterval,
} from "date-fns"
import { useGnoloveReport, useGnoloveRepositories } from "../../hooks/gnolove"
import { REPORT_TAB_LABELS, TEAMS, TEAM_CSS_COLORS } from "../../lib/gnoloveConstants"
import type { ReportTab, Team } from "../../lib/gnoloveConstants"
import type { TPullRequest } from "../../lib/gnoloveSchemas"
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

/** Check if a PR had any activity within the given date range */
function hasActivityInRange(pr: TPullRequest, start: Date, end: Date): boolean {
    const range = { start, end }
    const dates = [pr.createdAt, pr.mergedAt, pr.updatedAt].filter(Boolean) as string[]
    return dates.some(d => {
        try { return isWithinInterval(new Date(d), range) }
        catch { return false }
    })
}

export default function GnoloveReport() {
    const [searchParams, setSearchParams] = useSearchParams()
    const [period, setPeriod] = useState<ReportPeriod>("weekly")
    const [offset, setOffset] = useState(-1) // Default to previous week (report of past work)
    const [activeTab, setActiveTab] = useState<ReportTab | "all">("all")
    const [selectedTeam, setSelectedTeam] = useState("all")
    const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set(["gnolang/gno"]))
    const [repoDropdownOpen, setRepoDropdownOpen] = useState(false)
    const repoDropdownRef = useRef<HTMLDivElement>(null)
    const [view, setView] = useState<ViewMode>(() => searchParams.get("view") === "table" ? "table" : "report")

    const handleViewToggle = useCallback((v: ViewMode) => {
        setView(v)
        setSearchParams(prev => {
            const next = new URLSearchParams(prev)
            if (v === "table") next.set("view", "table")
            else next.delete("view")
            return next
        }, { replace: true })
    }, [setSearchParams])

    // Close repo dropdown on outside click or Escape key
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (repoDropdownRef.current && !repoDropdownRef.current.contains(e.target as Node)) {
                setRepoDropdownOpen(false)
            }
        }
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") setRepoDropdownOpen(false)
        }
        document.addEventListener("mousedown", handleClick)
        document.addEventListener("keydown", handleKeyDown)
        return () => {
            document.removeEventListener("mousedown", handleClick)
            document.removeEventListener("keydown", handleKeyDown)
        }
    }, [])

    const { data: repos } = useGnoloveRepositories()

    const { start, end } = useMemo(() => computeRange(period, offset), [period, offset])

    const { data: report, isLoading, isError: reportError, refetch } = useGnoloveReport(start, end)

    const prs: TPullRequest[] = useMemo(() => {
        if (!report) return []
        // Order: Merged first, then In Progress, Waiting, Reviewed, Blocked
        return [
            ...(report.merged ?? []),
            ...(report.in_progress ?? []),
            ...(report.waiting_for_review ?? []),
            ...(report.reviewed ?? []),
            ...(report.blocked ?? []),
        ]
    }, [report])

    const filteredPrs = useMemo(() => {
        let result = prs

        // Team filter
        if (selectedTeam !== "all") {
            const team = TEAMS.find(t => t.name === selectedTeam)
            if (team) {
                result = result.filter(pr => pr.authorLogin && team.members.includes(pr.authorLogin))
            }
        }

        // Multi-repo filter
        if (selectedRepos.size > 0) {
            result = result.filter(pr => {
                const repo = extractRepoFromUrl(pr.url)
                return repo ? selectedRepos.has(repo) : false
            })
        }

        // Weekly scope: only show PRs with activity in the selected period
        if (period === "weekly") {
            result = result.filter(pr => hasActivityInRange(pr, start, end))
        }

        // Tab filter
        if (activeTab !== "all") {
            const tabPrs = report?.[activeTab] ?? []
            const tabIds = new Set(tabPrs.map(p => p.id))
            result = result.filter(pr => tabIds.has(pr.id))
        }

        return result
    }, [prs, selectedTeam, selectedRepos, period, start, end, activeTab, report])

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
        setOffset(p === "weekly" ? -1 : 0)
    }

    function toggleRepo(repo: string) {
        setSelectedRepos(prev => {
            const next = new Set(prev)
            if (next.has(repo)) next.delete(repo)
            else next.add(repo)
            return next
        })
    }

    return (
        <div className="gl-page">
            <div className="gl-header">
                <h1 className="gl-title">📋 PR Report</h1>
                <div className="gl-report-actions">
                    <div className="gl-view-toggle">
                        <button
                            className={`gl-view-btn ${view === "report" ? "gl-view-btn--active" : ""}`}
                            onClick={() => handleViewToggle("report")}
                        >
                            Report
                        </button>
                        <button
                            className={`gl-view-btn ${view === "table" ? "gl-view-btn--active" : ""}`}
                            onClick={() => handleViewToggle("table")}
                        >
                            Table
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

                {/* Multi-select repo filter */}
                <div className="gl-repo-multiselect" ref={repoDropdownRef}>
                    <button
                        className="gl-filter-select gl-repo-multiselect-btn"
                        onClick={() => setRepoDropdownOpen(o => !o)}
                        type="button"
                    >
                        {selectedRepos.size === 0
                            ? "All Repositories"
                            : `${selectedRepos.size} repo${selectedRepos.size > 1 ? "s" : ""} selected`}
                        <span className="gl-repo-multiselect-arrow">{repoDropdownOpen ? "▲" : "▼"}</span>
                    </button>
                    {repoDropdownOpen && (
                        <div className="gl-repo-multiselect-dropdown">
                            <label className="gl-repo-multiselect-option gl-repo-multiselect-option--all">
                                <input
                                    type="checkbox"
                                    checked={selectedRepos.size === 0}
                                    onChange={() => setSelectedRepos(new Set())}
                                />
                                <span>All Repositories</span>
                            </label>
                            {repos?.map(repo => {
                                const key = `${repo.owner}/${repo.name}`
                                return (
                                    <label key={repo.id} className="gl-repo-multiselect-option">
                                        <input
                                            type="checkbox"
                                            checked={selectedRepos.has(key)}
                                            onChange={() => toggleRepo(key)}
                                        />
                                        <span>{key}</span>
                                    </label>
                                )
                            })}
                        </div>
                    )}
                </div>
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
                    period={period}
                    start={start}
                    end={end}
                    selectedTeam={selectedTeam}
                    selectedRepos={selectedRepos}
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

interface ReportData {
    merged?: TPullRequest[] | null
    in_progress?: TPullRequest[] | null
    waiting_for_review?: TPullRequest[] | null
    reviewed?: TPullRequest[] | null
    blocked?: TPullRequest[] | null
}

function NarrativeReportView({ report, period, start, end, selectedTeam, selectedRepos }: {
    report: ReportData | null | undefined
    period: ReportPeriod
    start: Date
    end: Date
    selectedTeam: string
    selectedRepos: Set<string>
}) {
    const [copied, setCopied] = useState(false)

    // Apply team/repo/scope filters to all categories
    const filterPrs = useCallback((prs: TPullRequest[] | null | undefined): TPullRequest[] => {
        let result = prs ?? []
        if (selectedTeam !== "all") {
            const team = TEAMS.find(t => t.name === selectedTeam)
            if (team) result = result.filter(pr => pr.authorLogin && team.members.includes(pr.authorLogin))
        }
        if (selectedRepos.size > 0) {
            result = result.filter(pr => {
                const repo = extractRepoFromUrl(pr.url)
                return repo ? selectedRepos.has(repo) : false
            })
        }
        // Weekly scope: only PRs with activity in range
        if (period === "weekly") {
            result = result.filter(pr => hasActivityInRange(pr, start, end))
        }
        return result
    }, [selectedTeam, selectedRepos, period, start, end])

    const merged = useMemo(() => filterPrs(report?.merged), [report, filterPrs])
    const inProgress = useMemo(() => filterPrs(report?.in_progress), [report, filterPrs])
    const waitingForReview = useMemo(() => filterPrs(report?.waiting_for_review), [report, filterPrs])
    const reviewed = useMemo(() => filterPrs(report?.reviewed), [report, filterPrs])
    const blocked = useMemo(() => filterPrs(report?.blocked), [report, filterPrs])

    const allPrs = useMemo(() => [...merged, ...inProgress, ...waitingForReview, ...reviewed, ...blocked], [merged, inProgress, waitingForReview, reviewed, blocked])

    // Active contributors
    const contributors = useMemo(() => {
        const set = new Set<string>()
        for (const pr of allPrs) {
            if (pr.authorLogin) set.add(pr.authorLogin)
        }
        return Array.from(set).sort()
    }, [allPrs])

    // Top merged PRs (by title length as impact proxy)
    const topMerged = useMemo(() =>
        [...merged].sort((a, b) => b.title.length - a.title.length).slice(0, 5),
        [merged]
    )

    // Find contributor team
    const getTeamForUser = (login: string): Team | undefined =>
        TEAMS.find(t => t.members.includes(login))

    const weekId = `${format(start, "yyyy")}-W${String(getISOWeek(start)).padStart(2, "0")}`

    // Period header for gno-skills format
    const periodHeader = useMemo(() => {
        switch (period) {
            case "weekly":
                return `From ${format(start, "dd/MM")} to ${format(end, "dd/MM")} : Samourai crews`
            case "monthly":
                return `Monthly Report — ${format(start, "MMMM yyyy")} : Samourai crews`
            case "yearly":
                return `Annual Report — ${format(start, "yyyy")} : Samourai crews`
            case "all_time":
                return "All Time Report : Samourai crews"
        }
    }, [period, start, end])

    // Generate shareable markdown (gno-skills format)
    // Order: Stats → Highlights → Waiting for Review → In Progress → Blockers → Merged → Contributors
    const generateReportMd = useCallback((): string => {
        const lines: string[] = [
            periodHeader,
            "",
        ]

        // --- Stats (overview first) ---
        lines.push(
            "## Stats", "",
            `- PRs Merged: ${merged.length}`,
            `- Waiting for Review: ${waitingForReview.length + reviewed.length}`,
            `- In Progress: ${inProgress.length}`,
            `- Blocked: ${blocked.length}`,
            `- Contributors Active: ${contributors.length}`,
            "", "---", ""
        )

        // --- Highlights ---
        lines.push("## ⭐ Highlights", "")
        if (topMerged.length > 0) {
            for (const pr of topMerged) {
                lines.push(`- **${pr.title}** - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
        } else {
            lines.push("None this period.")
        }
        lines.push("", "---", "")

        // --- Waiting for Review ---
        const allWaiting = [...waitingForReview, ...reviewed]
        if (allWaiting.length > 0) {
            lines.push("## 📋 Waiting for Review", "")
            for (const pr of allWaiting) {
                lines.push(`- ${pr.title} - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
            lines.push("", "---", "")
        }

        // --- In Progress ---
        if (inProgress.length > 0) {
            lines.push("## 🚧 In Progress", "")
            for (const pr of inProgress) {
                lines.push(`- ${pr.title} - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
            lines.push("", "---", "")
        }

        // --- Blockers ---
        if (blocked.length > 0) {
            lines.push("## 🚧 Blockers", "")
            for (const pr of blocked) {
                lines.push(`- ${pr.title} - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
            lines.push("", "---", "")
        }

        // --- Merged (done work — reference at bottom) ---
        if (merged.length > 0) {
            lines.push("## 🎉 Merged", "")
            for (const pr of merged) {
                lines.push(`- ${pr.title} - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
            lines.push("", "---", "")
        }

        // --- Contributors ---
        lines.push(`## 👥 Active Contributors (${contributors.length})`, "",
            contributors.map(login => `@${login}`).join(" · "),
            "", "---", `_Generated by Gnolove · ${weekId}_`)
        return lines.join("\n")
    }, [periodHeader, merged, topMerged, inProgress, waitingForReview, reviewed, blocked, contributors, weekId])

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
        const prefix = period === "monthly" ? "monthly-report" : period === "yearly" ? "annual-report" : "weekly-report"
        const fileDateId = period === "monthly" ? format(start, "yyyy-MM") : period === "yearly" ? format(start, "yyyy") : weekId
        a.download = `${prefix}-${fileDateId}.md`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }, [generateReportMd, weekId, period, start])

    if (allPrs.length === 0) {
        return <div className="gl-section"><div className="gl-empty">No data for this period.</div></div>
    }

    return (
        <div className="gl-report-narrative">
            {/* Copy / Download actions */}
            <div className="gl-report-narrative__actions">
                <button className="gl-export-btn" onClick={handleCopy}>
                    {copied ? "✓ Copied!" : "Copy as Markdown"}
                </button>
                <button className="gl-export-btn" onClick={handleDownload}>
                    Download .md
                </button>
                <span className="gl-report-narrative__week-id">{weekId}</span>
            </div>

            {/* Period Header */}
            <div className="gl-report-narrative__period-header">{periodHeader}</div>

            {/* 1. Stats — overview first */}
            <section className="gl-report-narrative__section">
                <h2 className="gl-report-narrative__heading">📊 Stats</h2>
                <div className="gl-report-narrative__stats">
                    <div className="gl-report-narrative__stat">
                        <span className="gl-report-narrative__stat-value">{merged.length}</span>
                        <span className="gl-report-narrative__stat-label">Merged</span>
                    </div>
                    <div className="gl-report-narrative__stat">
                        <span className="gl-report-narrative__stat-value">{waitingForReview.length + reviewed.length}</span>
                        <span className="gl-report-narrative__stat-label">Waiting</span>
                    </div>
                    <div className="gl-report-narrative__stat">
                        <span className="gl-report-narrative__stat-value">{inProgress.length}</span>
                        <span className="gl-report-narrative__stat-label">In Progress</span>
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

            {/* 2. Highlights */}
            <section className="gl-report-narrative__section">
                <h2 className="gl-report-narrative__heading">⭐ Highlights</h2>
                {topMerged.length > 0 ? (
                    <ul className="gl-report-narrative__list">
                        {topMerged.map(pr => (
                            <li key={pr.id}>
                                <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number}</a>: <strong>{pr.title}</strong>
                                {pr.authorLogin && <span className="gl-report-narrative__author"> @{pr.authorLogin}</span>}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="gl-report-narrative__empty">No merged PRs this period.</p>
                )}
            </section>

            {/* 3. Waiting for Review */}
            {(waitingForReview.length + reviewed.length) > 0 && (
                <section className="gl-report-narrative__section">
                    <h2 className="gl-report-narrative__heading">📋 Waiting for Review ({waitingForReview.length + reviewed.length})</h2>
                    <ul className="gl-report-narrative__list">
                        {[...waitingForReview, ...reviewed].map(pr => (
                            <li key={pr.id}>
                                <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number}</a>: {pr.title}
                                {pr.authorLogin && <span className="gl-report-narrative__author"> @{pr.authorLogin}</span>}
                                {pr.reviewDecision && (
                                    <span className={`gl-pr-state gl-pr-state--${pr.reviewDecision === "APPROVED" ? "open" : "waiting"}`} style={{ marginLeft: 6 }}>
                                        {pr.reviewDecision === "APPROVED" ? "Approved" : pr.reviewDecision === "CHANGES_REQUESTED" ? "Changes Requested" : "Review Required"}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* 4. In Progress */}
            {inProgress.length > 0 && (
                <section className="gl-report-narrative__section">
                    <h2 className="gl-report-narrative__heading">🚧 In Progress ({inProgress.length})</h2>
                    <ul className="gl-report-narrative__list">
                        {inProgress.map(pr => (
                            <li key={pr.id}>
                                <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number}</a>: {pr.title}
                                {pr.authorLogin && <span className="gl-report-narrative__author"> @{pr.authorLogin}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* 5. Blockers */}
            {blocked.length > 0 && (
                <section className="gl-report-narrative__section gl-report-narrative__section--blockers">
                    <h2 className="gl-report-narrative__heading">🚧 Blockers ({blocked.length})</h2>
                    <ul className="gl-report-narrative__list">
                        {blocked.map(pr => (
                            <li key={pr.id}>
                                <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number}</a>: {pr.title}
                                {pr.authorLogin && <span className="gl-report-narrative__author"> @{pr.authorLogin}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* 6. Merged — done work at bottom */}
            {merged.length > 0 && (
                <section className="gl-report-narrative__section">
                    <h2 className="gl-report-narrative__heading">🎉 Merged ({merged.length})</h2>
                    <ul className="gl-report-narrative__list">
                        {merged.map(pr => {
                            const team = pr.authorLogin ? getTeamForUser(pr.authorLogin) : undefined
                            return (
                                <li key={pr.id}>
                                    <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number}</a>: {pr.title}
                                    {pr.authorLogin && (
                                        <span className="gl-report-narrative__author">
                                            {" "}@{pr.authorLogin}
                                            {team && <span className="gl-report-narrative__team-dot" style={{ background: TEAM_CSS_COLORS[team.color] }} title={team.name} />}
                                        </span>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                </section>
            )}

            {/* Active Contributors */}
            <section className="gl-report-narrative__section">
                <h2 className="gl-report-narrative__heading">👥 Active Contributors ({contributors.length})</h2>
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
