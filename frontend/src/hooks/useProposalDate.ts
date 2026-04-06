/**
 * useProposalDate — React hook for resolving proposal creation timestamps.
 *
 * Uses the hybrid resolution strategy from proposalDates.ts:
 * ISO string → block estimation → tx-indexer search.
 *
 * @module hooks/useProposalDate
 */

import { useState, useEffect, useRef } from "react"
import { resolveProposalTimestamp, type ProposalTimestamp } from "../lib/dao/proposalDates"

type ResolveState = "idle" | "loading" | "done" | "error"

interface UseProposalDateResult {
    timestamp: ProposalTimestamp | null
    loading: boolean
}

export function useProposalDate(
    realmPath: string | undefined,
    proposalId: number | undefined,
    createdAt?: string,
    createdAtBlock?: number,
): UseProposalDateResult {
    const [state, setState] = useState<{ status: ResolveState; data: ProposalTimestamp | null }>({
        status: "idle",
        data: null,
    })
    const resolvedRef = useRef(false)

    useEffect(() => {
        if (!realmPath || proposalId === undefined || isNaN(proposalId)) return
        if (resolvedRef.current) return

        let cancelled = false

        // State is set only inside async callbacks (not synchronously in effect body)
        resolveProposalTimestamp(realmPath, proposalId, createdAt, createdAtBlock)
            .then(result => {
                if (!cancelled) {
                    resolvedRef.current = true
                    setState({ status: "done", data: result })
                }
            })
            .catch(() => {
                if (!cancelled) setState({ status: "error", data: null })
            })

        return () => { cancelled = true }
    }, [realmPath, proposalId, createdAt, createdAtBlock])

    // Derive loading from whether we have valid inputs but no result yet
    const hasValidInput = !!realmPath && proposalId !== undefined && !isNaN(proposalId)
    const loading = hasValidInput && state.status === "idle"

    return { timestamp: state.data, loading }
}
