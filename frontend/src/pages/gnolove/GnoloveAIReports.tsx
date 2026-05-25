/**
 * GnoloveAIReports — Weekly AI-generated ecosystem reports.
 *
 * Displays Mistral-powered summaries of Gno ecosystem activity,
 * grouped by project with stylized narrative descriptions.
 *
 * @module pages/gnolove/GnoloveAIReports
 */

import { useState, useMemo, useEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { useGnoloveAIReports } from "../../hooks/gnolove"
import { AIReportCard } from "../../components/gnolove/AIReportCard"
import { PageMeta } from "../../components/gnolove/PageMeta"

export default function GnoloveAIReports() {
    const { data: reports, isLoading } = useGnoloveAIReports()
    const [baseVisibleCount, setBaseVisibleCount] = useState(5)
    const [searchParams] = useSearchParams()
    // Phase 5 namespacing: prefer ?aiReport=, accept ?id= as a back-compat
    // fallback so previously-shared links still scroll to the right card.
    const targetId = searchParams.get("aiReport") ?? searchParams.get("id")
    const targetRef = useRef<HTMLDivElement | null>(null)

    const sortedReports = useMemo(() => {
        if (!reports?.length) return []
        return [...reports].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
    }, [reports])

    // Effective visible count auto-expands to include the deep-linked target if it's
    // below the user's current "load more" cutoff. Pure computation — no setState in effect.
    const effectiveVisibleCount = useMemo(() => {
        if (!targetId || sortedReports.length === 0) return baseVisibleCount
        const idx = sortedReports.findIndex(r => r.id === targetId)
        return idx >= 0 ? Math.max(baseVisibleCount, idx + 1) : baseVisibleCount
    }, [targetId, sortedReports, baseVisibleCount])

    // Scroll-into-view on mount when ?id= is present.
    useEffect(() => {
        if (!targetId || !targetRef.current) return
        const el = targetRef.current
        const handle = window.requestAnimationFrame(() => {
            el.scrollIntoView({ behavior: "smooth", block: "center" })
        })
        return () => window.cancelAnimationFrame(handle)
    }, [targetId, sortedReports.length])

    const visibleReports = sortedReports.slice(0, effectiveVisibleCount)

    if (isLoading) {
        return (
            <div className="gl-page">
                <PageMeta title="AI Reports | Gnolove · Memba" description="Weekly AI-generated ecosystem summaries for the Gno ecosystem." />
                <div className="gl-header">
                    <h1 className="gl-title">AI Reports</h1>
                    <p className="gl-subtitle">Weekly AI-generated ecosystem summaries</p>
                </div>
                <div className="gl-skeleton gl-skeleton--card" />
                <div className="gl-skeleton gl-skeleton--card" />
                <div className="gl-skeleton gl-skeleton--card" />
            </div>
        )
    }

    if (!sortedReports.length) {
        return (
            <div className="gl-empty">
                <p>No AI reports available yet.</p>
                <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    Reports are generated weekly by the gnolove backend.
                </p>
            </div>
        )
    }

    return (
        <div className="gl-page">
            <PageMeta title="AI Reports | Gnolove · Memba" description="Weekly AI-generated ecosystem summaries for the Gno ecosystem." />
            <div className="gl-header">
                <h1 className="gl-title">AI Reports</h1>
                <p className="gl-subtitle">
                    Weekly AI-generated ecosystem summaries ({sortedReports.length} reports)
                </p>
            </div>

            {visibleReports.map((report) => (
                <AIReportCard
                    key={report.id}
                    report={report}
                    highlighted={report.id === targetId}
                    refSetter={report.id === targetId ? (el) => { targetRef.current = el } : undefined}
                />
            ))}

            {effectiveVisibleCount < sortedReports.length && (
                <button
                    className="gl-filter-btn gl-filter-btn--active"
                    style={{ margin: "16px auto", display: "block" }}
                    onClick={() => setBaseVisibleCount((c) => c + 5)}
                >
                    Load more ({sortedReports.length - effectiveVisibleCount} remaining)
                </button>
            )}
        </div>
    )
}
