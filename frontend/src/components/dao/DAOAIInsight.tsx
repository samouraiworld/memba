/**
 * DAOAIInsight — Compact AI governance health badge for the DAO overview card.
 *
 * Idle: small "AI Insight" stat card in the grid.
 * Click: triggers on-demand 10-model analysis.
 * Result: shows grade + tooltip with summary. Click "Details" to expand full report.
 *
 * @module components/dao/DAOAIInsight
 */

import { useState, useRef, useEffect } from "react"
import { useAnalystReport } from "../../hooks/useAnalystReport"
import type { ConsensusReport } from "../../hooks/useAnalystReport"
import "../../pages/analyst.css"

const ANALYST_ENABLED = import.meta.env.VITE_ENABLE_ANALYST === "true"

// ── Verdict to Grade ─────────────────────────────────────────

function verdictToGrade(verdict: string, confidence: number): { grade: string; color: string } {
    if (verdict === "approve") {
        if (confidence >= 0.8) return { grade: "A+", color: "#4caf50" }
        if (confidence >= 0.6) return { grade: "A", color: "#4caf50" }
        return { grade: "B+", color: "#8bc34a" }
    }
    if (verdict === "caution") {
        if (confidence >= 0.6) return { grade: "B", color: "#ff9800" }
        return { grade: "C+", color: "#ff9800" }
    }
    if (verdict === "reject") {
        if (confidence >= 0.6) return { grade: "D", color: "#f44336" }
        return { grade: "C", color: "#f44336" }
    }
    return { grade: "—", color: "#666" }
}

// ── Model Card (inline) ─────────────────────────────────────

function ModelRow({ p }: { p: ConsensusReport["perspectives"][0] }) {
    const v = p.verdict === "approve" ? "#4caf50" : p.verdict === "caution" ? "#ff9800" : p.verdict === "reject" ? "#f44336" : "#666"
    return (
        <div className="ai-insight-model-row">
            <span className="ai-insight-model-name">{p.displayName}</span>
            <span className="ai-insight-model-role">{p.role}</span>
            <span className="ai-insight-model-verdict" style={{ color: v }}>
                {p.verdict} {Math.round(p.confidence * 100)}%
            </span>
        </div>
    )
}

// ── Main Component ───────────────────────────────────────────

interface DAOAIInsightProps {
    realmPath: string
    daoSummary: string  // Pre-built text with DAO metrics
}

export function DAOAIInsight({ realmPath, daoSummary }: DAOAIInsightProps) {
    const { report, loading, error, trigger } = useAnalystReport(
        realmPath, 0, daoSummary, realmPath, "dao",
    )
    const [showTooltip, setShowTooltip] = useState(false)
    const [showDetail, setShowDetail] = useState(false)
    const tooltipRef = useRef<HTMLDivElement>(null)

    // Close tooltip on outside click
    useEffect(() => {
        if (!showTooltip) return
        const handler = (e: MouseEvent) => {
            if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
                setShowTooltip(false)
            }
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [showTooltip])

    if (!ANALYST_ENABLED) return null

    // Idle state — clickable stat card
    if (!report && !loading && !error) {
        return (
            <button
                className="k-stat-card k-stat-card--clickable ai-insight-card"
                title="Run AI governance health analysis (10 free models)"
                onClick={trigger}
            >
                <span className="k-stat-card__icon">🤖</span>
                <div>
                    <div className="k-stat-card__value">AI</div>
                    <div className="k-stat-card__label">Insight</div>
                </div>
            </button>
        )
    }

    // Loading
    if (loading) {
        return (
            <button className="k-stat-card ai-insight-card ai-insight-card--loading" disabled>
                <span className="k-stat-card__icon">🤖</span>
                <div>
                    <div className="k-stat-card__value ai-insight-shimmer-text">...</div>
                    <div className="k-stat-card__label">Analyzing</div>
                </div>
            </button>
        )
    }

    // Error
    if (error) {
        return (
            <button
                className="k-stat-card k-stat-card--clickable ai-insight-card"
                title="Analysis failed — click to retry"
                onClick={trigger}
            >
                <span className="k-stat-card__icon">🤖</span>
                <div>
                    <div className="k-stat-card__value" style={{ color: "#f44336" }}>!</div>
                    <div className="k-stat-card__label">Retry</div>
                </div>
            </button>
        )
    }

    if (!report) return null

    const c = report.consensus
    const { grade, color } = verdictToGrade(c.verdict, c.confidence)

    return (
        <>
            {/* Stat card with grade */}
            <div className="ai-insight-wrapper" ref={tooltipRef}>
                <button
                    className="k-stat-card k-stat-card--clickable ai-insight-card ai-insight-card--active"
                    onClick={() => setShowTooltip(!showTooltip)}
                    title="AI Governance Health — click for details"
                >
                    <span className="k-stat-card__icon">🤖</span>
                    <div>
                        <div className="k-stat-card__value" style={{ color }}>{grade}</div>
                        <div className="k-stat-card__label">AI Health</div>
                    </div>
                </button>

                {/* Tooltip */}
                {showTooltip && (
                    <div className="ai-insight-tooltip">
                        <div className="ai-insight-tooltip__header">
                            <span className="ai-insight-tooltip__grade" style={{ color }}>{grade}</span>
                            <span className="ai-insight-tooltip__confidence">
                                {Math.round(c.confidence * 100)}% confidence · {c.agreeCount}/{c.totalCount} agree
                            </span>
                        </div>
                        <p className="ai-insight-tooltip__summary">{c.summary}</p>
                        {c.keyRisks && c.keyRisks.length > 0 && (
                            <div className="ai-insight-tooltip__risks">
                                {c.keyRisks.slice(0, 2).map((r, i) => (
                                    <span key={i} className="ai-insight-tooltip__risk">• {r}</span>
                                ))}
                            </div>
                        )}
                        <button
                            className="ai-insight-tooltip__expand"
                            onClick={() => { setShowTooltip(false); setShowDetail(!showDetail) }}
                        >
                            {showDetail ? "Hide Details" : "View Full Report →"}
                        </button>
                    </div>
                )}
            </div>

            {/* Expanded detail panel — rendered outside the stat grid */}
            {showDetail && (
                <div className="ai-insight-detail-portal" data-testid="ai-dao-detail">
                    <DAOAnalystDetail report={report} onClose={() => setShowDetail(false)} onRefresh={trigger} />
                </div>
            )}
        </>
    )
}

// ── Detail Panel ─────────────────────────────────────────────

function DAOAnalystDetail({ report, onClose, onRefresh }: { report: ConsensusReport; onClose: () => void; onRefresh: () => void }) {
    const c = report.consensus
    const { grade, color } = verdictToGrade(c.verdict, c.confidence)

    return (
        <div className="ai-insight-detail">
            <div className="ai-insight-detail__header">
                <div className="ai-insight-detail__title">
                    <span style={{ color }}>{grade}</span> AI Governance Health Report
                </div>
                <button className="ai-insight-detail__close" onClick={onClose}>✕</button>
            </div>

            <p className="ai-insight-detail__summary">{c.summary}</p>

            {c.keyRisks && c.keyRisks.length > 0 && (
                <div className="ai-insight-detail__section">
                    <span className="ai-insight-detail__label">Risks</span>
                    <ul>{c.keyRisks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
            )}
            {c.keyRecommendations && c.keyRecommendations.length > 0 && (
                <div className="ai-insight-detail__section">
                    <span className="ai-insight-detail__label">Recommendations</span>
                    <ul>{c.keyRecommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
            )}

            <details className="ai-insight-detail__models">
                <summary className="ai-insight-detail__models-toggle">
                    Model Breakdown ({report.perspectives.length} models)
                </summary>
                <div className="ai-insight-detail__models-list">
                    {report.perspectives.map((p, i) => <ModelRow key={i} p={p} />)}
                </div>
            </details>

            <div className="ai-insight-detail__footer">
                <span>Powered by {report.perspectives.length} free AI models · {(report.processingTimeMs / 1000).toFixed(1)}s{report.cached ? " · cached" : ""}</span>
                <button className="analyst-footer__refresh" onClick={onRefresh}>Refresh</button>
            </div>
        </div>
    )
}
