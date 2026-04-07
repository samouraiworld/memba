/**
 * DAOAIInsight — AI Council Analysis Report for DAO governance health.
 *
 * Auto-fetches cached report on mount (server caches 6h, shared across users).
 * Shows inline inside the DAO overview card as an elegant collapsed section.
 * Expandable for full details with risks, recommendations, model breakdown.
 *
 * @module components/dao/DAOAIInsight
 */

import { useState } from "react"
import { useAnalystReport } from "../../hooks/useAnalystReport"
import type { ConsensusReport } from "../../hooks/useAnalystReport"
import { useNetworkKey } from "../../hooks/useNetworkNav"
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

// ── Main Component ───────────────────────────────────────────

interface DAOAIInsightProps {
    realmPath: string
    daoSummary: string
}

export function DAOAIInsight({ realmPath, daoSummary }: DAOAIInsightProps) {
    const networkKey = useNetworkKey()
    const { report, loading, error, trigger } = useAnalystReport(
        realmPath, 0, daoSummary, realmPath, "dao", networkKey,
    )
    const [expanded, setExpanded] = useState(false)

    if (!ANALYST_ENABLED) return null

    // Loading — subtle shimmer bar
    if (loading) {
        return (
            <div className="ai-council">
                <div className="ai-council__bar">
                    <span className="ai-council__icon">🤖</span>
                    <span className="ai-council__label">AI Council analyzing...</span>
                    <div className="ai-council__shimmer" />
                </div>
            </div>
        )
    }

    // Error — subtle retry link, not a big red card
    if (error && !report) {
        return (
            <div className="ai-council">
                <button className="ai-council__bar ai-council__bar--clickable" onClick={trigger}>
                    <span className="ai-council__icon">🤖</span>
                    <span className="ai-council__label">AI Council Analysis Report</span>
                    <span className="ai-council__retry">Generate report</span>
                </button>
            </div>
        )
    }

    if (!report) return null

    const c = report.consensus
    const { grade, color } = verdictToGrade(c.verdict, c.confidence)
    const respondedCount = report.perspectives.filter(p => p.verdict !== "abstain").length

    return (
        <div className="ai-council">
            {/* Collapsed bar */}
            <button
                className="ai-council__bar ai-council__bar--clickable"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="ai-council__icon">🤖</span>
                <span className="ai-council__label">AI Council Analysis Report</span>
                <span className="ai-council__grade" style={{ color }}>{grade}</span>
                <span className="ai-council__summary-text">
                    {c.verdict === "approve" ? "Healthy" : c.verdict === "caution" ? "Caution" : c.verdict === "reject" ? "Issues" : "Pending"}
                    {" "}· {Math.round(c.confidence * 100)}%
                    {" "}· {respondedCount}/{c.totalCount} models
                </span>
                <span className={`ai-council__caret${expanded ? " open" : ""}`}>▸</span>
            </button>

            {/* Expanded detail */}
            {expanded && <AICouncilDetail report={report} onRefresh={trigger} />}
        </div>
    )
}

// ── Detail Panel ─────────────────────────────────────────────

function AICouncilDetail({ report, onRefresh }: { report: ConsensusReport; onRefresh: () => void }) {
    const c = report.consensus
    const { grade, color } = verdictToGrade(c.verdict, c.confidence)
    const responded = report.perspectives.filter(p => p.verdict !== "abstain")

    return (
        <div className="ai-council__detail">
            {/* Header */}
            <div className="ai-council__detail-header">
                <span className="ai-council__detail-grade" style={{ color }}>{grade}</span>
                <div className="ai-council__detail-meta">
                    <span className="ai-council__detail-confidence">
                        {Math.round(c.confidence * 100)}% confidence · {c.agreementLevel}
                    </span>
                    <span className="ai-council__detail-models">
                        {responded.length} of {report.perspectives.length} models responded
                    </span>
                </div>
            </div>

            {/* Summary */}
            <p className="ai-council__detail-summary">{c.summary}</p>

            {/* Risks + Recommendations side by side */}
            <div className="ai-council__columns">
                {c.keyRisks && c.keyRisks.length > 0 && (
                    <div className="ai-council__column">
                        <span className="ai-council__column-title">Risks</span>
                        {c.keyRisks.slice(0, 5).map((r, i) => (
                            <span key={i} className="ai-council__column-item ai-council__column-item--risk">
                                {r}
                            </span>
                        ))}
                    </div>
                )}
                {c.keyRecommendations && c.keyRecommendations.length > 0 && (
                    <div className="ai-council__column">
                        <span className="ai-council__column-title">Recommendations</span>
                        {c.keyRecommendations.slice(0, 5).map((r, i) => (
                            <span key={i} className="ai-council__column-item ai-council__column-item--rec">
                                {r}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Model breakdown — collapsible */}
            <details className="ai-council__models">
                <summary className="ai-council__models-toggle">
                    Model Breakdown
                </summary>
                <div className="ai-council__models-grid">
                    {report.perspectives.map((p, i) => {
                        const v = p.verdict === "approve" ? "#4caf50"
                            : p.verdict === "caution" ? "#ff9800"
                            : p.verdict === "reject" ? "#f44336" : "#444"
                        return (
                            <div key={i} className="ai-council__model">
                                <div className="ai-council__model-header">
                                    <span className="ai-council__model-name">{p.displayName}</span>
                                    <span className="ai-council__model-verdict" style={{ color: v }}>
                                        {p.verdict} {p.confidence > 0 ? `${Math.round(p.confidence * 100)}%` : ""}
                                    </span>
                                </div>
                                <span className="ai-council__model-role">{p.role}</span>
                                {p.reasoning && p.verdict !== "abstain" && (
                                    <p className="ai-council__model-reasoning">{p.reasoning}</p>
                                )}
                            </div>
                        )
                    })}
                </div>
            </details>

            {/* Footer */}
            <div className="ai-council__footer">
                <span>
                    {report.perspectives.length} AI models via OpenRouter
                    {report.cached ? " · cached" : ""}
                    {report.processingTimeMs > 0 && !report.cached ? ` · ${(report.processingTimeMs / 1000).toFixed(0)}s` : ""}
                </span>
                <button className="ai-council__refresh" onClick={onRefresh}>Refresh</button>
            </div>
        </div>
    )
}
