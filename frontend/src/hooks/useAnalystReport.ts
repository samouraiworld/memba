/**
 * useAnalystReport — Custom hook for fetching multi-model consensus reports.
 *
 * Fetches from POST /api/analyst/consensus. Returns cached results when available.
 * Only triggers when proposal data is available (non-empty).
 * Gracefully handles backend unavailability without flooding console.
 *
 * v3.3: Network-scoped caching (chainId in POST + sessionStorage persistence).
 *
 * @module hooks/useAnalystReport
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react"

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080"

// ── Types ────────────────────────────────────────────────────

export interface ConsensusVerdict {
    verdict: "approve" | "reject" | "caution" | "abstain"
    confidence: number
    agreementLevel: "unanimous" | "strong" | "split" | "contested"
    agreeCount: number
    respondedCount: number
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
    responded?: boolean
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

// ── SessionStorage Helpers ───────────────────────────────────

function getSessionCache(key: string): ConsensusReport | null {
    try {
        const cached = sessionStorage.getItem(key)
        if (cached) return JSON.parse(cached) as ConsensusReport
    } catch { /* ignore parse/quota errors */ }
    return null
}

function setSessionCache(key: string, report: ConsensusReport): void {
    try {
        sessionStorage.setItem(key, JSON.stringify(report))
    } catch { /* quota exceeded — non-blocking */ }
}

// ── Hook ─────────────────────────────────────────────────────

export function useAnalystReport(
    realmPath: string | undefined,
    proposalId: number | undefined,
    proposalData?: string,
    daoContext?: string,
    analysisType: "proposal" | "dao" = "proposal",
    networkKey?: string,
): UseAnalystReportResult {
    // Network-scoped cache key to prevent cross-chain data pollution
    const cacheKey = useMemo(
        () => `memba_analyst_${networkKey || "default"}_${realmPath}_${proposalId}_${analysisType}`,
        [networkKey, realmPath, proposalId, analysisType],
    )

    // Rehydrate from sessionStorage on init (prevents loading flash on re-navigation)
    const [report, setReport] = useState<ConsensusReport | null>(() => {
        const cached = getSessionCache(cacheKey)
        return cached
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const abortRef = useRef<AbortController | null>(null)
    // Track WHICH cacheKey a fetch was already attempted for (avoids re-triggering
    // on prop changes). Key-scoped instead of a boolean so it never needs resetting
    // when the context changes — a new cacheKey simply doesn't match (W4: refs must
    // not be written during render, so a resettable boolean is not an option).
    const fetchedKeyRef = useRef<string | null>(report ? cacheKey : null)

    // Reset state when context changes (realm, proposal, or network) — the React
    // docs "adjust state during render" pattern (prev-key guard) instead of an
    // effect, so the old context's report is never rendered for the new key and
    // no setState runs synchronously inside an effect.
    const [prevCacheKey, setPrevCacheKey] = useState(cacheKey)
    if (prevCacheKey !== cacheKey) {
        setPrevCacheKey(cacheKey)
        // Rehydrate from sessionStorage for the new context (or clear)
        setReport(getSessionCache(cacheKey))
        setError(null)
        setLoading(false)
    }

    const fetchReport = useCallback(async (force = false) => {
        // Must have valid realm, proposal ID, and non-empty proposal data
        if (!realmPath || proposalId === undefined || !proposalData || proposalData.trim() === "") return

        // Don't re-fetch unless forced (refresh button): skip when a fetch was
        // already attempted for this key, or a session-cached report exists
        // (rehydrated at init or on key change — previously fetchedRef=true).
        if (!force && (fetchedKeyRef.current === cacheKey || getSessionCache(cacheKey) !== null)) return
        // SEC: /api/analyst/consensus now requires auth (prevents unauthenticated
        // LLM cost-drain). Skip silently when not signed in; don't mark fetched so
        // it can run once the user authenticates and re-navigates.
        const authToken = (() => { try { return localStorage.getItem("memba_auth_token") || "" } catch { return "" } })()
        if (!authToken) return
        fetchedKeyRef.current = cacheKey

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
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
                body: JSON.stringify({
                    realmPath,
                    proposalId,
                    analysisType,
                    chainId: networkKey || "",
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
            setSessionCache(cacheKey, data)
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") return
            // Silently handle network errors (backend not deployed, CORS, etc.)
            setError("Analysis unavailable")
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false)
            }
        }
    }, [realmPath, proposalId, proposalData, daoContext, analysisType, networkKey, cacheKey])

    // Auto-fetch for DAO-level analysis (server-cached 6h, shared across users)
    // W4 (set-state-in-effect): the fetch kickoff is deferred one microtask so
    // fetchReport's setLoading/setError never run synchronously in the effect
    // body. Runs before paint — no visible difference; the cancelled guard
    // preserves the original "no fetch after cleanup" behavior.
    useEffect(() => {
        if (analysisType !== "dao") return
        if (!proposalData || proposalData.trim() === "") return
        let cancelled = false
        queueMicrotask(() => {
            if (!cancelled) fetchReport()
        })
        return () => {
            cancelled = true
            abortRef.current?.abort()
        }
    }, [analysisType, fetchReport]) // eslint-disable-line react-hooks/exhaustive-deps

    // Cleanup on unmount
    useEffect(() => {
        return () => { abortRef.current?.abort() }
    }, [])

    const trigger = useCallback(() => {
        fetchedKeyRef.current = null
        fetchReport(true)
    }, [fetchReport])

    return { report, loading, error, trigger }
}
