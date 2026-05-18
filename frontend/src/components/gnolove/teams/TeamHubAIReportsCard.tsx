/**
 * TeamHubAIReportsCard — embed the most recent AI weekly report,
 * filtered to projects this team drove or contributed to.
 *
 * Phase 5 will swap in a full short/long expand-inline + mobile-sheet
 * treatment. This first cut renders the short form by default, with an
 * inline "Read Detailed Report" toggle (operator decision Q-3) when a
 * long form exists. Empty state explains the situation rather than
 * blanking — the Sunday cron might just not have run yet.
 *
 * Team filter: prefer the backend's `project.team` echo-back (prompt v2);
 * if a v1 report is still showing during the rollover cycle, fall back
 * to "show all projects" so we don't hide everything.
 *
 * @module components/gnolove/teams/TeamHubAIReportsCard
 */

import { useMemo, useState } from "react"
import { useGnoloveAIReports } from "../../../hooks/gnolove"
import type { Team } from "../../../lib/gnoloveConstants"

interface Props {
    team: Team
}

interface AIProject {
    project_name: string
    summary: string
    summary_short?: string
    summary_long?: string
    team?: string
}

function extractProjects(data: unknown): AIProject[] {
    if (!data || typeof data !== "object") return []
    const projects = (data as { projects?: unknown }).projects
    if (!Array.isArray(projects)) return []
    return projects.flatMap(p => {
        if (!p || typeof p !== "object") return []
        const project_name = (p as { project_name?: unknown }).project_name
        const summary = (p as { summary?: unknown }).summary
        if (typeof project_name !== "string" || typeof summary !== "string") return []
        const summary_short = (p as { summary_short?: unknown }).summary_short
        const summary_long = (p as { summary_long?: unknown }).summary_long
        const team = (p as { team?: unknown }).team
        return [{
            project_name,
            summary,
            summary_short: typeof summary_short === "string" ? summary_short : undefined,
            summary_long: typeof summary_long === "string" ? summary_long : undefined,
            team: typeof team === "string" ? team : undefined,
        }]
    })
}

function ProjectRow({ project }: { project: AIProject }) {
    const [expanded, setExpanded] = useState(false)
    // ?? would let an empty string through; the plan's R-8 explicitly calls
    // out using || so empty strings fall back to the legacy field.
    const shortText = project.summary_short || project.summary
    const longText = project.summary_long || project.summary
    const hasDistinctLong = longText && longText !== shortText
    return (
        <article className="gl-thub-ai-project">
            <header className="gl-thub-ai-project-head">
                <h4 className="gl-thub-ai-project-name">{project.project_name}</h4>
                {project.team && (
                    <span className="gl-thub-chip gl-thub-ai-project-team">{project.team}</span>
                )}
            </header>
            <p className="gl-thub-ai-project-summary">
                {expanded && hasDistinctLong ? longText : shortText}
            </p>
            {hasDistinctLong && (
                <button
                    type="button"
                    className="gl-thub-ai-toggle"
                    onClick={() => setExpanded(v => !v)}
                >
                    {expanded ? "Show short summary" : "Read Detailed Report"}
                </button>
            )}
        </article>
    )
}

export function TeamHubAIReportsCard({ team }: Props) {
    const { data: reports, isLoading } = useGnoloveAIReports()

    const latestReport = reports?.[0]
    const filteredProjects = useMemo(() => {
        if (!latestReport) return []
        const all = extractProjects(latestReport.data)
        // If any project carries a `team` field (prompt v2), respect it.
        const anyTagged = all.some(p => p.team)
        if (!anyTagged) return all
        return all.filter(p => p.team?.toLowerCase() === team.slug.toLowerCase())
    }, [latestReport, team.slug])

    if (isLoading && !reports) {
        return (
            <div className="gl-thub-card">
                <h2 className="gl-thub-card-title">AI weekly report</h2>
                <div className="gl-thub-skel-stack">
                    <div className="gl-skeleton gl-skeleton-line" />
                    <div className="gl-skeleton gl-skeleton-line" />
                </div>
            </div>
        )
    }

    if (!latestReport) {
        return (
            <div className="gl-thub-card">
                <h2 className="gl-thub-card-title">AI weekly report</h2>
                <p className="gl-thub-empty">
                    No reports yet. The first one runs on the Sunday cron, or an
                    operator can trigger `/ai/report/regenerate` on demand.
                </p>
            </div>
        )
    }

    const createdAt = new Date(latestReport.createdAt).toUTCString()

    return (
        <div className="gl-thub-card">
            <header className="gl-thub-ai-head">
                <h2 className="gl-thub-card-title" style={{ margin: 0 }}>AI weekly report</h2>
                <span className="gl-thub-chip" title={createdAt}>
                    {new Date(latestReport.createdAt).toLocaleDateString()}
                </span>
            </header>

            {filteredProjects.length === 0 ? (
                <p className="gl-thub-empty">
                    No project in the latest report was attributed to {team.name}.
                </p>
            ) : (
                <div className="gl-thub-ai-projects">
                    {filteredProjects.map(p => <ProjectRow key={p.project_name} project={p} />)}
                </div>
            )}
        </div>
    )
}
