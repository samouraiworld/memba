/**
 * GnoloveMilestone — Dedicated milestone page with progress and issue list.
 *
 * @module pages/gnolove/GnoloveMilestone
 */

import { useGnoloveMilestone } from "../../hooks/gnolove"

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
            <div className="gl-header">
                <h1 className="gl-title">Milestone #{milestone.number}</h1>
                <p className="gl-subtitle">{milestone.title}</p>
            </div>

            {/* Progress bar */}
            <div className="gl-panel" style={{ marginBottom: 16 }}>
                <div className="gl-panel-header">
                    <h2 className="gl-panel-title">Progress</h2>
                    <span className="gl-panel-subtitle">
                        {closedCount}/{totalCount} issues closed ({progress}%)
                    </span>
                </div>
                <div style={{ padding: "8px 16px 16px" }}>
                    <div style={{
                        height: 8,
                        borderRadius: 4,
                        background: "rgba(255,255,255,0.08)",
                        overflow: "hidden",
                    }}>
                        <div style={{
                            height: "100%",
                            width: `${progress}%`,
                            background: progress === 100 ? "#22c55e" : "#a78bfa",
                            borderRadius: 4,
                            transition: "width 0.3s ease",
                        }} />
                    </div>
                </div>
            </div>

            {/* Description */}
            {milestone.description && (
                <div className="gl-panel" style={{ marginBottom: 16 }}>
                    <div style={{ padding: 16, fontSize: 13, lineHeight: 1.7, color: "var(--color-text-secondary)" }}>
                        {milestone.description}
                    </div>
                </div>
            )}

            {/* Issues list */}
            <div className="gl-panel">
                <div className="gl-panel-header">
                    <h2 className="gl-panel-title">Issues ({totalCount})</h2>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    {milestone.issues.map((issue) => (
                        <a
                            key={issue.id}
                            href={issue.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "10px 16px",
                                borderBottom: "1px solid rgba(255,255,255,0.04)",
                                textDecoration: "none",
                                color: "var(--color-text)",
                                fontSize: 13,
                            }}
                        >
                            <span style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: issue.state === "CLOSED" ? "#22c55e" : "#eab308",
                                flexShrink: 0,
                            }} />
                            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {issue.title}
                            </span>
                            <span style={{ color: "var(--color-text-secondary)", fontSize: 11, flexShrink: 0 }}>
                                #{issue.number}
                            </span>
                        </a>
                    ))}
                </div>
            </div>
        </div>
    )
}
