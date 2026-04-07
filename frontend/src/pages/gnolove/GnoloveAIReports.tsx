/**
 * GnoloveAIReports — Weekly AI-generated ecosystem reports.
 *
 * Displays Mistral-powered summaries of Gno ecosystem activity,
 * grouped by project with stylized narrative descriptions.
 *
 * @module pages/gnolove/GnoloveAIReports
 */

import { useState, useMemo } from "react"
import { useGnoloveAIReports } from "../../hooks/gnolove"
import type { TAIReport } from "../../lib/gnoloveSchemas"

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
        })
    } catch {
        return iso
    }
}

function ReportCard({ report }: { report: TAIReport }) {
    const projects = report.data?.projects ?? []

    return (
        <div className="gl-panel" style={{ marginBottom: 16 }}>
            <div className="gl-panel-header">
                <h3 className="gl-panel-title">
                    {formatDate(report.createdAt)}
                </h3>
            </div>
            {projects.length === 0 ? (
                <p className="gl-empty-text">No project data in this report.</p>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
                    {projects.map((p, i) => (
                        <div key={i} style={{ padding: "0 16px" }}>
                            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "#a78bfa" }}>
                                {p.project_name}
                            </h4>
                            <p style={{ fontSize: 12, lineHeight: 1.6, color: "#ccc", margin: 0 }}>
                                {p.summary}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export default function GnoloveAIReports() {
    const { data: reports, isLoading } = useGnoloveAIReports()
    const [visibleCount, setVisibleCount] = useState(5)

    const sortedReports = useMemo(() => {
        if (!reports?.length) return []
        return [...reports].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
    }, [reports])

    const visibleReports = sortedReports.slice(0, visibleCount)

    if (isLoading) {
        return (
            <div className="gl-loading">
                <div className="gl-skeleton" />
                <div className="gl-skeleton" />
                <div className="gl-skeleton" />
            </div>
        )
    }

    if (!sortedReports.length) {
        return (
            <div className="gl-empty">
                <p>No AI reports available yet.</p>
                <p style={{ fontSize: 12, color: "#666" }}>
                    Reports are generated weekly by the gnolove backend.
                </p>
            </div>
        )
    }

    return (
        <div className="gl-page">
            <div className="gl-header">
                <h1 className="gl-title">AI Reports</h1>
                <p className="gl-subtitle">
                    Weekly AI-generated ecosystem summaries ({sortedReports.length} reports)
                </p>
            </div>

            {visibleReports.map((report) => (
                <ReportCard key={report.id} report={report} />
            ))}

            {visibleCount < sortedReports.length && (
                <button
                    className="gl-filter-btn gl-filter-btn--active"
                    style={{ margin: "16px auto", display: "block" }}
                    onClick={() => setVisibleCount((c) => c + 5)}
                >
                    Load more ({sortedReports.length - visibleCount} remaining)
                </button>
            )}
        </div>
    )
}
