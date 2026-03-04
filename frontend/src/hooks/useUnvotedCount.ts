/**
 * useUnvotedCount — returns the number of unvoted proposals across saved DAOs.
 *
 * Powers the notification dot on the 🏛️ DAO nav link.
 * Scans max 5 saved DAOs × 5 active proposals with 2-minute sessionStorage cache.
 * Re-scans when vote cache is cleared (via clearVoteCache custom event).
 */
import { useState, useEffect, useCallback, useRef } from "react"
import { scanUnvotedProposals } from "../lib/dao/voteScanner"

export function useUnvotedCount(address: string | null) {
    const [unvotedCount, setUnvotedCount] = useState(0)
    const [loading, setLoading] = useState(false)
    const mountedRef = useRef(true)

    const scan = useCallback(() => {
        if (!address) {
            setUnvotedCount(0)
            return
        }
        setLoading(true)
        scanUnvotedProposals(address)
            .then((count) => { if (mountedRef.current) setUnvotedCount(count) })
            .catch(() => { if (mountedRef.current) setUnvotedCount(0) })
            .finally(() => { if (mountedRef.current) setLoading(false) })
    }, [address])

    // Initial scan on mount / address change
    useEffect(() => {
        mountedRef.current = true
        scan() // eslint-disable-line react-hooks/set-state-in-effect -- async callback, not synchronous
        return () => { mountedRef.current = false }
    }, [scan])

    // Re-scan when vote cache is cleared (after voting from any page)
    useEffect(() => {
        const handler = () => scan()
        window.addEventListener("memba:voteCacheCleared", handler)
        return () => window.removeEventListener("memba:voteCacheCleared", handler)
    }, [scan])

    return { unvotedCount, loading }
}
