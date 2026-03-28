/**
 * GnoloveReport — Weekly PR status report with team/repo filters and export.
 *
 * Week navigation (forward/backward) with PR status tabs.
 * Ported from gnolove report-client-page.tsx — MVP approach per F4.
 *
 * @module pages/gnolove/GnoloveReport
 */

import { useState, useMemo } from "react"
import { startOfWeek, endOfWeek, addWeeks, format, isFuture } from "date-fns"
import { useGnoloveReport, useGnoloveRepositories } from "../../hooks/gnolove"
import { REPORT_TAB_LABELS, TEAMS } from "../../lib/gnoloveConstants"
import type { ReportTab } from "../../lib/gnoloveConstants"
import type { TPullRequest } from "../../lib/gnoloveSchemas"
import { exportToCSV, exportToMarkdown } from "../../lib/gnoloveExport"

function extractRepoFromUrl(url: string): string {
    const match = url.match(/github\.com\/([^/]+\/[^/]+)/)
    return match ? match[1] : ""
}

export default function GnoloveReport() {
    const [weekOffset, setWeekOffset] = useState(0)
    const [activeTab, setActiveTab] = useState<ReportTab>("merged")
    const [selectedTeam, setSelectedTeam] = useState("all")
    const [selectedRepo, setSelectedRepo] = useState("all")

    const { data: repos } = useGnoloveRepositories()

    const { start, end } = useMemo(() => {
        const ref = addWeeks(new Date(), weekOffset)
        return {
            start: startOfWeek(ref, { weekStartsOn: 1 }),
            end: endOfWeek(ref, { weekStartsOn: 1 }),
        }
    }, [weekOffset])

    const { data: report, isLoading } = useGnoloveReport(start, end)

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

    const canGoForward = !isFuture(addWeeks(start, 1))
    const weekLabel = `${format(start, "MMM d")} — ${format(end, "MMM d, yyyy")}`

    return (
        <div className="gl-page">
            <div className="gl-header">
                <h1 className="gl-title">📋 Weekly Report</h1>
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
                        onClick={() => exportToMarkdown(filteredPrs, activeTab, weekLabel)}
                        disabled={filteredPrs.length === 0}
                    >
                        Export MD
                    </button>
                </div>
            </div>

            {/* Week Navigator */}
            <div className="gl-week-nav">
                <button className="gl-week-btn" onClick={() => setWeekOffset(o => o - 1)} aria-label="Previous week">← Previous</button>
                <span className="gl-week-label">{weekLabel}</span>
                <button
                    className="gl-week-btn"
                    onClick={() => setWeekOffset(o => o + 1)}
                    disabled={!canGoForward}
                    aria-label="Next week"
                >
                    Next →
                </button>
            </div>

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
                    <div className="gl-empty">No pull requests in this category for the selected week.</div>
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
