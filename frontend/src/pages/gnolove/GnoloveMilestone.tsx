/**
 * GnoloveMilestone — Dedicated milestone page with progress and issue list.
 *
 * @module pages/gnolove/GnoloveMilestone
 */

import { useGnoloveMilestone } from "../../hooks/gnolove"
import { PageMeta } from "../../components/gnolove/PageMeta"
import { renderMarkdown } from "../../lib/markdownLite"
import { sanitizeMarkdownHtml } from "../../lib/sanitizeMarkdownHtml"

export default function GnoloveMilestone() {
    const { data: milestone, isLoading, isError, refetch } = useGnoloveMilestone()

    if (isLoading) {
        return (
            <div className="gl-page">
                <PageMeta title="Milestone | Gnolove · Memba" />
                <div className="gl-loading">
                    <div className="gl-skeleton" />
                    <div className="gl-skeleton" />
                </div>
            </div>
        )
    }

    if (!milestone) {
        return <div className="gl-page gl-empty">
            <PageMeta title="Milestone unavailable | Gnolove · Memba" noindex />
            <h1>Milestone unavailable</h1>
            <p>{isError ? "The milestone could not be loaded." : "No milestone data is available."}</p>
            {isError && <button type="button" className="gl-filter-btn" onClick={() => refetch()}>Retry</button>}
        </div>
    }

    const closedCount = milestone.issues.filter(i => i.state === "CLOSED").length
    const totalCount = milestone.issues.length
    const progress = totalCount > 0 ? Math.round((closedCount / totalCount) * 100) : 0
    const complete = totalCount > 0 && closedCount === totalCount

    return (
        <div className="gl-page">
            <PageMeta title={`Milestone #${milestone.number} — ${milestone.title} | Gnolove · Memba`} description={`Progress tracking for milestone "${milestone.title}".`} />
            <div className="gl-header">
                <h1 className="gl-title">Milestone #{milestone.number}</h1>
                <p className="gl-subtitle">{milestone.title}</p>
            </div>

            <div className="gl-panel gl-mb-16">
                <div className="gl-panel-header">
                    <h2 className="gl-panel-title">Progress</h2>
                    <span className="gl-panel-subtitle">
                        {closedCount}/{totalCount} issues closed ({progress}%)
                    </span>
                </div>
                <div className="gl-ms-progress-track">
                    <div
                        className={`gl-ms-progress-fill${complete ? " gl-ms-progress-fill--done" : ""}`}
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>

            {milestone.description && (
                <div className="gl-panel gl-mb-16">
                    <h2 className="gl-panel-title">Original milestone description</h2>
                    {complete && <p className="gl-panel-subtitle">This milestone is complete. Its original description below may still refer to work in progress.</p>}
                    {/* Text from the GitHub API: rendered, then sanitised like every other renderMarkdown output. */}
                    <div
                        className="gl-ms-description"
                        dangerouslySetInnerHTML={{ __html: sanitizeMarkdownHtml(renderMarkdown(milestone.description)) }}
                    />
                </div>
            )}

            <div className="gl-panel">
                <div className="gl-panel-header">
                    <h2 className="gl-panel-title">Issues ({totalCount})</h2>
                </div>
                <div className="gl-ms-issues">
                    {milestone.issues.map((issue) => (
                        <a
                            key={issue.id}
                            href={issue.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="gl-ms-issue"
                        >
                            <span className={`gl-ms-issue-dot${issue.state === "CLOSED" ? " gl-ms-issue-dot--closed" : ""}`} />
                            <span className="gl-ms-issue-title">{issue.title}</span>
                            <span className="gl-ms-issue-number">#{issue.number}</span>
                        </a>
                    ))}
                </div>
            </div>
        </div>
    )
}
