/**
 * useProposalDate — React hook for resolving proposal creation timestamps.
 *
 * Uses the hybrid resolution strategy from proposalDates.ts:
 * ISO string → block estimation → tx-indexer search.
 *
 * @module hooks/useProposalDate
 */

import { useState, useEffect } from "react"
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

    // Deliberately NO resolve-once ref: on a cold ProposalView visit the first
    // run resolves with createdAt still undefined (the detail query hasn't
    // landed) and may settle on the tx-search approximation — when the exact
    // chain-rendered date arrives, the dep change must re-resolve and replace
    // it. Stable deps mean the effect doesn't re-fire, so no ref is needed to
    // prevent duplicate work.
    useEffect(() => {
        if (!realmPath || proposalId === undefined || isNaN(proposalId)) return

        let cancelled = false

        // State is set only inside async callbacks (not synchronously in effect body)
        resolveProposalTimestamp(realmPath, proposalId, createdAt, createdAtBlock)
            .then(result => {
                if (!cancelled) {
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
