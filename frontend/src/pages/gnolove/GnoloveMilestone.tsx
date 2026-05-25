/**
 * GnoloveMilestone — Dedicated milestone page with progress and issue list.
 *
 * @module pages/gnolove/GnoloveMilestone
 */

import { useGnoloveMilestone } from "../../hooks/gnolove"
import { PageMeta } from "../../components/gnolove/PageMeta"
import { renderMarkdown } from "../../lib/markdownLite"

export default function GnoloveMilestone() {
    const { data: milestone, isLoading } = useGnoloveMilestone()

    if (isLoading) {
        return (
            <div className="gl-loading">
                <div className="gl-skeleton" />
                <div className="gl-skeleton" />
            </div>
        )
    }

    if (!milestone) {
        return <div className="gl-empty"><p>No milestone data available.</p></div>
    }

    const closedCount = milestone.issues.filter(i => i.state === "CLOSED").length
    const totalCount = milestone.issues.length
    const progress = totalCount > 0 ? Math.round((closedCount / totalCount) * 100) : 0

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
                        className={`gl-ms-progress-fill${progress === 100 ? " gl-ms-progress-fill--done" : ""}`}
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>

            {milestone.description && (
                <div className="gl-panel gl-mb-16">
                    {/* renderMarkdown escapes all HTML then applies safe markdown transforms; source is GitHub API */}
                    <div
                        className="gl-ms-description"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(milestone.description) }}
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
