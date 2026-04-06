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

interface UseProposalDateResult {
    /** Resolved timestamp data (null while loading or if unavailable). */
    timestamp: ProposalTimestamp | null
    /** Whether the timestamp is still being resolved. */
    loading: boolean
}

/**
 * Resolve the creation timestamp for a DAO proposal.
 *
 * @param realmPath     - The DAO realm path (e.g. "gno.land/r/gov/dao")
 * @param proposalId    - The proposal numeric ID
 * @param createdAt     - ISO string from Render parsing (if available)
 * @param createdAtBlock - Block height from Render parsing (if available)
 */
export function useProposalDate(
    realmPath: string | undefined,
    proposalId: number | undefined,
    createdAt?: string,
    createdAtBlock?: number,
): UseProposalDateResult {
    const [timestamp, setTimestamp] = useState<ProposalTimestamp | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!realmPath || proposalId === undefined || isNaN(proposalId)) {
            setTimestamp(null)
            return
        }

        let cancelled = false
        setLoading(true)

        resolveProposalTimestamp(realmPath, proposalId, createdAt, createdAtBlock)
            .then(result => {
                if (!cancelled) setTimestamp(result)
            })
            .catch(() => {
                if (!cancelled) setTimestamp(null)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => { cancelled = true }
    }, [realmPath, proposalId, createdAt, createdAtBlock])

    return { timestamp, loading }
}
