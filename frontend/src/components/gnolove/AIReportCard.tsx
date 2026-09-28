/**
 * AIReportCard — shared component for one AI weekly report.
 *
 * Replaces the inline ReportCard in pages/gnolove/GnoloveAIReports.tsx and
 * the project-row block in components/gnolove/teams/TeamHubAIReportsCard.tsx.
 *
 * Phase 5 additions over the Phase 4 first cut:
 *   - Short/long inline toggle per project, with a "Read Detailed Report"
 *     label (operator decision Q-3). Empty strings fall back to the legacy
 *     `summary` via `||` (plan R-8 — never `??`).
 *   - On mobile viewports (≤768px, via the shared `useIsMobile` hook), the
 *     long view opens as a bottom sheet instead of expanding inline. Reactive
 *     to viewport changes via the hook's matchMedia listener.
 *   - Optional `teamSlug` filters projects to those tagged with that team
 *     (prompt v2 `team` field). Falls back to "show all" when no project
 *     in the report carries a team tag — keeps v1 rollover usable.
 *
 * @module components/gnolove/AIReportCard
 */

import { useCallback, useEffect, useState } from "react"
import type { TAIReport, TAIReportProject } from "../../lib/gnoloveSchemas"
import { AccessibleDialog } from "../AccessibleDialog"
import { RepoBadge } from "./RepoBadge"
import { sortReposWithCorePinned } from "../../lib/gnoloveRepo"
import { aiReportDate, reportToMarkdown } from "../../lib/gnoloveAiExport"
import { useIsMobile } from "../../hooks/useIsMobile"

interface Props {
    report: TAIReport
    /** When set, render only the projects tagged with this slug. */
    teamSlug?: string
    /** Highlight visually (deep-link target). */
    highlighted?: boolean
    /** Ref-setter so callers can scroll-into-view a deep-linked report. */
    refSetter?: (el: HTMLDivElement | null) => void
    /** Which URL param to use in the copy-link button. Defaults to "aiReport". */
    permalinkParam?: "aiReport" | "id"
    /** Hide the per-card chrome (copy/download/link buttons). Used by the team-hub embed. */
    compact?: boolean
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString("en-US", {
            year: "numeric", month: "long", day: "numeric",
        })
    } catch {
        return iso
    }
}

function downloadMarkdown(report: TAIReport) {
    const blob = new Blob([reportToMarkdown(report)], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `gnolove-ai-report-${aiReportDate(report.createdAt)}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

function filterByTeam(projects: TAIReportProject[], slug: string | undefined): { filtered: TAIReportProject[]; teamFallback: boolean } {
    if (!slug) return { filtered: projects, teamFallback: false }
    const tagged = projects.some(p => typeof p.team === "string" && p.team.length > 0)
    if (!tagged) return { filtered: projects, teamFallback: true }
    const want = slug.toLowerCase()
    return { filtered: projects.filter(p => (p.team ?? "").toLowerCase() === want), teamFallback: false }
}

/**
 * Slugify a project name for the URL hash. Plan §2 deep-link shape is
 * `?aiReport=<cycle>#<project_name>` — keep the legacy project-name hash but
 * scope DOM IDs and hash handling to the requested report.
 *
 * Kept un-exported because react-refresh/only-export-components forbids
 * mixing non-component exports with components. If another file needs
 * this, extract it to lib/.
 */
function projectAnchor(name: string): string {
    return name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
}

/** Read the current URL hash, stripped of the leading `#`. */
function currentHash(): string {
    if (typeof window === "undefined") return ""
    try {
        return decodeURIComponent(window.location.hash.replace(/^#/, ""))
    } catch {
        return ""
    }
}

function ProjectRow({ project, isMobile, reportId, index }: { project: TAIReportProject; isMobile: boolean; reportId: string; index: number }) {
    const [expanded, setExpanded] = useState(false)
    const [highlighted, setHighlighted] = useState(false)
    // R-8 explicitly: use `||`, NOT `??`, to drop empty strings.
    const shortText = project.summary_short || project.summary
    const longText = project.summary_long || project.summary
    const hasDistinctLong = !!(longText && longText !== shortText)
    const showLongAsSheet = isMobile && expanded && hasDistinctLong
    const showLongInline = !isMobile && expanded && hasDistinctLong

    const anchor = projectAnchor(project.project_name)
    const uniqueId = `${encodeURIComponent(reportId)}-${index}-${anchor}`
    const rowId = `gl-aircard-project-${uniqueId}`
    const sheetTitleId = `gl-aircard-sheet-title-${uniqueId}`
    const searchParams = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search)
    const reportTarget = searchParams.get("aiReport") ?? searchParams.get("id")

    // Plan §2 deep-link: `?aiReport=<id>#<project_name>` should scroll to the
    // matching ProjectRow and auto-expand it. Reacts to hashchange too so the
    // operator's "Copy link" (future) doesn't require a page reload to work.
    useEffect(() => {
        if (typeof window === "undefined") return
        const onHash = () => {
            if (reportTarget === reportId && currentHash() === anchor) {
                setExpanded(true)
                setHighlighted(true)
                setTimeout(() => setHighlighted(false), 1500)
                // Scroll into view if the browser hasn't already done so —
                // hashes set after first paint don't auto-scroll on every browser.
                const el = document.getElementById(rowId)
                el?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
        }
        onHash()
        window.addEventListener("hashchange", onHash)
        return () => window.removeEventListener("hashchange", onHash)
    }, [anchor, reportId, reportTarget, rowId])

    return (
        <div
            id={rowId}
            className={`gl-aircard-project${highlighted ? " gl-aircard-project--highlight" : ""}`}
            data-project-anchor={anchor}
        >
            <div className="gl-aircard-project-head">
                <h4 className="gl-aircard-project-name">
                    {project.project_name}
                    <RepoBadge repo={project.project_name} />
                </h4>
                {project.team && (
                    <span className="gl-thub-chip gl-aircard-project-team">{project.team}</span>
                )}
            </div>

            <p className="gl-aircard-project-summary">
                {showLongInline ? longText : shortText}
            </p>

            {hasDistinctLong && (
                <button
                    type="button"
                    className="gl-aircard-toggle"
                    onClick={() => setExpanded(v => !v)}
                    aria-expanded={expanded}
                >
                    {expanded ? "Show short summary" : "Read Detailed Report"}
                </button>
            )}

            <AccessibleDialog
                open={showLongAsSheet}
                onClose={() => setExpanded(false)}
                labelledBy={sheetTitleId}
                className="gl-aircard-sheet-backdrop"
            >
                <div className="gl-aircard-sheet">
                    <div className="gl-aircard-sheet-head">
                        <h4 id={sheetTitleId} className="gl-aircard-project-name">{project.project_name}</h4>
                        <button
                            type="button"
                            className="gl-aircard-sheet-close"
                            onClick={() => setExpanded(false)}
                            aria-label="Close"
                        >
                            ×
                        </button>
                    </div>
                    <p className="gl-aircard-sheet-body">{longText}</p>
                </div>
            </AccessibleDialog>
        </div>
    )
}

export function AIReportCard({
    report,
    teamSlug,
    highlighted = false,
    refSetter,
    permalinkParam = "aiReport",
    compact = false,
}: Props) {
    const { filtered: unsorted, teamFallback } = filterByTeam(report.data?.projects ?? [], teamSlug)
    const projects = sortReposWithCorePinned(unsorted, p => p.project_name)
    const isMobile = useIsMobile()
    const [copied, setCopied] = useState(false)
    const [linkCopied, setLinkCopied] = useState(false)

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(reportToMarkdown(report)).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        })
    }, [report])

    const handleCopyLink = useCallback(() => {
        const params = new URLSearchParams(window.location.search)
        params.set(permalinkParam, report.id)
        const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`
        navigator.clipboard.writeText(url).then(() => {
            setLinkCopied(true)
            setTimeout(() => setLinkCopied(false), 1500)
        })
    }, [report.id, permalinkParam])

    return (
        <div
            ref={refSetter}
            className={`gl-panel gl-aircard${highlighted ? " gl-panel--highlight" : ""}`}
            data-report-id={report.id}
        >
            <div className="gl-aircard-head">
                <h3 className="gl-panel-title">{formatDate(report.createdAt)}</h3>
                {!compact && (
                    <div className="gl-aircard-actions">
                        <button
                            className="gl-export-btn"
                            onClick={handleCopyLink}
                            aria-label={`Copy permalink to report from ${formatDate(report.createdAt)}`}
                        >
                            {linkCopied ? "✓ Linked" : "🔗 Link"}
                        </button>
                        <button className="gl-export-btn" onClick={handleCopy}>
                            {copied ? "Copied!" : "Copy"}
                        </button>
                        <button className="gl-export-btn" onClick={() => downloadMarkdown(report)}>
                            Download MD
                        </button>
                    </div>
                )}
            </div>

            {teamFallback && (
                <p className="gl-aircard-fallback-hint">
                    Team tagging not available for this report — showing all projects.
                </p>
            )}

            {projects.length === 0 ? (
                <p className="gl-empty-text">
                    {teamSlug
                        ? `No project in this report was attributed to ${teamSlug}.`
                        : "No project data in this report."}
                </p>
            ) : (
                <div className="gl-aircard-projects">
                    {projects.map((p, i) => (
                        <ProjectRow key={`${p.project_name}-${i}`} project={p} isMobile={isMobile} reportId={report.id} index={i} />
                    ))}
                </div>
            )}
        </div>
    )
}
