import { useState, useMemo, useCallback } from "react"
import { format, getISOWeek, getISOWeekYear } from "date-fns"
import { TEAMS, TEAM_CSS_COLORS } from "../../../lib/gnoloveConstants"
import type { Team } from "../../../lib/gnoloveConstants"
import type { TPullRequest } from "../../../lib/gnoloveSchemas"
import {
    buildShareUrl,
    type ReportPeriod, type ReportUrlState,
} from "../../../lib/gnoloveReportUrl"
import { filterPrsByCategory } from "../../../lib/gnoloveReportFilters"
import type { EmptyReason } from "./types"
import { EmptyStateMessage } from "./EmptyStateMessage"

interface ReportData {
    merged?: TPullRequest[] | null
    in_progress?: TPullRequest[] | null
    waiting_for_review?: TPullRequest[] | null
    reviewed?: TPullRequest[] | null
    blocked?: TPullRequest[] | null
}

interface Props {
    report: ReportData | null | undefined
    period: ReportPeriod
    start: Date
    end: Date
    selectedTeam: string
    selectedRepos: ReadonlySet<string>
    urlState: ReportUrlState
    networkKey: string
    emptyReason: EmptyReason
    onClearTeam: () => void
    onClearRepos: () => void
    onClearAll: () => void
}

export function NarrativeReportView({
    report, period, start, end, selectedTeam, selectedRepos,
    urlState, networkKey,
    emptyReason, onClearTeam, onClearRepos, onClearAll,
}: Props) {
    const [copied, setCopied] = useState(false)

    const merged = useMemo(() => filterPrsByCategory(report?.merged, selectedTeam, selectedRepos, period, start, end), [report, selectedTeam, selectedRepos, period, start, end])
    const inProgress = useMemo(() => filterPrsByCategory(report?.in_progress, selectedTeam, selectedRepos, period, start, end), [report, selectedTeam, selectedRepos, period, start, end])
    const waitingForReview = useMemo(() => filterPrsByCategory(report?.waiting_for_review, selectedTeam, selectedRepos, period, start, end), [report, selectedTeam, selectedRepos, period, start, end])
    const reviewed = useMemo(() => filterPrsByCategory(report?.reviewed, selectedTeam, selectedRepos, period, start, end), [report, selectedTeam, selectedRepos, period, start, end])
    const blocked = useMemo(() => filterPrsByCategory(report?.blocked, selectedTeam, selectedRepos, period, start, end), [report, selectedTeam, selectedRepos, period, start, end])

    const allPrs = useMemo(
        () => [...merged, ...inProgress, ...waitingForReview, ...reviewed, ...blocked],
        [merged, inProgress, waitingForReview, reviewed, blocked],
    )

    const contributors = useMemo(() => {
        const set = new Set<string>()
        for (const pr of allPrs) if (pr.authorLogin) set.add(pr.authorLogin)
        return Array.from(set).sort()
    }, [allPrs])

    const topMerged = useMemo(
        () => [...merged]
            .sort((a, b) => {
                const ta = a.mergedAt ? new Date(a.mergedAt).getTime() : 0
                const tb = b.mergedAt ? new Date(b.mergedAt).getTime() : 0
                return tb - ta
            })
            .slice(0, 5),
        [merged],
    )

    const getTeamForUser = (login: string): Team | undefined =>
        TEAMS.find(t => t.members.includes(login))

    const reportId = useMemo(() => {
        switch (period) {
            case "weekly":   return `${getISOWeekYear(start)}-W${String(getISOWeek(start)).padStart(2, "0")}`
            case "monthly":  return format(start, "yyyy-MM")
            case "yearly":   return format(start, "yyyy")
            case "all_time": return "all-time"
            case "custom":   return `${format(start, "yyyy-MM-dd")}_${format(end, "yyyy-MM-dd")}`
        }
    }, [period, start, end])

    const teamLabel = selectedTeam === "all" ? "All contributors" : selectedTeam
    const periodHeader = useMemo(() => {
        switch (period) {
            case "weekly":
                return `From ${format(start, "dd/MM")} to ${format(end, "dd/MM")} : ${teamLabel}`
            case "monthly":
                return `Monthly Report — ${format(start, "MMMM yyyy")} : ${teamLabel}`
            case "yearly":
                return `Annual Report — ${format(start, "yyyy")} : ${teamLabel}`
            case "all_time":
                return `All Time Report : ${teamLabel}`
            case "custom":
                return `From ${format(start, "dd/MM/yyyy")} to ${format(end, "dd/MM/yyyy")} : ${teamLabel}`
        }
    }, [period, start, end, teamLabel])

    const generateReportMd = useCallback((): string => {
        const filterUrl = buildShareUrl(window.location.origin, networkKey, urlState, { stripView: true })
        const lines: string[] = [
            periodHeader,
            "",
            "## Stats", "",
            `- PRs Merged: ${merged.length}`,
            `- Waiting for Review: ${waitingForReview.length + reviewed.length}`,
            `- In Progress: ${inProgress.length}`,
            `- Blocked: ${blocked.length}`,
            `- Contributors Active: ${contributors.length}`,
            "", "---", "",
            "## ⭐ Highlights", "",
        ]
        if (topMerged.length > 0) {
            for (const pr of topMerged) {
                lines.push(`- **${pr.title}** - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
        } else {
            lines.push("None this period.")
        }
        lines.push("", "---", "")

        const allWaiting = [...waitingForReview, ...reviewed]
        if (allWaiting.length > 0) {
            lines.push("## 📋 Waiting for Review", "")
            for (const pr of allWaiting) {
                lines.push(`- ${pr.title} - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
            lines.push("", "---", "")
        }
        if (inProgress.length > 0) {
            lines.push("## 🚧 In Progress", "")
            for (const pr of inProgress) {
                lines.push(`- ${pr.title} - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
            lines.push("", "---", "")
        }
        if (blocked.length > 0) {
            lines.push("## 🚧 Blockers", "")
            for (const pr of blocked) {
                lines.push(`- ${pr.title} - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
            lines.push("", "---", "")
        }
        if (merged.length > 0) {
            lines.push("## 🎉 Merged", "")
            for (const pr of merged) {
                lines.push(`- ${pr.title} - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
            lines.push("", "---", "")
        }
        lines.push(
            `## 👥 Active Contributors (${contributors.length})`, "",
            contributors.map(login => `@${login}`).join(" · "),
            "", "---",
            `_Generated by Gnolove · ${reportId}_`,
            `_Filter URL: ${filterUrl}_`,
        )
        return lines.join("\n")
    }, [
        periodHeader, merged, topMerged, inProgress, waitingForReview, reviewed,
        blocked, contributors, reportId, urlState, networkKey,
    ])

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
        const prefix =
            period === "monthly" ? "monthly-report" :
            period === "yearly" ? "annual-report" :
            period === "all_time" ? "all-time-report" :
            "weekly-report"
        a.download = `${prefix}-${reportId}.md`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }, [generateReportMd, reportId, period])

    if (allPrs.length === 0) {
        return (
            <div className="gl-section">
                <EmptyStateMessage
                    reason={emptyReason}
                    selectedTeam={selectedTeam}
                    selectedRepos={Array.from(selectedRepos)}
                    activeTab="all"
                    onClearTeam={onClearTeam}
                    onClearRepos={onClearRepos}
                    onClearTab={() => { /* no-op for narrative view */ }}
                    onClearAll={onClearAll}
                />
            </div>
        )
    }

    return (
        <div className="gl-report-narrative">
            <div className="gl-report-narrative__actions">
                <button className="gl-export-btn" onClick={handleCopy}>
                    {copied ? "✓ Copied!" : "Copy as Markdown"}
                </button>
                <button className="gl-export-btn" onClick={handleDownload}>
                    Download .md
                </button>
                <span className="gl-report-narrative__week-id">{reportId}</span>
            </div>

            <div className="gl-report-narrative__period-header">{periodHeader}</div>

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
