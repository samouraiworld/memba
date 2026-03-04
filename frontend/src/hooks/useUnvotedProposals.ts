/**
 * useUnvotedProposals — returns unvoted proposal details for Quick Vote widget.
 *
 * Returns up to 3 proposals with DAO context, proposal title, and ID.
 * Uses 2-minute sessionStorage cache (same TTL as useUnvotedCount).
 */
import { useState, useEffect, useCallback, useRef } from "react"
import { scanUnvotedProposalDetails, type UnvotedProposal } from "../lib/dao/voteScanner"

export function useUnvotedProposals(address: string | null) {
    const [proposals, setProposals] = useState<UnvotedProposal[]>([])
    const [loading, setLoading] = useState(false)
    const cancelRef = useRef<(() => void) | null>(null)

    const scan = useCallback(() => {
        // Cancel any in-flight scan
        cancelRef.current?.()

        if (!address) {
            setProposals([])
            setLoading(false)
            return
        }

        let cancelled = false
        cancelRef.current = () => { cancelled = true }
        setLoading(true)

        scanUnvotedProposalDetails(address)
            .then((result) => {
                if (!cancelled) setProposals(result)
            })
            .catch(() => {
                if (!cancelled) setProposals([])
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
    }, [address])

    useEffect(() => {
        scan() // eslint-disable-line react-hooks/set-state-in-effect
        return () => { cancelRef.current?.() }
    }, [scan])

    /** Re-scan after voting — cancels in-flight scan and fetches fresh data. */
    const refresh = useCallback(() => {
        scan()
    }, [scan])

    return { proposals, loading, refresh }
}
