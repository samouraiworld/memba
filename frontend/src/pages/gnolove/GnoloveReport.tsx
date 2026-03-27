/**
 * GnoloveReport — Weekly PR status report (MVP).
 *
 * Week navigation (forward/backward) with PR status tabs.
 * Ported from gnolove report-client-page.tsx — MVP approach per F4.
 *
 * @module pages/gnolove/GnoloveReport
 */

import { useState, useMemo } from "react"
import { startOfWeek, endOfWeek, addWeeks, format, isFuture } from "date-fns"
import { useGnoloveReport } from "../../hooks/gnolove"
import { REPORT_TAB_LABELS } from "../../lib/gnoloveConstants"
import type { ReportTab } from "../../lib/gnoloveConstants"
import type { TPullRequest } from "../../lib/gnoloveSchemas"

export default function GnoloveReport() {
    const [weekOffset, setWeekOffset] = useState(0)
    const [activeTab, setActiveTab] = useState<ReportTab>("merged")

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

    return (
        <div className="gl-page">
            <div className="gl-header">
                <h1 className="gl-title">📋 Weekly Report</h1>
            </div>

            {/* Week Navigator */}
            <div className="gl-week-nav">
                <button className="gl-week-btn" onClick={() => setWeekOffset(o => o - 1)} aria-label="Previous week">← Previous</button>
                <span className="gl-week-label">
                    {format(start, "MMM d")} — {format(end, "MMM d, yyyy")}
                </span>
                <button
                    className="gl-week-btn"
                    onClick={() => setWeekOffset(o => o + 1)}
                    disabled={!canGoForward}
                    aria-label="Next week"
                >
                    Next →
                </button>
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
                ) : prs.length === 0 ? (
                    <div className="gl-empty">No pull requests in this category for the selected week.</div>
                ) : (
                    <div className="gl-pr-list">
                        {prs.map(pr => (
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
