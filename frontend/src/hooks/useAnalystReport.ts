/**
 * useAnalystReport — Custom hook for fetching multi-model consensus reports.
 *
 * Fetches from POST /api/analyst/consensus. Returns cached results when available.
 * Only triggers when proposal data is available (non-empty).
 * Gracefully handles backend unavailability without flooding console.
 *
 * @module hooks/useAnalystReport
 */

import { useState, useEffect, useCallback, useRef } from "react"

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
    /** Manually trigger analysis (on-demand, not auto-triggered). */
    trigger: () => void
}

// ── Hook ─────────────────────────────────────────────────────

export function useAnalystReport(
    realmPath: string | undefined,
    proposalId: number | undefined,
    proposalData?: string,
    daoContext?: string,
    analysisType: "proposal" | "dao" = "proposal",
): UseAnalystReportResult {
    const [report, setReport] = useState<ConsensusReport | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const abortRef = useRef<AbortController | null>(null)
    // Track if we've already attempted a fetch to avoid re-triggering on prop changes
    const fetchedRef = useRef(false)

    const fetchReport = useCallback(async (force = false) => {
        // Must have valid realm, proposal ID, and non-empty proposal data
        if (!realmPath || proposalId === undefined || !proposalData || proposalData.trim() === "") return

        // Don't re-fetch unless forced (refresh button)
        if (fetchedRef.current && !force) return
        fetchedRef.current = true

        // Cancel any in-flight request
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setLoading(true)
        setError(null)

        try {
            const url = force
                ? `${API_URL}/api/analyst/consensus?force=1`
                : `${API_URL}/api/analyst/consensus`
            const resp = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    realmPath,
                    proposalId,
                    analysisType,
                    proposalData,
                    daoContext: daoContext || "",
                }),
                signal: controller.signal,
            })

            if (controller.signal.aborted) return

            if (!resp.ok) {
                const data = await resp.json().catch(() => ({ error: "Analysis unavailable" }))
                setError(data.error || `HTTP ${resp.status}`)
                return
            }

            const data: ConsensusReport = await resp.json()
            setReport(data)
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") return
            // Silently handle network errors (backend not deployed, CORS, etc.)
            setError("Analysis unavailable")
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false)
            }
        }
    }, [realmPath, proposalId, proposalData, daoContext, analysisType])

    // Reset state when context changes
    useEffect(() => {
        fetchedRef.current = false
        setReport(null)
        setError(null)
        setLoading(false)
    }, [realmPath, proposalId])

    // Auto-fetch for DAO-level analysis (server-cached 6h, shared across users)
    useEffect(() => {
        if (analysisType !== "dao") return
        if (!proposalData || proposalData.trim() === "") return
        fetchReport()
        return () => { abortRef.current?.abort() }
    }, [analysisType, fetchReport]) // eslint-disable-line react-hooks/exhaustive-deps

    // Cleanup on unmount
    useEffect(() => {
        return () => { abortRef.current?.abort() }
    }, [])

    const trigger = useCallback(() => {
        fetchedRef.current = false
        fetchReport(true)
    }, [fetchReport])

    return { report, loading, error, trigger }
}
