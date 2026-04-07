/**
 * AnalystReport — Multi-model AI consensus display for DAO proposals.
 *
 * Two modes:
 * - Collapsed: single-line badge with verdict, confidence, agreement
 * - Expanded: full panel with consensus details + 10 model breakdown
 *
 * Feature-gated behind VITE_ENABLE_ANALYST.
 *
 * @module components/dao/AnalystReport
 */

import { useState } from "react"
import { useAnalystReport } from "../../hooks/useAnalystReport"
import type { ConsensusReport, ConsensusPerspective } from "../../hooks/useAnalystReport"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import "../../pages/analyst.css"

const ANALYST_ENABLED = import.meta.env.VITE_ENABLE_ANALYST === "true"

// ── Verdict Badge ────────────────────────────────────────────

const VERDICT_STYLES: Record<string, { bg: string; color: string; label: string }> = {
    approve: { bg: "rgba(76,175,80,0.1)", color: "#4caf50", label: "APPROVE" },
    reject: { bg: "rgba(244,67,54,0.1)", color: "#f44336", label: "REJECT" },
    caution: { bg: "rgba(255,152,0,0.1)", color: "#ff9800", label: "CAUTION" },
    abstain: { bg: "rgba(158,158,158,0.1)", color: "#9e9e9e", label: "ABSTAIN" },
}

function VerdictBadge({ verdict }: { verdict: string }) {
    const style = VERDICT_STYLES[verdict] || VERDICT_STYLES.abstain
    return (
        <span
            className="analyst-verdict-badge"
            style={{ background: style.bg, color: style.color }}
        >
            {style.label}
        </span>
    )
}

// ── Model Card ───────────────────────────────────────────────

function ModelCard({ perspective }: { perspective: ConsensusPerspective }) {
    const [expanded, setExpanded] = useState(false)

    return (
        <div className="analyst-model-card">
            <button className="analyst-model-card__header" onClick={() => setExpanded(!expanded)}>
                <div className="analyst-model-card__info">
                    <span className="analyst-model-card__name">{perspective.displayName}</span>
                    <span className="analyst-model-card__role">{perspective.role}</span>
                </div>
                <div className="analyst-model-card__verdict">
                    <VerdictBadge verdict={perspective.verdict} />
                    <span className="analyst-model-card__confidence">
                        {Math.round(perspective.confidence * 100)}%
                    </span>
                </div>
            </button>
            {expanded && (
                <div className="analyst-model-card__detail">
                    {perspective.reasoning && (
                        <p className="analyst-model-card__reasoning">{perspective.reasoning}</p>
                    )}
                    {perspective.risks && perspective.risks.length > 0 && (
                        <div className="analyst-model-card__risks">
                            <span className="analyst-model-card__label">Risks:</span>
                            <ul>{perspective.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Main Component ───────────────────────────────────────────

interface AnalystReportProps {
    realmPath: string
    proposalId: number
    proposalData?: string
    daoContext?: string
}

export function AnalystReport({ realmPath, proposalId, proposalData, daoContext }: AnalystReportProps) {
    const [expanded, setExpanded] = useState(false)
    const networkKey = useNetworkKey()
    const { report, loading, error, trigger } = useAnalystReport(realmPath, proposalId, proposalData, daoContext, "proposal", networkKey)

    if (!ANALYST_ENABLED) return null

    // Idle state — show "Run AI Analysis" button (on-demand, not auto-triggered)
    if (!report && !loading && !error) {
        return (
            <div className="analyst-panel" data-testid="analyst-idle">
                <button className="analyst-collapsed" onClick={trigger}>
                    <span className="analyst-icon">🤖</span>
                    <span className="analyst-label">Run AI Analysis</span>
                    <span className="analyst-hint">10 free models analyze this proposal</span>
                </button>
            </div>
        )
    }

    // Loading skeleton
    if (loading) {
        return (
            <div className="analyst-panel analyst-panel--loading" data-testid="analyst-loading">
                <div className="analyst-collapsed">
                    <span className="analyst-icon">🤖</span>
                    <span className="analyst-loading-text">Analyzing with 10 AI models...</span>
                    <div className="analyst-shimmer" />
                </div>
            </div>
        )
    }

    // Error state
    if (error) {
        return (
            <div className="analyst-panel analyst-panel--error" data-testid="analyst-error">
                <div className="analyst-collapsed">
                    <span className="analyst-icon">🤖</span>
                    <span className="analyst-error-text">Analysis unavailable</span>
                    <button className="analyst-retry-btn" onClick={trigger}>Retry</button>
                </div>
            </div>
        )
    }

    if (!report) return null

    const c = report.consensus

    return (
        <div className="analyst-panel" data-testid="analyst-report">
            {/* Collapsed preview */}
            <button
                className="analyst-collapsed"
                onClick={() => setExpanded(!expanded)}
                data-testid="analyst-toggle"
            >
                <span className="analyst-icon">🤖</span>
                <span className="analyst-label">AI Consensus:</span>
                <VerdictBadge verdict={c.verdict} />
                <span className="analyst-confidence">{Math.round(c.confidence * 100)}%</span>
                <span className="analyst-agreement">{c.agreeCount}/{c.totalCount} agree</span>
                <span className={`analyst-caret${expanded ? " open" : ""}`}>▶</span>
            </button>

            {/* Expanded detail */}
            {expanded && (
                <AnalystDetail report={report} onRefresh={trigger} />
            )}
        </div>
    )
}

// ── Detail Panel ─────────────────────────────────────────────

function AnalystDetail({ report, onRefresh }: { report: ConsensusReport; onRefresh: () => void }) {
    const c = report.consensus

    return (
        <div className="analyst-detail" data-testid="analyst-detail">
            {/* Consensus header */}
            <div className="analyst-detail__header">
                <div className="analyst-detail__verdict-row">
                    <VerdictBadge verdict={c.verdict} />
                    <span className="analyst-detail__confidence">
                        {Math.round(c.confidence * 100)}% confidence
                    </span>
                    <span className="analyst-detail__agreement">
                        {c.agreementLevel} ({c.agreeCount}/{c.totalCount})
                    </span>
                </div>
                <p className="analyst-detail__summary">{c.summary}</p>
            </div>

            {/* Key risks */}
            {c.keyRisks && c.keyRisks.length > 0 && (
                <div className="analyst-detail__section">
                    <h4 className="analyst-detail__section-title">Key Risks</h4>
                    <ul className="analyst-detail__list">
                        {c.keyRisks.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                </div>
            )}

            {/* Key recommendations */}
            {c.keyRecommendations && c.keyRecommendations.length > 0 && (
                <div className="analyst-detail__section">
                    <h4 className="analyst-detail__section-title">Recommendations</h4>
                    <ul className="analyst-detail__list">
                        {c.keyRecommendations.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                </div>
            )}

            {/* Model breakdown */}
            <div className="analyst-detail__section">
                <h4 className="analyst-detail__section-title">Model Breakdown</h4>
                <div className="analyst-models">
                    {report.perspectives.map((p, i) => (
                        <ModelCard key={i} perspective={p} />
                    ))}
                </div>
            </div>

            {/* Footer */}
            <div className="analyst-footer">
                <span className="analyst-footer__info">
                    Powered by {report.perspectives.length} free AI models via OpenRouter
                    {report.processingTimeMs > 0 && ` · ${(report.processingTimeMs / 1000).toFixed(1)}s`}
                    {report.cached && " · cached"}
                </span>
                <button className="analyst-footer__refresh" onClick={onRefresh}>
                    Refresh
                </button>
            </div>
        </div>
    )
}
