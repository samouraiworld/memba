/**
 * useAnalystReport — Custom hook for fetching multi-model consensus reports.
 *
 * Fetches from POST /api/analyst/consensus. Returns cached results when available.
 * Auto-triggers analysis on mount if no cached report exists.
 *
 * @module hooks/useAnalystReport
 */

import { useState, useEffect, useCallback } from "react"

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080"

// ── Types ────────────────────────────────────────────────────

export interface ConsensusVerdict {
    verdict: "approve" | "reject" | "caution" | "abstain"
    confidence: number
    agreementLevel: "unanimous" | "strong" | "split" | "contested"
    agreeCount: number
    totalCount: number
    summary: string
    keyRisks: string[]
    keyRecommendations: string[]
}

export interface ConsensusPerspective {
    model: string
    displayName: string
    role: string
    verdict: string
    confidence: number
    reasoning: string
    risks: string[]
    recommendations: string[]
}

export interface ConsensusReport {
    consensus: ConsensusVerdict
    perspectives: ConsensusPerspective[]
    processingTimeMs: number
    cached: boolean
    expiresAt?: string
}

interface UseAnalystReportResult {
    report: ConsensusReport | null
    loading: boolean
    error: string | null
    refresh: () => void
}

// ── Hook ─────────────────────────────────────────────────────

export function useAnalystReport(
    realmPath: string | undefined,
    proposalId: number | undefined,
    proposalData?: string,
    daoContext?: string,
): UseAnalystReportResult {
    const [report, setReport] = useState<ConsensusReport | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const fetchReport = useCallback(async () => {
        if (!realmPath || proposalId === undefined || !proposalData) return

        setLoading(true)
        setError(null)

        try {
            const resp = await fetch(`${API_URL}/api/analyst/consensus`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    realmPath,
                    proposalId,
                    proposalData,
                    daoContext: daoContext || "",
                }),
                signal: AbortSignal.timeout(120_000), // 2 min timeout (10 models can take a while)
            })

            if (!resp.ok) {
                const data = await resp.json().catch(() => ({ error: "Analysis unavailable" }))
                setError(data.error || `HTTP ${resp.status}`)
                return
            }

            const data: ConsensusReport = await resp.json()
            setReport(data)
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                setError("Analysis timed out")
            } else {
                setError(err instanceof Error ? err.message : "Analysis failed")
            }
        } finally {
            setLoading(false)
        }
    }, [realmPath, proposalId, proposalData, daoContext])

    useEffect(() => {
        fetchReport()
    }, [fetchReport])

    return { report, loading, error, refresh: fetchReport }
}
